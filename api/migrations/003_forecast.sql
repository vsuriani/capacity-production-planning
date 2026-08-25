-- Forecast: quanto se pretende produzir de cada Model, mês a mês, no horizonte longo.
--
-- É dado EXTERNO — chega de fora numa tabela Country/Product/Model × meses e é recarregado
-- inteiro a cada revisão. Por isso mora em tabela própria, e não direto em cenario_demanda:
-- assim a recarga não atropela o ajuste que o PCP fez na tela (o ajuste continua em
-- cenario_demanda, sobrepondo o forecast célula a célula; sem linha lá, vale o forecast).
--
-- Uma linha por célula da planilha de origem. `produto` é a sigla do forecast (STUE, SRU,
-- UT+…) e é só informativa: ela NÃO identifica dispositivo — STUE cobre Smart Trac Ultra Ex e
-- Smart Trac Ultra Gen 2 EX, que têm tempos bem diferentes. Quem casa é o `model`.
CREATE TABLE forecast (
  country     text NOT NULL,
  produto     text NOT NULL,
  model       text NOT NULL,
  ano         integer NOT NULL,
  mes         integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  quantidade  numeric(14, 3) NOT NULL DEFAULT 0,
  PRIMARY KEY (country, produto, model, ano, mes)
);

CREATE INDEX forecast_periodo_idx ON forecast (ano, mes);
CREATE INDEX forecast_model_idx ON forecast (model);

-- Model -> a linha de dimensionamento que ele consome.
--
-- Sem FK para sku(codigo) de propósito: 5 dos 23 models do forecast (PROD-0151, PROD-0173,
-- PROD-0183, PROD-0176, PROD-0177) não estão na Base de PROD. A FK travaria a carga inteira
-- por causa deles; model sem dispositivo vira aviso na tela, não erro.
CREATE TABLE dispositivo_model (
  model           text PRIMARY KEY,
  dispositivo_id  integer NOT NULL REFERENCES dispositivo(id) ON DELETE CASCADE
);

CREATE INDEX dispositivo_model_disp_idx ON dispositivo_model (dispositivo_id);
