'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query, transacao } = require('../_lib/db');
const { alocarOperadores } = require('../_lib/motor/alocacao');
const { parametrosDoCenario } = require('../_lib/cenario');

/**
 * Dimensionamento de operadores (heat map).
 *
 * GET  /api/alocacao?cenario=N              -> matriz dia × operador gravada
 * POST /api/alocacao?cenario=N&acao=calcular -> recalcula a partir da lista de demanda
 *
 * Exceção deliberada à fidelidade: `alocacao-dia-anterior` é forçado aqui, veja `calcular()`.
 */
async function handler(req, res) {
  if (!exigirAuth(req, res)) return;

  const cenarioId = Number(req.query.cenario);
  if (!cenarioId) return res.status(400).json({ erro: 'cenario obrigatório' });

  if (req.method === 'GET') return obter(cenarioId, res);
  if (req.method === 'POST' && req.query.acao === 'calcular') return calcular(cenarioId, res);

  res.status(405).json({ erro: 'Método não permitido' });
}

async function obter(cenarioId, res) {
  const [{ rows: alocacao }, { rows: projecao }, parametros] = await Promise.all([
    query(
      `SELECT data::text, operador, horas FROM alocacao_operador
        WHERE cenario_id = $1 ORDER BY data, operador`,
      [cenarioId],
    ),
    query('SELECT qtd_operadores FROM projecao WHERE cenario_id = $1', [cenarioId]),
    parametrosDoCenario(cenarioId),
  ]);

  const qtdOperadores = projecao[0]?.qtd_operadores ?? 8;
  const jornadaLiquida = parametros.jornadaHoras - parametros.pausaHoras;

  // Matriz densa: uma linha por dia, uma coluna por operador.
  const porDia = new Map();
  for (const a of alocacao) {
    if (!porDia.has(a.data)) porDia.set(a.data, new Array(qtdOperadores).fill(0));
    const linha = porDia.get(a.data);
    if (a.operador >= 1 && a.operador <= qtdOperadores) {
      linha[a.operador - 1] = Number(a.horas);
    }
  }

  const dias = [...porDia.entries()].map(([data, horas]) => ({
    data,
    horas,
    total: horas.reduce((s, h) => s + h, 0),
    acimaDaJornada: horas.filter((h) => h > jornadaLiquida).length,
  }));

  res.json({
    dias,
    qtdOperadores,
    jornadaLiquida,
    jornadaCheia: parametros.jornadaHoras,
  });
}

async function calcular(cenarioId, res) {
  const [cenario] = (await query('SELECT * FROM cenario WHERE id = $1', [cenarioId])).rows;
  if (!cenario) return res.status(404).json({ erro: 'Cenário não encontrado' });

  const [{ rows: projecao }, parametros] = await Promise.all([
    query('SELECT qtd_operadores FROM projecao WHERE cenario_id = $1', [cenarioId]),
    parametrosDoCenario(cenarioId),
  ]);
  const qtdOperadores = projecao[0]?.qtd_operadores ?? 8;

  // Ordem de leitura em modo fiel = ordem de gravação (id), como na planilha, onde o
  // relatório é escrito em blocos e não fica ordenado por data.
  const { rows } = await query(
    `SELECT dia_processo::text AS dia_processo, tempo_horas, operadores, feito
       FROM demanda_processo WHERE cenario_id = $1 ORDER BY id`,
    [cenarioId],
  );

  const { alocacao, jornadaLiquida, diagnosticos } = alocarOperadores({
    linhas: rows.map((r) => ({
      diaProcesso: r.dia_processo,
      tempoHoras: r.tempo_horas === null ? null : Number(r.tempo_horas),
      operadores: Number(r.operadores || 0),
      feito: r.feito,
    })),
    qtdOperadores,
    parametros,
    // Única exceção ao "fiel por padrão" do projeto, e é o que mantém a tela de pé: em modo
    // fiel o empacotador só grava quando detecta troca de dia e não faz flush no fim, então o
    // último dia do período NUNCA é gravado e a primeira gravação é uma linha-fantasma com
    // data nula. Num cenário com um único dia de demanda isso zera o heat map inteiro — a
    // tela ficava vazia mesmo com a lista de demanda cheia, e sem UI para ligar a correção
    // (AGENTS.md 2026-08-17) não havia saída pelo produto. As demais correções do cenário
    // continuam valendo como estão; o motor e os dois testes (fiel/corrigido) seguem intactos.
    correcoes: { ...(cenario.correcoes || {}), 'alocacao-dia-anterior': true },
  });

  const gravadas = await transacao(async (c) => {
    await c.query('DELETE FROM alocacao_operador WHERE cenario_id = $1', [cenarioId]);
    let n = 0;
    for (const dia of alocacao) {
      // Guarda mantida: com a correção ligada o motor não emite dia sem data, mas gravar uma
      // linha com data nula estouraria o NOT NULL da tabela em vez de dar um erro legível.
      if (!dia.data) continue;
      for (const [i, horas] of dia.horas.entries()) {
        await c.query(
          `INSERT INTO alocacao_operador (cenario_id, data, operador, horas)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (cenario_id, data, operador) DO UPDATE SET horas = EXCLUDED.horas`,
          [cenarioId, dia.data, i + 1, horas],
        );
        n++;
      }
    }
    return n;
  });

  res.json({
    gravadas,
    diasSemData: alocacao.filter((d) => !d.data).length,
    jornadaLiquida,
    diagnosticos,
  });
}

module.exports = { handler };
