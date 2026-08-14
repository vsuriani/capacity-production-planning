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
| `planejamento` | editar meta/demanda/dias úteis/componentes; alinhar termos; incluir faltantes |
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
for corrigida. A UI mostra isso no painel *Diagnóstico* de cada tela.

Regras:

1. **Nenhum desvio muda de default sozinho.** Ligar a correção é ação do usuário.
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
