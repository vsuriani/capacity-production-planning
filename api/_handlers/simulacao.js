'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query, transacao } = require('../_lib/db');
const { gradeDoMes, ehDiaUtil } = require('../_lib/motor/calendario');
const { dimensionarDia } = require('../_lib/motor/simulacao');
const { parametrosDoCenario } = require('../_lib/cenario');
const { responderCsv } = require('../_lib/csv');

/**
 * Simulação Ideal: onde a lista de demanda vira calendário operacional.
 *
 * A geração calcula `dia_processo` pelas regras caso-a-caso da planilha e ninguém confere se
 * o dia resultante cabe na linha. Aqui o supervisor posiciona cada demanda no dia em que ela
 * vai acontecer de verdade (`dia_ideal`), vendo o dimensionamento do dia enquanto move, e só
 * então aplica.
 *
 * `dia_ideal IS NULL` = ainda no pool, por posicionar.
 *
 * GET   /api/simulacao?cenario=N              -> grade, pool e dimensionamento por dia
 * GET   /api/simulacao?cenario=N&formato=csv  -> o calendário plotado, dia a dia
 * PATCH /api/simulacao?cenario=N              -> { movimentos: [{ id, dia }] }, dia null volta ao pool
 * POST  /api/simulacao?cenario=N&acao=preencher -> dia_ideal := dia_processo
 * POST  /api/simulacao?cenario=N&acao=esvaziar  -> dia_ideal := NULL
 * POST  /api/simulacao?cenario=N&acao=aplicar   -> dia_processo := dia_ideal
 */
async function handler(req, res) {
  if (!exigirAuth(req, res)) return;

  const cenarioId = Number(req.query.cenario);
  if (!cenarioId) return res.status(400).json({ erro: 'cenario obrigatório' });

  if (req.method === 'GET') {
    return req.query.formato === 'csv' ? exportarCsv(cenarioId, res) : obter(cenarioId, res);
  }
  if (req.method === 'PATCH') return mover(cenarioId, req, res);
  if (req.method === 'POST') {
    if (req.query.acao === 'preencher') return preencher(cenarioId, res);
    if (req.query.acao === 'esvaziar') return esvaziar(cenarioId, res);
    if (req.query.acao === 'aplicar') return aplicar(cenarioId, res);
  }

  res.status(405).json({ erro: 'Método não permitido' });
}

const CAMPOS_DA_LINHA = `id, tipo_linha, dia_processo::text, dia_ideal::text, sku_codigo,
                         processo_nome, quantidade, operadores, tempo_horas, lote, feito`;

async function obter(cenarioId, res) {
  const payload = await montar(cenarioId);
  if (payload.erro) return res.status(payload.status).json({ erro: payload.erro });
  res.json(payload);
}

/** Monta o estado inteiro da simulação. Serve o GET e a exportação, para não divergirem. */
async function montar(cenarioId) {
  const [cenario] = (
    await query('SELECT id, nome, tipo, mes, ano FROM cenario WHERE id = $1', [cenarioId])
  ).rows;
  if (!cenario) return { erro: 'Cenário não encontrado', status: 404 };

  const [linhas, projecao, feriados, parametros] = await Promise.all([
    query(
      `SELECT ${CAMPOS_DA_LINHA} FROM demanda_processo
        WHERE cenario_id = $1
        ORDER BY dia_processo, tipo_linha, sku_codigo, processo_nome`,
      [cenarioId],
    ),
    query('SELECT mes, ano, qtd_operadores FROM projecao WHERE cenario_id = $1', [cenarioId]),
    query('SELECT data::text, descricao FROM feriado'),
    parametrosDoCenario(cenarioId),
  ]);

  // O mês da grade vem da projeção; sem calendário montado, cai no mês do próprio cenário.
  const mes = projecao.rows[0]?.mes ?? cenario.mes;
  const ano = projecao.rows[0]?.ano ?? cenario.ano;
  const capacidade = projecao.rows[0]?.qtd_operadores ?? 8;
  const jornadaLiquida = parametros.jornadaHoras - parametros.pausaHoras;

  if (!mes || !ano) {
    return { erro: 'Cenário sem mês — só cenários mensais têm simulação', status: 400 };
  }

  const nomeDoFeriado = new Map(feriados.rows.map((f) => [f.data, f.descricao]));
  const semFeriado = new Set(nomeDoFeriado.keys());

  const porDia = new Map();
  const pool = [];
  for (const l of linhas.rows) {
    if (!l.dia_ideal) {
      pool.push(l);
      continue;
    }
    if (!porDia.has(l.dia_ideal)) porDia.set(l.dia_ideal, []);
    porDia.get(l.dia_ideal).push(l);
  }

  const semanas = gradeDoMes(mes, ano);
  const dias = semanas
    .flatMap((s) => s.dias)
    .map((data) => {
      const doDia = porDia.get(data) ?? [];
      return {
        data,
        util: ehDiaUtil(data, semFeriado),
        feriado: nomeDoFeriado.get(data) ?? null,
        linhas: doDia,
        dimensionamento: dimensionarDia({
          linhas: doDia.map((l) => ({
            tempoHoras: l.tempo_horas === null ? null : Number(l.tempo_horas),
            operadores: Number(l.operadores || 0),
          })),
          jornadaLiquida,
          capacidade,
        }),
      };
    });

  // Linhas alocadas em dia fora da grade (o mês virou, ou a demanda é de outro mês). Não
  // somem: viram um aviso, senão o total da tela não fecha com o da Lista de demanda.
  const naGrade = new Set(dias.map((d) => d.data));
  const foraDaGrade = [...porDia.entries()]
    .filter(([data]) => !naGrade.has(data))
    .flatMap(([, ls]) => ls);

  return {
    cenario,
    mes,
    ano,
    capacidade,
    jornadaLiquida,
    semanas,
    dias,
    pool,
    foraDaGrade,
    total: linhas.rows.length,
  };
}

/** Ordem das colunas do CSV, no mesmo espírito da exportação da Lista de demanda. */
const COLUNAS_CSV = [
  ['dia', 'Dia'],
  ['diaSemana', 'Dia da semana'],
  ['tipoLinha', 'Tipo da Linha'],
  ['sku', 'Produto'],
  ['processo', 'Processo'],
  ['quantidade', 'Qtd Necessária para Lote'],
  ['operadores', 'Operadores'],
  ['tempo', 'Tempo Estimado (Horas)'],
  ['homemHora', 'Homem-hora'],
  ['lote', 'Lote de Produção'],
  ['feito', 'Check de atividade feita'],
  ['diaGerado', 'Dia calculado pela geração'],
  ['movida', 'Movida na simulação'],
  ['opDoDia', 'Operadores exigidos no dia'],
  ['homemHoraDoDia', 'Homem-hora do dia'],
  ['estadoDoDia', 'Situação do dia'],
];

const DIAS_DA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const ROTULO_ESTADO = {
  vazio: 'vazio',
  ok: 'cabe',
  apertado: 'apertado',
  estourado: 'falta gente',
  impossivel: 'não cabe no dia',
};

/**
 * O calendário plotado, uma linha por demanda posicionada, em ordem de dia.
 *
 * Só o que foi plotado entra — é o que a exportação promete. O que ficou no pool não tem dia
 * nenhum para exportar, e continua na Lista de demanda com o dia que a geração calculou.
 *
 * O dimensionamento do dia vem repetido em cada linha de propósito: é o que deixa somar,
 * filtrar e fazer tabela dinâmica no Sheets sem precisar de uma segunda aba.
 */
async function exportarCsv(cenarioId, res) {
  const payload = await montar(cenarioId);
  if (payload.erro) return res.status(payload.status).json({ erro: payload.erro });

  const linhas = [];
  for (const dia of payload.dias) {
    const d = dia.dimensionamento;
    const exigido = d.operadoresEmpacotado ?? d.operadoresMinimo;
    for (const l of dia.linhas) {
      const tempo = l.tempo_horas === null ? null : Number(l.tempo_horas);
      const operadores = Number(l.operadores || 0);
      linhas.push({
        dia: dia.data,
        diaSemana: DIAS_DA_SEMANA[new Date(`${dia.data}T00:00:00Z`).getUTCDay()],
        tipoLinha: l.tipo_linha,
        sku: l.sku_codigo,
        processo: l.processo_nome,
        quantidade: Number(l.quantidade),
        operadores,
        tempo,
        homemHora: tempo === null ? null : Number((tempo * operadores).toFixed(4)),
        lote: l.lote,
        feito: l.feito,
        diaGerado: l.dia_processo,
        movida: l.dia_ideal !== l.dia_processo,
        opDoDia: exigido,
        homemHoraDoDia: Number(d.homemHora.toFixed(4)),
        estadoDoDia: ROTULO_ESTADO[d.estado] ?? d.estado,
      });
    }
  }

  const mes = String(payload.mes).padStart(2, '0');
  responderCsv(res, `simulacao-${mes}-${payload.ano}.csv`, COLUNAS_CSV, linhas);
}

async function mover(cenarioId, req, res) {
  const movimentos = req.body?.movimentos;
  if (!Array.isArray(movimentos)) return res.status(400).json({ erro: 'movimentos obrigatório' });
  if (movimentos.length === 0) return res.json({ movidas: 0 });

  const movidas = await transacao(async (c) => {
    let n = 0;
    for (const m of movimentos) {
      const id = Number(m.id);
      if (!id) continue;
      // O cenario_id no WHERE é o que garante "só demanda respectiva do mês": a tela nunca
      // consegue arrastar para cá uma linha de outro cenário.
      // RETURNING e não rowCount: no PGlite do dev o rowCount de UPDATE vem indefinido.
      const { rows } = await c.query(
        `UPDATE demanda_processo SET dia_ideal = $3
          WHERE id = $1 AND cenario_id = $2 RETURNING id`,
        [id, cenarioId, m.dia || null],
      );
      n += rows.length;
    }
    return n;
  });

  res.json({ movidas, pedidos: movimentos.length });
}

async function preencher(cenarioId, res) {
  const { rows } = await query(
    `UPDATE demanda_processo SET dia_ideal = dia_processo
      WHERE cenario_id = $1 RETURNING id`,
    [cenarioId],
  );
  res.json({ preenchidas: rows.length });
}

async function esvaziar(cenarioId, res) {
  const { rows } = await query(
    `UPDATE demanda_processo SET dia_ideal = NULL
      WHERE cenario_id = $1 AND dia_ideal IS NOT NULL RETURNING id`,
    [cenarioId],
  );
  res.json({ esvaziadas: rows.length });
}

/**
 * Comita a simulação: o dia ideal vira o dia do processo.
 *
 * Só mexe no que foi posicionado. O que ficou no pool continua no dia que a geração
 * calculou — a tela avisa quantas são, porque "aplicar" com o pool cheio não é o mesmo que
 * ter planejado o mês inteiro.
 */
async function aplicar(cenarioId, res) {
  const { rows } = await query(
    `UPDATE demanda_processo
        SET dia_processo = dia_ideal
      WHERE cenario_id = $1 AND dia_ideal IS NOT NULL AND dia_ideal <> dia_processo
      RETURNING id`,
    [cenarioId],
  );

  const [contagem] = (
    await query(
      `SELECT count(*) FILTER (WHERE dia_ideal IS NULL)::int AS no_pool,
              count(*)::int AS total
         FROM demanda_processo WHERE cenario_id = $1`,
      [cenarioId],
    )
  ).rows;

  res.json({ aplicadas: rows.length, noPool: contagem.no_pool, total: contagem.total });
}

module.exports = { handler };
