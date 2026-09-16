'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query, transacao } = require('../_lib/db');
const { nomeCanonico } = require('../_lib/dispositivos');
const { lerAba, configurado } = require('../_lib/sheets');
const { agregarTempos, normalizar } = require('../_lib/motor/tempos');

/**
 * Os tempos vindos da planilha "Análises Best Laps".
 *
 *   GET  /api/tempos                        -> último sync, diff contra o cadastro, pendências
 *   POST /api/tempos?acao=sync              -> lê a planilha, grava snapshot, aplica no cadastro
 *   POST /api/tempos?acao=mapear            -> { deviceModel, dispositivo } resolve uma pendência
 *   POST /api/tempos?acao=aplicar-cenario   -> { cenarioId } leva os tempos para um cenário
 *
 * ## O que o sync aplica e o que ele NÃO aplica
 *
 * Aplica no CADASTRO: `dispositivo.meta_padrao`. Cadastro é da Engenharia, que é dona da
 * planilha — não faz sentido pedir clique para o dono do dado atualizar o próprio dado.
 *
 * NÃO toca `dispositivo_metrica` (ver `aplicarNoCadastro`): o aditivo "Montagem" de lá é a linha
 * de rollup, não o tempo-padrão, e escrever o total ali dobraria a defasagem no parcial.
 *
 * NÃO toca `cenario_meta`. Ela existe justamente para "mudar a Meta de um mês não contaminar os
 * outros" (migration 006): é uma cópia editável por cenário. Um sync que sobrescrevesse a cópia
 * mudaria o headcount do mês que o PCP está rodando, sozinho, no meio da operação. Cenário novo
 * já nasce com o tempo fresco; cenário em andamento tem `?acao=aplicar-cenario`, com o diff na
 * tela antes.
 *
 * Isso também é o que mantém `verificar_agosto.mjs` verde: as baselines `importado` da planilha
 * de Dimensionamento continuam intactas.
 */
async function handler(req, res) {
  if (!exigirAuth(req, res)) return;

  if (req.method === 'GET') return listar(res);

  if (req.method === 'POST') {
    const { acao } = req.query;
    if (acao === 'sync') return sincronizar(req, res);
    if (acao === 'mapear') return mapear(req, res);
    if (acao === 'aplicar-cenario') return aplicarNoCenario(req, res);
    return res.status(400).json({ erro: 'ação desconhecida' });
  }

  res.status(405).json({ erro: 'Método não permitido' });
}

// ---------------------------------------------------------------- leitura

/** Snapshot mais recente + de-para + dispositivos ativos, que é tudo que a agregação precisa. */
async function estadoAtual() {
  const { rows: syncs } = await query(
    `SELECT id, quando, linhas, origem, erro, aplicado, alteracoes
       FROM tempo_sync ORDER BY id DESC LIMIT 20`,
  );

  // O último sync BEM-SUCEDIDO, não o último: uma falha de leitura não pode apagar da tela o
  // dado que estava lá antes dela.
  const ultimoOk = syncs.find((s) => !s.erro);

  const [atividades, dePara, dispositivos] = await Promise.all([
    ultimoOk
      ? query(
          `SELECT device_model, processo, process_type, best_lap, goal, goal_min, goal_max,
                  mes_medicao, obsoleta
             FROM tempo_atividade WHERE sync_id = $1`,
          [ultimoOk.id],
        )
      : Promise.resolve({ rows: [] }),
    query(
      `SELECT m.device_model, m.dispositivo_id, d.nome AS dispositivo
         FROM dispositivo_device_model m
         JOIN dispositivo d ON d.id = m.dispositivo_id`,
    ),
    query('SELECT id, nome, meta_padrao FROM dispositivo WHERE ativo ORDER BY ordem, nome'),
  ]);

  return { syncs, ultimoOk, atividades: atividades.rows, dePara: dePara.rows, dispositivos: dispositivos.rows };
}

function agregarDoEstado({ atividades, dePara, dispositivos }) {
  return agregarTempos({
    atividades: atividades.map((a) => ({
      deviceModel: a.device_model,
      processo: a.processo,
      processType: a.process_type,
      goal: a.goal,
      mesMedicao: a.mes_medicao,
      obsoleta: a.obsoleta,
    })),
    dePara: new Map(
      dePara.map((m) => [normalizar(m.device_model), { id: m.dispositivo_id, nome: m.dispositivo }]),
    ),
    dispositivosAtivos: dispositivos.map((d) => ({ id: d.id, nome: d.nome })),
  });
}

async function listar(res) {
  const estado = await estadoAtual();
  const { resultado, pendencias, resumo } = agregarDoEstado(estado);

  const metaDe = new Map(estado.dispositivos.map((d) => [d.id, Number(d.meta_padrao)]));

  // O diff é o produto principal desta tela: o que muda, de quanto, e para quem.
  const diff = resultado
    .filter((r) => r.total > 0)
    .map((r) => {
      const atual = metaDe.get(r.dispositivoId) ?? 0;
      return {
        dispositivoId: r.dispositivoId,
        dispositivo: r.dispositivo,
        deviceModel: r.deviceModel,
        atual,
        planilha: r.total,
        delta: r.total - atual,
        percentual: atual > 0 ? (r.total - atual) / atual : null,
      };
    })
    .filter((d) => Math.abs(d.delta) > 1e-9);

  res.json({
    configurado: configurado() && Boolean(process.env.TEMPOS_SHEET_ID),
    ultimoSync: estado.ultimoOk ?? null,
    historico: estado.syncs,
    tempos: resultado,
    diff,
    pendencias,
    resumo,
    dePara: estado.dePara,
    dispositivos: estado.dispositivos.map((d) => ({
      id: d.id,
      nome: d.nome,
      metaPadrao: Number(d.meta_padrao),
    })),
  });
}

// ---------------------------------------------------------------- sync

const numero = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(String(valor).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/**
 * Lê a planilha, grava o snapshot e aplica no cadastro. Usado pela tela e pelo agendador.
 *
 * Devolve `{ ok: false, erro }` em vez de lançar quando a leitura falha: quem chama é um
 * `setInterval` no processo do app, e planilha fora do ar não pode derrubar o planejamento. A
 * falha fica gravada em `tempo_sync.erro` e aparece no histórico da tela.
 */
async function executarSync({ origem = 'agendado' } = {}) {
  const sheetId = process.env.TEMPOS_SHEET_ID;
  const aba = process.env.TEMPOS_SHEET_ABA || 'Perfomancedev';

  if (!sheetId || !configurado()) {
    return { ok: false, erro: 'sync não configurado (TEMPOS_SHEET_ID / GOOGLE_SA_JSON)' };
  }

  let linhas;
  try {
    linhas = await lerAba(sheetId, aba);
  } catch (erro) {
    const { rows } = await query(
      `INSERT INTO tempo_sync (origem, erro) VALUES ($1, $2) RETURNING id`,
      [origem, String(erro.message).slice(0, 500)],
    );
    return { ok: false, erro: erro.message, syncId: rows[0].id };
  }

  const syncId = await transacao(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO tempo_sync (origem, linhas) VALUES ($1, $2) RETURNING id`,
      [origem, linhas.length],
    );
    const id = rows[0].id;

    for (const l of linhas) {
      await c.query(
        `INSERT INTO tempo_atividade
           (sync_id, device_model, processo, process_type, best_lap, goal, goal_min, goal_max,
            mes_medicao, obsoleta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          (l.device_model ?? '').trim(),
          (l.process ?? '').trim(),
          (l.process_type ?? '').trim() || null,
          numero(l.best_lap),
          numero(l.goal),
          numero(l.goal_min),
          numero(l.goal_max),
          numero(l.month),
          String(l.obsoletas ?? '').toUpperCase() === 'TRUE',
        ],
      );
    }
    return id;
  });

  const alteracoes = await aplicarNoCadastro(syncId);
  return { ok: true, syncId, linhas: linhas.length, alteracoes };
}

/**
 * Grava o tempo-padrão no cadastro: `dispositivo.meta_padrao` = o total do device model.
 *
 * ## Por que NÃO escreve em `dispositivo_metrica`
 *
 * A primeira versão disto também atualizava os aditivos daquela tabela, e estava errado. O
 * aditivo "Montagem X" de lá não é o tempo-padrão do dispositivo — é UM componente do parcial
 * do Dimensionamento Global, e vale exatamente o `goal` da linha "Processo de montar completo"
 * (8,37 em Energy Trac). Gravar o total ali (22,55) faria o parcial contar a defasagem duas
 * vezes: uma no aditivo Defasagem, outra dentro do total.
 *
 * Separar as duas coisas tem custo: `/dimensionamento-global` continua vindo de
 * `docs/tempos-dispositivo.tsv`, por carga manual. Recompor os aditivos a partir da planilha é
 * possível — `defasagem` e `producao` já saem da agregação — mas mudaria os números daquela
 * tela, que não é o que este trabalho se propôs a fazer.
 *
 * Só escreve o que mudou, e devolve o diff para `tempo_sync.alteracoes`.
 */
async function aplicarNoCadastro(syncId) {
  const estado = await estadoAtual();
  const { resultado } = agregarDoEstado(estado);
  const metaDe = new Map(estado.dispositivos.map((d) => [d.id, Number(d.meta_padrao)]));

  const alteracoes = [];

  await transacao(async (c) => {
    for (const r of resultado) {
      // Device model sem nenhuma atividade viva não chega aqui (a agregação não o emite), mas
      // total zero seria "este dispositivo não custa nada" na fórmula de headcount — pior que
      // não ter número. Preserva o cadastro.
      if (!(r.total > 0)) continue;

      const atual = metaDe.get(r.dispositivoId);
      if (atual !== undefined && Math.abs(atual - r.total) > 1e-9) {
        alteracoes.push({
          dispositivo: r.dispositivo,
          campo: 'meta_padrao',
          de: atual,
          para: r.total,
        });
      }

      await c.query('UPDATE dispositivo SET meta_padrao = $2 WHERE id = $1', [
        r.dispositivoId,
        r.total,
      ]);
    }

    await c.query('UPDATE tempo_sync SET aplicado = true, alteracoes = $2 WHERE id = $1', [
      syncId,
      JSON.stringify(alteracoes),
    ]);
  });

  return alteracoes;
}

async function sincronizar(req, res) {
  const resultado = await executarSync({ origem: 'manual' });
  if (!resultado.ok) return res.status(502).json(resultado);
  res.json(resultado);
}

// ---------------------------------------------------------------- pendências e cenário

/** Resolve uma pendência `device-model-sem-dispositivo` sem precisar de migration. */
async function mapear(req, res) {
  const { deviceModel, dispositivo } = req.body || {};
  if (!deviceModel || !dispositivo) {
    return res.status(400).json({ erro: 'deviceModel e dispositivo obrigatórios' });
  }

  const nome = nomeCanonico(dispositivo);
  const { rows } = await query('SELECT id FROM dispositivo WHERE nome = $1', [nome]);
  if (!rows.length) return res.status(400).json({ erro: `dispositivo não cadastrado: ${nome}` });

  await query(
    `INSERT INTO dispositivo_device_model (device_model, dispositivo_id) VALUES ($1, $2)
     ON CONFLICT (device_model) DO UPDATE SET dispositivo_id = EXCLUDED.dispositivo_id`,
    [String(deviceModel).trim(), rows[0].id],
  );

  res.json({ deviceModel, dispositivo: nome });
}

/**
 * Leva os tempos do cadastro para um cenário existente. É a ação explícita que falta ao sync:
 * o mês em andamento só muda quando alguém decide que muda.
 */
async function aplicarNoCenario(req, res) {
  const cenarioId = Number(req.body?.cenarioId);
  if (!Number.isInteger(cenarioId)) return res.status(400).json({ erro: 'cenarioId obrigatório' });

  const { rows: cenario } = await query('SELECT id, importado FROM cenario WHERE id = $1', [
    cenarioId,
  ]);
  if (!cenario.length) return res.status(404).json({ erro: 'cenário não encontrado' });

  // As baselines da planilha de Dimensionamento provam a fidelidade do cálculo
  // (verificar_agosto.mjs). Injetar tempo novo nelas quebraria a prova.
  if (cenario[0].importado) {
    return res.status(400).json({ erro: 'cenário importado é baseline e não recebe tempo novo' });
  }

  const { rows: antes } = await query(
    `SELECT m.dispositivo_id, d.nome, m.meta_min_peca AS de, d.meta_padrao AS para
       FROM cenario_meta m JOIN dispositivo d ON d.id = m.dispositivo_id
      WHERE m.cenario_id = $1 AND m.meta_min_peca <> d.meta_padrao`,
    [cenarioId],
  );

  await query(
    `UPDATE cenario_meta m SET meta_min_peca = d.meta_padrao
       FROM dispositivo d
      WHERE d.id = m.dispositivo_id AND m.cenario_id = $1`,
    [cenarioId],
  );

  res.json({
    cenarioId,
    alterados: antes.length,
    alteracoes: antes.map((a) => ({
      dispositivo: a.nome,
      de: Number(a.de),
      para: Number(a.para),
    })),
  });
}

// `executarSync` é do agendador em server.cjs; `aplicarNoCadastro` é exposto para
// scripts/verificar_tempos_bestlap.mjs conseguir provar a aplicação sem falar com a planilha.
module.exports = { handler, executarSync, aplicarNoCadastro };
