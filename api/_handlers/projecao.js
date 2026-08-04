'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query, transacao } = require('../_lib/db');
const { gradeDoMes } = require('../_lib/motor/calendario');
const { explodirDemanda } = require('../_lib/motor/explosao');
const { parametrosDoCenario } = require('../_lib/cenario');

/**
 * Calendário de produção (aba Projeção das linhas).
 *
 * GET   /api/projecao?cenario=N            -> grade + slots
 * PATCH /api/projecao?cenario=N            -> { mes, ano, qtdOperadores, slots }
 * POST  /api/projecao?cenario=N&acao=gerar -> explode a demanda em demanda_processo
 */
const BLOCOS = ['producao', 'industrializacao'];

async function handler(req, res) {
  const email = exigirAuth(req, res);
  if (!email) return;

  const cenarioId = Number(req.query.cenario);
  if (!cenarioId) return res.status(400).json({ erro: 'cenario obrigatório' });

  if (req.method === 'GET') return obter(cenarioId, res);
  if (req.method === 'PATCH') return salvar(cenarioId, req, res);
  if (req.method === 'POST' && req.query.acao === 'gerar') return gerar(cenarioId, req, res, email);

  res.status(405).json({ erro: 'Método não permitido' });
}

async function obter(cenarioId, res) {
  const [cenario] = (
    await query('SELECT id, nome, tipo, mes, ano FROM cenario WHERE id = $1', [cenarioId])
  ).rows;
  if (!cenario) return res.status(404).json({ erro: 'Cenário não encontrado' });

  const [projecao] = (
    await query('SELECT * FROM projecao WHERE cenario_id = $1', [cenarioId])
  ).rows;

  // Sem projeção não é erro: o cenário simplesmente ainda não tem calendário montado.
  // Devolvemos o mês/ano dele para a tela poder criar com um clique.
  if (!projecao) return res.json({ cenario, projecao: null, semanas: [], slots: [] });

  const { rows: slots } = await query(
    `SELECT s.id, s.data::text, s.bloco, s.ordem, s.sku_codigo, s.quantidade,
            sk.descricao
       FROM projecao_slot s
       LEFT JOIN sku sk ON sk.codigo = s.sku_codigo
      WHERE s.projecao_id = $1
      ORDER BY s.data, s.bloco, s.ordem`,
    [projecao.id],
  );

  res.json({
    cenario,
    projecao,
    semanas: gradeDoMes(projecao.mes, projecao.ano),
    slots,
  });
}

async function salvar(cenarioId, req, res) {
  const b = req.body || {};

  const projecaoId = await transacao(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO projecao (cenario_id, mes, ano, qtd_operadores)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cenario_id) DO UPDATE
         SET mes = EXCLUDED.mes, ano = EXCLUDED.ano, qtd_operadores = EXCLUDED.qtd_operadores
       RETURNING id`,
      [cenarioId, b.mes, b.ano, b.qtdOperadores ?? 8],
    );
    const id = rows[0].id;

    if (Array.isArray(b.slots)) {
      await c.query('DELETE FROM projecao_slot WHERE projecao_id = $1', [id]);
      for (const [i, s] of b.slots.entries()) {
        const sku = String(s.skuCodigo || '').trim();
        if (!sku) continue;
        if (!BLOCOS.includes(s.bloco)) continue;
        await c.query(
          `INSERT INTO projecao_slot (projecao_id, data, bloco, ordem, sku_codigo, quantidade)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, s.data, s.bloco, s.ordem ?? i, sku, s.quantidade ?? 0],
        );
      }
    }
    return id;
  });

  res.json({ projecaoId });
}

async function gerar(cenarioId, req, res, email) {
  const [cenario] = (await query('SELECT * FROM cenario WHERE id = $1', [cenarioId])).rows;
  if (!cenario) return res.status(404).json({ erro: 'Cenário não encontrado' });

  const [projecao] = (
    await query('SELECT * FROM projecao WHERE cenario_id = $1', [cenarioId])
  ).rows;
  if (!projecao) return res.status(400).json({ erro: 'Cenário sem calendário' });

  const [slots, processos, mapa, feriados] = await Promise.all([
    query(
      `SELECT data::text, bloco, sku_codigo, quantidade
         FROM projecao_slot WHERE projecao_id = $1 ORDER BY data, bloco, ordem`,
      [projecao.id],
    ),
    query(
      `SELECT p.id, p.produto_id, p.tipo_linha, p.nome, p.sequencia, p.leadtime_dias,
              p.operadores, p.pcs_hora, p.sku_filho
         FROM processo p ORDER BY p.produto_id, p.sequencia NULLS LAST, p.id`,
    ),
    query('SELECT sku_codigo, produto_id, escopo FROM sku_produto'),
    query('SELECT data::text FROM feriado'),
  ]);

  const processosPorProduto = new Map();
  for (const p of processos.rows) {
    if (!processosPorProduto.has(p.produto_id)) processosPorProduto.set(p.produto_id, []);
    processosPorProduto.get(p.produto_id).push({
      id: p.id,
      tipoLinha: p.tipo_linha,
      nome: p.nome,
      sequencia: p.sequencia,
      leadtimeDias: p.leadtime_dias,
      operadores: p.operadores === null ? null : Number(p.operadores),
      pcsHora: p.pcs_hora === null ? null : Number(p.pcs_hora),
      skuFilho: p.sku_filho,
    });
  }

  const mapaSku = new Map();
  for (const m of mapa.rows) {
    const chave = `${m.sku_codigo}|${m.escopo}`;
    if (!mapaSku.has(chave)) mapaSku.set(chave, []);
    mapaSku.get(chave).push(m.produto_id);
  }

  const nomesProduto = new Map(
    (await query('SELECT id, nome FROM produto')).rows.map((r) => [r.id, r.nome]),
  );

  const { linhas, diagnosticos } = explodirDemanda({
    slots: slots.rows.map((s) => ({
      data: s.data,
      bloco: s.bloco,
      skuCodigo: s.sku_codigo,
      quantidade: Number(s.quantidade),
    })),
    mapaSku,
    processosPorProduto,
    nomesProduto,
    correcoes: cenario.correcoes || {},
    feriados: new Set(feriados.rows.map((f) => f.data)),
  });

  // Preserva o que foi editado à mão: linhas manuais e o "feito" das geradas.
  const gravadas = await transacao(async (c) => {
    const { rows: feitos } = await c.query(
      `SELECT sku_codigo, processo_nome, dia_processo::text, feito_por, feito_em
         FROM demanda_processo
        WHERE cenario_id = $1 AND origem = 'gerado' AND feito`,
      [cenarioId],
    );
    const eraFeito = new Map(
      feitos.map((f) => [`${f.sku_codigo}|${f.processo_nome}|${f.dia_processo}`, f]),
    );

    await c.query(
      `DELETE FROM demanda_processo WHERE cenario_id = $1 AND origem = 'gerado'`,
      [cenarioId],
    );

    let n = 0;
    for (const l of linhas) {
      const chave = `${l.skuCodigo}|${l.processoNome}|${l.diaProcesso}`;
      const antes = eraFeito.get(chave);
      await c.query(
        `INSERT INTO demanda_processo
           (cenario_id, tipo_linha, dia_processo, dia_producao, sku_codigo, processo_id,
            processo_nome, quantidade, operadores, pcs_hora, tempo_horas, lote,
            feito, feito_por, feito_em, origem, atualizado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'gerado',$16)`,
        [
          cenarioId,
          l.tipoLinha,
          l.diaProcesso,
          l.diaProducao,
          l.skuCodigo,
          l.processoId,
          l.processoNome,
          l.quantidade,
          l.operadores,
          l.pcsHora,
          Number.isFinite(l.tempoHoras) ? l.tempoHoras : null,
          l.lote,
          Boolean(antes),
          antes?.feito_por ?? null,
          antes?.feito_em ?? null,
          email,
        ],
      );
      n++;
    }
    return n;
  });

  // Sinaliza o tempo infinito, que o banco guarda como NULL.
  const infinitos = linhas.filter((l) => l.tempoHoras === Infinity).length;

  res.json({ geradas: gravadas, tempoInfinito: infinitos, diagnosticos });
}

module.exports = { handler };
