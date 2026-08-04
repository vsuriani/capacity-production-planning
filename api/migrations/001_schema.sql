-- Schema do Dimensionamento de Linha.
-- Origem de cada tabela documentada em docs/planilha-dimensionamento-de-linha.md.

-- ---------------------------------------------------------------- tipos

CREATE TYPE tipo_linha AS ENUM ('defasagem', 'industrializacao', 'producao_montagem');
CREATE TYPE tipo_cenario AS ENUM ('capacidade', 'semanal', 'mensal');
CREATE TYPE escopo_sku AS ENUM ('producao', 'industrializacao');
CREATE TYPE bloco_projecao AS ENUM ('producao', 'industrializacao');
CREATE TYPE origem_taxa AS ENUM ('taxa', 'total');
CREATE TYPE origem_demanda AS ENUM ('gerado', 'manual');
-- Papel do componente na composição da métrica. A planilha tem de 3 a 5 componentes por
-- dispositivo, com rótulos livres ("- Defasagem STU EX", "- Garra OEE Trac", "- Bateria …"),
-- então o que importa é o papel, não um nome fixo.
CREATE TYPE papel_componente AS ENUM ('aditivo', 'retrabalho', 'ftr');

-- ---------------------------------------------------------------- cadastros

-- Aba "Base de PROD": o catálogo de itens do SAP.
CREATE TABLE sku (
  codigo      text PRIMARY KEY,
  descricao   text NOT NULL DEFAULT '',
  grupo_item  text,
  ncm         text,
  ativo       boolean NOT NULL DEFAULT true,
  atualizado  timestamptz NOT NULL DEFAULT now()
);

-- Unidade de roteiro (coluna "Produto" da Base simplificada).
CREATE TABLE produto (
  id     serial PRIMARY KEY,
  nome   text NOT NULL UNIQUE,
  ativo  boolean NOT NULL DEFAULT true
);

-- Absorve as variações de texto da planilha ("OEE" x "OEE Trac",
-- "Smart Trac Ultra Gen 2 " com espaço) sem perder o rastro do nome original.
CREATE TABLE produto_alias (
  produto_id  integer NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
  alias       text PRIMARY KEY
);

-- Aba "Base simplificada": o roteiro de processo.
CREATE TABLE processo (
  id                serial PRIMARY KEY,
  produto_id        integer NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
  tipo_linha        tipo_linha NOT NULL,
  nome              text NOT NULL,
  sequencia         integer,
  paralelismo       numeric(10, 3),
  leadtime_dias     integer NOT NULL DEFAULT 0,
  operadores        numeric(10, 3),
  pcs_hora          numeric(12, 4),
  sku_filho         text REFERENCES sku(codigo),
  -- De qual lado a linha foi digitada na planilha: J=I*8 (taxa) ou I=J/8 (total).
  origem_total_dia  origem_taxa NOT NULL DEFAULT 'taxa',
  ordem_importacao  integer
);

CREATE INDEX processo_produto_idx ON processo (produto_id, tipo_linha, sequencia);

-- Os arrays hardcoded de calculoDefasagem/calculoIndustrializacao viram tabela.
CREATE TABLE sku_produto (
  sku_codigo  text NOT NULL,
  produto_id  integer NOT NULL REFERENCES produto(id) ON DELETE CASCADE,
  escopo      escopo_sku NOT NULL,
  -- true quando o mapeamento só existia no arquivo .gs sobreposto (código morto).
  so_no_codigo_morto boolean NOT NULL DEFAULT false,
  PRIMARY KEY (sku_codigo, produto_id, escopo)
);

CREATE INDEX sku_produto_sku_idx ON sku_produto (sku_codigo, escopo);

-- Linha de dimensionamento das abas de planejamento. Mistura produto
-- ("Smart Trac Ultra Gen 2") e grupo de processo ("Tampografia", "Bateria EX").
CREATE TABLE dispositivo (
  id     serial PRIMARY KEY,
  nome   text NOT NULL UNIQUE,
  ordem  integer NOT NULL DEFAULT 0,
  ativo  boolean NOT NULL DEFAULT true
);

CREATE TABLE feriado (
  data       date PRIMARY KEY,
  descricao  text NOT NULL DEFAULT ''
);

-- Parâmetros globais. Um cenário pode sobrescrever em cenario_parametro.
CREATE TABLE parametro (
  chave      text PRIMARY KEY,
  valor      numeric(12, 4) NOT NULL,
  descricao  text NOT NULL DEFAULT ''
);

INSERT INTO parametro (chave, valor, descricao) VALUES
  ('jornada_horas',    8,    'Jornada bruta por operador, em horas'),
  ('pausa_horas',      0.5,  'Parada/almoço descontado da jornada'),
  ('coef_eficiencia',  0.85, 'Eficiência real da linha'),
  ('coef_excedente',   0.20, 'Folga de headcount (só no cenário de capacidade na planilha)'),
  ('minutos_por_hora', 60,   'Divisor de minutos para horas');

-- ---------------------------------------------------------------- cenários

CREATE TABLE cenario (
  id          serial PRIMARY KEY,
  nome        text NOT NULL,
  tipo        tipo_cenario NOT NULL,
  mes         integer CHECK (mes BETWEEN 1 AND 12),
  ano         integer,
  oficial     boolean NOT NULL DEFAULT false,
  -- Quais desvios da planilha estão corrigidos neste cenário. Default {} = tudo fiel.
  correcoes   jsonb NOT NULL DEFAULT '{}'::jsonb,
  observacao  text NOT NULL DEFAULT '',
  criado_por  text NOT NULL DEFAULT '',
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX cenario_oficial_idx ON cenario (tipo) WHERE oficial;

CREATE TABLE cenario_parametro (
  cenario_id  integer NOT NULL REFERENCES cenario(id) ON DELETE CASCADE,
  chave       text NOT NULL,
  valor       numeric(12, 4) NOT NULL,
  PRIMARY KEY (cenario_id, chave)
);

-- Coluna "Meta" (minutos-operador por peça) das abas de planejamento.
CREATE TABLE cenario_meta (
  cenario_id      integer NOT NULL REFERENCES cenario(id) ON DELETE CASCADE,
  dispositivo_id  integer NOT NULL REFERENCES dispositivo(id) ON DELETE CASCADE,
  meta_min_peca   numeric(12, 4) NOT NULL DEFAULT 0,
  PRIMARY KEY (cenario_id, dispositivo_id)
);

-- Colunas de período (semanas "Week 45"… e meses "Abril"…) com os dias úteis.
CREATE TABLE cenario_periodo (
  cenario_id  integer NOT NULL REFERENCES cenario(id) ON DELETE CASCADE,
  periodo     text NOT NULL,
  ordem       integer NOT NULL DEFAULT 0,
  dias_uteis  numeric(6, 2) NOT NULL DEFAULT 0,
  PRIMARY KEY (cenario_id, periodo)
);

CREATE TABLE cenario_demanda (
  cenario_id      integer NOT NULL REFERENCES cenario(id) ON DELETE CASCADE,
  dispositivo_id  integer NOT NULL REFERENCES dispositivo(id) ON DELETE CASCADE,
  periodo         text NOT NULL,
  quantidade      numeric(14, 3) NOT NULL DEFAULT 0,
  PRIMARY KEY (cenario_id, dispositivo_id, periodo)
);

-- O NÚCLEO DA FIDELIDADE: cada termo da soma "Operadores Linha" da planilha é um par
-- (Meta da linha X) x (Qtd da linha Y). Na planilha vários pares estão desalinhados
-- (X != Y), alguns apontam para a coluna de OUTRO período, e vários dispositivos não
-- têm termo nenhum. Importamos exatamente como está.
CREATE TABLE cenario_formula_par (
  id                   serial PRIMARY KEY,
  cenario_id           integer NOT NULL REFERENCES cenario(id) ON DELETE CASCADE,
  periodo              text NOT NULL,
  meta_dispositivo_id  integer NOT NULL REFERENCES dispositivo(id) ON DELETE CASCADE,
  qtd_dispositivo_id   integer NOT NULL REFERENCES dispositivo(id) ON DELETE CASCADE,
  -- NULL = usa a quantidade do próprio `periodo`. Preenchido quando o termo da planilha
  -- aponta para a coluna de outro período (desvio par-outro-periodo).
  qtd_periodo          text,
  ordem                integer NOT NULL DEFAULT 0
);

CREATE INDEX cenario_formula_par_idx ON cenario_formula_par (cenario_id, periodo, ordem);

-- Composição da métrica do cenário de capacidade (aba Dimensionamento Global):
--   parcial = Σ(componentes aditivos) + retrabalho × (1 − FTR)
--   real    = parcial / coef_eficiencia
CREATE TABLE metrica_componente (
  id              serial PRIMARY KEY,
  cenario_id      integer NOT NULL REFERENCES cenario(id) ON DELETE CASCADE,
  dispositivo_id  integer NOT NULL REFERENCES dispositivo(id) ON DELETE CASCADE,
  ordem           integer NOT NULL DEFAULT 0,
  rotulo          text NOT NULL,
  papel           papel_componente NOT NULL,
  valor           numeric(12, 4) NOT NULL DEFAULT 0
);

CREATE INDEX metrica_componente_idx ON metrica_componente (cenario_id, dispositivo_id, ordem);

-- ---------------------------------------------------------------- calendário

-- Aba "Projeção das linhas": a grade de 5 semanas x 6 dias.
CREATE TABLE projecao (
  id              serial PRIMARY KEY,
  cenario_id      integer NOT NULL REFERENCES cenario(id) ON DELETE CASCADE,
  mes             integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  ano             integer NOT NULL,
  qtd_operadores  integer NOT NULL DEFAULT 8,
  UNIQUE (cenario_id)
);

CREATE TABLE projecao_slot (
  id            serial PRIMARY KEY,
  projecao_id   integer NOT NULL REFERENCES projecao(id) ON DELETE CASCADE,
  data          date NOT NULL,
  bloco         bloco_projecao NOT NULL,
  ordem         integer NOT NULL DEFAULT 0,
  sku_codigo    text NOT NULL,
  quantidade    numeric(14, 3) NOT NULL DEFAULT 0
);

CREATE INDEX projecao_slot_idx ON projecao_slot (projecao_id, data, bloco, ordem);

-- ---------------------------------------------------------------- saídas

-- Aba "Demandas Defasagem", editável no app.
CREATE TABLE demanda_processo (
  id             serial PRIMARY KEY,
  cenario_id     integer NOT NULL REFERENCES cenario(id) ON DELETE CASCADE,
  tipo_linha     tipo_linha NOT NULL,
  dia_processo   date NOT NULL,
  dia_producao   date NOT NULL,
  sku_codigo     text NOT NULL,
  processo_id    integer REFERENCES processo(id) ON DELETE SET NULL,
  processo_nome  text NOT NULL,
  quantidade     numeric(14, 3) NOT NULL DEFAULT 0,
  operadores     numeric(10, 3),
  pcs_hora       numeric(12, 4),
  tempo_horas    numeric(12, 4),
  lote           text NOT NULL DEFAULT '',
  feito          boolean NOT NULL DEFAULT false,
  feito_por      text,
  feito_em       timestamptz,
  origem         origem_demanda NOT NULL DEFAULT 'gerado',
  atualizado_por text,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX demanda_processo_cenario_idx ON demanda_processo (cenario_id, dia_processo);

-- Aba "Dimensionamento de Operadores": insumo do heat map.
CREATE TABLE alocacao_operador (
  cenario_id  integer NOT NULL REFERENCES cenario(id) ON DELETE CASCADE,
  data        date NOT NULL,
  operador    integer NOT NULL,
  horas       numeric(10, 4) NOT NULL DEFAULT 0,
  PRIMARY KEY (cenario_id, data, operador)
);

-- ---------------------------------------------------------------- importação

CREATE TABLE importacao (
  id         serial PRIMARY KEY,
  quando     timestamptz NOT NULL DEFAULT now(),
  quem       text NOT NULL DEFAULT '',
  planilha   text NOT NULL DEFAULT '',
  contagens  jsonb NOT NULL DEFAULT '{}'::jsonb,
  avisos     jsonb NOT NULL DEFAULT '[]'::jsonb
);
