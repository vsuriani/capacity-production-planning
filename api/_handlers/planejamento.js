'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query, transacao } = require('../_lib/db');

/**
 * Edição das grades de planejamento (meta, demanda, dias úteis, termos da fórmula).
 *
 * PATCH /api/planejamento  { cenarioId, metas?, demandas?, periodos?, componentes? }
 * POST  /api/planejamento?acao=alinhar-termos  { cenarioId, periodo? }
 * POST  /api/planejamento?acao=incluir-faltantes { cenarioId, periodo? }
 * POST  /api/planejamento?acao=dispositivo  { cenarioId, nome }
 * DELETE /api/planejamento?termo=N
 */
async function handler(req, res) {
  if (!exigirAuth(req, res)) return;

  if (req.method === 'PATCH') return salvar(req, res);
  if (req.method === 'POST') return acao(req, res);
  if (req.method === 'DELETE') {
    const termo = Number(req.query.termo);
    if (!termo) return res.status(400).json({ erro: 'termo obrigatório' });
    await query('DELETE FROM cenario_formula_par WHERE id = $1', [termo]);
    return res.json({ ok: true });
  }

  res.status(405).json({ erro: 'Método não permitido' });
}

async function salvar(req, res) {
  const { cenarioId, metas = [], demandas = [], periodos = [], componentes = [] } = req.body || {};
  if (!cenarioId) return res.status(400).json({ erro: 'cenarioId obrigatório' });

  await transacao(async (c) => {
    for (const m of metas) {
      await c.query(
        `INSERT INTO cenario_meta (cenario_id, dispositivo_id, meta_min_peca)
         VALUES ($1, $2, $3)
         ON CONFLICT (cenario_id, dispositivo_id) DO UPDATE SET meta_min_peca = EXCLUDED.meta_min_peca`,
        [cenarioId, m.dispositivoId, m.valor],
      );
    }
    for (const d of demandas) {
      await c.query(
        `INSERT INTO cenario_demanda (cenario_id, dispositivo_id, periodo, quantidade)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (cenario_id, dispositivo_id, periodo) DO UPDATE SET quantidade = EXCLUDED.quantidade`,
        [cenarioId, d.dispositivoId, d.periodo, d.quantidade],
      );
    }
    for (const p of periodos) {
      await c.query(
        `INSERT INTO cenario_periodo (cenario_id, periodo, ordem, dias_uteis, arredondado_manual)
         VALUES ($1, $2, COALESCE($3, 0), $4, $5)
         ON CONFLICT (cenario_id, periodo) DO UPDATE
           SET dias_uteis = EXCLUDED.dias_uteis,
               arredondado_manual = COALESCE($5, cenario_periodo.arredondado_manual)`,
        [cenarioId, p.periodo, p.ordem ?? null, p.diasUteis, p.arredondadoManual ?? null],
      );
    }
    for (const k of componentes) {
      await c.query('UPDATE metrica_componente SET valor = $2 WHERE id = $1', [k.id, k.valor]);
    }
  });

  res.json({ ok: true });
}

async function acao(req, res) {
  const { cenarioId, periodo = null } = req.body || {};
  if (!cenarioId) return res.status(400).json({ erro: 'cenarioId obrigatório' });

  if (req.query.acao === 'alinhar-termos') {
    // Faz cada termo usar a quantidade do próprio dispositivo e do próprio período.
    const { rows } = await query(
      `UPDATE cenario_formula_par
          SET qtd_dispositivo_id = meta_dispositivo_id, qtd_periodo = NULL
        WHERE cenario_id = $1
          AND ($2::text IS NULL OR periodo = $2)
          AND (qtd_dispositivo_id <> meta_dispositivo_id OR qtd_periodo IS NOT NULL)
        RETURNING id`,
      [cenarioId, periodo],
    );
    return res.json({ alinhados: rows.length });
  }

  if (req.query.acao === 'incluir-faltantes') {
    // Cria um termo alinhado para todo dispositivo com meta que ficou fora da soma.
    const { rows } = await query(
      `INSERT INTO cenario_formula_par
         (cenario_id, periodo, meta_dispositivo_id, qtd_dispositivo_id, ordem)
       SELECT $1, p.periodo, m.dispositivo_id, m.dispositivo_id, 999
         FROM cenario_meta m
         CROSS JOIN cenario_periodo p
        WHERE m.cenario_id = $1
          AND p.cenario_id = $1
          AND ($2::text IS NULL OR p.periodo = $2)
          AND NOT EXISTS (
            SELECT 1 FROM cenario_formula_par f
             WHERE f.cenario_id = $1
               AND f.periodo = p.periodo
               AND f.meta_dispositivo_id = m.dispositivo_id
          )
       RETURNING id`,
      [cenarioId, periodo],
    );
    return res.json({ incluidos: rows.length });
  }

  res.status(400).json({ erro: 'ação desconhecida' });
}

module.exports = { handler };
