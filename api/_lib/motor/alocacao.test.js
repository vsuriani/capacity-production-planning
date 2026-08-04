'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { alocarOperadores } = require('./alocacao');

const PARAMETROS = { jornadaHoras: 8, pausaHoras: 0.5 };

const linha = (dia, tempo, operadores, feito = false) => ({
  diaProcesso: dia,
  tempoHoras: tempo,
  operadores,
  feito,
});

function alocar(linhas, correcoes = {}, qtdOperadores = 4) {
  return alocarOperadores({ linhas, qtdOperadores, parametros: PARAMETROS, correcoes });
}

// ---------------------------------------------------------------- distribuição

test('cada operador do processo recebe a duração integral, não a fração', () => {
  // O Pç/Hr da base já é da equipe toda, então o tempo é de parede.
  const { alocacao } = alocar(
    [linha('2026-07-06', 4, 2), linha('2026-07-07', 1, 1)],
    { 'alocacao-dia-anterior': true },
  );

  const dia6 = alocacao.find((a) => a.data === '2026-07-06');
  assert.deepEqual(dia6.horas, [4, 4, 0, 0], 'dois operadores com 4 h cada, não 2 h');
});

test('passada 1 prioriza operadores ociosos', () => {
  const { alocacao } = alocar(
    [linha('2026-07-06', 3, 2), linha('2026-07-06', 2, 2)],
    { 'alocacao-dia-anterior': true },
  );

  const dia = alocacao.find((a) => a.data === '2026-07-06');
  assert.deepEqual(dia.horas, [3, 3, 2, 2], 'o segundo processo pega os dois que estavam a zero');
});

test('depois de todos ocupados, empilha em quem cabe na jornada', () => {
  const { alocacao } = alocar(
    [linha('2026-07-06', 2, 4), linha('2026-07-06', 3, 2)],
    { 'alocacao-dia-anterior': true },
  );

  const dia = alocacao.find((a) => a.data === '2026-07-06');
  assert.deepEqual(dia.horas, [5, 5, 2, 2]);
});

test('não aloca mais operadores do que a linha tem', () => {
  const { alocacao } = alocar([linha('2026-07-06', 2, 10)], { 'alocacao-dia-anterior': true }, 4);

  const dia = alocacao.find((a) => a.data === '2026-07-06');
  assert.equal(dia.horas.length, 4);
  assert.deepEqual(dia.horas, [2, 2, 2, 2]);
});

test('tempo infinito é ignorado em vez de contaminar a alocação', () => {
  const { alocacao } = alocar(
    [linha('2026-07-06', Infinity, 2), linha('2026-07-06', 3, 1)],
    { 'alocacao-dia-anterior': true },
  );

  const dia = alocacao.find((a) => a.data === '2026-07-06');
  for (const h of dia.horas) assert.ok(Number.isFinite(h));
  assert.deepEqual(dia.horas, [3, 0, 0, 0]);
});

// ---------------------------------------------------------------- desvios

test('fiel: rotula o acumulado com o dia anterior, primeira linha vazia', () => {
  const { alocacao, diagnosticos } = alocar([
    linha('2026-07-06', 4, 2),
    linha('2026-07-07', 2, 1),
  ]);

  // Primeiro flush: diaAnterior é null e o vetor está zerado.
  assert.equal(alocacao[0].data, null);
  assert.deepEqual(alocacao[0].horas, [0, 0, 0, 0]);

  // Segundo flush: carga do dia 06 gravada sob o rótulo 06 (o dia anterior à linha atual).
  assert.equal(alocacao[1].data, '2026-07-06');
  assert.deepEqual(alocacao[1].horas, [4, 4, 0, 0]);

  // O dia 07 nunca é gravado — o loop termina sem flush.
  assert.equal(alocacao.length, 2);
  assert.ok(!alocacao.some((a) => a.data === '2026-07-07'), 'último dia perdido');

  const desvio = diagnosticos.find((d) => d.id === 'alocacao-dia-anterior');
  assert.ok(desvio);
  assert.match(desvio.detalhe, /2026-07-07/);
});

test('corrigido: grava sob o próprio dia e não perde o último', () => {
  const { alocacao, diagnosticos } = alocar(
    [linha('2026-07-06', 4, 2), linha('2026-07-07', 2, 1)],
    { 'alocacao-dia-anterior': true },
  );

  assert.deepEqual(
    alocacao.map((a) => a.data),
    ['2026-07-06', '2026-07-07'],
  );
  assert.deepEqual(alocacao[0].horas, [4, 4, 0, 0]);
  assert.deepEqual(alocacao[1].horas, [2, 0, 0, 0]);
  assert.equal(diagnosticos.find((d) => d.id === 'alocacao-dia-anterior'), undefined);
});

test('fiel: troca de dia compara só o dia do mês, então 06/07 e 06/08 se fundem', () => {
  const { alocacao } = alocar([
    linha('2026-07-06', 3, 1),
    linha('2026-08-06', 3, 1), // mesmo dia do mês, mês diferente
  ]);

  // Só houve um flush (o inicial), porque o script não detectou troca de dia.
  assert.equal(alocacao.length, 1);
  assert.equal(alocacao[0].data, null);
});

test('corrigido: datas diferentes viram dias diferentes', () => {
  const { alocacao } = alocar(
    [linha('2026-07-06', 3, 1), linha('2026-08-06', 3, 1)],
    { 'alocacao-dia-anterior': true },
  );

  assert.deepEqual(
    alocacao.map((a) => a.data),
    ['2026-07-06', '2026-08-06'],
  );
});

test('fiel: processo marcado como feito continua ocupando operador', () => {
  const { alocacao, diagnosticos } = alocar(
    [linha('2026-07-06', 5, 2, true), linha('2026-07-07', 1, 1)],
    { 'alocacao-dia-anterior': true },
  );

  const dia = alocacao.find((a) => a.data === '2026-07-06');
  assert.deepEqual(dia.horas, [5, 5, 0, 0], 'as 5 h do processo feito continuam alocadas');

  const desvio = diagnosticos.find((d) => d.id === 'check-feito-ignorado');
  assert.ok(desvio);
  assert.match(desvio.detalhe, /1 processo/);
});

test('corrigido: processo feito não consome hora', () => {
  const { alocacao, diagnosticos } = alocar(
    [linha('2026-07-06', 5, 2, true), linha('2026-07-06', 2, 1)],
    { 'alocacao-dia-anterior': true, 'check-feito-ignorado': true },
  );

  const dia = alocacao.find((a) => a.data === '2026-07-06');
  assert.deepEqual(dia.horas, [2, 0, 0, 0]);
  assert.equal(diagnosticos.find((d) => d.id === 'check-feito-ignorado'), undefined);
});

test('jornada fora do padrão 8/0,5 aparece no diagnóstico', () => {
  const semAviso = alocarOperadores({
    linhas: [linha('2026-07-06', 2, 1)],
    qtdOperadores: 2,
    parametros: { jornadaHoras: 8, pausaHoras: 0.5 },
    correcoes: { 'alocacao-dia-anterior': true, 'check-feito-ignorado': true },
  });
  assert.equal(semAviso.diagnosticos.find((d) => d.id === 'jornada-divergente'), undefined);

  const comAviso = alocarOperadores({
    linhas: [linha('2026-07-06', 2, 1)],
    qtdOperadores: 2,
    parametros: { jornadaHoras: 8.8, pausaHoras: 0 },
    correcoes: { 'alocacao-dia-anterior': true, 'check-feito-ignorado': true },
  });
  const desvio = comAviso.diagnosticos.find((d) => d.id === 'jornada-divergente');
  assert.ok(desvio, 'a jornada de 8,8 h do PlotarProjeção deveria ser sinalizada');
  assert.equal(comAviso.jornadaLiquida, 8.8);
});

test('lista vazia não quebra', () => {
  const { alocacao } = alocar([], { 'alocacao-dia-anterior': true });
  assert.deepEqual(alocacao, []);
});
