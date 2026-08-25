-- O Dimensionamento Global é uma SIMULAÇÃO, não um cenário.
--
-- A primeira versão pendurou os tempos, os dias úteis e os ajustes num cenário de capacidade,
-- reusando a máquina de `cenario_*`. Estava errado para o uso: cenário é um recorte de um mês
-- de operação, com correções, oficial, duplicação e comparação; esta tela é uma única visão do
-- horizonte inteiro, que se mexe e se olha, e não precisa de nada disso. Sem cenário também
-- não há como abrir a tela vazia por falta de um.
--
-- Então as três coisas que ela guarda viram estado global.

-- O tempo-padrão de cada dispositivo, decomposto. Mesma semântica de metrica_componente
-- (papel = aditivo/retrabalho/ftr, rótulo livre), mas sem dono:
--   parcial = Σ(aditivos) + retrabalho × (1 − FTR)      real = parcial / coef_eficiencia
CREATE TABLE dispositivo_metrica (
  id              serial PRIMARY KEY,
  dispositivo_id  integer NOT NULL REFERENCES dispositivo(id) ON DELETE CASCADE,
  ordem           integer NOT NULL DEFAULT 0,
  rotulo          text NOT NULL,
  papel           papel_componente NOT NULL,
  valor           numeric(12, 4) NOT NULL DEFAULT 0
);

CREATE INDEX dispositivo_metrica_idx ON dispositivo_metrica (dispositivo_id, ordem);

-- Dias úteis de cada mês do horizonte. Digitados à mão (decisão do usuário): a tela não
-- preenche do calendário. Sem linha aqui, o mês é #DIV/0! e não entra na conta.
CREATE TABLE global_mes (
  ano         integer NOT NULL,
  mes         integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  dias_uteis  numeric(6, 2) NOT NULL DEFAULT 0,
  PRIMARY KEY (ano, mes)
);

-- O ajuste que sobrepõe o forecast, célula a célula. A AUSÊNCIA de linha é o que significa
-- "vale o forecast" — é por isso que recarregar o forecast não apaga o que foi digitado.
CREATE TABLE global_ajuste (
  dispositivo_id  integer NOT NULL REFERENCES dispositivo(id) ON DELETE CASCADE,
  ano             integer NOT NULL,
  mes             integer NOT NULL CHECK (mes BETWEEN 1 AND 12),
  quantidade      numeric(14, 3) NOT NULL,
  PRIMARY KEY (dispositivo_id, ano, mes)
);
