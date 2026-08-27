'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query } = require('../_lib/db');

/**
 * Processos e sequências (aba Base simplificada).
 *
 * GET    /api/roteiros                -> produtos + processos + pendências
 * POST   /api/roteiros                -> cria processo
 * POST   /api/roteiros?acao=produto   -> cria produto  { nome }
 * PATCH  /api/roteiros?id=N           -> altera processo
 * DELETE /api/roteiros?id=N
 */
const CAMPOS = {
  produtoId: 'produto_id',
  tipoLinha: 'tipo_linha',
  nome: 'nome',
  sequencia: 'sequencia',
  paralelismo: 'paralelismo',
  leadtimeDias: 'leadtime_dias',
  operadores: 'operadores',
  pcsHora: 'pcs_hora',
  skuFilho: 'sku_filho',
  origemTotalDia: 'origem_total_dia',
};

async function handler(req, res) {
  if (!exigirAuth(req, res)) return;
  const id = req.query.id ? Number(req.query.id) : null;

  if (req.method === 'GET') return listar(res);
  if (req.method === 'POST') {
    return req.query.acao === 'produto' ? criarProduto(req, res) : criar(req, res);
  }
  if (req.method === 'PATCH') return atualizar(id, req, res);
  if (req.method === 'DELETE') {
    if (!id) return res.status(400).json({ erro: 'id obrigatório' });
    await query('DELETE FROM processo WHERE id = $1', [id]);
    return res.json({ ok: true });
  }
  res.status(405).json({ erro: 'Método não permitido' });
}

async function listar(res) {
  const [produtos, processos, aliases, semRoteiro] = await Promise.all([
    query('SELECT id, nome, ativo FROM produto ORDER BY nome'),
    query(
      `SELECT p.id, p.produto_id, pr.nome AS produto, p.tipo_linha, p.nome, p.sequencia,
              p.paralelismo, p.leadtime_dias, p.operadores, p.pcs_hora, p.sku_filho,
              p.origem_total_dia,
              (p.pcs_hora IS NULL OR p.pcs_hora <= 0) AS sem_taxa
         FROM processo p
         JOIN produto pr ON pr.id = p.produto_id
        ORDER BY pr.nome, p.tipo_linha, p.sequencia NULLS LAST, p.id`,
    ),
    query('SELECT produto_id, alias FROM produto_alias ORDER BY alias'),
    // Produtos citados no mapa SKU→produto que não têm nenhum processo cadastrado.
    query(
      `SELECT DISTINCT pr.id, pr.nome
         FROM produto pr
         JOIN sku_produto sp ON sp.produto_id = pr.id
        WHERE NOT EXISTS (SELECT 1 FROM processo p WHERE p.produto_id = pr.id)
        ORDER BY pr.nome`,
    ),
  ]);

  res.json({
    produtos: produtos.rows,
    processos: processos.rows,
    aliases: aliases.rows,
    produtosSemRoteiro: semRoteiro.rows,
  });
}

/**
 * Cria um produto (a unidade de roteiro).
 *
 * Produto é cadastro global — não pertence a cenário nenhum, e é por isso que criar um aqui
 * basta para ele já aparecer no seletor de todo processo. Nasce sem roteiro: a tela mostra o
 * grupo vazio para que o primeiro passo seja lançado em seguida.
 *
 * O nome é chave natural (`produto.nome` é UNIQUE) e a planilha tinha "Smart Trac Ultra Gen 2" e
 * "Smart Trac Ultra Gen 2 " como produtos distintos — daí o `trim()` antes de gravar. Nome que
 * já existe volta 409 com o id de quem ocupou, para a tela poder apontar o produto certo em vez
 * de só reclamar.
 */
async function criarProduto(req, res) {
  const nome = String(req.body?.nome ?? '').trim();
  if (!nome) return res.status(400).json({ erro: 'nome é obrigatório' });

  const { rows: existente } = await query('SELECT id FROM produto WHERE nome = $1', [nome]);
  if (existente[0]) {
    return res.status(409).json({ erro: `Já existe o produto "${nome}"`, id: existente[0].id });
  }

  const { rows } = await query('INSERT INTO produto (nome) VALUES ($1) RETURNING id, nome', [nome]);
  res.json(rows[0]);
}

async function criar(req, res) {
  const b = req.body || {};
  if (!b.produtoId || !b.tipoLinha || !b.nome) {
    return res.status(400).json({ erro: 'produtoId, tipoLinha e nome são obrigatórios' });
  }
  const { rows } = await query(
    `INSERT INTO processo (produto_id, tipo_linha, nome, sequencia, paralelismo,
                           leadtime_dias, operadores, pcs_hora, sku_filho, origem_total_dia)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      b.produtoId, b.tipoLinha, b.nome, b.sequencia ?? null, b.paralelismo ?? null,
      b.leadtimeDias ?? 0, b.operadores ?? null, b.pcsHora ?? null, b.skuFilho || null,
      b.origemTotalDia || 'taxa',
    ],
  );
  res.json({ id: rows[0].id });
}

async function atualizar(id, req, res) {
  if (!id) return res.status(400).json({ erro: 'id obrigatório' });

  const sets = [];
  const valores = [id];
  for (const [chave, coluna] of Object.entries(CAMPOS)) {
    if (req.body?.[chave] !== undefined) {
      valores.push(req.body[chave]);
      sets.push(`${coluna} = $${valores.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ erro: 'nada para atualizar' });

  await query(`UPDATE processo SET ${sets.join(', ')} WHERE id = $1`, valores);
  res.json({ ok: true });
}

module.exports = { handler };
