-- "Produto filho" deixa de ser um SKU só e vira uma lista.
--
-- O campo é usado num lugar só do motor (`explosao.js`): quando o calendário explode um SKU no
-- bloco de industrialização, entram apenas os processos cujo produto filho é aquele SKU. Nos
-- blocos de produção/montagem ele é ignorado. Com a coluna única, um processo que serve três
-- SKU precisava ser cadastrado três vezes, com o mesmo Pç/hr e os mesmos operadores.
--
-- A semântica não muda de natureza, só de cardinalidade: de "o filho É este SKU" para "o SKU
-- ESTÁ ENTRE os filhos". Nenhum número de linha gerada muda — muda quantos processos casam.
--
-- A coluna sai no fim: duas fontes para o mesmo fato é como elas divergem.

CREATE TABLE processo_sku_filho (
  processo_id  integer NOT NULL REFERENCES processo(id) ON DELETE CASCADE,
  sku_codigo   text    NOT NULL REFERENCES sku(codigo),
  PRIMARY KEY (processo_id, sku_codigo)
);

-- A busca do motor é por processo; a do `sku.js` (renomear/remover um código) é por SKU.
CREATE INDEX processo_sku_filho_sku_idx ON processo_sku_filho (sku_codigo);

COMMENT ON TABLE processo_sku_filho IS
  'SKU que o processo produz. Filtra a industrialização: o processo roda quando o SKU explodido '
  'está nesta lista. Vazio = nunca roda em industrialização.';

INSERT INTO processo_sku_filho (processo_id, sku_codigo)
SELECT id, sku_filho FROM processo WHERE sku_filho IS NOT NULL;

ALTER TABLE processo DROP COLUMN sku_filho;
