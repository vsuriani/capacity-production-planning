'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query, transacao } = require('../_lib/db');
const { carregarDimensionamento, calcularDimensionamento } = require('../_lib/dimensionamento');
const { nomeCanonico, estaOculto } = require('../_lib/dispositivos');
const { diasUteisDoMes } = require('../_lib/motor/calendario');

/**
 * O Dimensionamento Global — uma simulação só, sem cenário.
 *
 * GET   /api/dimensionamento          -> a grade calculada
 * PATCH /api/dimensionamento          -> { ajustes?, meses?, componentes? }
 *          ajustes:     [{ dispositivoId, ano, mes, quantidade }]  quantidade null = apaga
 *          meses:       [{ ano, mes, diasUteis }]
 *          componentes: [{ id, valor }]
 * POST  /api/dimensionamento?acao=tempos -> substitui a métrica de todos os dispositivos
 *          { tempos: [{ dispositivo, componentes: [{ rotulo, papel, valor }] }] }
 * POST  /api/dimensionamento?acao=dias-uteis -> conta os dias úteis do calendário
 *          { sobrescrever?: boolean }  default false = só preenche os meses vazios
 */
async function handler(req, res) {
  if (!exigirAuth(req, res)) return;

  if (req.method === 'GET') return grade(res);
  if (req.method === 'PATCH') return salvar(req, res);
  if (req.method === 'POST' && req.query.acao === 'tempos') return gravarTempos(req, res);
  if (req.method === 'POST' && req.query.acao === 'dias-uteis') return contarDiasUteis(req, res);

  res.status(405).json({ erro: 'Método não permitido' });
}

async function grade(res) {
  const dados = await carregarDimensionamento();
  const calculo = calcularDimensionamento(dados);

  res.json({
    parametros: dados.parametros,
    meses: dados.meses,
    modelsSemDispositivo: dados.modelsSemDispositivo,
    ...calculo,
  });
}

async function salvar(req, res) {
  const { ajustes = [], meses = [], componentes = [] } = req.body || {};

  await transacao(async (c) => {
    for (const a of ajustes) {
      // Ausência de linha é o que significa "vale o forecast", então null APAGA em vez de
      // gravar zero — é o "voltar ao forecast" da tela.
      if (a.quantidade === null) {
        await c.query(
          `DELETE FROM global_ajuste WHERE dispositivo_id = $1 AND ano = $2 AND mes = $3`,
          [a.dispositivoId, a.ano, a.mes],
        );
        continue;
      }
      await c.query(
        `INSERT INTO global_ajuste (dispositivo_id, ano, mes, quantidade) VALUES ($1, $2, $3, $4)
         ON CONFLICT (dispositivo_id, ano, mes) DO UPDATE SET quantidade = EXCLUDED.quantidade`,
        [a.dispositivoId, a.ano, a.mes, a.quantidade],
      );
    }

    for (const m of meses) {
      await c.query(
        `INSERT INTO global_mes (ano, mes, dias_uteis) VALUES ($1, $2, $3)
         ON CONFLICT (ano, mes) DO UPDATE SET dias_uteis = EXCLUDED.dias_uteis`,
        [m.ano, m.mes, m.diasUteis],
      );
    }

    for (const k of componentes) {
      await c.query('UPDATE dispositivo_metrica SET valor = $2 WHERE id = $1', [k.id, k.valor]);
    }
  });

  res.json({ ok: true });
}

/**
 * Conta os dias úteis de cada mês do horizonte a partir do calendário, descontando os feriados
 * cadastrados em `feriado`.
 *
 * É uma **ação explícita**, não um preenchimento automático: a decisão foi que a célula é
 * digitada, e esta rota só existe para não digitar 16 vezes quando o horizonte estica. Por
 * padrão preenche apenas os meses vazios — `sobrescrever: true` refaz todos, e aí perde o que
 * foi digitado à mão.
 */
async function contarDiasUteis(req, res) {
  const sobrescrever = req.body?.sobrescrever === true;

  const dados = await carregarDimensionamento();
  const alvos = dados.meses.filter((m) => sobrescrever || m.diasUteis === null);
  if (!alvos.length) return res.json({ preenchidos: 0, meses: [] });

  const { rows: feriados } = await query('SELECT data::text FROM feriado');
  const semFeriado = new Set(feriados.map((f) => f.data));

  const preenchidos = alvos.map((m) => ({
    ano: m.ano,
    mes: m.mes,
    periodo: m.periodo,
    diasUteis: diasUteisDoMes(m.mes, m.ano, semFeriado),
  }));

  await transacao(async (c) => {
    for (const m of preenchidos) {
      await c.query(
        `INSERT INTO global_mes (ano, mes, dias_uteis) VALUES ($1, $2, $3)
         ON CONFLICT (ano, mes) DO UPDATE SET dias_uteis = EXCLUDED.dias_uteis`,
        [m.ano, m.mes, m.diasUteis],
      );
    }
  });

  res.json({ preenchidos: preenchidos.length, feriados: semFeriado.size, meses: preenchidos });
}

/**
 * Carga da tabela de tempos. Substitui a composição inteira — ela chega revisada por completo,
 * e mesclar deixaria para trás o componente que saiu da revisão.
 *
 * Cria o dispositivo que ainda não existe: a tela precisa ficar de pé num banco onde a planilha
 * nunca foi importada.
 */
async function gravarTempos(req, res) {
  const { tempos } = req.body || {};
  if (!Array.isArray(tempos)) return res.status(400).json({ erro: 'tempos obrigatórios' });

  const criados = await transacao(async (c) => {
    const { rows } = await c.query('SELECT id, nome, ordem FROM dispositivo');
    const idDe = new Map(rows.map((r) => [r.nome, r.id]));
    let proximaOrdem = Math.max(0, ...rows.map((r) => r.ordem)) + 1;
    let novos = 0;

    await c.query('DELETE FROM dispositivo_metrica');

    for (const t of tempos) {
      // A tabela de tempos vem da planilha e ainda usa os nomes antigos.
      const nome = nomeCanonico(t.dispositivo);
      let dispositivoId = idDe.get(nome);
      if (!dispositivoId) {
        const { rows: inserido } = await c.query(
          'INSERT INTO dispositivo (nome, ordem, ativo) VALUES ($1, $2, $3) RETURNING id',
          [nome, proximaOrdem++, !estaOculto(nome)],
        );
        dispositivoId = inserido[0].id;
        idDe.set(nome, dispositivoId);
        novos++;
      }

      for (const [ordem, comp] of (t.componentes ?? []).entries()) {
        await c.query(
          `INSERT INTO dispositivo_metrica (dispositivo_id, ordem, rotulo, papel, valor)
           VALUES ($1, $2, $3, $4, $5)`,
          [dispositivoId, ordem, comp.rotulo, comp.papel, comp.valor],
        );
      }
    }

    return novos;
  });

  const { rows } = await query('SELECT count(*)::int AS n FROM dispositivo_metrica');
  res.json({ dispositivos: tempos.length, componentes: rows[0].n, dispositivosCriados: criados });
}

module.exports = { handler };
