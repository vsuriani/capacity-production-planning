'use strict';

const { query } = require('./db');
const { calcularOperadores } = require('./motor/operadores');
const { metricaDoDispositivo } = require('./motor/metrica');

/**
 * O Dimensionamento Global: quantos operadores a linha precisa por mês, ao longo de todo o
 * horizonte do forecast.
 *
 * **É uma simulação, não um cenário.** Não tem mês em uso, não tem correções, não se duplica
 * nem se compara — é uma visão só, que se mexe e se olha. Por isso tudo que ela guarda é
 * estado global (migration `004_dimensionamento_global.sql`), e não `cenario_*`.
 *
 * Onde mora cada peça:
 *
 *   tempo por dispositivo   dispositivo_metrica
 *   quantidade base         forecast, somado por (dispositivo, mês) via dispositivo_model
 *   ajuste                  global_ajuste — sobrepõe o forecast célula a célula
 *   dias úteis              global_mes (digitados à mão)
 *   jornada e coeficientes  parametro (os globais)
 *
 * A conta é `calcularOperadores`, a mesma das outras telas, com duas particularidades da aba:
 *
 *   - a meta é a métrica **parcial**, para o `coefEficiencia` entrar uma vez só (a "Métrica
 *     Prod. Real" da planilha já é `parcial / 0,85` — usar ela dividiria duas vezes);
 *   - **sem excedente** — a linha "Quantidade Produção Real" é ROUNDUP puro.
 *
 * Os termos da soma são sintetizados alinhados aqui: a fórmula do Global é alinhada na origem,
 * então não há par desalinhado para reproduzir.
 */

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/** Rótulo do mês — mesma convenção do parse_global() do importador. */
function rotuloDoMes(mes, ano) {
  return `${MESES[mes - 1]}/${ano}`;
}

async function parametrosGlobais() {
  const { rows } = await query('SELECT chave, valor FROM parametro');
  const mapa = Object.fromEntries(rows.map((r) => [r.chave, Number(r.valor)]));
  return {
    jornadaHoras: mapa.jornada_horas,
    pausaHoras: mapa.pausa_horas,
    coefEficiencia: mapa.coef_eficiencia,
    coefExcedente: mapa.coef_excedente,
    minutosPorHora: mapa.minutos_por_hora,
  };
}

async function carregarDimensionamento() {
  const [
    parametros,
    componentes,
    dias,
    ajustes,
    forecast,
    models,
    porModel,
    semDispositivo,
  ] = await Promise.all([
    parametrosGlobais(),
    query(
      `SELECT m.id, m.dispositivo_id, m.ordem, m.rotulo, m.papel, m.valor, d.nome AS dispositivo
         FROM dispositivo_metrica m
         JOIN dispositivo d ON d.id = m.dispositivo_id
        ORDER BY d.ordem, d.nome, m.ordem`,
    ),
    query('SELECT ano, mes, dias_uteis FROM global_mes'),
    query('SELECT dispositivo_id, ano, mes, quantidade FROM global_ajuste'),
    query(
      `SELECT m.dispositivo_id, f.ano, f.mes, sum(f.quantidade) AS quantidade
         FROM forecast f
         JOIN dispositivo_model m ON m.model = f.model
        GROUP BY m.dispositivo_id, f.ano, f.mes`,
    ),
    // Os models de cada dispositivo, mesmo os que não têm nenhuma linha de forecast — a
    // planilha lista o PROD debaixo do dispositivo esteja ele zerado ou não.
    query(
      `SELECT dm.model, dm.dispositivo_id, min(f.produto) AS produto
         FROM dispositivo_model dm
         LEFT JOIN forecast f ON f.model = dm.model
        GROUP BY dm.model, dm.dispositivo_id
        ORDER BY dm.dispositivo_id, dm.model`,
    ),
    // A abertura da linha: quanto cada model traz em cada mês, somado sobre os Country.
    query(
      `SELECT dm.dispositivo_id, f.model, f.ano, f.mes, sum(f.quantidade) AS quantidade
         FROM forecast f
         JOIN dispositivo_model dm ON dm.model = f.model
        GROUP BY dm.dispositivo_id, f.model, f.ano, f.mes`,
    ),
    // Model com forecast e sem dispositivo: não entra em conta nenhuma, então vira aviso.
    query(
      `SELECT f.model, min(f.produto) AS produto, sum(f.quantidade) AS quantidade
         FROM forecast f
        WHERE NOT EXISTS (SELECT 1 FROM dispositivo_model m WHERE m.model = f.model)
        GROUP BY f.model
        ORDER BY f.model`,
    ),
  ]);

  // As colunas são os meses do forecast, mais qualquer mês que já tenha dias úteis digitados.
  const chaves = new Map();
  for (const f of forecast.rows) chaves.set(`${f.ano}-${f.mes}`, { ano: f.ano, mes: f.mes });
  for (const d of dias.rows) chaves.set(`${d.ano}-${d.mes}`, { ano: d.ano, mes: d.mes });

  const diasUteisDe = new Map(dias.rows.map((d) => [`${d.ano}-${d.mes}`, Number(d.dias_uteis)]));
  const meses = [...chaves.values()]
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes)
    .map(({ ano, mes }, ordem) => ({
      periodo: rotuloDoMes(mes, ano),
      ano,
      mes,
      ordem,
      diasUteis: diasUteisDe.has(`${ano}-${mes}`) ? diasUteisDe.get(`${ano}-${mes}`) : null,
    }));

  return {
    parametros,
    componentes: componentes.rows,
    meses,
    ajustes: ajustes.rows,
    forecast: forecast.rows,
    models: models.rows,
    porModel: porModel.rows,
    modelsSemDispositivo: semDispositivo.rows.map((r) => ({
      model: r.model,
      produto: r.produto,
      quantidade: Number(r.quantidade),
    })),
  };
}

function calcularDimensionamento(dados) {
  const { parametros, meses } = dados;

  // --- métrica por dispositivo ---------------------------------------------

  const porDispositivo = new Map();
  for (const c of dados.componentes) {
    if (!porDispositivo.has(c.dispositivo_id)) {
      porDispositivo.set(c.dispositivo_id, { nome: c.dispositivo, componentes: [] });
    }
    porDispositivo.get(c.dispositivo_id).componentes.push({
      id: c.id,
      rotulo: c.rotulo,
      papel: c.papel,
      valor: Number(c.valor),
    });
  }

  const metas = new Map();
  const metricas = [];
  for (const [dispositivoId, { nome, componentes }] of porDispositivo) {
    const m = metricaDoDispositivo(componentes, parametros.coefEficiencia);
    metas.set(dispositivoId, m.parcial);
    metricas.push({
      dispositivoId,
      dispositivo: nome,
      componentes,
      parcial: m.parcial,
      real: m.real,
    });
  }

  const dispositivos = metricas.map((m) => ({ id: m.dispositivoId, nome: m.dispositivo }));
  const nomes = new Map(dispositivos.map((d) => [d.id, d.nome]));

  // --- quantidade efetiva: forecast, sobreposto pelo ajuste ----------------

  const doForecast = new Map(
    dados.forecast.map((f) => [`${f.dispositivo_id}|${f.ano}-${f.mes}`, Number(f.quantidade)]),
  );
  const oAjuste = new Map(
    dados.ajustes.map((a) => [`${a.dispositivo_id}|${a.ano}-${a.mes}`, Number(a.quantidade)]),
  );

  const demandas = new Map();
  const quantidades = [];
  for (const d of dispositivos) {
    for (const m of meses) {
      const chave = `${d.id}|${m.ano}-${m.mes}`;
      const forecast = doForecast.get(chave) ?? 0;
      const ajuste = oAjuste.has(chave) ? oAjuste.get(chave) : null;
      const efetiva = ajuste ?? forecast;
      demandas.set(`${d.id}|${m.periodo}`, efetiva);
      quantidades.push({
        dispositivoId: d.id,
        periodo: m.periodo,
        ano: m.ano,
        mes: m.mes,
        forecast,
        ajuste,
        efetiva,
      });
    }
  }

  // --- a abertura da linha, por model --------------------------------------

  // Sempre o forecast puro: o ajuste é do dispositivo inteiro e não se distribui entre os
  // models. Quando há ajuste, a soma dos PRODs abertos não fecha com a linha de cima — é o
  // que se quer ver.
  const doModel = new Map(
    dados.porModel.map((r) => [`${r.model}|${r.ano}-${r.mes}`, Number(r.quantidade)]),
  );

  const daLinha = new Set(dispositivos.map((d) => d.id));
  const modelsDetalhe = dados.models
    .filter((m) => daLinha.has(m.dispositivo_id))
    .map((m) => ({
      dispositivoId: m.dispositivo_id,
      model: m.model,
      produto: m.produto,
      porMes: meses.map((mes) => ({
        periodo: mes.periodo,
        quantidade: doModel.get(`${m.model}|${mes.ano}-${mes.mes}`) ?? 0,
      })),
    }));

  // --- a conta, um mês por vez ---------------------------------------------

  const termos = dispositivos.map((d) => ({ metaDispositivoId: d.id, qtdDispositivoId: d.id }));

  const resultados = meses.map((m) => {
    // `diagnosticos` fica fora: sem excedente, todo mês devolveria o mesmo aviso
    // `excedente-so-no-global`, e esta tela não tem painel de diagnóstico.
    const { diagnosticos, ...r } = calcularOperadores({
      periodo: m.periodo,
      termos,
      metas,
      demandas,
      nomes,
      // Mês sem dias úteis digitados ainda não tem conta — é o #DIV/0! da planilha.
      diasUteis: m.diasUteis ?? 0,
      parametros,
      aplicarExcedente: false,
    });
    return { periodo: m.periodo, ordem: m.ordem, diasUteis: m.diasUteis, ...r };
  });

  return { dispositivos, metricas, quantidades, models: modelsDetalhe, resultados };
}

module.exports = {
  carregarDimensionamento,
  calcularDimensionamento,
  parametrosGlobais,
  rotuloDoMes,
  MESES,
};
