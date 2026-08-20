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
| `planejamento` | editar meta/demanda/dias úteis/componentes; alinhar termos e incluir faltantes (sem UI desde 17/08) |
| `roteiros` | processos e sequências (Base simplificada) |
| `sku` | catálogo Base de PROD + mapa SKU→produto + pendências |
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
foi a UI: o painel *Diagnóstico* das telas foi removido (ver §8) e só o catálogo em `/importar`
mostra as divergências.

Regras:

1. **Nenhum desvio muda de default sozinho.** Ligar a correção é ação do usuário — hoje, sem
   switch na tela, isso significa que todo cenário roda fiel à planilha.
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
npm test                                        # 71 testes do motor
node scripts/verificar_base.mjs                 # migrations + roteamento + auth
python scripts/importar_planilha.py --dump --dry-run
node scripts/verificar_importacao.mjs           # importação do payload real + idempotência
node scripts/verificar_api.mjs                  # todas as rotas /api ponta a ponta
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
- Rotas novas só aparecem depois de reiniciar o dev server (o roteamento é lido no boot).

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
