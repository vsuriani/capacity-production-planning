'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query, transacao } = require('../_lib/db');
const { validarCorrecoes } = require('../_lib/motor/desvios');
const { carregarCenario, calcularCenario } = require('../_lib/cenario');
const { gradeDoMes, diaDaSemana } = require('../_lib/motor/calendario');

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

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
  if (req.method === 'POST') {
    try {
      return await criar(req, res, email);
    } catch (erro) {
      if (erro.code === '23505') {
        return res.status(409).json({ erro: 'Já existe um cenário importado para esse mês' });
      }
      throw erro;
    }
  }
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

  if (!corpo.tipo) return res.status(400).json({ erro: 'tipo é obrigatório' });
  if (corpo.tipo !== 'capacidade' && (!corpo.mes || !corpo.ano)) {
    return res.status(400).json({ erro: 'mes e ano são obrigatórios' });
  }

  const id = await transacao((c) => semear(c, corpo, email));
  res.json({ id });
}

/**
 * Cria um cenário já com as bases compartilhadas dentro dele.
 *
 * Os cadastros globais (Base de PROD, processos e sequências, mapa SKU→produto) não são
 * copiados — o cenário aponta para eles. O que entra aqui é o que é POR cenário:
 *
 *   - os dispositivos e o tempo-padrão de cada um (a coluna Meta), herdados do cenário
 *     mais recente do mesmo tipo, que é o padrão vigente
 *   - os períodos do mês, com os dias úteis já contados do calendário e dos feriados
 *   - um termo de fórmula ALINHADO por dispositivo: cenário novo nasce correto, sem
 *     herdar os pares desalinhados da planilha
 *   - a composição da métrica, no cenário de capacidade
 */
async function semear(c, corpo, email) {
  const { tipo, mes = null, ano = null } = corpo;
  const nome = corpo.nome || (mes ? `${MESES[mes - 1]}/${ano}` : 'Novo cenário');

  const { rows } = await c.query(
    `INSERT INTO cenario (nome, tipo, mes, ano, observacao, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [nome, tipo, mes, ano, corpo.observacao || '', email],
  );
  const id = rows[0].id;

  // Cenário mais recente do mesmo tipo: a fonte dos tempos por dispositivo.
  const { rows: base } = await c.query(
    `SELECT id FROM cenario WHERE tipo = $1 AND id <> $2 ORDER BY oficial DESC, criado_em DESC LIMIT 1`,
    [tipo, id],
  );
  const baseId = base[0]?.id ?? null;

  if (baseId) {
    await c.query(
      `INSERT INTO cenario_meta (cenario_id, dispositivo_id, meta_min_peca)
       SELECT $1, dispositivo_id, meta_min_peca FROM cenario_meta WHERE cenario_id = $2`,
      [id, baseId],
    );
    await c.query(
      `INSERT INTO metrica_componente (cenario_id, dispositivo_id, ordem, rotulo, papel, valor)
       SELECT $1, dispositivo_id, ordem, rotulo, papel, valor
         FROM metrica_componente WHERE cenario_id = $2`,
      [id, baseId],
    );
    await c.query(
      `INSERT INTO cenario_parametro (cenario_id, chave, valor)
       SELECT $1, chave, valor FROM cenario_parametro WHERE cenario_id = $2`,
      [id, baseId],
    );
  } else {
    // Primeiro cenário do tipo: entra com todos os dispositivos e meta a preencher.
    await c.query(
      `INSERT INTO cenario_meta (cenario_id, dispositivo_id, meta_min_peca)
       SELECT $1, id, 0 FROM dispositivo WHERE ativo`,
      [id],
    );
  }

  // Períodos com os dias úteis contados de verdade.
  const { rows: feriados } = await c.query('SELECT data::text FROM feriado');
  const semFeriado = new Set(feriados.map((f) => f.data));
  const periodos =
    tipo === 'semanal' && mes
      ? periodosSemanais(mes, ano, semFeriado)
      : [{ periodo: mes ? MESES[mes - 1] : 'Período 1', diasUteis: diasUteisDoMes(mes, ano, semFeriado) }];

  for (const [ordem, p] of periodos.entries()) {
    await c.query(
      `INSERT INTO cenario_periodo (cenario_id, periodo, ordem, dias_uteis) VALUES ($1,$2,$3,$4)`,
      [id, p.periodo, ordem, p.diasUteis],
    );
  }

  // Um termo alinhado por dispositivo em cada período — nasce sem os desvios da planilha.
  for (const p of periodos) {
    await c.query(
      `INSERT INTO cenario_formula_par
         (cenario_id, periodo, meta_dispositivo_id, qtd_dispositivo_id, ordem)
       SELECT $1, $2, dispositivo_id, dispositivo_id,
              row_number() OVER (ORDER BY dispositivo_id)
         FROM cenario_meta WHERE cenario_id = $1`,
      [id, p.periodo],
    );
  }

  // Cenário mensal ganha o calendário do mês, pronto para receber a grade.
  if (tipo === 'mensal' && mes) {
    const { rows: anterior } = await c.query(
      `SELECT qtd_operadores FROM projecao ORDER BY id DESC LIMIT 1`,
    );
    await c.query(
      `INSERT INTO projecao (cenario_id, mes, ano, qtd_operadores) VALUES ($1,$2,$3,$4)`,
      [id, mes, ano, anterior[0]?.qtd_operadores ?? 8],
    );
  }

  return id;
}

/** Semana 1..5 do mês, as mesmas que o calendário monta, com os dias úteis de cada uma. */
function periodosSemanais(mes, ano, feriados) {
  return gradeDoMes(mes, ano).map((s) => ({
    periodo: `Semana ${s.semana}`,
    diasUteis: s.dias.filter((d) => ehUtil(d, feriados)).length,
  }));
}

function diasUteisDoMes(mes, ano, feriados) {
  if (!mes) return 0;
  let total = 0;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  for (let dia = 1; dia <= ultimo; dia++) {
    const iso = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    if (ehUtil(iso, feriados)) total++;
  }
  return total;
}

function ehUtil(iso, feriados) {
  const dow = diaDaSemana(iso);
  return dow !== 0 && dow !== 6 && !feriados.has(iso);
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
