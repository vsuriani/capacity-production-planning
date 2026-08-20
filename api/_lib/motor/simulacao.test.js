'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { dimensionarDia } = require('./simulacao');

const JORNADA = 7.5; // 8 h − 0,5 h de pausa, os parâmetros default
const CAPACIDADE = 8; // projecao.qtd_operadores de Agosto/2026

const linha = (tempoHoras, operadores) => ({ tempoHoras, operadores });

const dimensionar = (linhas, capacidade = CAPACIDADE) =>
  dimensionarDia({ linhas, jornadaLiquida: JORNADA, capacidade });

// ---------------------------------------------------------------- carga

test('dia sem demanda não exige ninguém', () => {
  const d = dimensionar([]);
  assert.equal(d.estado, 'vazio');
  assert.equal(d.operadoresMinimo, 0);
  assert.equal(d.homemHora, 0);
});

test('homem-hora é duração × operadores, não a duração dividida', () => {
  // O Pç/hr da base é da equipe toda: 2 h com 3 operadores custa 6 h de gente, não 2.
  const d = dimensionar([linha(2, 3)]);
  assert.equal(d.horasParede, 2);
  assert.equal(d.homemHora, 6);
});

test('o mínimo respeita o tamanho da equipe do processo, não só as horas', () => {
  // 6 homem-hora caberiam em 1 operador de 7,5 h, mas o processo pede 3 ao mesmo tempo.
  const d = dimensionar([linha(2, 3)]);
  assert.equal(d.operadoresMinimo, 3);
  assert.equal(d.operadoresEmpacotado, 3);
  assert.equal(d.estado, 'ok');
});

test('linha sem tempo estimado não vira processo de duração zero', () => {
  // Number(null) é 0 e passaria batido no isFinite; tem que ficar de fora e ser contada.
  const d = dimensionar([linha(null, 3), linha(2, 3)]);
  assert.equal(d.semTempo, 1);
  assert.equal(d.linhas, 2);
  assert.equal(d.homemHora, 6, 'só a linha com tempo entra na conta');
});

test('tempo infinito (o "sem taxa" fiel à planilha) também fica fora da conta', () => {
  const d = dimensionar([linha(Infinity, 2), linha(1, 1)]);
  assert.equal(d.semTempo, 1);
  assert.equal(d.homemHora, 1);
});

// ---------------------------------------------------------------- dimensionamento

test('o 14/08 de Agosto/2026 é impossível como a geração o montou', () => {
  // As 9 linhas reais do pior dia do mês, direto do cenário mensal de Agosto/2026.
  const dia14 = [
    linha(2.6316, 3), // PROD-0050 Colar imã e o adesivo no suporte externo
    linha(2.6316, 3), // PROD-0050 Colar imã e o adesivo no suporte externo
    linha(0.6667, 2), // PROD-0050 Colocar o grommet e gasket na tampa menor
    linha(2, 2), //     PROD-0050 Encapsular varistor, colar supercap e colocar chip
    linha(1.087, 2), // PROD-0050 Preparar cabo de alimentação
    linha(4, 3), //     PROD-0050 Resinar PCB e Ligth pipe na case - Primeira Etapa
    linha(4, 3), //     PROD-0050 Resinar PCB e Ligth pipe na case - Primeira Etapa
    linha(8, 4), //     PROD-0048 Processo de montar completo
    linha(8, 4), //     PROD-0048 Processo de montar completo
  ];
  const d = dimensionar(dia14);

  assert.equal(d.linhas, 9);
  assert.ok(Math.abs(d.homemHora - 111.297) < 0.001, `homem-hora foi ${d.homemHora}`);
  assert.equal(d.operadoresMinimo, 15, 'ceil(111,297 / 7,5) — quase o dobro dos 8 da linha');

  // E ainda assim 15 operadores não resolvem: os dois "montar completo" duram 8 h cada,
  // acima da jornada líquida de 7,5 h. Nenhum N conserta um processo longo demais — ou ele
  // vira hora extra, ou é partido em dois dias.
  assert.equal(d.naoCabem, 2);
  assert.equal(d.operadoresEmpacotado, null);
  assert.equal(d.estado, 'impossivel');
});

test('processo mais longo que a jornada é impossível, por mais gente que se jogue', () => {
  const d = dimensionar([linha(8, 2)]);
  assert.equal(d.naoCabem, 1);
  assert.equal(d.operadoresEmpacotado, null);
  assert.equal(d.estado, 'impossivel');
});

test('dia que cabe na linha é ok; o mesmo dia numa linha menor é estourado', () => {
  const dia = [linha(3, 2), linha(2, 2)];

  assert.equal(dimensionar(dia, 8).estado, 'ok');
  assert.equal(dimensionar(dia, 1).estado, 'estourado');
});

test('ocupação alta sem estourar a linha é "apertado"', () => {
  // 7 h × 7 operadores = 49 homem-hora; a linha de 8 tem 60 h, ocupação 82%… não basta.
  // Com 7,4 h × 7 = 51,8, ocupação 86%: apertado, mas ainda cabe.
  const d = dimensionar([linha(7.4, 7)]);
  assert.ok(d.ocupacao >= 0.85, `ocupação foi ${d.ocupacao}`);
  assert.equal(d.estado, 'apertado');
});

test('o empacotado sai do mesmo empacotador do heat map, e cabe na jornada', () => {
  // Quatro processos de 4 h pedindo 2 operadores cada: 32 homem-hora, mínimo 5 pela conta.
  // O empacotador pode precisar de mais, porque ninguém pode ficar com 3 × 4 h.
  const d = dimensionar([linha(4, 2), linha(4, 2), linha(4, 2), linha(4, 2)], 12);
  assert.equal(d.operadoresMinimo, 5);
  assert.ok(d.operadoresEmpacotado !== null, 'tem que achar um N que cabe');
  assert.ok(
    d.operadoresEmpacotado >= d.operadoresMinimo,
    `empacotado ${d.operadoresEmpacotado} < mínimo ${d.operadoresMinimo}`,
  );
});
