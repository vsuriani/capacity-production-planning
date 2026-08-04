'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  somarDias,
  diaDaSemana,
  puxarParaSexta,
  diaDefasagemFiel,
  subtrairDiasUteis,
  diaDoProcesso,
  gradeDoMes,
  loteDaData,
} = require('./calendario');

// Julho/2026 como referência (é o mês ativo na Projeção das linhas):
// 2026-07-06 é segunda, 07 terça, 08 quarta, 09 quinta, 10 sexta, 11 sábado, 12 domingo.
const SEGUNDA = '2026-07-06';
const TERCA = '2026-07-07';
const QUARTA = '2026-07-08';
const QUINTA = '2026-07-09';
const SEXTA = '2026-07-10';

test('dia da semana é calculado em UTC, sem depender do fuso da máquina', () => {
  assert.equal(diaDaSemana(SEGUNDA), 1);
  assert.equal(diaDaSemana(TERCA), 2);
  assert.equal(diaDaSemana(QUARTA), 3);
  assert.equal(diaDaSemana('2026-07-11'), 6);
  assert.equal(diaDaSemana('2026-07-12'), 0);
});

test('puxarParaSexta: sábado volta 1 dia, domingo volta 2', () => {
  assert.equal(puxarParaSexta('2026-07-11'), SEXTA);
  assert.equal(puxarParaSexta('2026-07-12'), SEXTA);
  assert.equal(puxarParaSexta(QUARTA), QUARTA, 'dia útil não muda');
});

test('somarDias atravessa a virada de mês', () => {
  assert.equal(somarDias('2026-07-31', 1), '2026-08-01');
  assert.equal(somarDias('2026-07-01', -1), '2026-06-30');
  assert.equal(somarDias('2026-03-01', -1), '2026-02-28');
});

// ------------------------------------------------------- os 8 ramos do Código.gs

test('ramo 1 — segunda com leadtime 2 volta 2 dias e cai na sexta anterior', () => {
  // 06/07 − 2 = 04/07 (sábado) -> puxa para 03/07 (sexta)
  assert.equal(diaDefasagemFiel(SEGUNDA, 2), '2026-07-03');
});

test('ramo 2 — terça com leadtime 2 volta apenas 1 dia', () => {
  assert.equal(diaDefasagemFiel(TERCA, 2), SEGUNDA);
});

test('ramo 3 — segunda/terça com leadtime >= 3 voltam leadtime + 1', () => {
  // 06/07 − 4 = 02/07 (quinta)
  assert.equal(diaDefasagemFiel(SEGUNDA, 3), '2026-07-02');
  // 07/07 − 4 = 03/07 (sexta)
  assert.equal(diaDefasagemFiel(TERCA, 3), '2026-07-03');
});

test('ramo 4 — leadtime 1 é o próprio dia (testado DEPOIS dos ramos de seg/ter)', () => {
  assert.equal(diaDefasagemFiel(QUARTA, 1), QUARTA);
  assert.equal(diaDefasagemFiel(SEGUNDA, 1), SEGUNDA);
});

test('ramo 5 — quarta com leadtime 5 volta 6 dias', () => {
  // 08/07 − 6 = 02/07 (quinta)
  assert.equal(diaDefasagemFiel(QUARTA, 5), '2026-07-02');
});

test('ramo 6 — quarta com leadtime 2 ou 3 volta leadtime − 1', () => {
  assert.equal(diaDefasagemFiel(QUARTA, 2), TERCA);
  assert.equal(diaDefasagemFiel(QUARTA, 3), SEGUNDA);
});

test('ramo 7 — quinta em diante com leadtime < 4 volta leadtime − 1', () => {
  assert.equal(diaDefasagemFiel(QUINTA, 3), TERCA);
  assert.equal(diaDefasagemFiel(SEXTA, 2), QUINTA);
});

test('ramo 8 (else) — quarta com leadtime 4 não casa com nenhum ramo específico', () => {
  // Cai no else: 08/07 − 4 = 04/07 (sábado) -> puxa para 03/07 (sexta).
  // É a combinação que o Código.gs esqueceu de tratar.
  assert.equal(diaDefasagemFiel(QUARTA, 4), '2026-07-03');
});

// ------------------------------------------------------- dias úteis de verdade

test('subtrairDiasUteis pula fim de semana', () => {
  // leadtime 1 = mesmo dia; 2 = um dia útil antes.
  assert.equal(subtrairDiasUteis(SEGUNDA, 1), SEGUNDA);
  assert.equal(subtrairDiasUteis(SEGUNDA, 2), '2026-07-03');
  assert.equal(subtrairDiasUteis(SEGUNDA, 3), '2026-07-02');
  assert.equal(subtrairDiasUteis(QUARTA, 4), SEXTA.replace('10', '03'));
});

test('subtrairDiasUteis pula feriado', () => {
  const feriados = new Set(['2026-07-09']); // quinta
  assert.equal(subtrairDiasUteis(SEXTA, 2, feriados), QUARTA);
});

test('subtrairDiasUteis normaliza data que cai no fim de semana', () => {
  assert.equal(subtrairDiasUteis('2026-07-11', 1), SEXTA);
  assert.equal(subtrairDiasUteis('2026-07-12', 1), SEXTA);
});

test('diaDoProcesso escolhe a implementação pela correção do cenário', () => {
  const fiel = diaDoProcesso(QUARTA, 4, {});
  const corrigido = diaDoProcesso(QUARTA, 4, { 'leadtime-caso-a-caso': true });

  assert.equal(fiel, '2026-07-03', 'fiel: cai no else e vira sexta da semana anterior');
  assert.equal(corrigido, '2026-07-03', '4 dias úteis antes de 08/07 também é 03/07');

  // Onde as duas divergem: segunda com leadtime 2.
  assert.equal(diaDoProcesso(SEGUNDA, 2, {}), '2026-07-03');
  assert.equal(diaDoProcesso(SEGUNDA, 2, { 'leadtime-caso-a-caso': true }), '2026-07-03');

  // Terça com leadtime 2: fiel volta 1 dia, dias úteis também. Já leadtime 3 diverge:
  assert.equal(diaDoProcesso(TERCA, 3, {}), '2026-07-03', 'fiel volta leadtime+1');
  assert.equal(
    diaDoProcesso(TERCA, 3, { 'leadtime-caso-a-caso': true }),
    '2026-07-03',
    '2 dias úteis antes de terça é sexta',
  );
});

test('as duas implementações divergem em pelo menos uma combinação real', () => {
  const divergentes = [];
  for (const dia of ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10']) {
    for (let lt = 1; lt <= 6; lt++) {
      if (diaDefasagemFiel(dia, lt) !== subtrairDiasUteis(dia, lt)) {
        divergentes.push({ dia, lt, fiel: diaDefasagemFiel(dia, lt), util: subtrairDiasUteis(dia, lt) });
      }
    }
  }
  assert.ok(divergentes.length > 0, 'as regras caso-a-caso deveriam divergir de dias úteis');
});

// ------------------------------------------------------- grade e lote

test('gradeDoMes começa na primeira segunda-feira e tem 5 semanas de 6 dias', () => {
  const semanas = gradeDoMes(7, 2026);

  assert.equal(semanas.length, 5);
  for (const s of semanas) assert.equal(s.dias.length, 6);

  // Julho/2026: dia 2 é quinta, então a primeira segunda da grade é 29/06.
  assert.equal(semanas[0].dias[0], '2026-06-29');
  assert.equal(diaDaSemana(semanas[0].dias[0]), 1, 'começa numa segunda');
  assert.equal(semanas[0].dias[5], '2026-07-04', 'sexto dia é sábado');
  assert.equal(diaDaSemana(semanas[0].dias[5]), 6);

  // A semana seguinte pula o domingo.
  assert.equal(semanas[1].dias[0], '2026-07-06');
  for (const s of semanas) for (const d of s.dias) assert.notEqual(diaDaSemana(d), 0);
});

test('gradeDoMes quando o dia 2 já é segunda', () => {
  // Março/2026: dia 2 é segunda-feira.
  const semanas = gradeDoMes(3, 2026);
  assert.equal(semanas[0].dias[0], '2026-03-02');
  assert.equal(diaDaSemana('2026-03-02'), 1);
});

test('loteDaData reproduz o formato #yyyyMMdd', () => {
  assert.equal(loteDaData('2026-07-01'), '#20260701');
  assert.equal(loteDaData('2026-07-08'), '#20260708');
});
