-- O catálogo de dispositivos vira cadastro de verdade: nome, ordem na tela e TEMPO-PADRÃO.
--
-- Até aqui a coluna Meta de um cenário novo era herdada do último cenário semanal com meta
-- preenchida (`baseDosTempos`). Isso fazia o padrão andar sozinho: bastava alguém editar um
-- cenário para o próximo nascer com o valor editado. Agora o padrão mora em
-- `dispositivo.meta_padrao`, o cenário nasce copiando dali, e a cópia dentro do cenário segue
-- editável — mudar a Meta de um mês não contamina os outros.

ALTER TABLE dispositivo ADD COLUMN meta_padrao numeric(12, 4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN dispositivo.meta_padrao IS
  'Minutos-operador por peça com que este dispositivo entra num cenário novo. A coluna Meta do '
  'cenário é uma cópia editável deste valor.';

-- "OEE Trac" passou a se chamar "Uni Trac 2.0". UPDATE e não INSERT novo: o id é referenciado
-- por cenario_meta, cenario_demanda, cenario_formula_par, dispositivo_metrica e
-- dispositivo_model (é por ele que PROD-0156 continua ligado ao dispositivo certo).
-- O cadastro de PRODUTOS não é tocado: lá o roteiro segue em "OEE Trac".
UPDATE dispositivo SET nome = 'Uni Trac 2.0' WHERE nome = 'OEE Trac';

-- O catálogo. A ordem é a da tela; a meta é o tempo-padrão acordado com o PCP.
-- Upsert para valer nos dois casos: banco em uso (já tem as linhas) e banco zerado, onde esta
-- migration roda antes da importação e é ela quem cria o cadastro.
INSERT INTO dispositivo (nome, ordem, meta_padrao, ativo) VALUES
  ('Retrabalho STU',              1,  5.00,  true),
  ('Retrabalho SRU',              2,  8.00,  true),
  ('Retrabalho Energy',           3,  6.00,  true),
  ('Smart Trac Ultra Gen 1',      4,  4.60,  true),
  ('Smart Trac Ultra Ex',         5,  4.40,  true),
  ('Smart Receiver Ultra',        6, 33.27,  true),
  ('Smart Receiver Ultra Gen 2',  7, 20.00,  true),
  ('Smart Trac Ultra Gen 2',      8,  5.25,  true),
  ('Smart Trac Ultra Gen 2 EX',   9,  5.25,  true),
  ('Energy Trac',                10, 22.70,  true),
  ('Energy Trac Pro',            11,  6.00,  true),
  ('Uni Trac',                   12,  4.10,  true),
  ('Uni Trac 2.0',               13,  4.10,  true),
  ('Omni Trac',                  14,  5.10,  true),
  ('Omni Receiver',              15,  5.10,  true),
  ('Bateria EX Gen 2',           16,  8.00,  true),
  ('Tampografia Case',           17,  0.48,  true),
  ('Tampografia Sensor',         18,  0.48,  true),
  ('Defasagem Smart Gen 2 EX',   19,  4.00,  true),
  ('Fechar Smart Gen 2 EX',      20,  2.25,  true),
  ('Energy Trac EE',             21,  6.00,  true),
  ('Garra Uni Trac',             22, 15.30,  true),
  ('Gravação UV SRU G2',         23,  0.05,  true)
ON CONFLICT (nome) DO UPDATE
   SET ordem       = EXCLUDED.ordem,
       meta_padrao = EXCLUDED.meta_padrao,
       ativo       = true;

-- Saem da lista junto com os da migration 005. "Garra OEE Trac" cai com o rename: a garra que
-- ficou é a "Garra Uni Trac".
UPDATE dispositivo SET ativo = false WHERE nome IN ('Bateria EX', 'Garra OEE Trac');

-- ---------------------------------------------------------------- cenários já existentes
--
-- Os cenários criados no app passam a mostrar o padrão sem precisar ser recriados. Duas travas:
--
--   NOT c.importado  — as 23 baselines da planilha ficam intactas. Injetar tempo-padrão onde a
--                      planilha tinha zero mudaria o headcount delas e quebraria a fidelidade.
--   meta_min_peca=0  — só preenche o que está vazio. Meta digitada à mão é preservada.

INSERT INTO cenario_meta (cenario_id, dispositivo_id, meta_min_peca)
SELECT c.id, d.id, d.meta_padrao
  FROM cenario c
  CROSS JOIN dispositivo d
 WHERE d.ativo AND NOT c.importado
ON CONFLICT (cenario_id, dispositivo_id) DO UPDATE
   SET meta_min_peca = EXCLUDED.meta_min_peca
 WHERE cenario_meta.meta_min_peca = 0;

-- E o termo alinhado do que entrou agora (o "Gravação UV SRU G2" e qualquer dispositivo que o
-- cenário ainda não conhecia), senão a linha apareceria na grade sem somar nada.
INSERT INTO cenario_formula_par
  (cenario_id, periodo, meta_dispositivo_id, qtd_dispositivo_id, ordem)
SELECT c.id, p.periodo, d.id, d.id, 999
  FROM cenario c
  JOIN cenario_periodo p ON p.cenario_id = c.id
  CROSS JOIN dispositivo d
 WHERE d.ativo AND NOT c.importado
   AND NOT EXISTS (
     SELECT 1 FROM cenario_formula_par f
      WHERE f.cenario_id = c.id
        AND f.periodo = p.periodo
        AND f.meta_dispositivo_id = d.id
   );
