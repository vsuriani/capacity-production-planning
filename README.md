# Dimensionamento de Linha

Planejamento de capacidade e dimensionamento de linha de produção da Tractian.

Substitui a planilha **"Dimensionamento de Linha"** (16 abas) e seus 6 arquivos Apps Script por um
app interno na [Vibe](dev-standards/docs/infra/vibe-platform.md), preservando o cálculo que o PCP
usa hoje.

> ⛔ **A planilha de origem é somente leitura.** Nenhuma rota deste app escreve no Google Sheets.
> Ela é usada diariamente pelo PCP e tem 18 editores.

---

## O problema

O planejamento vivia numa planilha com o cálculo espalhado em fórmulas escritas à mão e quatro
gerações de Apps Script convivendo no mesmo escopo global. A engenharia reversa completa está em
[docs/planilha-dimensionamento-de-linha.md](docs/planilha-dimensionamento-de-linha.md); os scripts
originais estão preservados em [scripts/apps-script/](scripts/apps-script/).

O que a análise encontrou, entre outras coisas:

- **`Code.gs` e `Código.gs` declaram as mesmas 17 funções.** No Apps Script todos os `.gs`
  compartilham um escopo global e a última definição vence — então metade do trabalho recente
  (UniTrac 2.0, OEE Trac, Omni Trac, Omni Receiver…) é **código morto**.
- **`Planejamento Semanal` calcula errado**: na soma de operadores, a Meta de um dispositivo
  multiplica a quantidade de outro (8 de 13 termos numa coluna, 11 de 16 em outra), e três termos
  usam a quantidade de **outro período**.
- **O headcount mensal é digitado à mão** — só as colunas semanais têm `ROUNDUP`.
- **`PlotarProjeção.gs` grava em layout de 3 colunas/dia numa grade de 2**, contaminando o dia
  seguinte e apagando a demanda digitada.
- **6 códigos SAP da grade não geram linha de demanda nenhuma**, em silêncio.
- **`Base de PROD` tem 216 linhas para 199 códigos** — 17 duplicados, um deles sem descrição.

## A decisão que molda o app

**O cálculo é fiel à planilha por padrão.** Cada divergência conhecida (13 hoje) está catalogada
com o que a planilha faz, o impacto medido e o que muda se for corrigida — o catálogo fica em
`/importar`.

Nada é corrigido em silêncio: a política de correções continua gravada por cenário (`correcoes`) e
o motor devolve os diagnósticos em toda rota. O que não existe mais é o switch na tela, então hoje
todo cenário roda fiel à planilha.

---

## Onde o projeto está

A planilha já foi lida — a carga inicial trouxe cadastros, cenários e a grade, e **o app é a fonte
da verdade desde então**. O trabalho agora é operar sem ela.

O que já está desvinculado:

- **A operação acontece no app**: cenário, calendário, geração de demanda, lista de demanda e
  alocação. Nenhuma rota escreve no Google Sheets — nunca escreveu.
- **Um mês por vez** (`MES_EM_USO`, ver [Cenários](#cenários)). Hoje: **Agosto/2026**, criado e
  mantido pelo app. Os cenários importados dos outros meses seguem no banco como histórico.
- **As telas foram enxugadas** para o fluxo semanal: saíram Planejamento Mensal, Capacidade e o
  painel de diagnóstico por tela.

O que ainda depende da planilha, de propósito:

- `scripts/planilha.py` e `scripts/importar_planilha.py` — a carga inicial, reexecutável se
  precisar re-sincronizar. **Somente leitura.**
- As fixtures do motor (`api/_lib/motor/fixtures.json`) e `verificar_agosto.mjs` — é assim que se
  prova que o cálculo continua batendo com o número que o PCP conhece.
- [docs/planilha-dimensionamento-de-linha.md](docs/planilha-dimensionamento-de-linha.md) e o
  catálogo de divergências — a memória de por que o cálculo é como é.

---

## Rodar localmente

Não precisa de Docker: o dev server usa **Postgres em WASM** (`@electric-sql/pglite`), persistido
em `.cache/pgdata`.

```bash
npm install
cd api && npm install && cd ..

npm run dev          # Vite em :5273 + API em :3101
```

Espere a linha `[dev] API em http://localhost:3101` — o primeiro boot do Postgres leva ~40 s.

Num banco vazio, rode a **carga inicial** da planilha (só uma vez; depois o app é a fonte da
verdade e a importação é idempotente):

```powershell
# PowerShell
$env:GOOGLE_APPLICATION_CREDENTIALS = "$env:USERPROFILE\.secrets\tractian-bi-operations-dashboard.json"
python scripts/importar_planilha.py --dry-run   # confere o que seria importado
python scripts/importar_planilha.py            # importa de verdade
```

```bash
# bash
export GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/tractian-bi-operations-dashboard.json
python scripts/importar_planilha.py
```

Abra **http://localhost:5273**.

> As portas são 5273/3101 (e não 5173/3001) para conviver com outros projetos internos na máquina.
> Sobrescreva com `VITE_PORT`, `VITE_API_TARGET` e `API_PORT`.

### Credencial

A service account (`operations-dashboard@tractian-bi`) tem escopo `spreadsheets.readonly` e **fica
fora do repositório**, em `~/.secrets/`. Nunca comite chave — ver
[segurança](dev-standards/docs/standards/security/).

---

## As telas

| Rota | Equivale a | O que faz |
|---|---|---|
| `/inicio` | — | Dashboard: headcount da **semana vigente**, carga dos próximos dias, pendências |
| `/semanal` | Planejamento Semanal | Meta + demanda pelas semanas do mês, dias úteis, operadores |
| `/calendario` | Projeção das linhas | Grade 5 semanas × 6 dias, blocos Produção e Industrialização, **Gerar demanda** |
| `/demandas` | Demandas Defasagem | Lista editável, checkbox "feito" funcional, filtros, exportar CSV |
| `/operadores` | Dimensionamento de Operadores | Heat map de ocupação dia × operador |
| `/roteiros` | Base simplificada | Processos e sequências, editável |
| `/sku` | Base de PROD | Catálogo + mapa SKU → produto + pendências |
| `/cenarios` | — | Criar, duplicar, marcar oficial, comparar headcount — lista o semanal do mês em uso |
| `/importar` | — | Como importar, histórico e o catálogo de divergências |

Tema claro e escuro, com toggle no pé da sidebar.

---

## Como funciona

### Cenários

Um cenário é o recorte de planejamento: **tipo** + **mês**. O app trabalha em **um mês só**, fixado
em [src/lib/escopo.ts](src/lib/escopo.ts) (`MES_EM_USO`): o seletor de cenário e a lista de
`/cenarios` mostram apenas esse mês. Os cenários dos outros meses continuam no banco como
histórico, acessíveis pela API. Para virar o mês, é essa constante — e só ela.

**Semanal** é a única tela de planejamento. O tipo `mensal` não tem tela: é o cenário que carrega o
**calendário, a lista de demanda e a alocação** do mês (`/calendario`, `/demandas`, `/operadores`).
O tipo `capacidade` (aba 🚧 Dimensionamento Global) continua no schema e na importação, mas saiu do
app — os cenários antigos só aparecem na lista de `/cenarios`.

Isso não é só organização — é o que impede o cálculo de somar meses diferentes. A planilha reusa
"Week 1".."Week 5" em cada mês (40 colunas, 12 rótulos distintos); escopando por mês, os rótulos
deixam de colidir.

Um cenário novo **nasce com as bases dentro**: os tempos por dispositivo do cenário mais recente do
mesmo tipo, os períodos do mês com os dias úteis já contados, e os termos da fórmula alinhados —
sem herdar os desvios da planilha. Os cadastros globais (Base de PROD, processos e sequências, mapa
SKU → produto) **não são copiados**: o cenário aponta para eles.

### O motor

Módulos puros em [api/_lib/motor/](api/_lib/motor/) — recebem dados, devolvem
`{ resultado, diagnosticos }`. Sem HTTP, sem banco.

| Módulo | O que faz |
|---|---|
| `desvios.js` | catálogo das 13 divergências + validação das correções |
| `operadores.js` | `Σ(Meta × Qtd)/60 ÷ (diasÚteis × (jornada − pausa)) ÷ coefEficiência` |
| `metrica.js` | `Σ(aditivos) + retrabalho × (1 − FTR)`, depois `÷ coefEficiência` |
| `calendario.js` | `diaDefasagemFiel` (os 8 ramos do script original) **e** `subtrairDiasUteis` |
| `explosao.js` | demanda do calendário → processos, via SKU→produto e roteiro |
| `alocacao.js` | horas por operador, nas 3 passadas do script original |

**Os termos da fórmula são dados, não código.** `cenario_formula_par` guarda cada termo
`(Meta da linha X) × (Qtd da linha Y, período Z)` como está na planilha — é isso que permite
reproduzir os pares desalinhados e os que apontam para outro período, e corrigi-los por opção.

### Fluxo de uso

```
cadastrar roteiros e SKU  →  criar/escolher o cenário do mês
                          →  montar a grade no Calendário
                          →  Gerar demanda        (explosão regressiva)
                          →  Lista de demanda     (marcar o que foi feito)
                          →  Operadores           (heat map de ocupação)
```

---

## Arquitetura

Processo único, no padrão do
[Quality Center](dev-standards/docs/examples/quality-center/AGENTS.md):

```
server.cjs             Express: serve dist/ + monta /api/* + fallback SPA
api/_lib/routes.js     roteamento file-based: api/_handlers/<nome>.js -> /api/<nome>
api/_lib/db.js         pool pg + migrations com retry
api/_lib/auth.js       X-Auth-Email do gateway da Vibe (sem login próprio)
api/_lib/motor/        o cálculo, puro e testável
api/_lib/cenario.js    carrega um cenário e roda o motor
src/                   React 18 + TS + Vite + Tailwind
```

- **Banco**: `postgres:16`. Migrations em `api/migrations/*.sql`, aplicadas na subida.
- **Auth**: o gateway injeta `X-Auth-Email`. Local usa `DEV_FAKE_EMAIL` (nunca em produção).
- **Air-gapped**: nada é baixado em runtime. As fontes Inter/Inter Tight vêm do npm
  (`@fontsource/*`) e são empacotadas — **não** usar o CDN do Google Fonts.
- **Design**: brand lock Slate + Blue, tokens CSS com bridge por tema. Nenhuma tela tem `dark:`.

### Rotas

`me` · `resumo` · `cenarios` · `planejamento` · `roteiros` · `sku` · `projecao` · `demandas` ·
`alocacao` · `parametros` · `desvios` · `importacao`

---

## Verificação

Sem Docker na máquina de dev, os scripts exercitam os handlers **de verdade** contra um Postgres em
WASM — não mockados.

```bash
npm test                              # 71 testes do motor
node scripts/verificar_base.mjs       # migrations, roteamento, auth
node scripts/verificar_importacao.mjs # importação do payload real + idempotência
node scripts/verificar_api.mjs        # todas as rotas ponta a ponta
node scripts/verificar_agosto.mjs     # Agosto/2026 contra os números da planilha
npx tsc --noEmit && npm run build     # frontend
```

Os testes do motor batem contra **números reais**: `api/_lib/motor/fixtures.json` é gerado por
`scripts/motor_fixtures.py` a partir do dump da planilha, e o teste de fidelidade confere os **65
períodos** das abas Mensal e Semanal.

`verificar_agosto.mjs` é o teste mais direto: pega os valores que a planilha exibe para Agosto/2026
(metas, demanda, dias úteis e headcount) e prova que o app reproduz **8,03 / 8,68 / 9,02**, o
headcount digitado **8 / 8 / 8** e o `#DIV/0!` da semana sem dias úteis.

Screenshot de qualquer tela, em qualquer tema:

```bash
node scripts/captura.mjs semanal dark .cache/telas/semanal.png
```

---

## Scripts

| Script | Para quê |
|---|---|
| `scripts/planilha.py` | leitura e parsing da planilha (somente leitura) |
| `scripts/importar_planilha.py` | carga inicial → `POST /api/importacao` |
| `scripts/dump_sheet.py` | dump de fórmulas/valores/metadados em `.cache/` |
| `scripts/motor_fixtures.py` | fixtures dos testes a partir do dump |
| `scripts/check_pairs.py` | confere o alinhamento Meta × Qtd das fórmulas |
| `scripts/check_gs_mapping.py` | confere os mapeamentos do Apps Script contra os dados |
| `scripts/captura.mjs` | screenshot via DevTools Protocol |

---

## Deploy

`git push` na `main` → GitHub Actions builda e publica em
`https://dimensionamento-de-linha.vibe.tractian.com`.

Segredos via `APP_SECRETS` (GitHub Secret → variáveis de ambiente do container). Ver
[docker-compose.yaml](docker-compose.yaml) para os labels `vibe.*`.

---

## Gotchas do dev

- **Não mate o dev server com `Stop-Process -Force`** — o datadir do pglite não sobrevive. Use
  Ctrl+C. Se corromper, o próprio servidor recria e avisa para reimportar.
- **Rotas novas só aparecem depois de reiniciar** o dev server (o roteamento é lido no boot).
- `process.exit()` durante o teardown do pglite dispara um assert do libuv no Windows — use
  `process.exitCode`.
- O Vite sobe instantâneo e a API demora; abrir antes faz as telas mostrarem erro de rede.

---

## Documentação

- [AGENTS.md](AGENTS.md) — fonte da verdade de arquitetura, convenções e registro de decisões
- [docs/planilha-dimensionamento-de-linha.md](docs/planilha-dimensionamento-de-linha.md) —
  engenharia reversa da planilha e dos scripts, com todos os problemas encontrados
- [scripts/apps-script/](scripts/apps-script/) — os 6 arquivos `.gs` originais, preservados

Uso interno Tractian.
