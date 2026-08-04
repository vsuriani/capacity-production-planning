'use strict';

const { corrigido, diagnostico } = require('./desvios');

/**
 * Distribui as horas de cada processo entre os operadores da linha.
 *
 * Porte de `dimensionamentoDeOperadores()` do EstudoPorOperador.gs. O processo pede
 * N operadores e cada um deles recebe a duração INTEGRAL do processo — o "Pç/Hr" da
 * base já é da equipe toda, então a duração é tempo de parede, não homem-hora.
 *
 * A escolha de quais N operadores recebem a carga segue três passadas, na ordem do
 * original:
 *   1. operadores ainda ociosos (0 h)
 *   2. quem está abaixo de 7,5 h — com um desvio para processo longo (> 7 h)
 *   3. o que sobrou, primeiro quem está abaixo de 8 h, depois qualquer um
 *
 * @param {object} entrada
 * @param {{diaProcesso: string, tempoHoras: number|null, operadores: number, feito: boolean,
 *          skuCodigo?: string, processoNome?: string}[]} entrada.linhas
 *        Em modo fiel, na mesma ordem em que estão gravadas (que não é ordem de data).
 * @param {number} entrada.qtdOperadores
 * @param {object} entrada.parametros  jornadaHoras, pausaHoras
 * @param {Record<string, boolean>} [entrada.correcoes]
 */
function alocarOperadores({ linhas, qtdOperadores, parametros, correcoes = {} }) {
  const estaCorrigido = corrigido(correcoes);
  const diagnosticos = [];

  const jornadaLiquida = parametros.jornadaHoras - parametros.pausaHoras;

  // Limiares literais do EstudoPorOperador.gs. Não derivam da jornada — são números
  // escritos à mão no script (tempo > 7, ocupação < 1, > 3, < 7.5, > 8) e a fidelidade
  // depende de mantê-los assim.
  const PROCESSO_LONGO = 7;
  const QUASE_OCIOSO = 1;
  const JA_CARREGADO = 3;
  const CABE_NA_JORNADA = 7.5;
  const JORNADA_CHEIA = 8;

  const corrigirDia = estaCorrigido('alocacao-dia-anterior');
  const respeitarFeito = estaCorrigido('check-feito-ignorado');

  const ordenadas = corrigirDia
    ? [...linhas].sort((a, b) => String(a.diaProcesso).localeCompare(String(b.diaProcesso)))
    : linhas;

  const porOperador = new Array(qtdOperadores).fill(0);
  const resultado = [];
  let ignoradasPorFeito = 0;

  const gravar = (dia) => {
    resultado.push({ data: dia, horas: [...porOperador] });
  };

  for (let i = 0; i < ordenadas.length; i++) {
    const linha = ordenadas[i];
    const anterior = i > 0 ? ordenadas[i - 1] : null;

    // Fiel: compara só o dia do mês (getDate()) e rotula o acumulado com o dia ANTERIOR.
    // Na primeira iteração o anterior é nulo, o que gera a linha vazia com zeros.
    const trocouDeDia = corrigirDia
      ? anterior === null || linha.diaProcesso !== anterior.diaProcesso
      : anterior === null || diaDoMes(linha.diaProcesso) !== diaDoMes(anterior.diaProcesso);

    if (trocouDeDia) {
      if (corrigirDia) {
        if (anterior !== null) gravar(anterior.diaProcesso);
      } else {
        gravar(anterior === null ? null : anterior.diaProcesso);
      }
      porOperador.fill(0);
    }

    if (linha.feito) {
      if (respeitarFeito) continue;
      ignoradasPorFeito++;
    }

    const necessarios = Math.min(Number(linha.operadores || 0), qtdOperadores);
    const tempo = Number(linha.tempoHoras);
    if (!Number.isFinite(tempo) || necessarios <= 0) continue;

    let atribuidos = 0;

    // Passada 1 — operadores ociosos.
    for (let k = 0; k < porOperador.length && atribuidos < necessarios; k++) {
      if (porOperador[k] === 0) {
        porOperador[k] = tempo;
        atribuidos++;
      }
    }

    // Passada 2 — quem cabe na jornada; processo longo evita quem já tem carga.
    for (let k = 0; k < porOperador.length && atribuidos < necessarios; k++) {
      if (tempo > PROCESSO_LONGO && porOperador[k] < QUASE_OCIOSO) {
        porOperador[k] += tempo;
        atribuidos++;
      } else if (tempo > PROCESSO_LONGO && porOperador[k] > JA_CARREGADO) {
        continue;
      } else if (porOperador[k] < CABE_NA_JORNADA) {
        porOperador[k] += tempo;
        atribuidos++;
      }
    }

    // Passada 3 — primeiro quem está abaixo da jornada cheia, depois qualquer um.
    for (let rodada = 0; rodada < 2 && atribuidos < necessarios; rodada++) {
      for (let k = 0; k < porOperador.length && atribuidos < necessarios; k++) {
        if (rodada === 0 && porOperador[k] > JORNADA_CHEIA) continue;
        porOperador[k] += tempo;
        atribuidos++;
      }
    }
  }

  // Fiel: o loop original termina sem flush, então o último dia nunca é gravado.
  if (corrigirDia && ordenadas.length > 0) {
    gravar(ordenadas[ordenadas.length - 1].diaProcesso);
  }

  // --- diagnósticos --------------------------------------------------------

  if (!corrigirDia) {
    const perdido = ordenadas.length > 0 ? ordenadas[ordenadas.length - 1].diaProcesso : null;
    diagnosticos.push(
      diagnostico(
        'alocacao-dia-anterior',
        `O acumulado é rotulado com o dia anterior, a primeira linha sai vazia e o último dia ` +
          `(${perdido ?? '—'}) não é gravado. A troca de dia também compara só o dia do mês, ` +
          `então 5/7 e 5/8 contam como o mesmo dia.`,
      ),
    );
  }

  if (!respeitarFeito) {
    diagnosticos.push(
      diagnostico(
        'check-feito-ignorado',
        ignoradasPorFeito > 0
          ? `${ignoradasPorFeito} processo(s) marcado(s) como feito continuam ocupando operador.`
          : 'Nenhum processo marcado como feito neste período, mas a exclusão não funcionaria.',
      ),
    );
  }

  if (parametros.jornadaHoras !== 8 || parametros.pausaHoras !== 0.5) {
    diagnosticos.push(
      diagnostico(
        'jornada-divergente',
        `Jornada em uso: ${jornadaLiquida} h líquidas (${parametros.jornadaHoras} − ` +
          `${parametros.pausaHoras}). A planilha usa 7,5 h nas fórmulas, 8 h na Base simplificada ` +
          `e 8,8 h no PlotarProjeção.`,
      ),
    );
  }

  return { alocacao: resultado, jornadaLiquida, diagnosticos };
}

function diaDoMes(iso) {
  return iso ? Number(String(iso).slice(8, 10)) : null;
}

module.exports = { alocarOperadores };
