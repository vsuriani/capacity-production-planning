'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { explodirDemanda } = require('./explosao');
const fixtures = require('./fixtures.json');

/**
 * Monta as estruturas do motor a partir das fixtures reais da planilha.
 * O nome do produto é usado como id (o motor trata ids como chave opaca).
 *
 * `fixtures.json` é captura da planilha, onde "Produto Filho" era uma célula só — por isso o
 * arquivo continua com `skuFilho` singular e a conversão para a lista que o motor espera mora
 * aqui. Regravar as fixtures só para plurizar um campo apagaria o que elas são: o retrato do
 * dado de origem.
 */
function mundoReal() {
  const processosPorProduto = new Map();
  for (const p of fixtures.roteiros) {
    if (!processosPorProduto.has(p.produto)) processosPorProduto.set(p.produto, []);
    processosPorProduto.get(p.produto).push({ ...p, skusFilho: p.skuFilho ? [p.skuFilho] : [] });
  }

  const mapaSku = new Map();
  for (const [escopo, porProduto] of Object.entries(fixtures.skuProduto)) {
    for (const [produto, skus] of Object.entries(porProduto)) {
      for (const sku of skus) {
        const chave = `${sku}|${escopo}`;
        if (!mapaSku.has(chave)) mapaSku.set(chave, []);
        mapaSku.get(chave).push(produto);
      }
    }
  }

  const nomesProduto = new Map([...processosPorProduto.keys()].map((n) => [n, n]));
  for (const produtos of mapaSku.values()) {
    for (const p of produtos) if (!nomesProduto.has(p)) nomesProduto.set(p, p);
  }

  return { processosPorProduto, mapaSku, nomesProduto };
}

const MUNDO = mundoReal();

function explodir(slots, correcoes = {}) {
  return explodirDemanda({ slots, ...MUNDO, correcoes });
}

// ---------------------------------------------------------------- básico

test('a base tem os 87 processos e os 3 tipos de linha', () => {
  assert.equal(fixtures.roteiros.length, 87);
  const tipos = new Set(fixtures.roteiros.map((p) => p.tipoLinha));
  assert.deepEqual([...tipos].sort(), ['defasagem', 'industrializacao', 'producao_montagem']);
});

test('bloco de produção gera defasagem e montagem, nunca industrialização', () => {
  const { linhas } = explodir([
    { data: '2026-07-08', bloco: 'producao', skuCodigo: 'PROD-0114', quantidade: 500 },
  ]);

  assert.ok(linhas.length > 0);
  for (const l of linhas) assert.notEqual(l.tipoLinha, 'industrializacao');
  assert.ok(linhas.some((l) => l.tipoLinha === 'defasagem'));
  assert.ok(linhas.some((l) => l.tipoLinha === 'producao_montagem'));
});

test('tempo estimado é quantidade / Pç-hora e o lote sai da data de produção', () => {
  const { linhas } = explodir([
    { data: '2026-07-08', bloco: 'producao', skuCodigo: 'PROD-0114', quantidade: 500 },
  ]);

  const comTaxa = linhas.find((l) => l.pcsHora > 0);
  assert.ok(comTaxa);
  assert.equal(comTaxa.tempoHoras, 500 / comTaxa.pcsHora);
  assert.equal(comTaxa.lote, '#20260708');
  assert.equal(comTaxa.diaProducao, '2026-07-08');
});

test('industrialização só roda no processo que tem o SKU entre os produtos filhos', () => {
  const { linhas } = explodir([
    { data: '2026-07-08', bloco: 'industrializacao', skuCodigo: 'ENCG-0018', quantidade: 1000 },
  ]);

  assert.ok(linhas.length > 0, 'ENCG-0018 deveria casar com algum processo');
  for (const l of linhas) {
    assert.equal(l.tipoLinha, 'industrializacao');
    const processo = fixtures.roteiros.find((p) => p.id === l.processoId);
    assert.equal(processo.skuFilho, 'ENCG-0018');
  }
});

test('um processo com vários filhos roda para cada um deles', () => {
  // O ganho da migration 007: antes isto exigia dois cadastros iguais, um por SKU.
  const processo = {
    id: 9001,
    tipoLinha: 'industrializacao',
    nome: 'Montar dois filhos',
    sequencia: 1,
    leadtimeDias: 0,
    operadores: 2,
    pcsHora: 10,
    skusFilho: ['ITCS-0001', 'ITCS-0012'],
  };
  const mundo = {
    processosPorProduto: new Map([['P', [processo]]]),
    mapaSku: new Map([
      ['ITCS-0001|industrializacao', ['P']],
      ['ITCS-0012|industrializacao', ['P']],
      ['ITCS-0023|industrializacao', ['P']],
    ]),
    nomesProduto: new Map([['P', 'P']]),
  };
  const slot = (sku) => ({
    data: '2026-07-08',
    bloco: 'industrializacao',
    skuCodigo: sku,
    quantidade: 100,
  });

  const { linhas } = explodirDemanda({
    ...mundo,
    slots: [slot('ITCS-0001'), slot('ITCS-0012'), slot('ITCS-0023')],
  });

  assert.deepEqual(
    linhas.map((l) => l.skuCodigo),
    ['ITCS-0001', 'ITCS-0012'],
    'os dois filhos casam; o SKU de fora não',
  );
});

test('processo sem filho nenhum nunca roda em industrialização', () => {
  // Mesma semântica do antigo `sku_filho` nulo — a lista vazia não casa com nada.
  const { linhas } = explodirDemanda({
    processosPorProduto: new Map([
      ['P', [{ id: 9002, tipoLinha: 'industrializacao', nome: 'Órfão', pcsHora: 10, skusFilho: [] }]],
    ]),
    mapaSku: new Map([['ITCS-0001|industrializacao', ['P']]]),
    nomesProduto: new Map([['P', 'P']]),
    slots: [
      { data: '2026-07-08', bloco: 'industrializacao', skuCodigo: 'ITCS-0001', quantidade: 100 },
    ],
  });

  assert.equal(linhas.length, 0);
});

// ---------------------------------------------------------------- desvios

test('SKU sem mapeamento não gera linha e entra no diagnóstico', () => {
  const semMapa = ['PROD-0157', 'PROD-0158', 'PROD-0163', 'PROD-0165'];
  const slots = semMapa.map((sku) => ({
    data: '2026-07-08',
    bloco: 'producao',
    skuCodigo: sku,
    quantidade: 100,
  }));

  const { linhas, diagnosticos } = explodir(slots);

  assert.equal(linhas.length, 0, 'nenhuma linha gerada');
  const desvio = diagnosticos.find((d) => d.id === 'sku-sem-roteiro-silencioso');
  assert.ok(desvio);
  assert.equal(desvio.itens.length, 4);
  assert.deepEqual(desvio.itens.map((i) => i.sku).sort(), semMapa);
  for (const item of desvio.itens) assert.equal(item.motivo, 'sem mapeamento SKU → produto');
});

test('PROR-0006 do bloco de industrialização também não tem mapeamento', () => {
  const { linhas, diagnosticos } = explodir([
    { data: '2026-07-08', bloco: 'industrializacao', skuCodigo: 'PROR-0006', quantidade: 1000 },
  ]);

  assert.equal(linhas.length, 0);
  assert.ok(diagnosticos.some((d) => d.id === 'sku-sem-roteiro-silencioso'));
});

test('PROD-0164 e PROD-0172 estão mapeados mas para produtos sem roteiro', () => {
  const { linhas, diagnosticos } = explodir([
    { data: '2026-07-08', bloco: 'producao', skuCodigo: 'PROD-0164', quantidade: 550 },
    { data: '2026-07-08', bloco: 'producao', skuCodigo: 'PROD-0172', quantidade: 100 },
  ]);

  assert.equal(linhas.length, 0);
  const desvio = diagnosticos.find((d) => d.id === 'sku-sem-roteiro-silencioso');
  assert.ok(desvio);
  for (const item of desvio.itens) {
    assert.equal(item.motivo, 'produto mapeado sem processos do tipo esperado');
  }
  assert.ok(desvio.itens.some((i) => i.sku.includes('Smart Trac Ultra Ex Gen 2')));
  assert.ok(desvio.itens.some((i) => i.sku.includes('Omni Receiver MX')));
});

test('PROD-0156 aponta para "OEE Trac", que não existe na base (lá é "OEE")', () => {
  const { linhas, diagnosticos } = explodir([
    { data: '2026-07-08', bloco: 'producao', skuCodigo: 'PROD-0156', quantidade: 300 },
  ]);

  assert.equal(linhas.length, 0);
  assert.ok(diagnosticos.some((d) => d.id === 'sku-sem-roteiro-silencioso'));
  assert.ok(
    fixtures.roteiros.some((p) => p.produto === 'OEE'),
    'a base tem "OEE"',
  );
  assert.ok(
    !fixtures.roteiros.some((p) => p.produto === 'OEE Trac'),
    'a base não tem "OEE Trac"',
  );
});

test('SKU em dois grupos duplica as linhas em modo fiel', () => {
  const slot = {
    data: '2026-07-08',
    bloco: 'industrializacao',
    skuCodigo: 'ITCS-0002',
    quantidade: 100,
  };

  const fiel = explodir([slot]);
  const corrigido = explodir([slot], { 'sku-em-dois-grupos': true });

  const desvio = fiel.diagnosticos.find((d) => d.id === 'sku-em-dois-grupos');
  assert.ok(desvio, 'esperava o diagnóstico de ambiguidade');
  assert.deepEqual(desvio.itens[0].produtos.sort(), ['Baterias', 'Smart Trac Ultra Ex']);
  assert.ok(
    fiel.linhas.length >= corrigido.linhas.length,
    'em modo fiel gera as linhas dos dois produtos',
  );
});

test('hoje nenhum processo da base está sem Pç/Hr — o desvio é latente', () => {
  const semTaxa = fixtures.roteiros.filter((p) => !p.pcsHora || Number(p.pcsHora) <= 0);
  assert.equal(semTaxa.length, 0, 'se isto falhar, o desvio tempo-sem-guarda passou a ser real');
});

test('processo sem Pç/Hr: tempo infinito em modo fiel, nulo quando corrigido', () => {
  // Roteiro sintético: o código não tem guarda para divisor zero, mesmo que a base
  // atual não exercite o caso. É o que produz as células de tempo vazias na planilha.
  const processo = {
    id: 9001,
    produto: 'Produto Teste',
    tipoLinha: 'producao_montagem',
    nome: 'Processo sem taxa',
    sequencia: 1,
    paralelismo: 1,
    leadtimeDias: 1,
    operadores: 2,
    pcsHora: 0,
    skuFilho: null,
  };

  const entrada = {
    slots: [{ data: '2026-07-08', bloco: 'producao', skuCodigo: 'TESTE-0001', quantidade: 100 }],
    mapaSku: new Map([['TESTE-0001|producao', ['Produto Teste']]]),
    processosPorProduto: new Map([['Produto Teste', [processo]]]),
    nomesProduto: new Map([['Produto Teste', 'Produto Teste']]),
  };

  const fiel = explodirDemanda(entrada);
  assert.equal(fiel.linhas.length, 1);
  assert.equal(fiel.linhas[0].tempoHoras, Infinity);
  assert.equal(fiel.linhas[0].pcsHora, null);
  const desvio = fiel.diagnosticos.find((d) => d.id === 'tempo-sem-guarda');
  assert.ok(desvio);
  assert.equal(desvio.itens[0].processo, 'TESTE-0001 · Processo sem taxa');

  const corrigido = explodirDemanda({ ...entrada, correcoes: { 'tempo-sem-guarda': true } });
  assert.equal(corrigido.linhas[0].tempoHoras, null);
  assert.equal(corrigido.diagnosticos.find((d) => d.id === 'tempo-sem-guarda'), undefined);
});

// ---------------------------------------------------------------- grade real

test('a grade real da planilha explode e acusa os 6 SKU órfãos', () => {
  const { linhas, diagnosticos } = explodir(fixtures.slots);

  assert.ok(linhas.length > 0, 'a grade real gera demanda');

  const desvio = diagnosticos.find((d) => d.id === 'sku-sem-roteiro-silencioso');
  assert.ok(desvio, 'esperava SKU órfão na grade real');

  const orfaos = new Set(desvio.itens.map((i) => i.sku.split(' → ')[0]));
  for (const sku of ['PROD-0157', 'PROD-0158', 'PROD-0163', 'PROD-0165', 'PROD-0164', 'PROR-0006']) {
    assert.ok(orfaos.has(sku), `${sku} deveria estar na lista de órfãos`);
  }
});

test('corrigir o leadtime muda as datas de processo da grade real', () => {
  const fiel = explodir(fixtures.slots);
  const corrigido = explodir(fixtures.slots, { 'leadtime-caso-a-caso': true });

  const diferentes = fiel.linhas.filter(
    (l, i) => l.diaProcesso !== corrigido.linhas[i].diaProcesso,
  );
  assert.ok(diferentes.length > 0, 'as duas regras de leadtime deveriam divergir na grade real');
  assert.equal(fiel.diagnosticos.some((d) => d.id === 'leadtime-caso-a-caso'), true);
  assert.equal(corrigido.diagnosticos.some((d) => d.id === 'leadtime-caso-a-caso'), false);
});
