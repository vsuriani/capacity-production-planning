'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query } = require('../_lib/db');
const { carregarCenario, calcularCenario } = require('../_lib/cenario');
const { gradeDoMes } = require('../_lib/motor/calendario');

/**
 * Índice (0-based) da semana do mês que contém `hoje`, na mesma grade que o Calendário
 * monta e que dá os rótulos dos períodos do cenário semanal.
 *
 * A grade é seg–sáb: no domingo `hoje` não está em semana nenhuma, então cai para a
 * semana que começa em seguida.
 */
function indiceDaSemanaVigente(hoje) {
  const [ano, mes] = hoje.split('-').map(Number);
  const semanas = gradeDoMes(mes, ano);
  const semana =
    semanas.find((s) => s.dias.includes(hoje)) ?? semanas.find((s) => s.dias[5] >= hoje);
  return semana ? semana.semana - 1 : null;
}

/**
 * Resumo para a tela inicial: uma chamada só, com o essencial de cada área.
 *
 * GET /api/resumo
 */
async function handler(req, res) {
  const email = exigirAuth(req, res);
  if (!email) return;

  const [hojeRows, cenarios, cadastro, demanda, proximos, pendencias, importacao] =
    await Promise.all([
    query('SELECT CURRENT_DATE::text AS hoje'),
    // O cenário do mês corrente vem primeiro: é o que está em uso, não o último criado.
    query(
      `SELECT id, nome, tipo, mes, ano, oficial, correcoes FROM cenario
        ORDER BY tipo,
                 COALESCE(mes = EXTRACT(MONTH FROM CURRENT_DATE)::int
                      AND  ano = EXTRACT(YEAR  FROM CURRENT_DATE)::int, false) DESC,
                 oficial DESC, criado_em DESC`,
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
    // Carga por dia nos próximos dias com demanda pendente. Sem o corte em CURRENT_DATE
    // o painel encalha nos dias vencidos — o pendente mais antigo, não o que vem pela frente.
    query(
      `SELECT dia_processo::text AS data,
              count(*)::int AS processos,
              COALESCE(sum(tempo_horas), 0)::float AS horas
         FROM demanda_processo
        WHERE NOT feito
          AND dia_processo >= CURRENT_DATE
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

  // Headcount do cenário em uso de cada tipo: o do mês corrente, senão o oficial, senão o
  // mais recente.
  const hoje = hojeRows.rows[0].hoje;
  const [anoHoje, mesHoje] = hoje.split('-').map(Number);
  const indiceSemana = indiceDaSemanaVigente(hoje);

  const porTipo = [];
  const vistos = new Set();
  for (const c of cenarios.rows) {
    if (vistos.has(c.tipo)) continue;
    vistos.add(c.tipo);

    const dados = await carregarCenario(c.id);
    if (!dados) continue;
    const { resultados, diagnosticos } = calcularCenario(dados);
    const validos = resultados.filter((r) => r.operadores !== null);

    // A semana vigente só existe se o cenário for mesmo do mês corrente e tiver o período
    // dessa semana — senão fica null e a tela cai no pico.
    const doMes = c.mes === mesHoje && c.ano === anoHoje;
    const semana =
      doMes && indiceSemana !== null
        ? resultados.find((r) => r.ordem === indiceSemana) ?? null
        : null;

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
      semanaVigente: semana && {
        periodo: semana.periodo,
        operadores: semana.operadores,
        horas: semana.horasTotais,
        erro: semana.erro,
      },
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
