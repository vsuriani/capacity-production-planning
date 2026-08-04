'use strict';

const { corrigido, diagnostico } = require('./desvios');

/**
 * Quantos operadores a linha precisa para atender a demanda de um período.
 *
 * Fórmula da planilha (Planejamento Mensal!E24 e equivalentes):
 *
 *   Σ(Meta_i × Qtd_j) / minutosPorHora
 *   ─────────────────────────────────────────────  ÷ coefEficiencia
 *      diasUteis × (jornadaHoras − pausaHoras)
 *
 * Os termos da soma vêm de `termos` — na planilha eles são escritos à mão dentro da
 * fórmula, e é aí que moram três desvios:
 *   - a Meta da linha X multiplica a quantidade da linha Y (pares desalinhados)
 *   - dispositivos sem termo nenhum ficam fora da conta
 *   - alguns termos apontam para a quantidade de OUTRO período (outra coluna)
 *
 * @param {object} entrada
 * @param {string} entrada.periodo   período sendo calculado (ex.: 'Week 45', 'Abril')
 * @param {{metaDispositivoId: number, qtdDispositivoId: number, qtdPeriodo?: string}[]} entrada.termos
 * @param {Map<number, number>} entrada.metas       dispositivoId -> minutos por peça
 * @param {Map<string, number>} entrada.demandas    `${dispositivoId}|${periodo}` -> quantidade
 * @param {Map<number, string>} [entrada.nomes]     dispositivoId -> nome (para o diagnóstico)
 * @param {number} entrada.diasUteis
 * @param {object} entrada.parametros  jornadaHoras, pausaHoras, coefEficiencia, coefExcedente, minutosPorHora
 * @param {Record<string, boolean>} [entrada.correcoes]
 * @param {boolean} [entrada.aplicarExcedente]      true no cenário de capacidade
 * @param {number|null} [entrada.arredondadoManual] headcount digitado à mão no período
 */
function calcularOperadores({
  periodo,
  termos,
  metas,
  demandas,
  nomes = new Map(),
  diasUteis,
  parametros,
  correcoes = {},
  aplicarExcedente = false,
  arredondadoManual = null,
}) {
  const estaCorrigido = corrigido(correcoes);
  const diagnosticos = [];

  const { jornadaHoras, pausaHoras, coefEficiencia, coefExcedente, minutosPorHora } = parametros;

  const demandaDe = (dispositivoId, deQualPeriodo) =>
    Number(demandas.get(`${dispositivoId}|${deQualPeriodo ?? periodo}`) ?? 0);

  // --- monta os termos da soma ---------------------------------------------

  const corrigirPares = estaCorrigido('pares-desalinhados');
  const corrigirCruzado = estaCorrigido('par-outro-periodo');
  const corrigirFaltantes = estaCorrigido('dispositivos-fora-da-soma');

  let efetivos = termos.map((t) => ({
    metaDispositivoId: t.metaDispositivoId,
    qtdDispositivoId: corrigirPares ? t.metaDispositivoId : t.qtdDispositivoId,
    qtdPeriodo: corrigirCruzado ? periodo : (t.qtdPeriodo ?? periodo),
  }));

  if (corrigirFaltantes) {
    const jaTem = new Set(efetivos.map((t) => t.metaDispositivoId));
    for (const id of metas.keys()) {
      if (!jaTem.has(id)) {
        efetivos.push({ metaDispositivoId: id, qtdDispositivoId: id, qtdPeriodo: periodo });
      }
    }
  }

  // --- diagnósticos --------------------------------------------------------

  const desalinhados = termos.filter((t) => t.metaDispositivoId !== t.qtdDispositivoId);
  if (desalinhados.length && !corrigirPares) {
    diagnosticos.push(
      diagnostico(
        'pares-desalinhados',
        `${desalinhados.length} de ${termos.length} termos desalinhados neste período.`,
        {
          itens: desalinhados.map((t) => ({
            meta: nomes.get(t.metaDispositivoId) ?? `#${t.metaDispositivoId}`,
            qtd: nomes.get(t.qtdDispositivoId) ?? `#${t.qtdDispositivoId}`,
          })),
        },
      ),
    );
  }

  const cruzados = termos.filter((t) => t.qtdPeriodo && t.qtdPeriodo !== periodo);
  if (cruzados.length && !corrigirCruzado) {
    diagnosticos.push(
      diagnostico(
        'par-outro-periodo',
        `${cruzados.length} termo(s) usam a quantidade de outro período.`,
        {
          itens: cruzados.map((t) => ({
            dispositivo: nomes.get(t.metaDispositivoId) ?? `#${t.metaDispositivoId}`,
            periodoUsado: t.qtdPeriodo,
            periodoEsperado: periodo,
          })),
        },
      ),
    );
  }

  const naSoma = new Set(efetivos.map((t) => t.metaDispositivoId));
  const fora = [...metas.keys()].filter((id) => !naSoma.has(id) && demandaDe(id) !== 0);
  if (fora.length && !corrigirFaltantes) {
    diagnosticos.push(
      diagnostico(
        'dispositivos-fora-da-soma',
        `${fora.length} dispositivo(s) com demanda no período mas fora da soma.`,
        {
          itens: fora.map((id) => ({
            dispositivo: nomes.get(id) ?? `#${id}`,
            quantidade: demandaDe(id),
          })),
        },
      ),
    );
  }

  // --- a conta -------------------------------------------------------------

  let minutosTotais = 0;
  for (const t of efetivos) {
    const meta = Number(metas.get(t.metaDispositivoId) ?? 0);
    minutosTotais += meta * demandaDe(t.qtdDispositivoId, t.qtdPeriodo);
  }

  const horasTotais = minutosTotais / minutosPorHora;
  const horasPorOperador = diasUteis * (jornadaHoras - pausaHoras);

  if (horasPorOperador <= 0) {
    // A planilha devolve #DIV/0! aqui (é o caso de Planejamento Semanal!AR27).
    return {
      minutosTotais,
      horasTotais,
      horasPorOperador,
      operadoresFracionario: null,
      operadores: null,
      operadoresCalculado: null,
      erro: diasUteis <= 0 ? 'dias-uteis-zero' : 'jornada-zero',
      diagnosticos,
    };
  }

  let fracionario = horasTotais / horasPorOperador / coefEficiencia;

  const usarExcedente = aplicarExcedente || estaCorrigido('excedente-so-no-global');
  if (usarExcedente) fracionario = fracionario * (1 + coefExcedente);

  if (!usarExcedente) {
    diagnosticos.push(
      diagnostico(
        'excedente-so-no-global',
        `Sem folga de headcount neste cenário. Com o excedente de ` +
          `${(coefExcedente * 100).toFixed(0)}% seriam ` +
          `${Math.ceil(fracionario * (1 + coefExcedente) - 1e-9)} operadores.`,
      ),
    );
  }

  // ROUNDUP com folga de epsilon: nossa ordem de soma pode diferir da do Sheets e cair
  // do outro lado de um inteiro por erro de ponto flutuante.
  const arredondadoCalculado = Math.ceil(fracionario - 1e-9);

  // Fiel: nas colunas mensais o headcount é digitado à mão e não acompanha o cálculo.
  const usarManual = arredondadoManual !== null && !estaCorrigido('arredondado-manual');

  if (usarManual) {
    diagnosticos.push(
      diagnostico(
        'arredondado-manual',
        `Headcount exibido é o valor digitado (${arredondadoManual}); o cálculo daria ` +
          `${arredondadoCalculado}.`,
        { manual: Number(arredondadoManual), calculado: arredondadoCalculado },
      ),
    );
  }

  return {
    minutosTotais,
    horasTotais,
    horasPorOperador,
    operadoresFracionario: fracionario,
    operadores: usarManual ? Number(arredondadoManual) : arredondadoCalculado,
    operadoresCalculado: arredondadoCalculado,
    erro: null,
    diagnosticos,
  };
}

module.exports = { calcularOperadores };
