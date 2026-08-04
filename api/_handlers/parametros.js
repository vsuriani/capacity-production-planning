'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query } = require('../_lib/db');

/**
 * Parâmetros globais e feriados.
 *
 * GET    /api/parametros
 * PATCH  /api/parametros            -> { parametros: [{chave, valor}] }
 * POST   /api/parametros?feriado=1  -> { data, descricao }
 * DELETE /api/parametros?feriado=YYYY-MM-DD
 */
async function handler(req, res) {
  if (!exigirAuth(req, res)) return;

  if (req.method === 'GET') {
    const [parametros, feriados] = await Promise.all([
      query('SELECT chave, valor, descricao FROM parametro ORDER BY chave'),
      query('SELECT data::text, descricao FROM feriado ORDER BY data'),
    ]);
    return res.json({ parametros: parametros.rows, feriados: feriados.rows });
  }

  if (req.method === 'PATCH') {
    for (const p of req.body?.parametros || []) {
      await query('UPDATE parametro SET valor = $2 WHERE chave = $1', [p.chave, p.valor]);
    }
    return res.json({ ok: true });
  }

  if (req.method === 'POST' && req.query.feriado) {
    const { data, descricao } = req.body || {};
    if (!data) return res.status(400).json({ erro: 'data obrigatória' });
    await query(
      `INSERT INTO feriado (data, descricao) VALUES ($1, $2)
       ON CONFLICT (data) DO UPDATE SET descricao = EXCLUDED.descricao`,
      [data, descricao || ''],
    );
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE' && req.query.feriado) {
    await query('DELETE FROM feriado WHERE data = $1', [req.query.feriado]);
    return res.json({ ok: true });
  }

  res.status(405).json({ erro: 'Método não permitido' });
}

module.exports = { handler };
