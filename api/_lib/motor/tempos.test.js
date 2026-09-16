'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { agregarTempos, normalizar, ehRollup, tipoDe } = require('./tempos');
const fixture = require('./tempos.fixture.json');

/**
 * A regra: o tempo-padrão de um dispositivo é a SOMA dos processos do device model, com a linha
 * "Processo de montar completo" FORA — ela é um rollup do que as outras já detalham.
 *
 * O que trava a regra aqui não é um número escolhido: é a coincidência interna da planilha. Em
 * Omni Trac e Omni Receiver o rollup vale exatamente a soma das linhas de detalhe, o que só
 * acontece se ele for de fato um rollup. E Garra Uni Trac, que não tem rollup e por isso é
 * imune à escolha, reproduz o `meta_padrao` que já estava no cadastro.
 */
const DE_PARA = [
  ['Energy Trac', 'Energy Trac'],
  ['Smart Trac Ultra Ex', 'Smart Trac Ultra Ex'],
  ['Smart Receiver Ultra', 'Smart Receiver Ultra'],
  ['Smart Trac Ultra Gen 2', 'Smart Trac Ultra Gen 2'],
  ['Smart Trac Ultra Gen 2 Ex', 'Smart Trac Ultra Gen 2 EX'],
  ['Omni Trac', 'Omni Trac'],
  ['Omni Receiver', 'Omni Receiver'],
  ['Uni Trac', 'Uni Trac'],
  ['OEE Trac', 'Uni Trac 2.0'],
  ['Garra OEE', 'Garra Uni Trac'],
  ['Smart Trac Ultra', 'Smart Trac Ultra Gen 1'],
];

const dePara = () =>
  new Map(DE_PARA.map(([dm, nome], i) => [normalizar(dm), { id: i + 1, nome }]));

const dispositivosAtivos = () => DE_PARA.map(([, nome], i) => ({ id: i + 1, nome }));

const agregar = (extra = {}) =>
  agregarTempos({
    atividades: fixture.atividades,
    dePara: dePara(),
    dispositivosAtivos: dispositivosAtivos(),
    ...extra,
  });

const doDispositivo = (resultado, nome) => resultado.find((r) => r.dispositivo === nome);
const q = (n) => Number(n.toFixed(2));

// ---------------------------------------------------------------- normalização

test('normalizar tira acento, caixa e espaço em excesso', () => {
  assert.equal(normalizar('Industrialização'), 'industrializacao');
  assert.equal(normalizar('  Produção  '), 'producao');
  assert.equal(normalizar('Smart Trac Ultra Gen 2 Ex'), 'smart trac ultra gen 2 ex');
});

test('tipoDe mapeia os três process_type e trata o vazio', () => {
  assert.equal(tipoDe('Defasagem'), 'defasagem');
  assert.equal(tipoDe('Industrialização'), 'industrializacao');
  assert.equal(tipoDe('Produção'), 'producao');
  assert.equal(tipoDe(''), null);
  assert.equal(tipoDe(null), null);
});

test('o rollup é achado pelo nome, não pelo tipo', () => {
  // Omni Trac e Omni Receiver têm "Processo de montar completo" com process_type EM BRANCO.
  // Se a exclusão fosse por tipo, os dois entrariam na soma e dobrariam o tempo.
  assert.equal(ehRollup('Processo de montar completo'), true);
  assert.equal(ehRollup('Montar completo'), true);
  assert.equal(ehRollup('Limpar case'), false);
});

// ---------------------------------------------------------------- a regra

test('o rollup fica fora da soma', () => {
  const { resumo } = agregar();
  assert.equal(resumo.descartadas.rollup, 8, '8 linhas "montar completo" na planilha');
});

test('onde a decomposição está completa, o rollup vale a soma do detalhe', () => {
  // A prova de que a linha É um rollup — e, portanto, de que somá-la dobraria o tempo.
  // O total já exclui o rollup, então bater com ele é a própria demonstração.
  const { resultado } = agregar();

  assert.equal(q(doDispositivo(resultado, 'Omni Trac').total), 12.08);
  assert.equal(q(doDispositivo(resultado, 'Omni Receiver').total), 16.47);

  const rollups = new Map(
    fixture.atividades
      .filter((a) => ehRollup(a.processo) && !a.obsoleta)
      .map((a) => [a.deviceModel, a.goal]),
  );
  assert.equal(rollups.get('Omni Trac'), 12.08);
  assert.equal(rollups.get('Omni Receiver'), 16.47);
});

test('Garra Uni Trac ancora a regra: não tem rollup e reproduz o cadastro', () => {
  // Imune à decisão de incluir ou excluir o rollup, porque não tem um. meta_padrao = 15,30.
  const { resultado } = agregar();
  assert.equal(q(doDispositivo(resultado, 'Garra Uni Trac').total), 15.34);
});

test('Smart Trac Ultra Ex chega perto do cadastro: 4,17 contra 4,40', () => {
  // −5,2%. Não é exato como Garra, mas é a segunda melhor corroboração da regra: qualquer outra
  // agregação erra por muito mais (somando o rollup dá 6,35, +44%).
  const { resultado } = agregar();
  assert.equal(q(doDispositivo(resultado, 'Smart Trac Ultra Ex').total), 4.17);
});

test('os recortes por tipo somam o total quando toda linha tem process_type', () => {
  // defasagem/industrializacao/producao são recortes DENTRO do total, não parcelas a somar por
  // fora. Onde nenhuma linha está sem tipo, os três têm de fechar exatamente com o total.
  const { resultado, pendencias } = agregar();
  const semTipo = new Set(
    (pendencias.find((p) => p.tipo === 'processo-sem-tipo')?.itens ?? []).map((i) => i.dispositivo),
  );

  for (const r of resultado) {
    if (semTipo.has(r.dispositivo)) continue;
    assert.equal(
      q(r.defasagem + r.industrializacao + r.producao),
      q(r.total),
      `composição de ${r.dispositivo}`,
    );
  }
});

test('Energy Trac: a defasagem continua exata mesmo com o rollup fora', () => {
  // 8,78 é o aditivo "Defasagem Energy Trac" de dispositivo_metrica, derivado à mão da mesma
  // planilha. O rollup é de Produção, então excluí-lo não pode mexer neste número.
  const { resultado } = agregar();
  assert.equal(q(doDispositivo(resultado, 'Energy Trac').defasagem), 8.78);
});

test('Smart Trac Ultra Ex: defasagem 1,12 exata', () => {
  const { resultado } = agregar();
  assert.equal(q(doDispositivo(resultado, 'Smart Trac Ultra Ex').defasagem), 1.12);
});

test('o total nunca é zero para device model com atividade', () => {
  // Zero entraria na fórmula de headcount como "este dispositivo não custa nada".
  const { resultado } = agregar();
  assert.ok(resultado.length > 0);
  for (const r of resultado) assert.ok(r.total > 0, `${r.dispositivo} com total ${r.total}`);
});

// ---------------------------------------------------------------- pendências

test('device model sem par no cadastro vira pendência, não some', () => {
  const { pendencias } = agregar();
  const p = pendencias.find((x) => x.tipo === 'device-model-sem-dispositivo');

  assert.ok(p, 'pendência emitida');
  const nomes = p.itens.map((i) => i.deviceModel);
  assert.ok(nomes.includes('Super capacitor'));
  assert.ok(nomes.includes('Smart Trac Pro'));
});

test('dispositivo ativo fora da planilha é cobrado', () => {
  const { pendencias } = agregarTempos({
    atividades: fixture.atividades,
    dePara: dePara(),
    dispositivosAtivos: [...dispositivosAtivos(), { id: 99, nome: 'Retrabalho STU' }],
  });

  const p = pendencias.find((x) => x.tipo === 'dispositivo-sem-tempo');
  assert.ok(p);
  assert.deepEqual(p.itens, [{ dispositivo: 'Retrabalho STU' }]);
});

test('medição duplicada é resolvida pelo mês maior E reportada', () => {
  const { pendencias } = agregar();
  const p = pendencias.find((x) => x.tipo === 'medicao-duplicada');

  assert.ok(p, 'a planilha tem pares repetidos e eles não podem sumir calados');
  assert.ok(p.itens.length > 0);
  for (const item of p.itens) {
    assert.ok(item.meses.length > 1);
    assert.ok(item.valores.includes(item.escolhido));
  }
});

test('obsoleta e linha vazia saem da conta, mas aparecem no resumo', () => {
  const { resumo } = agregar();

  assert.equal(resumo.lidas, fixture.atividades.length);
  assert.equal(resumo.descartadas.obsoleta, 2);
  assert.equal(resumo.descartadas.semDeviceModel, 2);
  assert.ok(resumo.usadas < resumo.lidas);
});

test('entrada vazia não quebra', () => {
  const { resultado, pendencias, resumo } = agregarTempos({
    atividades: [],
    dePara: new Map(),
  });

  assert.deepEqual(resultado, []);
  assert.equal(resumo.lidas, 0);
  assert.deepEqual(pendencias, []);
});
