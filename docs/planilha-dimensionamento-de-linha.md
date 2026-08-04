# Planilha "Dimensionamento de Linha" — como funciona

Engenharia reversa da planilha que hoje faz o dimensionamento de linha / planejamento de
capacidade de produção. Base para portar essa lógica para uma aplicação.

- **Arquivo:** `Dimensionamento de Linha`
- **ID:** `1UWobn-ss5IY4cvG89hYrttCcXB_qc07PmbHsf8r7LNM`
- **Abas:** 16 (9 ocultas)
- **Data da análise:** 2026-08-03
- **Como foi lida:** Google Sheets API v4 com a service account
  `operations-dashboard@tractian-bi.iam.gserviceaccount.com` (ver [scripts/](../scripts/))

---

## 1. O que a planilha resolve

Dada uma **demanda de produção** (quantas peças de cada dispositivo, por semana ou por mês),
responder **quantos operadores a linha precisa** para dar conta — e desdobrar isso em um
**cronograma diário** por código SAP, respeitando o *leadtime* de cada processo.

Três perguntas, três grupos de abas:

| Pergunta | Aba |
|---|---|
| Quantos operadores para esta demanda? | `Planejamento Mensal`, `Planejamento Semanal`, `🚧 Dimensionamento Global` |
| Que peça produzir em que dia? | `Projeção das linhas`, `Demandas Defasagem`, `Dimensionamento de Operadores` |
| Quanto tempo cada processo leva? | `Base simplificada` (+ variantes mensais e `Geral`) |

---

## 2. Fluxo de dados

```
   CADASTROS (colados de fora)                    PARÂMETROS DE PROCESSO
   ┌──────────────────────────┐                   ┌──────────────────────────────┐
   │ Base de PROD   (217 SKU) │                   │ Base simplificada  (87 proc) │
   │ Base SAP      (1004 itens)│                  │  tipo de linha, produto,     │
   │ Base SUBM      (59 proc) │                   │  processo, sequência,        │
   └──────────────────────────┘                   │  paralelismo, leadtime,      │
              │                                   │  operadores, pçs/hr          │
              │ códigos SAP                       └──────────────┬───────────────┘
              │                                                  │
              v                                                  │ snapshot mensal
   ┌───────────────────────────────┐                             v
   │ Projeção das linhas           │              ┌──────────────────────────────┐
   │  grade 5 semanas x 6 dias     │              │ Base simplificada - Geral    │
   │  3 blocos:                    │              │  (491 linhas, + Month/Year)  │
   │   - Linha de Produção (9-18)  │              │  histórico 05/2025 a 11/2025 │
   │   - Industrialização (19-29)  │              └──────────────┬───────────────┘
   │   - Defasagem (31-...)        │                             │
   │  consolidação em C45:I...     │                             v
   └───────────────┬───────────────┘              ┌──────────────────────────────┐
                   │                              │ BigQuery (aba auxiliar)      │
                   v                              │  gera o DDL + o SELECT para  │
   ┌───────────────────────────────┐              │  carregar em                 │
   │ Demandas Defasagem            │              │  operations_production_      │
   │  1 linha = 1 processo/dia     │              │  performance (tractian-bi)   │
   │  + horas por operador (M..W)  │              └──────────────────────────────┘
   └───────────────┬───────────────┘
                   v
   ┌───────────────────────────────┐
   │ Dimensionamento de Operadores │   horas/dia de cada Operador 1..8
   └───────────────────────────────┘

   DEMANDA + META (digitadas à mão)
   ┌──────────────────────────────────────────────────────────────┐
   │ Planejamento Semanal / Mensal / 🚧 Dimensionamento Global     │
   │   Meta (min/peça) x Demanda (peças)  ->  Operadores Linha     │
   └──────────────────────────────────────────────────────────────┘
```

Não há `IMPORTRANGE`, nem Connected Sheets, nem *data source* configurado: **as bases são
coladas manualmente** (SAP, PROD, SUBM não têm nenhuma fórmula). A planilha é 100%
auto-contida — o único ponto de saída é a carga para o BigQuery.

---

## 3. O motor de cálculo

### 3.1 Fórmula de operadores (o coração da planilha)

Em `Planejamento Mensal!E24` (e equivalentes):

```
Operadores = ( Σ (Meta_i × Demanda_i) / 60 ) / ( DiasÚteis × (8 − 0,5) ) / CoefEficiência
```

| Termo | Onde | Significado |
|---|---|---|
| `Meta_i` | coluna `B` | **minutos-operador por peça** do dispositivo *i* (ex.: Smart Receiver Ultra = 30,1) |
| `Demanda_i` | colunas `E:AF` | peças planejadas naquela semana/mês |
| `/ 60` | — | minutos → horas |
| `DiasÚteis` | linha 23 | dias úteis do período (5 na semana; 20-23 no mês) |
| `(8 − 0,5)` | hardcoded | jornada de 8 h menos 0,5 h de parada/almoço = **7,5 h líquidas** |
| `CoefEficiência` | `B25` = **0,85** | eficiência real da linha (85 %) |

O resultado é fracionário; a linha de baixo (`E25`) aplica `ROUNDUP(...;0)` para virar
**cabeça de operador inteira**.

> A jornada `8 − 0,5` e o divisor `60` estão **escritos dentro da fórmula**, não em células de
> parâmetro. Ao portar, transformar em constantes configuráveis.

### 3.2 Como a "Meta" (min/peça) é composta

A aba `🚧 Dimensionamento Global` mostra a decomposição, por dispositivo (11 dispositivos,
blocos de 4-5 linhas):

```
MétricaParcial = (Defasagem + Montagem) + Bateria + (Retrabalho × (1 − FTR))
MétricaReal    = MétricaParcial / CoefEficiência        (D56 = 0,85)
```

Exemplo — Smart Trac Ultra Ex (`C4`):

```
= (C5 + C6) + C7 + (C8 × (1 − C9))
   ↑     ↑      ↑         ↑    ↑
 Defas. Mont. Bateria  Retrab. FTR = 0,95
```

O **FTR** (*first-time-right*, 0,95) faz o retrabalho pesar só sobre os 5 % que reprovam.
É essa `MétricaReal` que alimenta a coluna `Meta` das abas de planejamento.

### 3.3 A conta do Global (mensal, 2026)

```
linha 73  Dias Úteis no mês            (20, 20, 21, 23, ...)
linha 74  Quantidade Calculado  = (Σ(MétricaReal_i × Demanda_i)/60) / (DiasÚteis × 7,5)
linha 75  Quantidade Produção   = ROUNDUP(linha74 + linha74 × CoefExcedente)   ← D58 = 0,2
```

O **Coef. de Excedente (20 %)** é uma folga de headcount aplicada só aqui — as abas
`Planejamento Mensal/Semanal` **não** usam esse coeficiente.

### 3.4 Tempo por processo (`Base simplificada`)

Uma linha por processo (87 processos, 15 produtos, 3 tipos de linha):

| Coluna | Campo | Observação |
|---|---|---|
| A | Tipo da linha | `Defasagem` (38) / `Industrialização` (30) / `Produção / Montagem` (19) |
| B | Produto | |
| C | Produto Filho | `-` quando não se aplica |
| D | Processo | |
| E | Sequência de montagem | ordem dentro do produto |
| F | Coeficiente de paralelismo | quantos postos em paralelo |
| G | Leadtime até produção (dias, regressivo) | quantos dias **antes** da produção o processo roda |
| H | Operadores por processo | |
| I | Pçs/hr (total de operadores) | |
| J | **Total no dia (8 hrs)** | `=I × 8` |

Atenção à direção do cálculo: **nas linhas 2-40 `J = I × 8`, mas nas linhas 41-86 é o inverso
(`I = J / 8`)** — ora se digita a taxa horária, ora o total diário. Não há circularidade (nunca
as duas na mesma linha), mas a fonte da verdade muda no meio da tabela.

### 3.5 Cronograma diário (`Projeção das linhas`)

Cabeçalho: `Mês` (B1), `Ano` (B2), `Qtd. Operadores` (B3).

A grade de datas é **calculada**: `C6` acha a primeira segunda-feira do mês
(`IF(WEEKDAY(DATE(ano;mês;2))=2; ...)`), e as demais células só somam +1 dia — com **+2 na
virada de semana**, para pular o domingo. Resultado: 5 semanas × 6 dias (seg-sáb),
espalhadas nas colunas `C` a `BN` em pares `Cód Sap | Qtd`.

Três blocos de linhas, um por tipo de linha:

| Linhas | Bloco |
|---|---|
| 9-18 | Linha de Produção |
| 19-29 | Industrialização |
| 31-... | Defasagem |

**Consolidação (`C45:I...`)**: `C46` monta a lista de SKU distintos com um
`SORT(UNIQUE(QUERY({...53 faixas empilhadas...}; "select * where Col1 != 'PROD' and Col1 != 'PROI-0062'")))`,
e cada semana é somada com **6 `SUMIF` encadeados** (um por dia da semana) — 480 `SUMIF` na aba.
`D46 = SUM(E46:I46)` fecha o total do mês.

### 3.6 Carga para o BigQuery (`BigQuery`, oculta)

A aba não consulta o BigQuery — ela **gera texto** para configurar a carga da
`Base simplificada - Geral` na tabela `operations_production_performance` (projeto `tractian-bi`):

- `A1` — URL da planilha; `C1` — nome da tabela destino
- `A2` — faixa a carregar: `="Base simplificada - Geral!A2:"&SUBSTITUTE(ADDRESS(1;A3;4);"1";"")`
- `A3` — nº de colunas: `=COUNTA(ARRAYFORMULA('Base simplificada - Geral'!1:1))`
- `A5` — nomes das colunas da planilha (`TRANSPOSE` do cabeçalho)
- `B:C` — nome e tipo no BigQuery; `D` — string do schema (`Campo:TIPO,`)
- `F` — cláusula `SELECT` com os casts (`SAFE_CAST(REPLACE(...))` para limpar `$`, `.` e `,`)

Mapa planilha → BigQuery:

| Planilha | BigQuery | Tipo declarado |
|---|---|---|
| *(coluna A, cabeçalho vazio)* | `LineType` | STRING |
| Produto | `Product` | STRING |
| Produto Fiho | `ProductChild` | STRING |
| Processo | `Process` | STRING |
| Sequencia de montagem | `AssemblySequence` | STRING |
| Coeficiente de paralelismo | `Parallelism` | INTEGER |
| Leadtime até produção | `LeadtimeToProduction` | INTEGER |
| Operadores por Processo | `QtyOperatorsProcess` | INTEGER |
| Pçs/ HR (Total Operadores) | `PiecesPerHour` | FLOAT |
| Total no dia (8 hrs) | `ProductionCapacity` | STRING |
| Month | `Month` | INTEGER |
| Year | `Year` | INTEGER |

`Base simplificada - Geral` é o **histórico versionado** da `Base simplificada`: mesma
estrutura + `Month`/`Year`. Contém 491 linhas cobrindo **05/2025 a 11/2025** — as abas
`Base Simplificada - Abril /2025`, `Maio/2025` e `Julho/2025` são snapshots antigos soltos.

---

## 4. Automação / scripts

O que foi possível verificar pela API:

| Item | Situação |
|---|---|
| Connected Sheets / data sources | **nenhum** (`dataSources` vazio) |
| Intervalos nomeados | **nenhum** |
| Faixas protegidas | **nenhuma** |
| Developer metadata | **nenhum** |
| Formatação condicional | 5 regras em 6 abas |
| Filtros | `basicFilter` em 5 abas |
| Gráficos / slicers | nenhum |

**Apps Script:** existem **6 arquivos**, preservados em [`scripts/apps-script/`](../scripts/apps-script/).
A Sheets API não expõe script vinculado, então eles foram obtidos com o usuário. São **quatro
gerações da mesma solução convivendo no mesmo escopo global**:

| Arquivo | Geração | Estado |
|---|---|---|
| `Código.gs` | 1ª — 8 grupos de produto | **ativa** |
| `Code.gs` | 2ª — 14 grupos | **morta por sobreposição** |
| `PlotarProjeção.gs` | 3ª — fluxo invertido | funcional, mas corrompe a grade |
| `teste.gs` | 4ª — reescrita | nunca roda |
| `EstudoPorOperador.gs` | complemento (alocação) | funcional, com 3 bugs |
| `Historico.gs` | resíduo | menu quebrado |

### 4.1 `Code.gs` e `Código.gs` declaram as mesmas 17 funções

No Apps Script todos os `.gs` compartilham **um único escopo global** — não há módulo nem import.
Declarações de função são içadas e a **última carregada vence**. Pela ordem dos arquivos no editor
(`Code.gs` antes de `Código.gs`), quem roda é a versão do **`Código.gs`**, que é a mais antiga:

| | `Code.gs` | `Código.gs` (a que vence) |
|---|---|---|
| Grupos em `calculoDefasagem` | 14 | **8** |
| Grupos em `calculoIndustrializacao` | 8 | **6** |
| `processoUniTrac2`, `processoOEETrac`, `processoOmniTrac`, `processoOmniReceiver`, `processoSmartTracUltraExGen2`, `processoOmniReceiverMX` | existem | **não existem** |
| `smartTracUltraGen2Prod` | `PROD-0140/0152/0153` | `PROD-0140/0152` |
| `baterias` | 6 códigos | 4 códigos |

Todo o trabalho de adicionar UniTrac 2.0, OEE Trac, Omni Trac, Omni Receiver, Smart Trac Ultra Ex
Gen 2 e Omni Receiver MX está no `Code.gs` e é **código morto**. Para confirmar sem escrever nada:

```javascript
function qualVersaoEstaAtiva() {
  Logger.log(calculoDefasagem.toString().includes("PROD-0153") ? "Code.gs" : "Código.gs");
  Logger.log(typeof processoOmniTrac);  // "undefined" => Código.gs venceu
}
```

### 4.2 `PlotarProjeção.gs` grava na coluna errada

Faz o caminho **inverso** — lê `Demandas Defasagem` e escreve em `Projeção das linhas` — fechando
um ciclo `Projeção → ploteRelatorio → Demandas → plotarNaProjecao → Projeção`.

O comentário diz *"Layout Novo: col = Cód Sap | col + 1 = Processo | col + 2 = Qtd"*, ou seja **3
colunas por dia**. Mas a grade tem **2 colunas por dia** (`Cód Sap | Qtd`). Escrevendo a partir de
`C9`: `C9` ← SKU (ok), `D9` ← Processo (mas `D` é *Qtd*), `E9` ← Qtd (mas `E` é o *SKU do dia
seguinte*). Cada linha plotada contamina o dia seguinte. Antes disso ele faz `clearContent()` **e**
`setDataValidation(null)` em `C9:BY29`, apagando a demanda digitada e destruindo as listas
suspensas. **Não rodar.**

`validarCapacidade` do mesmo arquivo soma o tempo do dia inteiro *incluindo a própria linha* e
depois soma `novoTempo` outra vez (dupla contagem), e usa `B3 * 8.8` — uma quarta jornada.

### 4.3 `teste.gs` nunca executou

Lê a aba **"Planejamento Macro"**, que não existe entre as 16 abas. Cai no
`alert("Erro: Verifique os nomes das abas")` e retorna. É uma pena: conceitualmente é a melhor
versão — calendário de dias úteis real, `diasConsumidos = ceil(horas / (operadores × 7,5))` e
escrita num único `setValues`. Ressalvas: usa a `Base simplificada - Geral` (dados até 11/2025),
pega o ano de `new Date().getFullYear()`, o comparador do `sort` é inválido (só olha `a`), o
ponteiro de dia útil não reseta por semana, e escreveria `"Semana N"` (texto) na coluna B onde as
outras funções esperam uma **data** — schemas incompatíveis na mesma aba.

### 4.4 `EstudoPorOperador.gs` — a alocação por operador

`dimensionamentoDeOperadores()` distribui as horas de cada processo entre os N operadores (`B3` da
Projeção) em 3 passadas: primeiro os ociosos, depois quem tem menos de 7,5 h, por último quem já
passou de 8 h. Cada um dos N operadores recebe a duração **integral** do processo — o `Pç/Hr` da
base já é da equipe toda, então é tempo de parede. Três bugs:

1. **Grava sob o dia anterior.** O flush acontece na troca de dia mas é rotulado com `diaAnterior`.
   Na primeira iteração `diaAnterior` é `null` — é por isso que a linha 2 daquela aba é
   `['', 0, 0, …]`. E o loop termina sem flush: **o último dia nunca é gravado**.
2. **O check nunca funciona.** `check[i] == "true"` compara um checkbox (booleano) com a string
   `"true"`; em JS isso é sempre `false`. A coluna *"Check de atividade feita"* não exclui nada.
3. **Troca de dia por `getDate()`** compara só o dia do mês — 5 de julho e 5 de agosto são "o
   mesmo dia".

`analiseDemanda()` tem os `if/else` com corpo vazio: não faz nada.

### 4.5 `Historico.gs`

Só um `onOpen` criando o menu "Scripts" com "Run" → `run` e "Format" → `format`. **Nenhuma das
duas existe** em nenhum arquivo: clicar dá "Script function not found". Usa `ss.addMenu()`, API
antiga (hoje é `SpreadsheetApp.getUi().createMenu()`).

### 4.6 Problemas transversais dos scripts

- `dadosBaseProcesso()` é chamada **9 vezes** dentro de cada `processoXxx()`, e cada chamada faz 10
  `getValues()`. `calculoDefasagem()` instancia as 14 funções → ~1.260 leituras de range. E
  `ploteRelatorio()` chama `calculoDefasagem()` **3 vezes**.
- `ploteRelatorio()` escreve **célula por célula** (10 `setValue()` por linha) e recalcula
  `getLastRow()` a cada iteração.
- Dados trafegam como **array plano com aritmética de índice** (`def[8*b][0]`,
  `relatorios[a][7 + 10*i]`). Qualquer campo novo desloca tudo.
- `getRange(2, 1, ultimaLinha, 1)` lê uma linha além do fim (deveria ser `ultimaLinha - 1`).
- `relatorioIndustrializacao` de `calculoDefasagem()` é declarado, retornado e usado — mas **nunca
  preenchido**.
- URL da planilha hardcoded 5×; `openByUrl` em vez de `getActive()`.

---

## 5. Problemas encontrados

Ordenados por impacto. Todos verificados sobre o estado de 2026-08-03.

### 5.1 `Planejamento Semanal` — Meta multiplicada pela demanda do dispositivo errado

**Grave, afeta o resultado.** Na fórmula de `Operadores Linha` (linha 27), a Meta de uma linha é
multiplicada pela quantidade de **outra**. Reproduzir com `python scripts/check_pairs.py`:

| Coluna | Termos | Desalinhados | Dispositivos fora da conta |
|---|---|---|---|
| `E27` (semanas) | 13 | **8** | 9 |
| `S27` (meses) | 16 | **11** | 6 |

Exemplos em `E27`:

```
$B$8  × E7   → Meta de "Retrabalho SRU"          × Qtd de "Retrabalho STU"
$B$12 × E11  → Meta de "Smart Receiver Ultra"    × Qtd de "Smart Trac Ultra Ex"
$B$23 × E24  → Meta de "Omni Trac"               × Qtd de "Omni Receiver"
```

É o sintoma clássico de fórmula copiada da aba mensal **depois** de inserir linhas: as
referências `$B$n` travadas com `$` não acompanharam o deslocamento. Como as Metas variam de
0,48 a 33,27 min/peça, o headcount calculado pode estar errado por um fator grande.

`Planejamento Mensal!S24` é a única fórmula **correta e completa** (19 termos, todos alinhados) —
serve de referência para reconstruir as outras.

### 5.1.1 `Planejamento Semanal` — termo usando a quantidade de outro período

**Grave, mesma fórmula.** Além das linhas trocadas, três colunas multiplicam a Meta pela
quantidade de **outra coluna**, ou seja, de outro período:

| Célula | Termo | Efeito |
|---|---|---|
| `Y27` (Week 2) | `$B$3*Z3` | usa a quantidade da Week 3 |
| `Z27` (Week 3) | `$B$3*AA3` | usa a quantidade da Week 4 |
| `AA27` (Week 4) | `$B$3*AB3` | usa a quantidade da Week 5 |

Sempre no dispositivo da linha 3 (`Bateria EX Gen 2`) — erro de arraste em um único termo,
propagado para as colunas seguintes. Em `Y27` e `AA27` as duas colunas têm a mesma quantidade,
então o erro fica **silencioso**; em `Z27` ele morde: usa `AA3` = 0 quando devia usar `Z3` = 500,
subtraindo 8 × 500 = 4.000 minutos da carga da Week 3.

### 5.1.2 O headcount mensal é digitado à mão, não calculado

A linha "Operadores Linha" arredondada só tem `ROUNDUP` nas **colunas semanais** (`E:R`). Nas
**colunas mensais** (`S:AF`) o número é **valor digitado** e não acompanha o cálculo:

| Aba | Colunas com `ROUNDUP` | Colunas digitadas |
|---|---|---|
| `Planejamento Mensal` | `E:R` (11) | `S:AF` — todas com `8` fixo (14) |
| `Planejamento Semanal` | `E:R` (11) | `S:AF` — valores entre 6 e 9 (14) |

Exemplo: `Planejamento Mensal!T24` calcula **8,4986** (que arredondaria para 9), mas `T25` exibe
**8**. Ou seja, o headcount mensal apresentado é uma decisão manual desconectada da conta —
e não há nada na planilha indicando isso.

### 5.2 Dispositivos silenciosamente ignorados no cálculo

`Planejamento Mensal!E24` (colunas semanais) soma **13 dos 19** dispositivos. Fora da conta:
`Retrabalho Energy`, `Smart Receiver Ultra Gen 2`, `Smart Trac Ultra Gen 2 EX`, `Energy Trac Pro`,
`OEE Trac`, `Garra OEE Trac`. Se qualquer um deles tiver demanda na semana, o operador não é
contado. Como a soma é uma lista fixa de termos escrita à mão, **toda linha nova precisa ser
adicionada em 28 fórmulas** — o formato não escala.

### 5.3 `BigQuery` — a coluna `Year` nunca é carregada

`A3` usa `COUNTA` do cabeçalho da `Base simplificada - Geral` para descobrir quantas colunas
carregar. Mas **`A1` (LineType) está vazia**: `COUNTA` conta 11 em vez de 12, e `A2` monta a faixa
`Base simplificada - Geral!A2:K` — que **para em `K` e exclui `L` (Year)**. Corrigir preenchendo
o cabeçalho `A1` (ex.: `Tipo da linha`) ou trocando `COUNTA` por uma contagem posicional.

### 5.4 `BigQuery` — casts errados no `SELECT` gerado

| Célula | Problema |
|---|---|
| `F5` | `SAFE.PARSE_DATE('%d/%m/%Y', LineType)` — `LineType` é texto (`Defasagem`, `Industrialização`). O parse **sempre retorna NULL**. Deveria ser `` `LineType` `` puro. |
| `F13` | `PiecesPerHour` declarado `FLOAT` mas o cast é `AS INT64` — **trunca a casa decimal** da taxa horária. |
| `F14` | `ProductionCapacity` declarado `STRING` mas o cast é `AS INT64` — schema e SELECT discordam. |
| `F10`-`F16` | `REPLACE(..., '$', '')` aparece duas vezes (a segunda é no-op) e remove `.` antes de trocar `,` por `.` — funciona para pt-BR, mas quebra se o valor vier já em formato americano. |

### 5.5 Dados do BigQuery defasados

`Base simplificada - Geral` tem snapshots só até **11/2025**, enquanto o planejamento ativo já é
**07/2026**. A tabela `operations_production_performance` está ~8 meses atrasada, e a
`Base simplificada` atual (87 linhas) nunca foi versionada para lá.

### 5.6 Células em erro hoje

| Aba | Célula | Erro |
|---|---|---|
| `Planejamento Semanal` | `AR27` | `#DIV/0!` — `Dias Úteis` (`AR26`) está zerado/vazio |
| `Qtd / Lote - Horas` | `A6` | `#N/A` — o `FILTER` procura `Gateway Ultra` (A2) em `Base simplificada!B`, que não tem esse produto |
| `BigQuery` | `E5` | `#REF!` — referência à aba inexistente `Tabela_Base_BQ` |

### 5.6.1 `Base de PROD` tem 17 códigos duplicados

A aba tem **216 linhas para 199 códigos distintos**. Cada duplicata aparece **duas vezes: uma com
descrição e outra sem**. Códigos afetados:

`PROD-0078`, `PROD-0080`, `PROD-0083`, `PROD-0084`, `PROD-0085`, `PROD-0086`, `PROD-0087`,
`PROD-0089`, `PROD-0090`, `PROD-0093`, `PROD-0109`, `PROD-0110`, `PROD-0113`, `PROD-0114`,
`PROD-0127`, `PROD-0131`, `ITCS-0015`.

Vários deles são SKU **ativos no planejamento** (`PROD-0109/0110/0113/0114` estão nos arrays de
mapeamento e `PROD-0114` aparece na grade). Qualquer `PROCV`/`VLOOKUP` na Base de PROD devolve a
primeira linha encontrada — que pode ser a sem descrição.

Também: **3 processos apontam para um "Produto Filho" que não existe na Base de PROD**.

### 5.7 Fragilidades estruturais (para não repetir na aplicação)

- **Chave de produto é texto livre**: `Base simplificada` tem `Smart Trac Ultra Gen 2` **e**
  `Smart Trac Ultra Gen 2 ` (espaço no fim) como produtos distintos. Idem `Produto Fiho `
  (typo) e `Tipo da linha ` com espaço no cabeçalho. Qualquer `SUMIF`/`FILTER` por nome erra.
- **Nomes de dispositivo divergem entre abas**: `Planejamento Mensal` tem `Energy Trac Pro`,
  `Garra OEE Trac`, `Bateria EX`; `Planejamento Semanal` tem `Energy Trac EE`, `Garra Uni Trac`,
  `Bateria EX Gen 2`. Não há tabela de domínio única.
- **`Projeção das linhas!C46`**: as 53 faixas empilhadas no `QUERY` têm sobreposições e faixas
  truncadas (`AC20:AC28` repetida 2×, `AC20:AC29`, `BC9:BC17` **e** `BC9:BC18`), e exclusões
  hardcoded (`!= 'PROD'`, `!= 'PROI-0062'`). Qualquer linha inserida quebra o mapeamento.
- **Mesmo cálculo em 3 lugares** (`Mensal`, `Semanal`, `Global`) com parâmetros diferentes
  (o excedente de 20 % só existe no Global) — as respostas divergem por construção.
- **Parâmetros hardcoded na fórmula**: jornada (`8`), parada (`0,5`), minutos (`60`).
- `🚧 Dimensionamento Global!D75` é o valor `8` digitado à mão, enquanto `F75`, `H75`... são
  `ROUNDUP(...)` — a primeira coluna foi sobrescrita manualmente.

---

## 6. Acesso programático

```bash
export GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/tractian-bi-operations-dashboard.json

python scripts/dump_sheet.py 1UWobn-ss5IY4cvG89hYrttCcXB_qc07PmbHsf8r7LNM
python scripts/show_tab.py "Planejamento Mensal" 1 30
python scripts/check_pairs.py
```

O dump vai para `.cache/sheet-dump/` (gitignored — contém dado interno de produção):
`metadata.json`, `formulas.json`, `values.json`, `inventario.json`.

**A credencial nunca fica no repositório** — ver [security](../dev-standards/docs/standards/security/).
A service account tem escopo `spreadsheets.readonly`.
