# AGENTS.md — Dimensionamento de Linha (PCP)

> Fonte da verdade sobre arquitetura, convenções e regras deste projeto. Ao tomar uma decisão
> nova, **atualize este arquivo** (registro de decisões no fim).

Idioma do projeto: código, comentários e docs em **português**; nomes de branch e mensagens de
commit em **inglês**.

---

## 1. O que é

Web app interno de **planejamento de capacidade e dimensionamento de linha de produção**.
Substitui a planilha **"Dimensionamento de Linha"** (`1UWobn-...`, 16 abas) e seus 6 arquivos
Apps Script. A engenharia reversa completa está em
[docs/planilha-dimensionamento-de-linha.md](docs/planilha-dimensionamento-de-linha.md); o código
original ficou preservado em [scripts/apps-script/](scripts/apps-script/).

Segue o guia de [dev-standards](dev-standards/AGENTS.md) (repo separado, gitignored aqui).

---

## 2. ⛔ A planilha é SOMENTE LEITURA

**Nunca** escrever, alterar, limpar ou criar nada na planilha de origem. Ela é usada pelo PCP no
dia a dia e tem 18 editores.

- Todo acesso usa escopo `spreadsheets.readonly`.
- Não existe rota no app que fale com o Google Sheets — a leitura acontece só no importador
  (`scripts/importar_planilha.py`), fora do runtime.
- A lógica de escrita do Apps Script (`ploteRelatorio`, `plotarNaProjecao`, `setValue`,
  `clearContent`) foi **reimplementada contra o Postgres do app**, nunca contra o Sheets.
- A service account `operations-dashboard@tractian-bi` deve ficar como **leitor**.

---

## 3. Arquitetura

Processo único, no padrão do projeto-exemplo Quality Center:

```
server.cjs           Express: serve dist/ + monta /api/* + fallback SPA
api/_lib/routes.js   roteamento file-based: api/_handlers/<nome>.js -> /api/<nome>
api/_lib/db.js       pool pg + migrations com retry (o app pode subir antes do banco)
api/_lib/auth.js     X-Auth-Email do gateway da Vibe (sem login próprio)
api/_lib/motor/      o cálculo, puro e testável
api/_lib/cenario.js  carrega um cenário e roda o motor
src/                 React 18 + TS + Vite + Tailwind
```

- **Banco**: `postgres:16`. Migrations em `api/migrations/*.sql`, aplicadas na subida.
- **Auth**: o proxy injeta `X-Auth-Email` (`@tractian.com`). No dev local vale `DEV_FAKE_EMAIL`,
  que é ignorado quando `NODE_ENV=production`.
- **Air-gapped**: nenhuma dependência baixada em runtime. As fontes Inter/Inter Tight vêm do
  npm (`@fontsource/*`) e são empacotadas no build — **não** usar o CDN do Google Fonts, mesmo
  que o brand guide mostre `@import`.

### Rotas

| Rota | O que faz |
|---|---|
| `me` | e-mail do usuário logado |
| `cenarios` | listar, detalhar (com cálculo), duplicar, comparar, marcar oficial |
| `planejamento` | editar meta/demanda/dias úteis/componentes (o `PATCH` já cria o termo faltante do dispositivo editado); alinhar termos e incluir faltantes em lote (sem UI desde 17/08) |
| `forecast` | o forecast externo por Country/Model e o mapa Model→dispositivo |
| `dimensionamento` | a grade do Dimensionamento Global (sem cenário): ler, editar, carregar tempos |
| `roteiros` | processos e sequências (Base simplificada); `?acao=produto` cadastra produto |
| `sku` | catálogo Base de PROD (CRUD, com renomear código) + mapa SKU→produto + pendências |
| `projecao` | grade do calendário e geração da demanda |
| `demandas` | lista de demanda editável + exportação CSV |
| `alocacao` | heat map de operadores |
| `parametros` | jornada, coeficientes, feriados |
| `desvios` | catálogo das divergências conhecidas |
| `importacao` | recebe o payload do importador; histórico |

---

## 4. O mecanismo central: fidelidade com diagnóstico

**O app é fiel à planilha por padrão.** Cada divergência conhecida está registrada em
`api/_lib/motor/desvios.js` (13 hoje) com: o que a planilha faz, o impacto medido e o que muda se
for corrigida. O motor continua devolvendo `{ resultado, diagnosticos }` em toda rota; o que saiu
foi a UI: o painel *Diagnóstico* das telas foi removido (ver §8) e o catálogo em `/importar` saiu
da sidebar em 2026-08-31 — a rota e a página continuam de pé, sem link. Hoje **nenhuma tela**
mostra as divergências.

Regras:

1. **Nenhum desvio muda de default sozinho.** Ligar a correção é ação do usuário — hoje, sem
   switch na tela, isso significa que todo cenário roda fiel à planilha. **Uma exceção, e só
   uma:** `api/_handlers/alocacao.js` força `alocacao-dia-anterior` no heat map de operadores,
   porque em fiel a tela ficava vazia e não havia como ligar a correção pelo produto (ver §8,
   2026-08-31). Se for criar outra exceção, registre aqui — a lista tem que caber numa linha.
2. A escolha fica em `cenario.correcoes` (jsonb) — então dois cenários podem ter políticas
   diferentes e ser comparados lado a lado. É esse o "modo comparação".
3. Um id de desvio desconhecido em `correcoes` **falha alto** (`validarCorrecoes`), para um typo
   não virar "correção sempre desligada" em silêncio.
4. Ao descobrir uma nova divergência: registre em `desvios.js`, implemente os dois caminhos no
   módulo do motor, e **escreva os dois testes** (fiel e corrigido).

### Os módulos do motor

Puros: recebem dados, devolvem `{ resultado, diagnosticos }`. Sem HTTP, sem banco.

| Módulo | O que faz |
|---|---|
| `desvios.js` | registro dos desvios + `corrigido()` / `validarCorrecoes()` |
| `operadores.js` | `Σ(Meta × Qtd)/60 ÷ (diasÚteis × (jornada − pausa)) ÷ coefEficiência` |
| `metrica.js` | `Σ(aditivos) + retrabalho × (1 − FTR)`, depois `÷ coefEficiência` |
| `calendario.js` | `diaDefasagemFiel` (os 8 ramos do Código.gs) **e** `subtrairDiasUteis` |
| `explosao.js` | demanda do calendário → processos, por SKU→produto e roteiro |
| `alocacao.js` | horas por operador, nas 3 passadas do EstudoPorOperador.gs |

**Os termos da fórmula são dados, não código.** `cenario_formula_par` guarda cada termo
`(Meta da linha X) × (Qtd da linha Y, período Z)` exatamente como está na planilha — é isso que
permite reproduzir os pares desalinhados e os que apontam para outro período.

---

## 5. Verificação sem Docker

Esta máquina não tem Docker nem Postgres. Os scripts de verificação usam **Postgres em WASM**
(`@electric-sql/pglite`, devDependency) para rodar as migrations e os handlers de verdade.

```bash
npm test                                        # 95 testes do motor
node scripts/verificar_base.mjs                 # migrations + roteamento + auth
python scripts/importar_planilha.py --dump --dry-run
node scripts/verificar_importacao.mjs           # importação do payload real + idempotência
node scripts/verificar_api.mjs                  # todas as rotas /api ponta a ponta
node scripts/verificar_dimensionamento.mjs      # o Global, num banco sem planilha importada
npx tsc --noEmit && npm run build               # frontend
```

Os testes do motor batem contra **números reais** da planilha: `api/_lib/motor/fixtures.json` é
gerado por `scripts/motor_fixtures.py` a partir do dump em `.cache/sheet-dump/`. O teste de
fidelidade confere os **65 períodos** das abas Mensal e Semanal.

Screenshot de uma tela, em qualquer tema (o `prefers-color-scheme` só é emulável pelo CDP; as
flags de linha de comando do Chrome não afetam esse media query em headless):

```bash
node scripts/captura.mjs inicio dark .cache/telas/inicio-escuro.png
```

Gotchas do dev:

- `process.exit()` durante o teardown do pglite dispara um assert do libuv no Windows — use
  `process.exitCode`.
- **Não mate o dev server com `Stop-Process -Force`**: o datadir do pglite não sobrevive e o
  próximo boot falha em `_pg_initdb`. Use Ctrl+C. Se corromper: `rm -rf .cache/pgdata` e reimporte.
- **Editar um handler já vale sem reiniciar** o dev server: ele chama
  `loadRoutes(app, { recarregar: true })` e o arquivo do handler é relido a cada request. **Rota
  nova** (arquivo novo em `api/_handlers/`) continua exigindo restart — a varredura do diretório é
  no boot. `server.cjs` não liga a recarga: em produção o handler é carregado uma vez.

---

## 6. Design system

Brand lock TRACTIAN: neutros `slate-*`, accent `primary-*` (Blue 600 `#2563eb`),
`emerald/amber/red` **só para estado**. Tipografia Inter Tight (títulos) / Inter (corpo).
Primitivos em `src/index.css`: `.panel`, `.btn-primary`/`.btn-ghost`, `.input-field`,
`.cell-input`, `.chip`/`.chip-warn`/`.chip-danger`/`.chip-ok`, `.kpi-card`, `.page-header`,
`.th`/`.td`/`.td-num`, `.empty-state`, `.skeleton`. Reúse em vez de recriar.

### Tema claro/escuro

`src/lib/tema.tsx` grava a escolha no localStorage e, sem escolha, segue o
`prefers-color-scheme`. O tema vai no atributo `data-theme` do `<html>`.

As cores vivem em **tokens CSS** (`--app-surface`, `--ink`, `--accent`, `--estado-*`,
`--heat-*`) e os primitivos consomem os tokens. Um **bridge** no fim do `index.css` remapeia as
utilities cruas que as telas usam (`bg-white`, `border-slate-200`, `text-slate-500`, os
amber/red/emerald de estado…) para os mesmos tokens — o seletor `[data-theme] .classe` tem
especificidade maior que a classe sozinha, então não precisa de `!important`. **Por isso nenhuma
tela tem variante `dark:`**: ao criar UI nova, use os primitivos ou as utilities já cobertas pelo
bridge; se precisar de uma cor nova, adicione o token e a linha no bridge.

O escuro é **escolhido**, não um flip automático: são passos próprios das mesmas rampas de marca.

### Impressão / PDF

Não há gerador de PDF: o relatório é a **própria tela** impressa pelo navegador, o que mantém o
cluster air-gapped e o bundle sem uma biblioteca a mais. O bloco `@media print` no fim do
`index.css` define A4 paisagem, some com o menu e solta o scroll da grade. Duas classes fazem a
ponte: **`.nao-imprime`** (some no papel — botões, seletor, textos de ajuda) e
**`.so-impressao`** (só aparece nele — o cabeçalho que identifica cenário e data de emissão).
Quem chama `window.print()` força `data-theme=light` e restaura no `afterprint`.

Duas armadilhas já pagas, ao imprimir uma grade: `break-inside: avoid` no `.panel` empurra a
tabela inteira para a página seguinte em vez de deixá-la quebrar, e `<tfoot>` **repete em toda
página** por padrão — as duas coisas somavam uma folha a mais. Por isso `tfoot` vira
`table-row-group` e só o `tr`/`.kpi-card` levam `break-inside: avoid`.

**Heat map** (`src/paginas/Operadores.tsx`): ocupação é magnitude → rampa sequencial de um único
matiz (Blue), com lightness monotônica verificada nos dois temas — claro vai de claro a escuro
(0,932 → 0,882 → 0,714 → 0,546) e **escuro inverte a âncora**, saindo da superfície e clareando
(0,379 → 0,488 → 0,623 → 0,809), todos os passos em AA. Classes `.heat-0`…`.heat-4`. Estouro de
jornada é **estado**, não magnitude → paleta de status com ícone e rótulo, nunca só a cor. Cada
célula traz o número, o que também resolve o contraste baixo dos passos claros.

---

## 7. Fluxo de branch e commit

- Branch por tarefa (`git switch -c tipo/descricao-curta`). Nunca trabalhar na `main`.
- Branch e commits **em inglês**, mesmo com a conversa em português.
- **O agente não roda `git commit`** — entrega título + descrição prontos para o usuário colar.
- Conventional Commits: `tipo(escopo): resumo no imperativo`, ≤ 72 chars, sem ponto final.

---

## 8. Registro de decisões

- 2026-08-31 — **O heat map de operadores é a única exceção ao "fiel por padrão"** (decisão do
  usuário, depois da tela aparecer vazia). `api/_handlers/alocacao.js` força
  `alocacao-dia-anterior: true` no `calcular()`, mesclado por cima de `cenario.correcoes`.
  - **Sintoma:** Execução → Operadores em branco ("Nenhuma alocação") com a lista de demanda
    cheia. `POST /api/alocacao?cenario=167&acao=calcular` devolvia `gravadas: 0`,
    `diasSemData: 1`.
  - **Causa:** em modo fiel o motor só grava o acumulado ao detectar troca de dia e não faz flush
    no fim (`alocacao.js:117`), então o último dia do período nunca é gravado e a primeira
    gravação é a linha-fantasma com `data = null`, que o handler descarta. Num cenário cuja
    demanda cabe em **um único dia** — o Setembro/2026 de teste, 2 linhas em 31/08 — isso zera
    100% do heat map. Não é específico do dataset: em fiel a tela sempre perdia o último dia.
  - **Por que forçar em vez de ligar a correção no cenário:** sem UI para alternar (decisão de
    2026-08-17, abaixo) e com a Importação fora da sidebar, não havia caminho pelo produto —
    só `PATCH /api/cenarios?id=N` na mão, repetido a cada cenário novo.
  - **Escopo:** só o handler. `desvios.js` intacto, o desvio segue no catálogo, `alocacao.js` do
    motor e os dois testes (fiel/corrigido) inalterados, as demais `correcoes` do cenário
    continuam valendo. As outras telas seguem fiéis. Verificado: cenário 167 passou a gravar
    8 células (8 op × 6,25 h = 50 h), que é exatamente a homem-hora que a Simulação ideal mostra.
  - **Não mexido** (o usuário escolheu "só o cálculo"): o empty state de `Operadores.tsx` ainda dá
    o conselho errado ("gere a demanda no calendário") quando não há alocação por outro motivo, e
    o botão Recalcular continua descartando `gravadas`/`diasSemData`/`diagnosticos` da resposta.
- 2026-08-25 — **A tela Dimensionamento Global voltou, alimentada por um forecast e SEM cenário**
  (pedida pelo usuário). Ela responde a pergunta do horizonte longo — headcount mês a mês até
  o fim do forecast (hoje 09/2026 a 12/2027) — e é a **única tela que não é escopada por
  `MES_EM_USO`**.
  **Nada de motor foi escrito**: `calcularOperadores` já é a fórmula. O que entrou foi a origem
  do dado e a UI.
  Decisões do usuário: o forecast mora em **tabela própria por Country/Model** (migration
  `003_forecast.sql`), a quantidade da célula é **editável** com o forecast como ponto de
  partida, o **Coef. de Excedente de 20% não é aplicado**, e os **dias úteis são digitados** —
  a tela não preenche do calendário.
  **É uma simulação, não um cenário** (correção de rota do usuário depois de ver a primeira
  versão). A primeira tentativa pendurou tudo num cenário de `capacidade`, reusando a máquina de
  `cenario_*` — e a tela abriu **vazia**: o cenário de capacidade importado tinha sido apagado
  em 17/08, então o "Criar cenário" nasceu com **zero** `metrica_componente` (não havia de onde
  `semear()` herdar) e com período `Período 1`, que nem é mês. O erro de fundo era conceitual:
  cenário é um recorte de um mês de operação, com correções, oficial, duplicação e comparação;
  esta tela é uma visão só do horizonte inteiro. Agora o estado é global (migration
  `004_dimensionamento_global.sql`): `dispositivo_metrica` (os tempos), `global_mes` (dias
  úteis) e `global_ajuste` (o ajuste). Sem seletor, sem cenário, e sem como abrir vazia por
  falta de um.
  **A camada de ajuste é o cerne do desenho**: `forecast` é o dado externo, `global_ajuste` o
  sobrepõe célula a célula, e a ausência de linha lá significa "vale o forecast". É isso que faz
  recarregar o forecast **não** apagar o que o PCP digitou — provado em
  `verificar_dimensionamento.mjs`, que roda num banco sem planilha importada justamente para
  provar que a tela não depende de mais nada. `PATCH /api/dimensionamento` com
  `quantidade: null` apaga o ajuste; na tela, digitar de volta o número do forecast faz isso.
  `POST /api/dimensionamento?acao=tempos` **cria o dispositivo que não existe**, pelo mesmo
  motivo.
  **Duas correções que a feature revelou**, que ficam de pé independentemente dela:
  1. `cenario.js` usava a métrica **real** (que já é `parcial / 0,85`) como meta do cenário de
     capacidade, e `calcularOperadores` dividia por `coefEficiencia` de novo — 0,85 duas vezes.
     Somado ao `aplicarExcedente: true`, Abril/2026 dava **10,69 → 11** onde a planilha dá
     **7,57 → 8**. Agora a meta é a **parcial**, e o excedente saiu (a linha "Quantidade
     Produção Real" da planilha é ROUNDUP puro; quem quiser os 20% liga
     `excedente-so-no-global` no cenário). Os **13 meses** da aba agora são teste de fidelidade
     em `operadores.test.js`.
  2. `Math.ceil(0 - 1e-9)` devolvia `-0`, e o `Intl` do pt-BR renderiza isso como **"-0"** na
     grade. Era latente também no Semanal. Corrigido com `|| 0`.
  **O mapa é por `Model`, nunca pela sigla**: `STUE` cobre *Smart Trac Ultra Ex* e *Smart Trac
  Ultra Gen 2 EX* (11,76 contra 12,50 na parcial), `SRU` cobre dois, `ET+` cobre dois.
  `dispositivo_model.model` **não** tem FK para `sku(codigo)`: 5 dos 23 models do forecast não
  estão na Base de PROD (PROD-0151, PROD-0173, PROD-0183, PROD-0176, PROD-0177). Model sem
  dispositivo vira aviso na tela, não erro — sem tempo, aquele volume não entra em conta
  nenhuma.
  **A linha abre nos PRODs** (pedido do usuário, espelhando os grupos da planilha): clicar no
  dispositivo mostra os `Model` que o compõem, mês a mês, somados sobre os Country. É
  **somente leitura** — quem se ajusta é o dispositivo, porque é ele que tem tempo-padrão. Num
  mês ajustado os PRODs de propósito **não** somam a linha de cima: embaixo é o forecast, em
  cima é a decisão.
  **Dias úteis**: a célula é digitada, mas o botão *Preencher N dias úteis*
  (`POST /api/dimensionamento?acao=dias-uteis`) conta do calendário descontando a tabela
  `feriado` e **só toca nos meses vazios** — ação explícita, não preenchimento automático. Os
  feriados nacionais de 2026 e 2027 entraram por `scripts/cadastrar_feriados.mjs`, **só os por
  lei**: Carnaval e Corpus Christi são ponto facultativo e ficaram de fora (decisão do usuário;
  `_feriados_br.mjs` já tem o `pascoa()` se passarem a valer). A contagem bate com a planilha em
  Set/Out/Nov de 2026 (21/21/19); **Dezembro/2026 dá 22 contra os 14 da planilha** — são férias
  coletivas, que nenhum calendário adivinha, e é caso de sobrescrever à mão.
  Efeito colateral bom: o painel *Valores de referência* devolveu a **edição da composição da
  métrica**, que estava sem UI desde 14/08 — agora sobre `dispositivo_metrica`, global.
  A carga dos três TSV de `docs/` é `node scripts/importar_dimensionamento.mjs`.
  Ficou de fora: colar o forecast na própria tela (as rotas já servem uma caixa de colar) e
  editar jornada/coeficientes por aqui (é `parametro`, global, sem UI).
- 2026-08 — Projeto criado a partir da engenharia reversa da planilha. **Fidelidade por padrão
  com diagnóstico visível** em vez de correção silenciosa (decisão do usuário).
- 2026-08 — Postgres em vez de Mongo: o domínio é fortemente relacional
  (SKU ↔ produto ↔ processo ↔ cenário ↔ demanda ↔ alocação).
- 2026-08 — Os termos da fórmula de operadores viraram **dados** (`cenario_formula_par`), com
  `qtd_periodo` para o caso do termo que aponta para outro período.
- 2026-08 — `metrica_componente` é genérica (`papel` = aditivo/retrabalho/ftr + rótulo livre):
  a planilha tem de 3 a 5 componentes por dispositivo, incluindo "Garra OEE Trac", que não cabe
  em cinco slots fixos.
- 2026-08 — Fontes auto-hospedadas via `@fontsource` porque o cluster é air-gapped, contrariando
  o `@import` do Google Fonts que o brand guide documenta.
- 2026-08 — Verificação com **pglite** por não haver Docker na máquina de desenvolvimento; os
  handlers são exercitados de verdade, não mockados.
- 2026-08 — A importação **mescla** os SKU duplicados da Base de PROD (216 linhas, 199 códigos)
  mantendo o valor não vazio de cada campo, e nunca sobrescreve descrição preenchida com vazia.
- 2026-08 — **Cenário é escopado a um mês** (decisão do usuário). A tela Semanal mostra só as
  **Semana 1–5 do mês** — as mesmas que `gradeDoMes()` monta para o Calendário. Outros meses viram
  cenários salvos (histórico), selecionáveis no topo.
  Isso resolve de raiz o bug de chave de período: a planilha reusa "Week 1".."Week 5" em cada mês
  (40 colunas, 12 rótulos distintos), e dentro de um único mês os rótulos não repetem.
- 2026-08-14 — **A tela Planejamento Mensal saiu do front** (decisão do usuário): o headcount por
  mês era a mesma conta do Semanal com outro recorte. O que ficou:
  - `Planejamento.tsx` deixou de ser parametrizado por tipo — é a tela Semanal, e só.
  - O tipo de cenário `mensal` **continua existindo** e é o portador do calendário, da lista de
    demanda e da alocação do mês (`useCenarioSelecionado('mensal')` em `Calendario`, `Demandas` e
    `Operadores`; é nele que `importar_planilha.py` pendura `projecao`/`demandaProcesso`/`alocacao`).
    Por isso `Novo cenário → Mensal` segue em `/cenarios`: é o que dá calendário a um mês novo.
  - Sem migration e sem mexer nas fixtures: `tipo_cenario` mantém `'mensal'`, e os testes de
    fidelidade do motor continuam batendo contra a aba *Planejamento Mensal* da planilha de origem.
  - Efeito colateral conhecido: as `correcoes` de um cenário mensal ficaram sem UI para alternar —
    os painéis de diagnóstico de `Calendario`/`Operadores` são somente leitura.
- 2026-08-14 — **A tela Capacidade saiu do front** (decisão do usuário), mesmo padrão do Mensal:
  `src/paginas/Capacidade.tsx` foi apagada, a rota `/capacidade` e o item da sidebar saíram, e o
  `Novo cenário` de `/cenarios` não oferece mais o tipo — todo cenário criado no app tem mês.
  O `Início` mostra só o card do Semanal.
  - Continua tudo no back: o tipo `capacidade` no enum, `parse_global()` no importador, a
    `metrica_componente`, o `aplicarExcedente` de `operadores.js` e o desvio `excedente-so-no-global`
    (alternável na tela Semanal). Os cenários de capacidade importados seguem visíveis em
    `/cenarios`.
  - Ficou sem UI: editar a composição da métrica (`PATCH /api/planejamento` com `componentes`) — era
    só nessa tela. O endpoint continua de pé.
- 2026-08-17 — **O painel Diagnóstico saiu das telas** (decisão do usuário, escolhendo "só ocultar"
  em vez de parar de aplicar os desvios). `src/components/Diagnostico.tsx` e o hook `useCorrecoes`
  foram removidos por ficarem sem uso; Semanal, Calendário e Operadores não renderizam mais nada de
  diagnóstico. **Nenhum número mudou**: o motor segue fiel à planilha, `desvios.js` intacto, as
  rotas ainda devolvem `diagnosticos` e `cenario.correcoes` continua no banco. Sem switch na UI,
  ligar uma correção hoje só por `PATCH /api/cenarios?id=N`.
- 2026-08-20 — **Simulação ideal** (feature nova, pedida pelo usuário): a lista de demanda vira
  calendário operacional. Decisões dele: grava numa coluna `dia_ideal` **separada** do
  `dia_processo` (migration `002_simulacao.sql`), o gesto é **arrastar e soltar** nativo, e o
  quadro abre com **tudo no pool** (`dia_ideal IS NULL`). Separar as duas colunas é o que deixa
  simular sem mexer na Lista de demanda nem no heat map — só o Aplicar copia uma na outra, e o
  que ficou no pool mantém o dia gerado.
  **O dimensionamento do dia** (`motor/simulacao.js`) responde uma pergunta que o heat map não
  responde: lá N é fixo e a carga se espalha; aqui N é a incógnita. Duas leituras, e não são
  intercambiáveis — `homemHora` (Σ duração × operadores) é o consumo de gente, `horasParede`
  (Σ duração) é o relógio. O nº de operadores sai do **mesmo empacotador de 3 passadas** do
  `alocacao.js`, rodado com N crescente até ninguém passar da jornada, em vez de uma conta
  paralela que discordaria da tela de Operadores. O teto da busca é a soma dos operadores
  pedidos no dia — com essa gente todo processo pega gente ociosa, então a busca prova que
  termina.
  **O que a feature revelou em Agosto/2026**: 5 dos 16 dias com carga têm problema. O 14/08 junta
  **111,30 homem-hora contra 60 h** de capacidade (mínimo 15 operadores, a linha tem 8) e é
  **impossível**, não só apertado: dois "Processo de montar completo" duram 8 h cada, acima da
  jornada de 7,5 h — nenhum N conserta processo longo demais. O 07/08 é o caso oposto e mais
  sutil: ocupação de só 68%, mas o empacotador precisa de 9 operadores, então quem morde é a
  restrição de empacotamento, não o volume.
  **As não alocadas são tabela**, não cards (pedido do usuário): mesmas colunas da Lista de
  demanda, mais `Homem-hora` — cada `<tr>` é arrastável e a seção inteira é alvo de drop.
  **CSV do que foi plotado** em `GET /api/simulacao?cenario=N&formato=csv`: uma linha por
  demanda posicionada, em ordem de dia, com o dimensionamento do dia **repetido em cada linha**
  para dar tabela dinâmica no Sheets sem segunda aba. Só o plotado entra — o que ficou no pool
  não tem dia para exportar. O `celulaCsv` saiu de `demandas.js` para `_lib/csv.js` e agora é
  compartilhado pelas duas exportações, em vez de duplicado.
  Notas de implementação: `rowCount` de UPDATE vem indefinido no PGlite do dev — os handlers
  usam `RETURNING` e contam as linhas. Clicar na demanda e depois no dia faz o mesmo que
  arrastar, porque drag-and-drop nativo não funciona por teclado nem em toque.
- 2026-08-20 — **Os tempos por dispositivo de um cenário novo vêm sempre do semanal** (pedido do
  usuário). `semear()` elegia como base o cenário mais recente **do mesmo tipo**, então um mensal
  novo herdava de outro mensal — e o mensal de Agosto/2026 nasceu com os 26 dispositivos zerados
  enquanto o semanal do mesmo mês tinha 23 preenchidos. Agora `baseDosTempos()` ordena por
  `(tipo = 'semanal') DESC, oficial DESC, criado_em DESC`: o semanal é o padrão para qualquer
  tipo, porque é o único com tela de planejamento e o único que se mantém. **Só entra na eleição
  quem tem ao menos um `meta_min_peca > 0`** — cenário zerado não carrega padrão nenhum e antes
  podia ser eleito, propagando o vazio; sem candidato, cai no caminho de semear todos os
  dispositivos com 0. `metrica_componente` **continua vindo do mesmo tipo**: ela só existe no
  cenário de capacidade, e puxá-la do semanal deixaria um capacidade novo sem componente algum.
  Duplicar cenário (`?duplicarDe=`) não mudou — copiar aquele cenário é o que se pediu.
  Provado por `scripts/verificar_tempos_padrao.mjs`, num PGlite próprio: mensal novo pega os
  tempos do semanal e não os zeros do mensal anterior, o semanal oficial ganha do semanal mais
  recente, e sem candidato com tempo o cenário nasce zerado.
- 2026-08-20 — **Perdi o banco de dev reiniciando o dev-server à força.** `Stop-Process -Force`
  no processo do PGlite corrompeu o datadir, e `abrirBanco()` (`dev-server-pglite.cjs:42`) faz
  `fs.rmSync` e recria vazio quando não consegue abrir — sem backup. Recuperado pelo caminho
  documentado: `importar_planilha.py --dump` (cadastros + os 23 cenários importados, estado de
  04/08) e `desvincular_planilha.mjs --mes 8 --ano 2026`. **Não voltou**, porque só existia no
  banco: a grade de Agosto no Calendário e as 50 linhas de demanda (o dump só tem a grade de
  **Julho/2026**), os cenários de Setembro/2026, os feriados cadastrados e as edições de
  cadastro posteriores a 04/08. **Regra daqui em diante: não matar esse processo à força** — ele
  não tem shutdown gracioso, e a migration nova só entra reiniciando, então o restart é pedido
  ao usuário.
- 2026-08-20 — **A lista de `/cenarios` passou a contar a demanda que o cenário realmente tem, e
  `Correções ligadas` deu lugar a `Carga listada`** (pedido do usuário). A coluna Demandas contava
  só `cenario_demanda`, então o mensal Agosto/2026 aparecia com **0** enquanto a Lista de demanda
  mostrava 50 linhas: são tabelas diferentes por tipo — o semanal guarda quantidade por
  dispositivo × período, o mensal guarda a lista explodida do calendário (`demanda_processo`). A
  rota devolve as duas contagens (`demandas`, `linhas_demanda`) mais `carga_horas` = soma de
  `tempo_horas`, **sem `coalesce`**, para cenário sem lista dar null e a tela mostrar `—` em vez de
  "0,00 h". Confere com o KPI da Lista de demanda: 50 linhas, **137,97 h**. As correções não se
  perderam de vista — o painel Comparar segue mostrando "N correção(ões)" por cenário.
- 2026-08-20 — **`MES_EM_USO` virou default, não mais filtro** (o usuário não achava no Calendário
  o cenário que tinha acabado de criar). O filtro estava num ponto só, `useCenarioSelecionado`
  (`hooks.ts`), e valia para Semanal, Calendário, Lista de demanda e Operadores. Ele existia
  porque o banco carregava os 14 cenários mensais importados e o seletor virava ilegível — mas
  esses cenários foram apagados em 17/08, e o filtro passou a esconder só o cenário do mês que
  vem. Agora o seletor lista todos os meses, com o mês em uso na frente, e **abre nele**; a
  escolha vale de outro mês também e persiste no localStorage, porque planejar setembro é uma
  sessão inteira, não um clique. Conferido no Calendário: escolher Setembro/2026 carrega a
  projeção de setembro (Semana 1 = 31/08–05/09, grade vazia). Virar o mês de verdade ainda é
  editar `src/lib/escopo.ts`.
- 2026-08-20 — **"O botão Criar não cria" em /cenarios era a própria lista escondendo o cenário**
  (bug relatado pelo usuário). O `POST` sempre funcionou — o filtro da listagem exigia
  `tipo === 'semanal' && noMesEmUso(c)`, então criar Setembro/2026 gravava e sumia, e clicar de
  novo empilhava duplicata (chegaram a nove no banco de dev). Cenário **mensal** nunca aparecia em
  mês nenhum, o que tornava invisível o passo 2 do "Virar o mês" do README. Agora `/cenarios` lista
  **todos os tipos e todos os meses**, com o mês em uso na frente e chip `mês em uso`; quem escopa
  a operação continua sendo `useCenarioSelecionado` (`MES_EM_USO`) nas telas de execução. Duplicata
  no mesmo mês segue permitida de propósito — é como se compara "fiel" com "corrigido" —, só que
  agora ela é visível em vez de silenciosa.
- 2026-08-20 — **Processos e sequências virou cadastro de verdade** (pedido do usuário): saiu o
  painel de aviso do topo (produtos sem processo + grafias alternativas), toda coluna ficou
  editável e a tela ganhou **Novo processo**. A rota já fazia POST/PATCH/DELETE — o trabalho foi
  todo de tela. Decisões: **produto é coluna editável** (é o único jeito de mover um processo de
  roteiro; a linha troca de grupo ao salvar); **produto filho é escolha fechada** do catálogo,
  porque `processo.sku_filho` tem FK para `sku(codigo)` e `explosao.js` casa o SKU por ele —
  `— nenhum —` grava null; **Total/dia continua derivado** (Pç/hr × 8) mas aceita edição pelo
  outro lado, gravando `pcsHora = total ÷ 8`, com guarda de arredondamento para entrar e sair da
  célula não regravar nada. `sequencia` e `leadtime_dias` são `integer`, então a tela arredonda
  antes do PATCH (digitar "1,5" daria 500 no cast). `GET /api/roteiros` **não** mudou:
  `produtosSemRoteiro` e `aliases` continuam na resposta porque `scripts/verificar_api.mjs` afere
  os dois; só a UI parou de mostrar. O caso dos 3 produtos sem processo agora se resolve sozinho —
  eles aparecem no seletor de produto do formulário.
- 2026-08-18 — **O Início mostra semana vigente e mês inteiro, lado a lado** (pedido do usuário).
  O bloco mensal repete a conta de `operadores.js` com os agregados do mês: horas de todos os
  períodos ÷ (dias úteis do mês × jornada líquida) ÷ coefEficiência, `ROUNDUP` com o mesmo
  epsilon. Agosto/2026: **8 na semana vigente, 6 no mês** (678,04 h em 21 dias úteis) — a
  diferença é o pico semanal contra a carga diluída. `ehDiaUtil` e `diasUteisDoMes` saíram de
  `cenarios.js`, onde eram privados, para `motor/calendario.js`, e agora são usados pelos dois
  handlers (o feriado cadastrado entra na conta: setembro cai de 22 para 21 dias com o 07/09).
- 2026-08-18 — **O termo "oficial" saiu do front** (pedido do usuário): sem o chip no Início e em
  `/cenarios`, sem o ★ no seletor e sem o botão de marcar. A coluna `cenario.oficial` continua no
  banco e é desempate em `resumo.js` e `useCenarioSelecionado` — com um cenário por mês, nunca
  chega a valer. Quem ainda marca é o `desvincular_planilha.mjs`.
- 2026-08-17 — **A Lista de demanda é toda editável** (decisão do usuário): a geração é ponto de
  partida, e quem decide data, quantidade e alocação é o **supervisor de produção**. Isso resolve
  na operação o desvio `leadtime-caso-a-caso` — em Agosto/2026, 23 das 50 linhas nascem com o dia
  do processo 1 a 3 dias adiantado, porque o padrão ainda é o `diaDefasagemFiel` (os 8 ramos do
  `Código.gs`, que também ignoram a tabela de feriados). O `PATCH /api/demandas?id=N` já aceitava
  quase tudo; faltava a UI e o `processoId`, que foi adicionado. `comuns.tsx` ganhou `CelulaData` e
  `CelulaSelecao`, irmãs da `CelulaNumero` (commit no blur/Enter, Esc desfaz).
  **SKU e processo são escolha fechada** (decisão do usuário): SKU vem da Base de PROD e processo
  vem dos roteiros, em `<optgroup>` por produto · tipo de linha. O valor atual sempre entra na
  lista marcado como `(fora do cadastro)`, para o select não trocar o dado sozinho. Escolher um
  processo **adota o cadastro dele**: `processo_id`, nome, tipo de linha, operadores, Pç/hr e o
  tempo recalculado. **Lote é texto livre** — não há cadastro de lote.
  **A coluna Tempo não é editável**: é derivada de `quantidade ÷ Pç/hr` (é o que
  `explosao.js` calcula na geração; `operadores` **não** entra nessa conta — ele é o consumo de
  gente na alocação). A tela regrava `tempoHoras` sempre que a Qtd ou o Pç/hr mudam, e sem taxa
  o campo fica nulo e aparece como "sem taxa".
  O `UPDATE` da rota deixou de usar `COALESCE` e passou a montar o `SET` só com os campos que
  vieram no corpo — era o que impedia gravar nulo de propósito (o tempo "sem taxa").
  Cuidado conhecido: **regerar a demanda apaga as edições** — `gerar()` deleta tudo que é
  `origem='gerado'` e só remonta o "feito", casado por `sku|processo|dia_processo`.
- 2026-08-17 — **Revisão das 13 divergências, agora que ninguém compara com a planilha**:
  4 ficaram impossíveis (`pares-desalinhados`, `par-outro-periodo`, `dispositivos-fora-da-soma`,
  `arredondado-manual`) porque só existiam em dado importado; 2 nunca foram consultadas pelo motor
  (`jornada-divergente`, `produto-nome-divergente`) — são documentação; `excedente-so-no-global`
  é decisão de negócio, mantida fiel. Sobram 4 em que o app **ainda reproduz o bug do Apps Script
  por padrão** e que ficaram para tratar à parte: `leadtime-caso-a-caso` (endereçado pela edição
  manual acima), `alocacao-dia-anterior` (o dia 28/08 tem demanda e não entra no heat map),
  `check-feito-ignorado` (latente: marcar feito não devolve a hora) e `sku-em-dois-grupos`
  (latente: ITCH-0011, ITCS-0002 e ITCS-0019 não estão na grade de agosto).
  Achado extra: em `sku-sem-roteiro-silencioso` a polaridade é invertida — o app já avisa, e
  ligar a "correção" só **cala o aviso**; e `tempo-sem-guarda` é inócuo, porque
  `projecao.js` grava `null` no lugar de `Infinity` de qualquer jeito.
- 2026-08-17 — **O banco não tem mais cenário importado** (decisão do usuário: desvincular a
  operação da planilha). `scripts/desvincular_planilha.mjs` faz a troca em três passos, tudo por
  HTTP nas rotas que já existem — o datadir do pglite fica travado pelo dev server:
  1. cria o par próprio do mês (`POST /api/cenarios`), copia metas e demanda do importado casando
     **pelo número da semana** (`Week 3` → `Semana 3`), marca oficial, copia a grade
     (`PATCH /api/projecao`), regera a demanda e recalcula a alocação;
  2. `--conferir` imprime importado × próprio lado a lado;
  3. `--apagar-importados` remove os 23 (o `ON DELETE CASCADE` leva os filhos), e recusa se o mês
     em uso ainda não tiver cenário próprio.
  **Efeito no número**: o importado trazia `arredondado_manual = 8` em toda semana e exibia
  8/8/8/8; o próprio mostra o ROUNDUP do cálculo, **0/8/8/7/0** (ganhou a Semana 5, que a planilha
  não tinha). Carga e demanda idênticas: 9600 peças, 678,04 h. Some o desvio `arredondado-manual`;
  fica só `excedente-so-no-global`, mantido fiel (sem os 20%) por decisão de negócio.
  Os `verificar_*.mjs` **não** dependem do banco de dev — montam um PGlite próprio a partir de
  `.cache/payload-importacao.json`, então seguem passando. Rollback:
  `python scripts/importar_planilha.py --dump`.
- 2026-08-17 — **O app trabalha em um mês só** (decisão do usuário, preparando a operação sem a
  planilha): `src/lib/escopo.ts` exporta `MES_EM_USO = { mes: 8, ano: 2026 }` e `noMesEmUso()`.
  `useCenarioSelecionado` filtra por ele, então Semanal, Calendário, Lista de demanda e Operadores
  só oferecem o cenário desse mês; `/cenarios` usa a mesma função (além do filtro por tipo
  `semanal`). Os 24 cenários importados da planilha seguem no banco como histórico e continuam
  acessíveis pela API. **Virar o mês é editar essa constante — e só ela.**
- 2026-08-17 — **O resumo passou a olhar o cenário do mês corrente e a semana vigente**: antes
  ordenava por `criado_em` e mostrava o pico do mês, o que fazia o dashboard exibir um cenário
  vazio de outro mês. `indiceDaSemanaVigente()` usa o `gradeDoMes()` do motor e casa pelo `ordem`
  do período; `proximosDias` ganhou o corte em `CURRENT_DATE` para não encalhar no vencido.
- 2026-08-27 — **`dispositivo.ativo` é o mecanismo de remoção, e a grade lista todos os ativos.**
  Duas decisões que andam juntas, ambas do usuário:
  1. **Remover dispositivo = `ativo = false`, nunca `DELETE`** (migration
     `005_dispositivos_ocultos.sql`, que desliga **Ima na Base** e **Tampografia** — esta
     substituída no Semanal por "Tampografia Case" e "Tampografia Sensor"). As FKs são todas
     `ON DELETE CASCADE`: apagar levaria junto meta e demanda dos 23 cenários importados.
     O oculto sai **da tela e da conta**: `carregarCenario` filtra metas, demandas, componentes e
     os **dois lados** de cada par de `cenario_formula_par`, e o Global filtra `dispositivo_metrica`
     — o motor segue sem saber que `ativo` existe. `gravarDispositivos` tem a mesma lista em
     `DISPOSITIVOS_OCULTOS`, para o banco zerado não ressuscitar os dois na importação.
     **Efeito no número**: o semanal de Dezembro perde os 4000 min de "Ima na Base" na Week 45 e
     cai de 9,659 para 7,568 operadores fracionários — a verificação passou a esperar o valor
     novo, com a conta da diferença no comentário. Reverter é o `UPDATE` inverso.
  2. **A grade do Semanal lista todo dispositivo ativo**, não só o que já tem linha no cenário —
     antes o mensal mostrava 19 e o semanal 22, agora ambos mostram os 24. Dispositivo sem meta
     nem demanda aparece zerado e é editável. Para a linha nova de fato contar, `semear` passou a
     criar `cenario_meta` a partir de `dispositivo` (com a meta da base, ou 0) em vez de copiar a
     base, e o `PATCH /api/planejamento` cria o termo alinhado faltante do dispositivo editado.
     Esse termo nasce **só no que o usuário editar**: o cenário fiel não é reescrito, e o
     diagnóstico `dispositivos-fora-da-soma` continua valendo para os pares que a planilha
     deixou de fora.
- 2026-08-27 — **O catálogo de dispositivos virou cadastro, com tempo-padrão** (migration
  `006_catalogo_dispositivos.sql`). Os **23 dispositivos ativos**, a ordem da tela e a coluna
  `dispositivo.meta_padrao` (minutos-operador por peça) são semeados pela migration, e é de lá
  que `semear` copia a coluna Meta — **todo cenário nasce com o mesmo padrão**, e a cópia dentro
  do cenário segue editável sem contaminar os outros. Antes a Meta era herdada do último cenário
  semanal com meta preenchida, o que fazia o padrão andar sozinho a cada edição; `baseDosTempos`
  virou `baseDosCoeficientes` e hoje só carrega `cenario_parametro`.
  Junto: **"OEE Trac" → "Uni Trac 2.0"** (UPDATE do nome, o id é preservado, então
  `dispositivo_model`/PROD-0156 e os componentes continuam ligados), **"Bateria EX" e
  "Garra OEE Trac" escondidos** e **"Gravação UV SRU G2" criado** (0,05).
  O de-para de nome mora em `api/_lib/dispositivos.js` (`nomeCanonico`/`estaOculto`) e é aplicado
  nos três caminhos que criam dispositivo a partir de texto da planilha — `importacao.js`,
  `dimensionamento.js?acao=tempos` e `forecast.js` (este último passou a aceitar "OEE Trac" no
  mapa Model→dispositivo em vez de responder 400). A importação **não sobrescreve mais**
  `ordem`/`ativo`/`meta_padrao` de quem já existe: isso é do cadastro, não da planilha.
  O cadastro de **produtos** não foi renomeado — em Processos e sequências o roteiro segue em
  "OEE Trac" (e o produto "UniTrac 2.0" já existia lá, sem espaço).
  **Efeito nos cenários existentes**: a migration preenche meta e termo dos cenários criados no
  app, com duas travas — `NOT importado` (as 23 baselines da planilha ficam intactas) e
  `meta_min_peca = 0` (meta digitada à mão é preservada).
- 2026-08-31 — **A Base de PROD virou cadastro completo** (pedido do usuário: botão de novo código
  e toda coluna editável). Mesmo caminho de *Processos e sequências*, só que aqui a rota precisou
  crescer: entraram `POST /api/sku` (cria, com mapeamento opcional junto), `DELETE /api/sku?codigo=`
  e o **renomear** dentro do `PATCH`.
  Decisões:
  - **O código é normalizado** (`trim` + maiúsculas) na criação e no rename. Ele casa por
    igualdade exata em `explosao.js` e na grade, então um "prod-0199" digitado em minúscula
    nunca encontraria nada — e o `busca` já usa `lower()`, então nada se perde.
  - **Renomear é INSERT + repontar + DELETE**, numa transação, não `UPDATE` da chave:
    `processo.sku_filho` tem FK para `sku(codigo)` e barraria o update. As outras três tabelas
    (`sku_produto`, `projecao_slot`, `demanda_processo`) guardam o código como **texto solto, sem
    FK** — é por isso que a lista de referências vive explícita em `REFERENCIAS` no handler, e
    quem mexer no schema tem de mexer nela também.
  - **Remover recusa enquanto alguém apontar** para o código (409 dizendo onde), em vez de
    apagar em cascata: as três tabelas sem FK ficariam com código órfão em silêncio. Desfazer o
    vínculo é pelos chips da própria linha.
  - O `PATCH` **deixou de usar `COALESCE`** e monta o `SET` só com o que veio no corpo — mesmo
    motivo da rota de demandas: sem isso não dava para limpar grupo e NCM de propósito.
  `scripts/verificar_api.mjs` roda o ciclo inteiro (criar → normalizar → 409 de repetido → limpar
  campos → renomear levando o mapeamento junto → 409 ao remover em uso → remover) e termina com o
  catálogo de volta em **199**, que é o número que o resto do script afere.
  **O que a feature revelou**: o botão respondeu *"Método não permitido"* na tela enquanto os
  testes passavam — o `loadRoutes` fazia `require` do handler **uma vez, no boot**, então o
  dev-server de pé ainda tinha o `sku.js` antigo, que 405 em `POST` sem `acao=mapear`. A gotcha
  documentada só falava de *rota nova*; método novo em rota existente tem o mesmo efeito. Como o
  processo do PGlite **não pode ser morto à força**, reiniciar é o gesto mais caro do dev aqui —
  então `loadRoutes` ganhou a opção `recarregar`, que **só o dev-server liga**, e que relê o
  arquivo do handler a cada request. Sai do `require.cache` **só a entrada do próprio handler**:
  as dependências continuam o mesmo módulo, o que preserva a troca de `_lib/db.js` que o
  dev-server faz por cache — e com ela o PGlite aberto. `server.cjs` não passa a opção, então o
  caminho de produção não mudou.
- 2026-08-27 — **Produto se cadastra na tela de Processos e sequências** (`POST
  /api/roteiros?acao=produto`, botão "Novo produto"). Produto é a unidade de roteiro e um
  cadastro global — nenhum cenário o copia —, então criar um basta para ele valer em todo
  processo. O nome é chave natural, gravado com `trim()` (a planilha tinha "Smart Trac Ultra
  Gen 2" e a variante com espaço no fim como produtos distintos) e nome repetido volta 409.
  Junto: **a tabela passou a listar produto sem processo** como grupo vazio, com o atalho para
  lançar o primeiro passo — sem isso o produto recém-criado ficava invisível até ganhar roteiro.
  O grupo vazio some sob filtro de tipo de linha (esse filtro é sobre processos) e respeita a
  busca por texto pelo próprio nome. O contador virou "N processo(s) em M produto(s) · K sem
  roteiro"; os 3 órfãos que já existiam pararam de ficar escondidos.
- 2026-08-27 — **Relatório em PDF do Cenário semanal, pela impressão do navegador.** Botão "PDF"
  → `window.print()` + o bloco `@media print` do `index.css` (as regras e as armadilhas estão no
  §6). Descartadas uma lib no bundle (~300 kB, e o layout do relatório viraria uma segunda coisa
  para manter) e a geração no servidor (exigiria Chrome headless na imagem). Sai em A4 paisagem,
  2 páginas, com cabeçalho de cenário e data de emissão.
  Junto: o KPI **"Períodos sem dias úteis" virou "Hora/Homem mês"** = carga total ÷
  `OPERADORES_DA_LINHA` (`src/lib/escopo.ts`, hoje **9**). O divisor é a **capacidade instalada**,
  constante, e não o "Pico de operadores" do card ao lado — o pico é o que a demanda exigiu e
  varia a cada cenário. Trocar o tamanho da equipe é editar essa constante, como o `MES_EM_USO`.
  O aviso do card removido não sumiu: período sem dia útil virou o detalhe em âmbar do card
  "Períodos", e cada período afetado segue marcado como `#DIV/0!` no rodapé da grade.

---

## 9. Próximo passo (em aberto)

Implementar o escopo mensal decidido acima. Sequência:

1. **Schema** — `mes`/`ano` obrigatórios em `cenario` para os tipos `semanal` e `mensal`; unique
   `(tipo, mes, ano)`. `cenario_periodo.periodo` passa a ser `'Semana 1'..'Semana 5'` (semanal) ou
   o nome do mês (mensal), únicos dentro do cenário.
2. **Importador** (`scripts/planilha.py`) — quebrar as 40 colunas do Semanal e as 25 do Mensal em
   **um cenário por mês/ano**, mapeando cada coluna da planilha para a semana/mês certo. É aqui que
   está o trabalho de verdade: descobrir a que mês cada coluna pertence (as semanais repetem
   rótulo; usar a ordem das colunas + o bloco).
3. **Telas** — `useCenarioSelecionado` passa a preferir o cenário do mês corrente; o seletor lista
   o histórico. A grade some com o scroll horizontal (5 colunas no Semanal, 1 no Mensal).
4. **Verificar** — `scripts/verificar_api.mjs` deve provar que nenhum cenário tem período repetido
   e que o pico do Semanal volta a um valor plausível (hoje mostra 247 por causa do merge).

Enquanto isso não for feito, os números do Semanal/Mensal a partir de onde os rótulos repetem estão
inflados. Capacidade e as colunas de rótulo único estão corretas.
