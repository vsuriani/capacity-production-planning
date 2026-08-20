'use strict';

const { alocarOperadores } = require('./alocacao');

/**
 * Dimensionamento de um dia da Simulação Ideal.
 *
 * A pergunta que a tela faz é "de quanta gente esse dia precisa?", que não é a mesma que o
 * heat map responde. O heat map fixa a linha em N operadores e mostra como a carga se
 * espalha; aqui N é a incógnita.
 *
 * Duas leituras da carga, e elas não são intercambiáveis:
 *   - `horasParede`: a soma das durações. É quanto tempo de relógio os processos ocupam se
 *     rodarem um atrás do outro — serve para ver que um dia com 33 h não cabe em 7,5 h de
 *     jornada por mais operador que se jogue nele.
 *   - `homemHora`: Σ(duração × operadores). É o consumo de gente. `alocacao.js` documenta que
 *     o processo pede N operadores e **cada um recebe a duração integral** — o Pç/hr da base
 *     já é da equipe toda, então a duração é tempo de parede, não homem-hora dividida.
 *
 * O número de operadores sai do MESMO empacotador de 3 passadas do heat map
 * (`alocarOperadores`), rodado com N crescente até ninguém passar da jornada. Reusar o
 * empacotador em vez de fazer uma conta paralela é o que garante que a simulação e o
 * Dimensionamento de operadores não discordem.
 */

/**
 * @param {object} entrada
 * @param {{tempoHoras: number|null, operadores: number}[]} entrada.linhas  as demandas do dia
 * @param {number} entrada.jornadaLiquida  jornadaHoras − pausaHoras
 * @param {number} entrada.capacidade      operadores que a linha tem hoje (projecao.qtd_operadores)
 */
function dimensionarDia({ linhas, jornadaLiquida, capacidade }) {
  // `!== null` explícito: Number(null) é 0, que passaria no isFinite e contaria como um
  // processo de duração zero. Infinity (o "sem taxa" fiel à planilha) cai fora sozinho.
  const validas = linhas.filter(
    (l) => l.tempoHoras !== null && l.tempoHoras !== undefined && Number.isFinite(Number(l.tempoHoras)),
  );

  let horasParede = 0;
  let homemHora = 0;
  let maiorEquipe = 0;
  let naoCabem = 0;

  for (const l of validas) {
    const tempo = Number(l.tempoHoras);
    const operadores = Math.max(0, Number(l.operadores || 0));
    horasParede += tempo;
    homemHora += tempo * operadores;
    maiorEquipe = Math.max(maiorEquipe, operadores);
    if (tempo > jornadaLiquida) naoCabem++;
  }

  if (validas.length === 0 || homemHora === 0) {
    return {
      linhas: linhas.length,
      semTempo: linhas.length - validas.length,
      horasParede: 0,
      homemHora: 0,
      operadoresMinimo: 0,
      operadoresEmpacotado: 0,
      naoCabem: 0,
      ocupacao: 0,
      estado: 'vazio',
    };
  }

  // Piso teórico: nem menos gente do que a hora exige, nem menos do que o maior processo
  // do dia pede de uma vez só. O epsilon é o mesmo do motor — a ordem da soma pode cair do
  // outro lado de um inteiro.
  const operadoresMinimo = Math.max(
    Math.ceil(homemHora / jornadaLiquida - 1e-9),
    maiorEquipe,
  );

  // Se um processo sozinho já estoura a jornada, não existe N que resolva: o problema é a
  // duração dele, não a falta de gente.
  const operadoresEmpacotado =
    naoCabem > 0 ? null : menorQueCabe(validas, jornadaLiquida, operadoresMinimo);

  const ocupacao = capacidade > 0 ? homemHora / (capacidade * jornadaLiquida) : Infinity;
  const exigido = operadoresEmpacotado ?? operadoresMinimo;

  let estado;
  if (naoCabem > 0 || operadoresEmpacotado === null) estado = 'impossivel';
  else if (exigido > capacidade) estado = 'estourado';
  else if (ocupacao >= 0.85) estado = 'apertado';
  else estado = 'ok';

  return {
    linhas: linhas.length,
    semTempo: linhas.length - validas.length,
    horasParede,
    homemHora,
    operadoresMinimo,
    operadoresEmpacotado,
    naoCabem,
    ocupacao,
    estado,
  };
}

/**
 * Menor N em que o empacotador do heat map acomoda o dia dentro da jornada.
 *
 * As 3 passadas de `alocarOperadores` são heurística, não ótimo — por isso a busca é linear
 * de baixo para cima e não uma divisão pela jornada: o primeiro N que couber é o que a linha
 * de verdade vai conseguir usar. `alocacao-dia-anterior` ligado põe a função em modo
 * corrigido, onde ela devolve uma entrada por dia de verdade, sem a linha-fantasma da
 * planilha e sem perder o último dia.
 *
 * O teto é a soma dos operadores pedidos no dia, e não um número escolhido a dedo: com essa
 * gente toda a passada 1 dá um operador ocioso para cada posto, ninguém acumula dois
 * processos, e o pico vira a maior duração — que já sabemos caber (`naoCabem === 0`). Ou
 * seja, a busca termina.
 */
function menorQueCabe(linhas, jornadaLiquida, minimo) {
  const doDia = linhas.map((l) => ({
    diaProcesso: '2000-01-01',
    tempoHoras: Number(l.tempoHoras),
    operadores: Math.max(0, Number(l.operadores || 0)),
    feito: false,
  }));
  const teto = Math.max(minimo, doDia.reduce((s, l) => s + l.operadores, 0));

  for (let n = Math.max(1, minimo); n <= teto; n++) {
    const { alocacao } = alocarOperadores({
      linhas: doDia,
      qtdOperadores: n,
      parametros: { jornadaHoras: jornadaLiquida, pausaHoras: 0 },
      correcoes: { 'alocacao-dia-anterior': true },
    });
    const horas = alocacao[0]?.horas ?? [];
    if (horas.every((h) => h <= jornadaLiquida + 1e-9)) return n;
  }
  return null;
}

module.exports = { dimensionarDia };
