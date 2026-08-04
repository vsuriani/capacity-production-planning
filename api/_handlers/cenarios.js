'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query, transacao } = require('../_lib/db');
const { validarCorrecoes } = require('../_lib/motor/desvios');
const { carregarCenario, calcularCenario } = require('../_lib/cenario');

/**
 * GET    /api/cenarios              -> lista
 * GET    /api/cenarios?id=N         -> cenário completo + cálculo + diagnósticos
 * GET    /api/cenarios?comparar=1,2 -> comparação de headcount entre cenários
 * POST   /api/cenarios              -> cria (ou duplica com ?duplicarDe=N)
 * PATCH  /api/cenarios?id=N         -> nome, observacao, correcoes, oficial
 * DELETE /api/cenarios?id=N
 */
async function handler(req, res) {
  const email = exigirAuth(req, res);
  if (!email) return;

  const id = req.query.id ? Number(req.query.id) : null;

  if (req.method === 'GET') {
    if (req.query.comparar) return comparar(req, res);
    if (id) return detalhe(id, res);
    return listar(req, res);
  }
  if (req.method === 'POST') return criar(req, res, email);
  if (req.method === 'PATCH') return atualizar(id, req, res);
  if (req.method === 'DELETE') return remover(id, res);

  res.status(405).json({ erro: 'Método não permitido' });
}

async function listar(req, res) {
  const tipo = req.query.tipo || null;
  const { rows } = await query(
    `SELECT c.id, c.nome, c.tipo, c.mes, c.ano, c.oficial, c.correcoes, c.observacao,
            c.criado_por, c.criado_em,
            (SELECT count(*) FROM cenario_periodo p WHERE p.cenario_id = c.id)::int AS periodos,
            (SELECT count(*) FROM cenario_demanda d WHERE d.cenario_id = c.id)::int AS demandas
       FROM cenario c
      WHERE ($1::text IS NULL OR c.tipo::text = $1)
      ORDER BY c.tipo, c.oficial DESC, c.criado_em DESC`,
    [tipo],
  );
  res.json({ cenarios: rows });
}

async function detalhe(id, res) {
  const dados = await carregarCenario(id);
  if (!dados) return res.status(404).json({ erro: 'Cenário não encontrado' });

  const calculo = calcularCenario(dados);
  res.json({
    cenario: dados.cenario,
    parametros: dados.parametros,
    dispositivos: dados.dispositivos,
    periodos: dados.periodos,
    metas: dados.metas,
    demandas: dados.demandas,
    termos: dados.termos,
    componentes: dados.componentes,
    ...calculo,
  });
}

async function comparar(req, res) {
  const ids = String(req.query.comparar)
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n));

  const comparacao = [];
  for (const id of ids) {
    const dados = await carregarCenario(id);
    if (!dados) continue;
    const { resultados, diagnosticos } = calcularCenario(dados);
    comparacao.push({
      cenario: {
        id: dados.cenario.id,
        nome: dados.cenario.nome,
        tipo: dados.cenario.tipo,
        correcoes: dados.cenario.correcoes,
      },
      resultados: resultados.map((r) => ({
        periodo: r.periodo,
        operadores: r.operadores,
        operadoresFracionario: r.operadoresFracionario,
      })),
      totalDiagnosticos: diagnosticos.length,
    });
  }
  res.json({ comparacao });
}

async function criar(req, res, email) {
  const duplicarDe = req.query.duplicarDe ? Number(req.query.duplicarDe) : null;
  const corpo = req.body || {};

  if (duplicarDe) {
    const novoId = await transacao(async (c) => {
      const [origem] = (await c.query('SELECT * FROM cenario WHERE id = $1', [duplicarDe])).rows;
      if (!origem) throw new Error('Cenário de origem não encontrado');

      const { rows } = await c.query(
        `INSERT INTO cenario (nome, tipo, mes, ano, correcoes, observacao, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [
          corpo.nome || `${origem.nome} (cópia)`,
          origem.tipo,
          corpo.mes ?? origem.mes,
          corpo.ano ?? origem.ano,
          corpo.correcoes ?? origem.correcoes,
          corpo.observacao ?? '',
          email,
        ],
      );
      const id = rows[0].id;

      // Copia os filhos, sem a saída calculada (demanda e alocação são regeradas).
      await c.query(
        `INSERT INTO cenario_meta (cenario_id, dispositivo_id, meta_min_peca)
         SELECT $1, dispositivo_id, meta_min_peca FROM cenario_meta WHERE cenario_id = $2`,
        [id, duplicarDe],
      );
      await c.query(
        `INSERT INTO cenario_periodo (cenario_id, periodo, ordem, dias_uteis)
         SELECT $1, periodo, ordem, dias_uteis FROM cenario_periodo WHERE cenario_id = $2`,
        [id, duplicarDe],
      );
      await c.query(
        `INSERT INTO cenario_demanda (cenario_id, dispositivo_id, periodo, quantidade)
         SELECT $1, dispositivo_id, periodo, quantidade FROM cenario_demanda WHERE cenario_id = $2`,
        [id, duplicarDe],
      );
      await c.query(
        `INSERT INTO cenario_formula_par
           (cenario_id, periodo, meta_dispositivo_id, qtd_dispositivo_id, qtd_periodo, ordem)
         SELECT $1, periodo, meta_dispositivo_id, qtd_dispositivo_id, qtd_periodo, ordem
           FROM cenario_formula_par WHERE cenario_id = $2`,
        [id, duplicarDe],
      );
      await c.query(
        `INSERT INTO metrica_componente (cenario_id, dispositivo_id, ordem, rotulo, papel, valor)
         SELECT $1, dispositivo_id, ordem, rotulo, papel, valor
           FROM metrica_componente WHERE cenario_id = $2`,
        [id, duplicarDe],
      );
      await c.query(
        `INSERT INTO cenario_parametro (cenario_id, chave, valor)
         SELECT $1, chave, valor FROM cenario_parametro WHERE cenario_id = $2`,
        [id, duplicarDe],
      );
      return id;
    });

    return res.json({ id: novoId });
  }

  if (!corpo.nome || !corpo.tipo) {
    return res.status(400).json({ erro: 'nome e tipo são obrigatórios' });
  }
  const { rows } = await query(
    `INSERT INTO cenario (nome, tipo, mes, ano, observacao, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [corpo.nome, corpo.tipo, corpo.mes ?? null, corpo.ano ?? null, corpo.observacao || '', email],
  );
  res.json({ id: rows[0].id });
}

async function atualizar(id, req, res) {
  if (!id) return res.status(400).json({ erro: 'id obrigatório' });
  const corpo = req.body || {};

  if (corpo.correcoes !== undefined) {
    try {
      validarCorrecoes(corpo.correcoes);
    } catch (erro) {
      return res.status(400).json({ erro: erro.message });
    }
  }

  await transacao(async (c) => {
    // Um oficial por tipo: desmarca o anterior antes de marcar este.
    if (corpo.oficial === true) {
      await c.query(
        `UPDATE cenario SET oficial = false
          WHERE oficial AND tipo = (SELECT tipo FROM cenario WHERE id = $1)`,
        [id],
      );
    }
    await c.query(
      `UPDATE cenario
          SET nome = COALESCE($2, nome),
              observacao = COALESCE($3, observacao),
              correcoes = COALESCE($4, correcoes),
              oficial = COALESCE($5, oficial),
              mes = COALESCE($6, mes),
              ano = COALESCE($7, ano)
        WHERE id = $1`,
      [
        id,
        corpo.nome ?? null,
        corpo.observacao ?? null,
        corpo.correcoes === undefined ? null : JSON.stringify(corpo.correcoes),
        corpo.oficial === undefined ? null : corpo.oficial,
        corpo.mes ?? null,
        corpo.ano ?? null,
      ],
    );
  });

  res.json({ ok: true });
}

async function remover(id, res) {
  if (!id) return res.status(400).json({ erro: 'id obrigatório' });
  await query('DELETE FROM cenario WHERE id = $1', [id]);
  res.json({ ok: true });
}

module.exports = { handler };
