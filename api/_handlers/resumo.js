'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query } = require('../_lib/db');
const { carregarCenario, calcularCenario } = require('../_lib/cenario');

/**
 * Resumo para a tela inicial: uma chamada só, com o essencial de cada área.
 *
 * GET /api/resumo
 */
async function handler(req, res) {
  const email = exigirAuth(req, res);
  if (!email) return;

  const [cenarios, cadastro, demanda, proximos, pendencias, importacao] = await Promise.all([
    query(
      `SELECT id, nome, tipo, oficial, correcoes FROM cenario
        ORDER BY tipo, oficial DESC, criado_em DESC`,
    ),
    query(
      `SELECT (SELECT count(*) FROM sku)::int              AS sku,
              (SELECT count(*) FROM produto)::int          AS produto,
              (SELECT count(*) FROM processo)::int         AS processo,
              (SELECT count(*) FROM sku_produto)::int      AS mapeamentos,
              (SELECT count(*) FROM feriado)::int          AS feriados`,
    ),
    query(
      `SELECT count(*)::int                                          AS total,
              count(*) FILTER (WHERE feito)::int                     AS feitas,
              count(*) FILTER (WHERE tempo_horas IS NULL)::int       AS sem_tempo,
              COALESCE(sum(tempo_horas), 0)::float                   AS horas,
              min(dia_processo)::text                                AS de,
              max(dia_processo)::text                                AS ate
         FROM demanda_processo`,
    ),
    // Carga por dia nos próximos dias com demanda pendente.
    query(
      `SELECT dia_processo::text AS data,
              count(*)::int AS processos,
              COALESCE(sum(tempo_horas), 0)::float AS horas
         FROM demanda_processo
        WHERE NOT feito
        GROUP BY dia_processo
        ORDER BY dia_processo
        LIMIT 8`,
    ),
    // SKU na grade que não geram nenhuma linha de demanda.
    query(
      `SELECT DISTINCT s.sku_codigo
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
        ORDER BY s.sku_codigo`,
    ),
    query('SELECT quando, quem FROM importacao ORDER BY quando DESC LIMIT 1'),
  ]);

  // Headcount de pico e nº de divergências do cenário oficial (ou o 1º) de cada tipo.
  const porTipo = [];
  const vistos = new Set();
  for (const c of cenarios.rows) {
    if (vistos.has(c.tipo)) continue;
    vistos.add(c.tipo);

    const dados = await carregarCenario(c.id);
    if (!dados) continue;
    const { resultados, diagnosticos } = calcularCenario(dados);
    const validos = resultados.filter((r) => r.operadores !== null);

    porTipo.push({
      id: c.id,
      nome: c.nome,
      tipo: c.tipo,
      oficial: c.oficial,
      periodos: resultados.length,
      pico: validos.length ? Math.max(...validos.map((r) => r.operadores)) : null,
      picoPeriodo: validos.length
        ? validos.reduce((a, b) => (b.operadores > a.operadores ? b : a)).periodo
        : null,
      horas: resultados.reduce((s, r) => s + r.horasTotais, 0),
      diagnosticos: diagnosticos.length,
      correcoesLigadas: Object.values(c.correcoes || {}).filter(Boolean).length,
      semDiasUteis: resultados.filter((r) => r.erro).length,
    });
  }

  res.json({
    email,
    cenarios: porTipo,
    totalCenarios: cenarios.rows.length,
    cadastro: cadastro.rows[0],
    demanda: demanda.rows[0],
    proximosDias: proximos.rows,
    skuSemRoteiro: pendencias.rows.map((r) => r.sku_codigo),
    ultimaImportacao: importacao.rows[0] ?? null,
  });
}

module.exports = { handler };
