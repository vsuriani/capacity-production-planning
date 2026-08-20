'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query } = require('../_lib/db');
const { responderCsv } = require('../_lib/csv');

/**
 * Lista de demanda (aba Demandas Defasagem), editável.
 *
 * GET    /api/demandas?cenario=N[&tipo=&de=&ate=&sku=&feito=]
 * GET    /api/demandas?cenario=N&formato=csv
 * POST   /api/demandas                 -> cria linha manual
 * PATCH  /api/demandas?id=N            -> edita linha (inclui marcar feito)
 * DELETE /api/demandas?id=N
 */
const COLUNAS_CSV = [
  ['tipo_linha', 'Tipo da Linha'],
  ['dia_processo', 'Dia do Processo'],
  ['dia_producao', 'Dia da Produção'],
  ['sku_codigo', 'Produto'],
  ['processo_nome', 'Processo'],
  ['quantidade', 'Qtd Necessária para Lote'],
  ['operadores', 'Operadores'],
  ['pcs_hora', 'Pç / Hr'],
  ['tempo_horas', 'Tempo Estimado (Horas)'],
  ['lote', 'Lote de Produção'],
  ['feito', 'Check de atividade feita'],
];

async function handler(req, res) {
  const email = exigirAuth(req, res);
  if (!email) return;

  if (req.method === 'GET') return listar(req, res);
  if (req.method === 'POST') return criar(req, res, email);
  if (req.method === 'PATCH') return atualizar(req, res, email);
  if (req.method === 'DELETE') {
    const id = Number(req.query.id);
    if (!id) return res.status(400).json({ erro: 'id obrigatório' });
    await query('DELETE FROM demanda_processo WHERE id = $1', [id]);
    return res.json({ ok: true });
  }
  res.status(405).json({ erro: 'Método não permitido' });
}

async function buscar(req) {
  const cenarioId = Number(req.query.cenario);
  const { rows } = await query(
    `SELECT id, tipo_linha, dia_processo::text, dia_producao::text, sku_codigo,
            processo_id, processo_nome, quantidade, operadores, pcs_hora, tempo_horas,
            lote, feito, feito_por, feito_em, origem
       FROM demanda_processo
      WHERE cenario_id = $1
        AND ($2::text IS NULL OR tipo_linha::text = $2)
        AND ($3::date IS NULL OR dia_processo >= $3)
        AND ($4::date IS NULL OR dia_processo <= $4)
        AND ($5::text IS NULL OR sku_codigo ILIKE '%' || $5 || '%')
        AND ($6::boolean IS NULL OR feito = $6)
      ORDER BY dia_processo, tipo_linha, sku_codigo, processo_nome`,
    [
      cenarioId,
      req.query.tipo || null,
      req.query.de || null,
      req.query.ate || null,
      req.query.sku || null,
      req.query.feito === undefined ? null : req.query.feito === 'true',
    ],
  );
  return rows;
}

async function listar(req, res) {
  if (!req.query.cenario) return res.status(400).json({ erro: 'cenario obrigatório' });
  const linhas = await buscar(req);

  if (req.query.formato === 'csv') {
    return responderCsv(res, 'demandas.csv', COLUNAS_CSV, linhas);
  }

  const [{ n: total }] = (
    await query('SELECT count(*)::int AS n FROM demanda_processo WHERE cenario_id = $1', [
      Number(req.query.cenario),
    ])
  ).rows;

  res.json({ demandas: linhas, total });
}

async function criar(req, res, email) {
  const b = req.body || {};
  if (!b.cenarioId || !b.diaProcesso || !b.diaProducao || !b.skuCodigo || !b.tipoLinha) {
    return res
      .status(400)
      .json({ erro: 'cenarioId, tipoLinha, diaProcesso, diaProducao e skuCodigo são obrigatórios' });
  }

  const { rows } = await query(
    `INSERT INTO demanda_processo
       (cenario_id, tipo_linha, dia_processo, dia_producao, sku_codigo, processo_id,
        processo_nome, quantidade, operadores, pcs_hora, tempo_horas, lote, origem,
        atualizado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'manual',$13)
     RETURNING id`,
    [
      b.cenarioId, b.tipoLinha, b.diaProcesso, b.diaProducao, b.skuCodigo,
      b.processoId ?? null, b.processoNome || '', b.quantidade ?? 0, b.operadores ?? null,
      b.pcsHora ?? null, b.tempoHoras ?? null, b.lote || '', email,
    ],
  );
  res.json({ id: rows[0].id });
}

/** Campo do corpo -> coluna. O que não está aqui não é editável pela rota. */
const CAMPOS_EDITAVEIS = {
  tipoLinha: 'tipo_linha',
  diaProcesso: 'dia_processo',
  diaProducao: 'dia_producao',
  skuCodigo: 'sku_codigo',
  processoId: 'processo_id',
  processoNome: 'processo_nome',
  quantidade: 'quantidade',
  operadores: 'operadores',
  pcsHora: 'pcs_hora',
  tempoHoras: 'tempo_horas',
  lote: 'lote',
  feito: 'feito',
};

/**
 * Escreve só os campos que vieram no corpo.
 *
 * O SET é montado dinamicamente de propósito: com `COALESCE(valor, coluna)` era impossível
 * gravar null, e null é um estado legítimo aqui — tempo "sem taxa", processo sem cadastro.
 */
async function atualizar(req, res, email) {
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ erro: 'id obrigatório' });
  const b = req.body || {};

  const sets = [];
  const valores = [id];
  for (const [campo, coluna] of Object.entries(CAMPOS_EDITAVEIS)) {
    if (b[campo] === undefined) continue;
    valores.push(b[campo]);
    sets.push(`${coluna} = $${valores.length}`);
  }
  if (!sets.length) return res.json({ ok: true });

  if (b.feito === true) {
    valores.push(email);
    sets.push(`feito_por = $${valores.length}`, 'feito_em = now()');
  } else if (b.feito === false) {
    sets.push('feito_por = NULL', 'feito_em = NULL');
  }

  valores.push(email);
  sets.push(`atualizado_por = $${valores.length}`, 'atualizado_em = now()');

  await query(`UPDATE demanda_processo SET ${sets.join(', ')} WHERE id = $1`, valores);
  res.json({ ok: true });
}

module.exports = { handler };
