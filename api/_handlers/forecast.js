'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query, transacao } = require('../_lib/db');
const { nomeCanonico } = require('../_lib/dispositivos');

/**
 * O forecast externo e o mapa Model -> dispositivo.
 *
 * GET  /api/forecast   -> linhas cruas, o mapa e os models sem dispositivo
 * POST /api/forecast   -> { linhas: [{country, produto, model, ano, mes, quantidade}],
 *                           mapa:   [{model, dispositivo}] }
 *
 * O POST **substitui** o conjunto inteiro, em transação: o forecast chega de fora revisado por
 * completo, e mesclar deixaria para trás os models que saíram da revisão. Os ajustes do PCP não
 * se perdem nisso — eles moram em `cenario_demanda`, que não é tocada aqui.
 *
 * `mapa` é opcional: recarregar só as quantidades mantém o mapa como está.
 */
async function handler(req, res) {
  if (!exigirAuth(req, res)) return;

  if (req.method === 'GET') return listar(res);
  if (req.method === 'POST') return substituir(req, res);

  res.status(405).json({ erro: 'Método não permitido' });
}

async function listar(res) {
  const [linhas, mapa, semDispositivo] = await Promise.all([
    query(
      `SELECT country, produto, model, ano, mes, quantidade
         FROM forecast ORDER BY produto, model, country, ano, mes`,
    ),
    query(
      `SELECT m.model, m.dispositivo_id, d.nome AS dispositivo
         FROM dispositivo_model m
         JOIN dispositivo d ON d.id = m.dispositivo_id
        ORDER BY d.nome, m.model`,
    ),
    query(
      `SELECT DISTINCT f.model FROM forecast f
        WHERE NOT EXISTS (SELECT 1 FROM dispositivo_model m WHERE m.model = f.model)
        ORDER BY f.model`,
    ),
  ]);

  res.json({
    linhas: linhas.rows,
    mapa: mapa.rows,
    modelsSemDispositivo: semDispositivo.rows.map((r) => r.model),
  });
}

async function substituir(req, res) {
  const { linhas, mapa } = req.body || {};
  if (!Array.isArray(linhas)) return res.status(400).json({ erro: 'linhas obrigatórias' });

  // Resolve os dispositivos pelo nome antes de abrir a transação, para um nome errado falhar
  // alto em vez de gravar um mapa pela metade. O nome passa por `nomeCanonico`: a planilha de
  // origem ainda traz "OEE Trac", que hoje é "Uni Trac 2.0".
  let mapaResolvido = null;
  if (Array.isArray(mapa)) {
    const { rows } = await query('SELECT id, nome FROM dispositivo');
    const idDe = new Map(rows.map((r) => [r.nome, r.id]));
    const nomes = mapa.map((m) => nomeCanonico(m.dispositivo));
    const faltando = [...new Set(nomes.filter((n) => !idDe.has(n)))];
    if (faltando.length) {
      return res.status(400).json({ erro: `dispositivo não cadastrado: ${faltando.join(', ')}` });
    }
    mapaResolvido = mapa.map((m, i) => ({ model: m.model, dispositivoId: idDe.get(nomes[i]) }));
  }

  await transacao(async (c) => {
    await c.query('DELETE FROM forecast');
    for (const l of linhas) {
      await c.query(
        `INSERT INTO forecast (country, produto, model, ano, mes, quantidade)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (country, produto, model, ano, mes)
           DO UPDATE SET quantidade = EXCLUDED.quantidade`,
        [l.country, l.produto, l.model, l.ano, l.mes, l.quantidade ?? 0],
      );
    }

    if (mapaResolvido) {
      await c.query('DELETE FROM dispositivo_model');
      for (const m of mapaResolvido) {
        await c.query(
          `INSERT INTO dispositivo_model (model, dispositivo_id) VALUES ($1, $2)
           ON CONFLICT (model) DO UPDATE SET dispositivo_id = EXCLUDED.dispositivo_id`,
          [m.model, m.dispositivoId],
        );
      }
    }
  });

  res.json({ linhas: linhas.length, mapa: mapaResolvido?.length ?? null });
}

module.exports = { handler };
