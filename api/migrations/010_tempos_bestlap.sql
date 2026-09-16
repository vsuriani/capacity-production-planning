-- Os tempos passam a vir da planilha "Análises Best Laps", aba Perfomancedev.
--
-- Até aqui o app tinha TRÊS conjuntos de tempo que ninguém reconciliava:
--
--   dispositivo.meta_padrao   cravado na migration 006, sem tela          -> headcount /semanal
--   dispositivo_metrica       docs/tempos-dispositivo.tsv, carga manual   -> /dimensionamento-global
--   processo.pcs_hora         digitado em /roteiros                       -> tempo da demanda
--
-- A planilha é a fonte viva dos dois primeiros, mantida pela Engenharia. O que esta migration
-- monta é o caminho para ela entrar sozinha: snapshot do que foi lido, log de cada leitura e o
-- de-para entre o vocabulário dela e o cadastro de dispositivos.
--
-- `processo.pcs_hora` fica de fora de propósito: a planilha chaveia em device model ->
-- `dispositivo`, e `processo` pendura em `produto` — tabelas sem FK entre si, ligadas só por
-- nome, e os nomes divergem ("Uniform" x "Uni Trac"). Alimentar a explosão exige antes um
-- cadastro produto<->dispositivo, que é outro trabalho.
--
-- A REGRA DE AGREGAÇÃO (decisão de PCP/Engenharia, mora em `api/_lib/motor/tempos.js`):
--
--   tempo-padrão = Σ goal dos processos do device model, SEM `Processo de montar completo`
--
-- Essa linha é um rollup: repete num número só o que as outras linhas do mesmo produto já
-- detalham. Onde a decomposição da planilha está completa ela vale EXATAMENTE a soma do detalhe
-- (Omni Trac 12,08 = 12,08; Omni Receiver 16,47 = 16,47), então contar as duas dobraria o tempo.
--
-- Âncora contra o cadastro que já existia: Garra Uni Trac não tem rollup, é imune à decisão, e
-- dá 15,34 contra os 15,30 de `meta_padrao`. Smart Trac Ultra Ex dá 4,17 contra 4,40.
--
-- Isto NÃO alimenta `dispositivo_metrica`: o aditivo "Montagem" de lá é o rollup (8,37 em Energy
-- Trac), um componente do parcial do Dimensionamento Global, e não o tempo-padrão do
-- dispositivo. Gravar o total ali faria o parcial contar a defasagem duas vezes.

-- ---------------------------------------------------------------- log
--
-- Vem antes de tempo_atividade porque é o alvo da FK.
--
-- Existe para responder "por que o número de terça era outro". Sem isso, um sync automático que
-- move o headcount vira mistério — que é o problema que este projeto inteiro existe para matar.
-- `erro` preenchido é o registro de uma leitura que falhou: planilha fora do ar não pode tirar
-- o planejamento do ar, então a falha é gravada, não lançada.

CREATE TABLE tempo_sync (
  id          serial PRIMARY KEY,
  quando      timestamptz NOT NULL DEFAULT now(),
  linhas      integer NOT NULL DEFAULT 0,
  origem      text NOT NULL DEFAULT 'agendado',
  erro        text,
  aplicado    boolean NOT NULL DEFAULT false,
  alteracoes  jsonb
);

COMMENT ON COLUMN tempo_sync.origem IS 'agendado | manual';
COMMENT ON COLUMN tempo_sync.alteracoes IS
  'O que o sync mudou no cadastro: [{dispositivo, campo, de, para}]. É o diff que a tela mostra.';

-- ---------------------------------------------------------------- snapshot
--
-- Uma linha por atividade, COMO CHEGA — sem normalizar, sem descartar. O filtro (obsoletas,
-- device_model vazio, goal vazio) acontece na agregação, não na entrada: guardar cru é o que
-- permite reprocessar com outra regra sem reler a planilha, e o que deixa a tela explicar por
-- que uma linha não entrou.
--
-- `mes_medicao` é a coluna `month` da planilha, que NÃO tem ano. Há 16 pares
-- (device_model, processo) duplicados com months diferentes, e sem ano "o mais recente" é
-- convenção, não fato. A agregação desempata pelo maior mês E emite diagnóstico — o número
-- escolhido nunca é silencioso.

CREATE TABLE tempo_atividade (
  id             serial PRIMARY KEY,
  sync_id        integer NOT NULL REFERENCES tempo_sync(id) ON DELETE CASCADE,
  device_model   text NOT NULL DEFAULT '',
  processo       text NOT NULL DEFAULT '',
  process_type   text,
  best_lap       numeric(10, 4),
  goal           numeric(10, 4),
  goal_min       numeric(10, 4),
  goal_max       numeric(10, 4),
  mes_medicao    integer,
  obsoleta       boolean NOT NULL DEFAULT false
);

CREATE INDEX tempo_atividade_sync_idx ON tempo_atividade (sync_id, device_model);

COMMENT ON COLUMN tempo_atividade.goal IS
  'Minuto-OPERADOR por peça. Cada atividade é uma bancada de uma pessoa, então o lap time da '
  'atividade já é o homem-minuto. Confirmado comparando com o roteiro: goal ÷ min-operador fica '
  'entre 0,70 e 1,61, enquanto goal ÷ tempo-de-relógio varia de 1,4 a 9,7 acompanhando o nº de '
  'operadores — assinatura de grandeza errada.';

COMMENT ON COLUMN tempo_atividade.goal_max IS
  'goal ÷ 0,80 em 156 das 188 linhas; nas outras 30 (Smart Trac Ultra Gen 2 e Uni Trac) a razão '
  'é 1,20. Guardamos por fidelidade, mas quem planeja é `goal`: a eficiência mora em '
  'cenario_parametro.coef_eficiencia, onde o PCP consegue ver e mudar. Pôr coef_eficiencia em '
  '0,80 reproduz goal_max exatamente.';

-- ---------------------------------------------------------------- de-para
--
-- Mesmo papel de `dispositivo_model` (forecast), tabela separada porque o vocabulário é outro:
-- lá são códigos PROD, aqui são nomes. Sem FK para nada da planilha de propósito — device model
-- sem par vira pendência na tela, não erro que trava o sync inteiro.

CREATE TABLE dispositivo_device_model (
  device_model    text PRIMARY KEY,
  dispositivo_id  integer NOT NULL REFERENCES dispositivo(id) ON DELETE CASCADE
);

CREATE INDEX dispositivo_device_model_disp_idx ON dispositivo_device_model (dispositivo_id);

-- Os pares confirmados. Só entra o que tem corroboração — nome idêntico, rename conhecido da
-- migration 006, ou número batendo contra dispositivo_metrica.
--
-- Fora daqui, de propósito:
--   Tampografia         — o dispositivo "Tampografia" está OCULTO desde a 005; o cadastro hoje
--                         tem Tampografia Case e Tampografia Sensor, e a planilha não diz qual.
--   Smart Trac Pro, Super capacitor, Bases com imã colado, as três Baterias
--                       — são componentes/subconjuntos, não dispositivos do dimensionamento.
--
-- Todos aparecem como pendência em /tempos. Mapear é decisão de quem conhece a linha, não minha.

INSERT INTO dispositivo_device_model (device_model, dispositivo_id)
SELECT p.device_model, d.id
  FROM (VALUES
    -- exato, e com número conferido contra dispositivo_metrica
    ('Energy Trac',               'Energy Trac'),                 -- Montagem 8,37 e Defasagem 8,78: exatos
    ('Smart Trac Ultra Ex',       'Smart Trac Ultra Ex'),         -- Defasagem 1,12: exato
    ('Smart Receiver Ultra',      'Smart Receiver Ultra'),        -- 20,04/21,82 e 12,84/13,32
    -- nome idêntico
    ('Smart Trac Ultra Gen 2',    'Smart Trac Ultra Gen 2'),
    ('Omni Trac',                 'Omni Trac'),
    ('Omni Receiver',             'Omni Receiver'),
    ('Uni Trac',                  'Uni Trac'),
    -- variação de caixa
    ('Smart Trac Ultra Gen 2 Ex', 'Smart Trac Ultra Gen 2 EX'),
    -- renomeados pela migration 006 ("OEE Trac" -> "Uni Trac 2.0")
    ('OEE Trac',                  'Uni Trac 2.0'),
    ('Garra OEE',                 'Garra Uni Trac'),
    -- a planilha não sufixa a geração; o cadastro só tem a Gen 1 sem sufixo
    ('Smart Trac Ultra',          'Smart Trac Ultra Gen 1')
  ) AS p(device_model, dispositivo)
  JOIN dispositivo d ON d.nome = p.dispositivo
ON CONFLICT (device_model) DO NOTHING;
