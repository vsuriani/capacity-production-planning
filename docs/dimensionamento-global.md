# Dimensionamento Global

A tela `/dimensionamento-global` responde a pergunta do horizonte longo: **quantos operadores
por mês até o fim do forecast** (hoje 09/2026 → 12/2027).

**É uma simulação, não um cenário.** Não tem seletor, não é escopada por `MES_EM_USO`, não se
duplica nem se compara — é uma visão só, que se mexe e se olha. Tudo que ela guarda é estado
global.

```
Calculado = ( Σ(MétricaParcial_i × Qtd_i) / 60 ) / (DiasÚteis × (8 − 0,5)) / CoefEficiência
Produção  = ROUNDUP(Calculado)          ← sem o Coef. de Excedente
```

## Os três arquivos de entrada

| Arquivo | O que é |
|---|---|
| [forecast.tsv](forecast.tsv) | quantidade prevista por `Model`, mês a mês, 09/2026 → 12/2027 |
| [dispositivos-forecast.tsv](dispositivos-forecast.tsv) | `Model` → dispositivo (e a sigla `Product` do forecast) |
| [tempos-dispositivo.tsv](tempos-dispositivo.tsv) | tempo por dispositivo, nas duas métricas |

Convenções: decimal com ponto nos tempos, FTR como fração (`0.95`, não `95%`), mês no cabeçalho
do forecast como `MM/AAAA`. A coluna `Local` do forecast original foi descartada — o usuário já
tinha filtrado por Tractian.

Carregar no app (com o dev server de pé):

```bash
node scripts/importar_dimensionamento.mjs
```

As duas rotas de carga **substituem** o conjunto inteiro — o dado chega revisado por completo, e
mesclar deixaria para trás o que saiu da revisão. Os ajustes e os dias úteis digitados não se
perdem nisso: moram em outras tabelas.

## Onde mora cada peça

```
forecast (country, produto, model, ano, mes)     dado externo, recarregável
dispositivo_model (model -> dispositivo_id)      o mapa
dispositivo_metrica                              os tempos, por dispositivo
global_mes (ano, mes) -> dias_uteis              digitados; o botão preenche os vazios
global_ajuste                                    o AJUSTE, que sobrepõe o forecast
parametro                                        jornada, pausa e coeficientes (globais)
```

A **camada de ajuste** é o cerne: a quantidade efetiva de uma célula é o ajuste quando existe
linha em `global_ajuste`, senão a soma do forecast. Sem linha = "vale o forecast". É isso que
faz recarregar o forecast não apagar o que o PCP digitou. Digitar de volta o número do forecast
apaga o ajuste (`PATCH /api/dimensionamento` com `quantidade: null`).

`POST /api/dimensionamento?acao=tempos` **cria o dispositivo que ainda não existe**: a tela tem
de ficar de pé num banco onde a planilha nunca foi importada, e é assim que
`verificar_dimensionamento.mjs` a exercita.

## A linha abre nos PRODs

Como na planilha: clicar no dispositivo mostra os `Model` que o compõem, mês a mês. É a
rastreabilidade do número — *Smart Trac Ultra Gen 2 EX* abre em PROD-0164 e PROD-0165, e dá para
ver de onde vieram as 3200 peças de Setembro/2026.

A abertura é **somada sobre os Country** (PROD-0164 US + MX viram uma linha só) e é **somente
leitura**: quem se ajusta é o dispositivo, porque é ele que tem tempo-padrão. Consequência
intencional — num mês ajustado os PRODs **não** somam a linha de cima, e é exatamente isso que
se quer enxergar: o de baixo é o forecast, o de cima é a decisão.

## Dias úteis

A célula é digitada — a tela não preenche sozinha. O que existe é uma **ação explícita**, o
botão *Preencher N dias úteis*, para não digitar 16 vezes quando o horizonte estica:
`POST /api/dimensionamento?acao=dias-uteis` conta do calendário descontando a tabela `feriado`,
e **só toca nos meses vazios** — o que foi digitado à mão é decisão e não se sobrescreve.
(`{ sobrescrever: true }` refaz todos, e aí perde o digitado.)

Os feriados entram por `node scripts/cadastrar_feriados.mjs 2026 2027`. **Só os feriados por
lei** (decisão do usuário): Carnaval e Corpus Christi são ponto facultativo federal e ficam de
fora — ver `scripts/_feriados_br.mjs`, que já tem o `pascoa()` caso passem a valer. Feriado
estadual ou municipal também não entra: depende de onde a planta está.

A contagem bate com o print da planilha em Setembro/2026 (21), Outubro (21) e Novembro (19).
**Dezembro/2026 é a exceção**: o calendário dá 22 e a planilha mostrava **14** — os 8 dias de
diferença são férias coletivas, que nenhum calendário adivinha. É um caso para sobrescrever a
célula à mão.

## A chave de junção é `Model`, não a sigla

As siglas do forecast **não** identificam dispositivo:

- `STUE` cobre *Smart Trac Ultra Ex* (PROD-0113/0114) **e** *Smart Trac Ultra Gen 2 EX*
  (PROD-0164/0165) — tempos bem diferentes: 11,76 contra 12,50 na parcial.
- `SRU` cobre *Smart Receiver Ultra* e *…Gen 2*.
- `ET+` cobre *Energy Trac* e *Energy Trac Pro* (18,75 contra 6,30).

Casar por `Model` é o único caminho correto. Os 23 models do forecast estão todos mapeados.

`dispositivo_model.model` não tem FK para `sku(codigo)`: **5 dos 23 models não estão na Base de
PROD** (PROD-0151, PROD-0173, PROD-0183, PROD-0176, PROD-0177). A FK travaria a carga inteira
por causa deles. Model sem dispositivo aparece como aviso ao pé da tela — sem dispositivo não há
tempo, então aquele volume não entra em conta nenhuma.

## O que foi tirado do forecast

`PROD-0177` chegou duplicado, em `OEET` e `UT+` com os mesmos números; por decisão do usuário
ficou **só em UT+** (*Uni Trac*), e a linha `OEET` saiu.

*Smart Receiver Ultra Ex* (`PROD-0155`, 50 peças em 09/2026) saiu inteiro — mapa e forecast —
porque é **produção externa**: não consome a linha, então não entra no dimensionamento. Era o
único dispositivo sem linha na tabela de tempos, e a ausência do tempo era justamente o sinal
disso. Restaram **28 linhas** de forecast e **11 dispositivos**, todos com tempo.

## Os tempos são a mesma fórmula do motor

Conferido linha a linha nos 11 dispositivos:

- **Parcial** = `Σ(aditivos) + retrabalho × (1 − FTR)` — é exatamente `motor/metrica.js`.
- **Real** = `Parcial ÷ 0,85` — é o `coefEficiência` que o motor aplica depois.

Ou seja, a coluna *Métrica Prod. Real* não é um dado novo: é a parcial já dividida pela
eficiência. Guardar as duas é conveniência de leitura.

Os componentes têm a coluna Real arredondada individualmente, então somá-los pode dar 1 centésimo
a menos que o total (ex.: STU Ex dá 13,83 contra 13,84). **A conta boa é sempre pela parcial** —
é o que a tela faz: alimenta o motor com a parcial e deixa ele dividir por `coefEficiência` uma
vez, em vez de usar o valor de 2 casas que a planilha exibe.

## O excedente de 20% não entra

A linha *Quantidade Produção Real* da planilha é `ROUNDUP` puro. Conferido nos meses que
distinguem os dois casos: Abril/2026 dá 7,57 → **8** e Junho/2026 dá 8,53 → **9**; com os 20%
seriam 10 e 11. O parâmetro `coef_excedente` continua no banco e a tela mostra o valor como
chip, marcado *não aplicado*. Para vê-lo aplicado, é ligar `excedente-so-no-global` no cenário.

## Fidelidade

Os **13 meses** da aba (Abril/2026 → Abril/2027, com as quantidades digitadas na planilha) são
teste em `api/_lib/motor/operadores.test.js` — calculado e headcount, casa decimal por casa
decimal. `scripts/verificar_dimensionamento.mjs` cobre o resto ponta a ponta, **partindo de um
banco sem nenhum cenário e sem nenhum dispositivo**: carga dos tempos e do forecast,
idempotência das duas recargas, a conta do mês, a camada de ajuste e o model órfão.

Vale notar que as quantidades do teste são as **digitadas à mão na planilha**, e não as do
forecast: Setembro/2026 tem 4000 de *Smart Trac Ultra Gen 2 EX* na planilha contra 3200 no
forecast. Substituir esses números pelo forecast é o ponto da tela.
