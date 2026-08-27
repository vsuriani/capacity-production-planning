'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query, transacao } = require('../_lib/db');
const { nomeCanonico, estaOculto } = require('../_lib/dispositivos');

/**
 * Recebe o payload do importador (scripts/importar_planilha.py) e grava no banco.
 *
 * Idempotente: upsert por chave natural. Cenários importados são identificados por
 * (tipo, nome) e reescritos por completo — a demanda editada no app não é misturada
 * com a da planilha.
 *
 * GET  /api/importacao  -> histórico
 * POST /api/importacao  -> aplica o payload
 */
async function handler(req, res) {
  const email = exigirAuth(req, res);
  if (!email) return;

  if (req.method === 'GET') {
    const { rows } = await query(
      `SELECT id, quando, quem, planilha, contagens, avisos
         FROM importacao ORDER BY quando DESC LIMIT 20`,
    );
    return res.json({ importacoes: rows });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const resultado = await transacao((c) => aplicarPayload(c, req.body || {}, email));
  res.json(resultado);
}

/**
 * Aplica o payload num cliente de banco já em transação.
 * Exportado para permitir teste end-to-end sem servidor Postgres.
 */
async function aplicarPayload(c, payload, email) {
  // Avisos detectados já na leitura da planilha (ex.: SKU duplicado na Base de PROD).
  const avisos = [...(payload.avisosOrigem || [])];
  const contagens = {};

  contagens.sku = await gravarSku(c, payload.sku);
  const produtos = await gravarProdutos(c, payload.produtos, payload.aliases);
  contagens.produto = produtos.size;
  contagens.processo = await gravarProcessos(c, payload.processos, produtos, avisos);
  contagens.sku_produto = await gravarSkuProduto(c, payload.skuProduto, produtos, avisos);

  const dispositivos = await gravarDispositivos(c, payload.dispositivos);
  contagens.dispositivo = dispositivos.size;

  contagens.cenario = 0;
  contagens.cenario_formula_par = 0;
  contagens.metrica_componente = 0;
  contagens.demanda_processo = 0;
  contagens.alocacao_operador = 0;
  contagens.projecao_slot = 0;

  for (const cenario of payload.cenarios || []) {
    const cenarioId = await gravarCenario(c, cenario, dispositivos, email);
    contagens.cenario++;
    contagens.cenario_formula_par += (cenario.termos || []).length;
    contagens.metrica_componente += (cenario.metricaComponentes || []).length;

    if (cenario.projecao) {
      contagens.projecao_slot += await gravarProjecao(c, cenarioId, cenario.projecao);
    }
    if (cenario.demandaProcesso) {
      contagens.demanda_processo += await gravarDemandaProcesso(
        c,
        cenarioId,
        cenario.demandaProcesso,
        avisos,
      );
    }
    if (cenario.alocacao) {
      contagens.alocacao_operador += await gravarAlocacao(c, cenarioId, cenario.alocacao);
    }
  }

  const { rows } = await c.query(
    `INSERT INTO importacao (quem, planilha, contagens, avisos)
     VALUES ($1, $2, $3, $4) RETURNING id, quando`,
    [email, payload.planilha || '', JSON.stringify(contagens), JSON.stringify(avisos)],
  );

  return { id: rows[0].id, quando: rows[0].quando, contagens, avisos };
}

// ---------------------------------------------------------------- cadastros

async function gravarSku(c, lista = []) {
  for (const s of lista) {
    // NULLIF/COALESCE: nunca sobrescrever um valor preenchido por um vazio. A Base de
    // PROD tem códigos repetidos em que uma das linhas vem sem descrição.
    await c.query(
      `INSERT INTO sku (codigo, descricao, grupo_item, ncm, atualizado)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (codigo) DO UPDATE
         SET descricao  = COALESCE(NULLIF(EXCLUDED.descricao, ''), sku.descricao),
             grupo_item = COALESCE(EXCLUDED.grupo_item, sku.grupo_item),
             ncm        = COALESCE(EXCLUDED.ncm, sku.ncm),
             atualizado = now()`,
      [s.codigo, s.descricao || '', s.grupoItem || null, s.ncm || null],
    );
  }
  return lista.length;
}

/** @returns {Map<string, number>} nome do produto -> id */
async function gravarProdutos(c, nomes = [], aliases = {}) {
  const mapa = new Map();

  for (const nome of nomes) {
    const { rows } = await c.query(
      `INSERT INTO produto (nome) VALUES ($1)
       ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome
       RETURNING id`,
      [nome],
    );
    mapa.set(nome, rows[0].id);
  }

  // O alias preserva a grafia original da planilha (com espaço sobrando, etc.).
  for (const [alias, nomeCanonico] of Object.entries(aliases)) {
    const id = mapa.get(nomeCanonico);
    if (!id) continue;
    await c.query(
      `INSERT INTO produto_alias (produto_id, alias) VALUES ($1, $2)
       ON CONFLICT (alias) DO UPDATE SET produto_id = EXCLUDED.produto_id`,
      [id, alias],
    );
  }

  return mapa;
}

async function gravarProcessos(c, lista = [], produtos, avisos) {
  // Reimporta o roteiro inteiro: a Base simplificada é a fonte na carga inicial.
  await c.query('DELETE FROM processo');

  let gravados = 0;
  for (const p of lista) {
    const produtoId = produtos.get(p.produto);
    if (!produtoId) {
      avisos.push({ tipo: 'processo-sem-produto', processo: p.nome, produto: p.produto });
      continue;
    }
    // sku_filho tem FK para sku: só grava se o código existir no catálogo.
    let skuFilho = p.skuFilho || null;
    if (skuFilho) {
      const { rows } = await c.query('SELECT 1 FROM sku WHERE codigo = $1', [skuFilho]);
      if (!rows.length) {
        avisos.push({ tipo: 'produto-filho-fora-da-base-prod', processo: p.nome, sku: skuFilho });
        skuFilho = null;
      }
    }

    await c.query(
      `INSERT INTO processo
         (produto_id, tipo_linha, nome, sequencia, paralelismo, leadtime_dias,
          operadores, pcs_hora, sku_filho, origem_total_dia, ordem_importacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        produtoId,
        p.tipoLinha,
        p.nome,
        p.sequencia ?? null,
        p.paralelismo ?? null,
        p.leadtimeDias ?? 0,
        p.operadores ?? null,
        p.pcsHora ?? null,
        skuFilho,
        p.origemTotalDia || 'taxa',
        p.ordem ?? null,
      ],
    );
    gravados++;
  }
  return gravados;
}

async function gravarSkuProduto(c, lista = [], produtos, avisos) {
  await c.query('DELETE FROM sku_produto');

  let gravados = 0;
  for (const m of lista) {
    const produtoId = produtos.get(m.produto);
    if (!produtoId) {
      avisos.push({ tipo: 'mapeamento-sem-produto', sku: m.skuCodigo, produto: m.produto });
      continue;
    }
    await c.query(
      `INSERT INTO sku_produto (sku_codigo, produto_id, escopo, so_no_codigo_morto)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (sku_codigo, produto_id, escopo) DO UPDATE
         SET so_no_codigo_morto = EXCLUDED.so_no_codigo_morto`,
      [m.skuCodigo, produtoId, m.escopo, m.soNoCodigoMorto === true],
    );
    gravados++;
  }
  return gravados;
}

/**
 * Grava o cadastro de dispositivos do payload.
 *
 * O nome é traduzido na entrada (`nomeCanonico`), mas o mapa devolvido continua indexado pelo
 * nome ORIGINAL: é por ele que as metas e as demandas do payload procuram o id logo adiante.
 *
 * @returns {Map<string, number>} nome do dispositivo no payload -> id
 */
async function gravarDispositivos(c, lista = []) {
  const mapa = new Map();
  for (const d of lista) {
    const nome = nomeCanonico(d.nome);
    const { rows } = await c.query(
      // Quem já existe não é tocado: `ordem`, `ativo` e `meta_padrao` são do catálogo
      // (migration 006) e do app, não da planilha. O `DO UPDATE` que não muda nada é só para
      // o `RETURNING id` valer também no conflito.
      `INSERT INTO dispositivo (nome, ordem, ativo) VALUES ($1, $2, $3)
       ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome
       RETURNING id`,
      [nome, d.ordem ?? 0, !estaOculto(nome)],
    );
    mapa.set(d.nome, rows[0].id);
  }
  return mapa;
}

// ---------------------------------------------------------------- cenários

async function gravarCenario(c, cenario, dispositivos, email) {
  // Um cenário é identificado pelo mês que ele planeja. O de capacidade não tem mês,
  // então cai no nome.
  const { rows: existente } = cenario.mes
    ? await c.query(
        'SELECT id FROM cenario WHERE tipo = $1 AND mes = $2 AND ano = $3 AND importado',
        [cenario.tipo, cenario.mes, cenario.ano],
      )
    : await c.query('SELECT id FROM cenario WHERE tipo = $1 AND nome = $2 AND importado', [
        cenario.tipo, cenario.nome,
      ]);

  let cenarioId;
  if (existente.length) {
    cenarioId = existente[0].id;
    // Reescreve por completo — o cenário importado espelha a planilha.
    for (const tabela of [
      'cenario_meta',
      'cenario_periodo',
      'cenario_demanda',
      'cenario_formula_par',
      'metrica_componente',
      'demanda_processo',
      'alocacao_operador',
    ]) {
      await c.query(`DELETE FROM ${tabela} WHERE cenario_id = $1`, [cenarioId]);
    }
    await c.query('DELETE FROM projecao WHERE cenario_id = $1', [cenarioId]);
    await c.query('UPDATE cenario SET nome = $2, mes = $3, ano = $4 WHERE id = $1', [
      cenarioId,
      cenario.nome,
      cenario.mes ?? null,
      cenario.ano ?? null,
    ]);
  } else {
    const { rows } = await c.query(
      `INSERT INTO cenario (nome, tipo, mes, ano, observacao, criado_por, importado)
       VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
      [
        cenario.nome,
        cenario.tipo,
        cenario.mes ?? null,
        cenario.ano ?? null,
        cenario.observacao || 'Importado da planilha',
        email,
      ],
    );
    cenarioId = rows[0].id;
  }

  const idDe = (nome) => dispositivos.get(nome);

  for (const [nome, meta] of Object.entries(cenario.metas || {})) {
    const id = idDe(nome);
    if (id) {
      await c.query(
        `INSERT INTO cenario_meta (cenario_id, dispositivo_id, meta_min_peca)
         VALUES ($1, $2, $3)
         ON CONFLICT (cenario_id, dispositivo_id) DO UPDATE SET meta_min_peca = EXCLUDED.meta_min_peca`,
        [cenarioId, id, meta],
      );
    }
  }

  for (const p of cenario.periodos || []) {
    await c.query(
      `INSERT INTO cenario_periodo (cenario_id, periodo, ordem, dias_uteis, arredondado_manual)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cenario_id, periodo) DO UPDATE
         SET ordem = EXCLUDED.ordem,
             dias_uteis = EXCLUDED.dias_uteis,
             arredondado_manual = EXCLUDED.arredondado_manual`,
      [cenarioId, p.periodo, p.ordem ?? 0, p.diasUteis ?? 0, p.arredondadoManual ?? null],
    );
  }

  for (const d of cenario.demandas || []) {
    const id = idDe(d.dispositivo);
    if (id) {
      await c.query(
        `INSERT INTO cenario_demanda (cenario_id, dispositivo_id, periodo, quantidade)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (cenario_id, dispositivo_id, periodo) DO UPDATE SET quantidade = EXCLUDED.quantidade`,
        [cenarioId, id, d.periodo, d.quantidade ?? 0],
      );
    }
  }

  for (const [i, t] of (cenario.termos || []).entries()) {
    const metaId = idDe(t.metaDispositivo);
    const qtdId = idDe(t.qtdDispositivo);
    if (metaId && qtdId) {
      await c.query(
        `INSERT INTO cenario_formula_par
           (cenario_id, periodo, meta_dispositivo_id, qtd_dispositivo_id, qtd_periodo, ordem)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [cenarioId, t.periodo, metaId, qtdId, t.qtdPeriodo ?? null, t.ordem ?? i],
      );
    }
  }

  for (const m of cenario.metricaComponentes || []) {
    const id = idDe(m.dispositivo);
    if (id) {
      await c.query(
        `INSERT INTO metrica_componente (cenario_id, dispositivo_id, ordem, rotulo, papel, valor)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [cenarioId, id, m.ordem ?? 0, m.rotulo, m.papel, m.valor ?? 0],
      );
    }
  }

  // Coeficientes próprios do cenário (o Global tem os seus em D56/D58).
  for (const [chave, valor] of [
    ['coef_eficiencia', cenario.coefEficiencia],
    ['coef_excedente', cenario.coefExcedente],
  ]) {
    if (typeof valor === 'number') {
      await c.query(
        `INSERT INTO cenario_parametro (cenario_id, chave, valor) VALUES ($1, $2, $3)
         ON CONFLICT (cenario_id, chave) DO UPDATE SET valor = EXCLUDED.valor`,
        [cenarioId, chave, valor],
      );
    }
  }

  return cenarioId;
}

async function gravarProjecao(c, cenarioId, projecao) {
  const { rows } = await c.query(
    `INSERT INTO projecao (cenario_id, mes, ano, qtd_operadores)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [cenarioId, projecao.mes, projecao.ano, projecao.qtdOperadores ?? 8],
  );
  const projecaoId = rows[0].id;

  for (const [i, s] of (projecao.slots || []).entries()) {
    await c.query(
      `INSERT INTO projecao_slot (projecao_id, data, bloco, ordem, sku_codigo, quantidade)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [projecaoId, s.data, s.bloco, s.ordem ?? i, s.skuCodigo, s.quantidade ?? 0],
    );
  }
  return (projecao.slots || []).length;
}

async function gravarDemandaProcesso(c, cenarioId, lista = [], avisos) {
  let gravados = 0;
  for (const d of lista) {
    if (!d.diaProcesso || !d.diaProducao) {
      avisos.push({ tipo: 'demanda-sem-data', sku: d.skuCodigo, processo: d.processoNome });
      continue;
    }
    await c.query(
      `INSERT INTO demanda_processo
         (cenario_id, tipo_linha, dia_processo, dia_producao, sku_codigo, processo_nome,
          quantidade, operadores, pcs_hora, tempo_horas, lote, feito, origem, atualizado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'gerado',$13)`,
      [
        cenarioId,
        d.tipoLinha,
        d.diaProcesso,
        d.diaProducao,
        d.skuCodigo,
        d.processoNome || '',
        d.quantidade ?? 0,
        d.operadores ?? null,
        d.pcsHora ?? null,
        Number.isFinite(d.tempoHoras) ? d.tempoHoras : null,
        d.lote || '',
        d.feito === true,
        'importacao',
      ],
    );
    gravados++;
  }
  return gravados;
}

async function gravarAlocacao(c, cenarioId, lista = []) {
  let gravados = 0;
  for (const a of lista) {
    if (!a.data) continue;
    await c.query(
      `INSERT INTO alocacao_operador (cenario_id, data, operador, horas)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cenario_id, data, operador) DO UPDATE SET horas = EXCLUDED.horas`,
      [cenarioId, a.data, a.operador, a.horas ?? 0],
    );
    gravados++;
  }
  return gravados;
}

module.exports = { handler, aplicarPayload };
