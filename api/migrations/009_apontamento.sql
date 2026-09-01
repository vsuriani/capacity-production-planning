-- Planejado × Realizado: o que o chão de fábrica devolve sobre a demanda planejada.
--
-- Até aqui o ciclo terminava na Simulação ideal — o supervisor decidia o dia e aplicava, e nada
-- voltava. Estas colunas são o apontamento: a linha foi feita inteira, em parte (e quanto), ou
-- cancelada.
--
-- Coluna e não tabela: o apontamento é 1:1 com a linha de demanda e morre com ela.

CREATE TYPE status_realizado AS ENUM ('pendente', 'total', 'parcial', 'cancelado');

ALTER TABLE demanda_processo
  ADD COLUMN status_realizado      status_realizado NOT NULL DEFAULT 'pendente',
  -- Peças de fato produzidas. NULL enquanto pendente; 'total' copia a quantidade planejada e
  -- 'cancelado' grava 0, para somar sem CASE em toda consulta.
  ADD COLUMN quantidade_realizada  numeric(14, 3),
  ADD COLUMN apontado_por          text,
  ADD COLUMN apontado_em           timestamptz;

COMMENT ON COLUMN demanda_processo.status_realizado IS
  'Apontamento de produção. Anda junto com `feito`: feito <=> status = ''total''.';

-- A coluna `feito` já existia e diz a mesma coisa que 'total'. Alinha o que está no banco antes
-- de a regra passar a valer, senão uma linha marcada como feita nasceria "pendente" aqui.
UPDATE demanda_processo
   SET status_realizado = 'total', quantidade_realizada = quantidade
 WHERE feito;

-- ---------------------------------------------------------------- log
--
-- Registra só o que acontece na aba Planejado × Realizado (decisão do usuário).
--
-- `ON DELETE SET NULL` mais o SKU e o processo COPIADOS: o evento tem de sobreviver à exclusão
-- da linha, que é justamente quando um log importa.

CREATE TABLE apontamento_evento (
  id             serial PRIMARY KEY,
  cenario_id     integer NOT NULL REFERENCES cenario(id) ON DELETE CASCADE,
  demanda_id     integer REFERENCES demanda_processo(id) ON DELETE SET NULL,
  quando         timestamptz NOT NULL DEFAULT now(),
  quem           text NOT NULL DEFAULT '',
  acao           text NOT NULL,
  sku_codigo     text NOT NULL DEFAULT '',
  processo_nome  text NOT NULL DEFAULT '',
  detalhe        text NOT NULL DEFAULT ''
);

CREATE INDEX apontamento_evento_idx ON apontamento_evento (cenario_id, quando DESC);
