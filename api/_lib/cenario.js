'use strict';

const { query } = require('./db');
const { calcularOperadores } = require('./motor/operadores');
const { metricaDoDispositivo } = require('./motor/metrica');

/**
 * Carrega tudo que o motor precisa de um cenário e roda o cálculo por período.
 * Compartilhado por /api/calculo, /api/projecao (gerar demanda) e /api/alocacao.
 */

async function parametrosDoCenario(cenarioId) {
  const { rows } = await query(
    `SELECT p.chave, COALESCE(cp.valor, p.valor) AS valor
       FROM parametro p
       LEFT JOIN cenario_parametro cp ON cp.chave = p.chave AND cp.cenario_id = $1`,
    [cenarioId],
  );
  const mapa = Object.fromEntries(rows.map((r) => [r.chave, Number(r.valor)]));
  return {
    jornadaHoras: mapa.jornada_horas,
    pausaHoras: mapa.pausa_horas,
    coefEficiencia: mapa.coef_eficiencia,
    coefExcedente: mapa.coef_excedente,
    minutosPorHora: mapa.minutos_por_hora,
  };
}

async function carregarCenario(cenarioId) {
  const [cenario] = (
    await query('SELECT * FROM cenario WHERE id = $1', [cenarioId])
  ).rows;
  if (!cenario) return null;

  // Dispositivo inativo é filtrado aqui, na entrada, e não no motor: assim `calcularCenario` e
  // `calcularOperadores` seguem sem saber que `ativo` existe, e esconder um dispositivo o tira
  // da grade E da soma de uma vez só. O dado dele continua gravado.
  const ativos = 'SELECT id FROM dispositivo WHERE ativo';

  const [periodos, metas, demandas, termos, componentes, dispositivos] = await Promise.all([
    query(
      `SELECT periodo, ordem, dias_uteis, arredondado_manual FROM cenario_periodo
        WHERE cenario_id = $1 ORDER BY ordem`,
      [cenarioId],
    ),
    query(
      `SELECT dispositivo_id, meta_min_peca FROM cenario_meta
        WHERE cenario_id = $1 AND dispositivo_id IN (${ativos})`,
      [cenarioId],
    ),
    query(
      `SELECT dispositivo_id, periodo, quantidade FROM cenario_demanda
        WHERE cenario_id = $1 AND dispositivo_id IN (${ativos})`,
      [cenarioId],
    ),
    query(
      // Os dois lados do par: um termo que usa a quantidade de um dispositivo escondido também
      // sai da soma, senão sobrariam minutos sem linha visível que os explique.
      `SELECT periodo, meta_dispositivo_id, qtd_dispositivo_id, qtd_periodo, ordem
         FROM cenario_formula_par
        WHERE cenario_id = $1
          AND meta_dispositivo_id IN (${ativos})
          AND qtd_dispositivo_id IN (${ativos})
        ORDER BY periodo, ordem`,
      [cenarioId],
    ),
    query(
      `SELECT id, dispositivo_id, ordem, rotulo, papel, valor
         FROM metrica_componente
        WHERE cenario_id = $1 AND dispositivo_id IN (${ativos})
        ORDER BY dispositivo_id, ordem`,
      [cenarioId],
    ),
    // TODOS os dispositivos ativos, não só os que já têm linha neste cenário: a grade mostra o
    // dispositivo zerado para que ele possa receber meta e demanda sem passar por cadastro.
    query('SELECT id, nome, ordem FROM dispositivo WHERE ativo ORDER BY ordem, nome'),
  ]);

  return {
    cenario,
    parametros: await parametrosDoCenario(cenarioId),
    periodos: periodos.rows,
    metas: metas.rows,
    demandas: demandas.rows,
    termos: termos.rows,
    componentes: componentes.rows,
    dispositivos: dispositivos.rows,
  };
}

/**
 * Roda o motor para todos os períodos do cenário.
 *
 * No cenário de capacidade a "meta" de cada dispositivo é a métrica **parcial** calculada dos
 * componentes; nos demais vem da coluna Meta. Parcial, e não real: `real` já é
 * `parcial / coefEficiencia`, e `calcularOperadores` divide por `coefEficiencia` de novo — usar
 * a real aplicava 0,85 duas vezes e inflava o headcount em ~18%.
 */
function calcularCenario(dados) {
  const { cenario, parametros, periodos, dispositivos } = dados;
  const ehCapacidade = cenario.tipo === 'capacidade';

  const nomes = new Map(dispositivos.map((d) => [d.id, d.nome]));

  // metas
  const metas = new Map();
  const metricas = [];
  if (ehCapacidade) {
    const porDispositivo = new Map();
    for (const c of dados.componentes) {
      if (!porDispositivo.has(c.dispositivo_id)) porDispositivo.set(c.dispositivo_id, []);
      porDispositivo.get(c.dispositivo_id).push({
        rotulo: c.rotulo,
        papel: c.papel,
        valor: Number(c.valor),
      });
    }
    for (const [dispositivoId, lista] of porDispositivo) {
      const m = metricaDoDispositivo(lista, parametros.coefEficiencia);
      metas.set(dispositivoId, m.parcial);
      metricas.push({
        dispositivoId,
        dispositivo: nomes.get(dispositivoId),
        componentes: lista,
        parcial: m.parcial,
        real: m.real,
      });
    }
  } else {
    for (const m of dados.metas) metas.set(m.dispositivo_id, Number(m.meta_min_peca));
  }

  const demandas = new Map(
    dados.demandas.map((d) => [`${d.dispositivo_id}|${d.periodo}`, Number(d.quantidade)]),
  );

  const termosPorPeriodo = new Map();
  for (const t of dados.termos) {
    if (!termosPorPeriodo.has(t.periodo)) termosPorPeriodo.set(t.periodo, []);
    termosPorPeriodo.get(t.periodo).push({
      metaDispositivoId: t.meta_dispositivo_id,
      qtdDispositivoId: t.qtd_dispositivo_id,
      qtdPeriodo: t.qtd_periodo ?? undefined,
    });
  }

  const resultados = periodos.map((p) => {
    const r = calcularOperadores({
      periodo: p.periodo,
      termos: termosPorPeriodo.get(p.periodo) ?? [],
      metas,
      demandas,
      nomes,
      diasUteis: Number(p.dias_uteis),
      parametros,
      correcoes: cenario.correcoes || {},
      // A linha "Quantidade Produção Real" do Global é ROUNDUP puro — a folga de 20% do
      // Coef. de Excedente não entra em aba nenhuma hoje. Quem quiser vê-la liga a correção
      // `excedente-so-no-global` no cenário.
      aplicarExcedente: false,
      arredondadoManual: p.arredondado_manual ?? null,
    });
    return { periodo: p.periodo, ordem: p.ordem, diasUteis: Number(p.dias_uteis), ...r };
  });

  // Um diagnóstico por id, com a lista de períodos afetados.
  const porId = new Map();
  for (const r of resultados) {
    for (const d of r.diagnosticos) {
      if (!porId.has(d.id)) porId.set(d.id, { ...d, periodos: [], itens: [] });
      const acc = porId.get(d.id);
      acc.periodos.push(r.periodo);
      if (d.itens) acc.itens.push(...d.itens);
    }
  }

  return { resultados, metricas, diagnosticos: [...porId.values()] };
}

module.exports = { carregarCenario, calcularCenario, parametrosDoCenario };
