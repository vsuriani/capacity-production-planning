'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query } = require('../_lib/db');

/**
 * Base de PROD (catálogo) + mapa SKU → produto.
 *
 * GET    /api/sku                     -> catálogo, mapeamentos, pendências
 * GET    /api/sku?busca=texto         -> filtra o catálogo
 * POST   /api/sku?acao=mapear         -> { skuCodigo, produtoId, escopo }
 * DELETE /api/sku?acao=mapear&skuCodigo=&produtoId=&escopo=
 * PATCH  /api/sku?codigo=X            -> descricao, grupoItem, ncm, ativo
 */
async function handler(req, res) {
  if (!exigirAuth(req, res)) return;

  if (req.method === 'GET') return listar(req, res);
  if (req.method === 'POST' && req.query.acao === 'mapear') return mapear(req, res);
  if (req.method === 'DELETE' && req.query.acao === 'mapear') return desmapear(req, res);
  if (req.method === 'PATCH') return atualizar(req, res);

  res.status(405).json({ erro: 'Método não permitido' });
}

async function listar(req, res) {
  const busca = req.query.busca ? `%${String(req.query.busca).toLowerCase()}%` : null;

  const [itens, mapeamentos, semRoteiro, ambiguos, total] = await Promise.all([
    query(
      `SELECT codigo, descricao, grupo_item, ncm, ativo
         FROM sku
        WHERE $1::text IS NULL
           OR lower(codigo) LIKE $1 OR lower(descricao) LIKE $1
        ORDER BY codigo
        LIMIT 500`,
      [busca],
    ),
    query(
      `SELECT sp.sku_codigo, sp.produto_id, pr.nome AS produto, sp.escopo, sp.so_no_codigo_morto,
              (SELECT count(*) FROM processo p WHERE p.produto_id = sp.produto_id)::int AS processos
         FROM sku_produto sp
         JOIN produto pr ON pr.id = sp.produto_id
        ORDER BY sp.sku_codigo, sp.escopo`,
    ),
    // SKU usados na grade de algum cenário que não geram demanda nenhuma.
    query(
      `SELECT s.sku_codigo,
              s.bloco,
              sum(s.quantidade) AS quantidade,
              CASE WHEN sp.sku_codigo IS NULL THEN 'sem mapeamento SKU → produto'
                   ELSE 'produto mapeado sem processos do tipo esperado' END AS motivo
         FROM projecao_slot s
         LEFT JOIN sku_produto sp
           ON sp.sku_codigo = s.sku_codigo
          AND sp.escopo = (CASE WHEN s.bloco = 'industrializacao'
                                THEN 'industrializacao' ELSE 'producao' END)::escopo_sku
         LEFT JOIN processo p
           ON p.produto_id = sp.produto_id
          AND p.tipo_linha = ANY (
                CASE WHEN s.bloco = 'industrializacao'
                     THEN ARRAY['industrializacao']::tipo_linha[]
                     ELSE ARRAY['defasagem','producao_montagem']::tipo_linha[] END)
        WHERE p.id IS NULL
        GROUP BY s.sku_codigo, s.bloco, sp.sku_codigo
        ORDER BY s.sku_codigo`,
    ),
    query(
      `SELECT sku_codigo, escopo, array_agg(pr.nome ORDER BY pr.nome) AS produtos
         FROM sku_produto sp
         JOIN produto pr ON pr.id = sp.produto_id
        GROUP BY sku_codigo, escopo
       HAVING count(*) > 1
        ORDER BY sku_codigo`,
    ),
    query('SELECT count(*)::int AS n FROM sku'),
  ]);

  res.json({
    itens: itens.rows,
    total: total.rows[0].n,
    mapeamentos: mapeamentos.rows,
    pendencias: semRoteiro.rows,
    ambiguos: ambiguos.rows,
  });
}

async function mapear(req, res) {
  const { skuCodigo, produtoId, escopo } = req.body || {};
  if (!skuCodigo || !produtoId || !escopo) {
    return res.status(400).json({ erro: 'skuCodigo, produtoId e escopo são obrigatórios' });
  }
  await query(
    `INSERT INTO sku_produto (sku_codigo, produto_id, escopo)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [skuCodigo, produtoId, escopo],
  );
  res.json({ ok: true });
}

async function desmapear(req, res) {
  const { skuCodigo, produtoId, escopo } = req.query;
  if (!skuCodigo || !produtoId || !escopo) {
    return res.status(400).json({ erro: 'skuCodigo, produtoId e escopo são obrigatórios' });
  }
  await query(
    'DELETE FROM sku_produto WHERE sku_codigo = $1 AND produto_id = $2 AND escopo = $3',
    [skuCodigo, Number(produtoId), escopo],
  );
  res.json({ ok: true });
}

async function atualizar(req, res) {
  const codigo = req.query.codigo;
  if (!codigo) return res.status(400).json({ erro: 'codigo obrigatório' });
  const b = req.body || {};

  await query(
    `UPDATE sku
        SET descricao = COALESCE($2, descricao),
            grupo_item = COALESCE($3, grupo_item),
            ncm = COALESCE($4, ncm),
            ativo = COALESCE($5, ativo),
            atualizado = now()
      WHERE codigo = $1`,
    [codigo, b.descricao ?? null, b.grupoItem ?? null, b.ncm ?? null, b.ativo ?? null],
  );
  res.json({ ok: true });
}

module.exports = { handler };
