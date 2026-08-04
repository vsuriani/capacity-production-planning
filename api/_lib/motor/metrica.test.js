'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { metricaDoDispositivo } = require('./metrica');
const { DESVIOS, POR_ID, validarCorrecoes } = require('./desvios');

const c = (rotulo, papel, valor) => ({ rotulo, papel, valor });

test('reproduz a composição do Smart Trac Ultra Ex (Global C4:C9)', () => {
  // =(C5+C6)+C7+(C8*(1-C9))
  const r = metricaDoDispositivo(
    [
      c('- Defasagem STU EX', 'aditivo', 1.12),
      c('- Montagem STU EX', 'aditivo', 4.39),
      c('- Bateria STU EX Gen1', 'aditivo', 6),
      c('- Retrabalho EX Gen1', 'retrabalho', 5),
      c('- FTR STU EX Gen1', 'ftr', 0.95),
    ],
    0.85,
  );

  // (1,12 + 4,39) + 6 + 5 × (1 − 0,95) = 11,76
  assert.ok(Math.abs(r.parcial - 11.76) < 1e-9, `parcial ${r.parcial}`);
  // 11,76 / 0,85 = 13,835294117647059 — o valor que a planilha exibe em D4
  assert.ok(Math.abs(r.real - 13.83529411764706) < 1e-9, `real ${r.real}`);
});

test('reproduz o Smart Receiver Ultra, que não tem bateria (Global C10:C14)', () => {
  // =(C12+C11)+(C13*(1-C14))
  const r = metricaDoDispositivo(
    [
      c('- Defasagem SRU Gen1', 'aditivo', 12.84),
      c('- Montagem SRU Gen1', 'aditivo', 20.04),
      c('- Retrabalho SRU Gen1', 'retrabalho', 15),
      c('- FTR SRU Gen1', 'ftr', 0.9),
    ],
    0.85,
  );

  // 12,84 + 20,04 + 15 × 0,10 = 34,38
  assert.ok(Math.abs(r.parcial - 34.38) < 1e-9, `parcial ${r.parcial}`);
});

test('reproduz o OEE Trac, que tem o componente "Garra" (Global C42:C46)', () => {
  // =(C44+C43)+(C45*(1-C46)) — "Garra OEE Trac" é aditivo, fora dos 5 nomes usuais.
  const r = metricaDoDispositivo(
    [
      c('- Montagem OEE Trac', 'aditivo', 4.1),
      c('- Garra OEE Trac', 'aditivo', 15.1),
      c('- Retrabalho OEE Trac', 'retrabalho', 4),
      c('- FTR OEE Trac', 'ftr', 0.9),
    ],
    0.85,
  );

  // 4,1 + 15,1 + 4 × 0,10 = 19,6
  assert.ok(Math.abs(r.parcial - 19.6) < 1e-9, `parcial ${r.parcial}`);
});

test('FTR 1 zera a contribuição do retrabalho', () => {
  const r = metricaDoDispositivo(
    [c('m', 'aditivo', 5), c('r', 'retrabalho', 10), c('f', 'ftr', 1)],
    1,
  );
  assert.equal(r.parcial, 5);
});

test('FTR 0 faz o retrabalho entrar inteiro', () => {
  const r = metricaDoDispositivo(
    [c('m', 'aditivo', 5), c('r', 'retrabalho', 10), c('f', 'ftr', 0)],
    1,
  );
  assert.equal(r.parcial, 15);
});

test('sem FTR declarado o retrabalho entra inteiro', () => {
  const r = metricaDoDispositivo([c('m', 'aditivo', 5), c('r', 'retrabalho', 2)], 1);
  assert.equal(r.parcial, 7);
});

test('coeficiente de eficiência zero não divide por zero', () => {
  const r = metricaDoDispositivo([c('m', 'aditivo', 5)], 0);
  assert.equal(r.real, null);
});

test('papel desconhecido é erro, não silêncio', () => {
  assert.throws(
    () => metricaDoDispositivo([c('x', 'bateria', 1)], 0.85),
    /papel de componente desconhecido/,
  );
});

// ---------------------------------------------------------------- registro

test('todo desvio tem os campos que a UI precisa', () => {
  assert.ok(DESVIOS.length >= 12, `esperava 12+ desvios, tem ${DESVIOS.length}`);
  for (const d of DESVIOS) {
    for (const campo of ['id', 'titulo', 'aba', 'planilha', 'correcao', 'impacto']) {
      assert.ok(d[campo], `desvio ${d.id} sem ${campo}`);
    }
    assert.equal(POR_ID.get(d.id), d);
  }
});

test('ids de desvio são únicos', () => {
  const ids = DESVIOS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('validarCorrecoes rejeita chave desconhecida', () => {
  assert.doesNotThrow(() => validarCorrecoes({ 'pares-desalinhados': true }));
  assert.doesNotThrow(() => validarCorrecoes({}));
  assert.doesNotThrow(() => validarCorrecoes(null));
  assert.throws(() => validarCorrecoes({ 'pares-desalinhado': true }), /desvio desconhecido/);
});
