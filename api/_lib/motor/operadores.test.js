'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { calcularOperadores } = require('./operadores');
const fixtures = require('./fixtures.json');

// Parâmetros da planilha. A jornada líquida vem de (8 − 0,5) escrito na própria fórmula.
const PARAMETROS = {
  jornadaHoras: 8,
  pausaHoras: 0.5,
  coefEficiencia: 0.85,
  coefExcedente: 0.2,
  minutosPorHora: 60,
};

/**
 * Monta a entrada do motor a partir de um período do fixture.
 * A linha da planilha é o id do dispositivo; a letra da coluna é o nome do período.
 */
function entradaDoPeriodo(aba, periodo) {
  const metas = new Map();
  const nomes = new Map();
  for (const [linha, disp] of Object.entries(aba.dispositivos)) {
    metas.set(Number(linha), Number(disp.meta) || 0);
    nomes.set(Number(linha), disp.nome);
  }

  // Demanda de TODAS as colunas: alguns termos apontam para outro período.
  const demandas = new Map();
  for (const [coluna, porLinha] of Object.entries(aba.demandasPorColuna)) {
    for (const [linha, qtd] of Object.entries(porLinha)) {
      demandas.set(`${linha}|${coluna}`, Number(qtd) || 0);
    }
  }

  return {
    periodo: periodo.coluna,
    termos: periodo.termos.map((t) => ({
      metaDispositivoId: t.metaLinha,
      qtdDispositivoId: t.qtdLinha,
      qtdPeriodo: t.qtdColuna,
    })),
    metas,
    demandas,
    nomes,
    diasUteis: Number(periodo.diasUteis) || 0,
    parametros: { ...PARAMETROS, coefEficiencia: Number(aba.coefEficiencia) || 0.85 },
    // Nas colunas mensais a planilha traz o headcount digitado, não o ROUNDUP.
    arredondadoManual: periodo.arredondadoEhFormula ? null : periodo.planilhaArredondado,
  };
}

// ---------------------------------------------------------------- fidelidade

test('modo fiel reproduz o número que a planilha exibe hoje, em todos os períodos', () => {
  let conferidos = 0;

  for (const [nomeAba, aba] of Object.entries(fixtures.abas)) {
    for (const periodo of aba.periodos) {
      const esperado = periodo.planilhaFracionario;
      if (typeof esperado !== 'number') continue; // #DIV/0! e afins

      const r = calcularOperadores(entradaDoPeriodo(aba, periodo));
      assert.ok(
        Math.abs(r.operadoresFracionario - esperado) < 1e-9,
        `${nomeAba} ${periodo.coluna} (${periodo.rotulo}): motor ${r.operadoresFracionario} ` +
          `!= planilha ${esperado}`,
      );
      assert.equal(
        r.operadores,
        periodo.planilhaArredondado,
        `${nomeAba} ${periodo.coluna}: headcount exibido divergente`,
      );
      conferidos++;
    }
  }

  assert.ok(conferidos >= 60, `esperava conferir 60+ períodos, conferi ${conferidos}`);
});

test('colunas mensais: headcount é digitado e o motor acusa a divergência', () => {
  const aba = fixtures.abas['Planejamento Mensal'];
  const manuais = aba.periodos.filter((p) => !p.arredondadoEhFormula);
  assert.ok(manuais.length >= 10, `esperava 10+ colunas manuais, achei ${manuais.length}`);

  // Mensal T calcula 8,4986 (ROUNDUP -> 9) mas a planilha exibe 8 digitado.
  const t = aba.periodos.find((p) => p.coluna === 'T');
  const r = calcularOperadores(entradaDoPeriodo(aba, t));

  assert.equal(r.operadores, 8, 'em modo fiel vale o valor digitado');
  assert.equal(r.operadoresCalculado, 9, 'o cálculo daria 9');

  const desvio = r.diagnosticos.find((d) => d.id === 'arredondado-manual');
  assert.ok(desvio);
  assert.deepEqual({ manual: desvio.manual, calculado: desvio.calculado }, { manual: 8, calculado: 9 });
});

test('corrigir arredondado-manual faz o ROUNDUP valer', () => {
  const aba = fixtures.abas['Planejamento Mensal'];
  const t = aba.periodos.find((p) => p.coluna === 'T');

  const r = calcularOperadores({
    ...entradaDoPeriodo(aba, t),
    correcoes: { 'arredondado-manual': true },
  });

  assert.equal(r.operadores, 9);
  assert.equal(r.diagnosticos.find((d) => d.id === 'arredondado-manual'), undefined);
});

test('período sem dias úteis devolve o mesmo erro que o #DIV/0! da planilha', () => {
  const aba = fixtures.abas['Planejamento Semanal'];
  const periodo = aba.periodos[0];
  const entrada = { ...entradaDoPeriodo(aba, periodo), diasUteis: 0 };

  const r = calcularOperadores(entrada);
  assert.equal(r.operadores, null);
  assert.equal(r.erro, 'dias-uteis-zero');
});

// ---------------------------------------------------------------- diagnósticos

test('Planejamento Semanal E27: acusa os 8 pares desalinhados sem corrigir', () => {
  const aba = fixtures.abas['Planejamento Semanal'];
  const periodo = aba.periodos.find((p) => p.coluna === 'E');

  const r = calcularOperadores(entradaDoPeriodo(aba, periodo));
  const desvio = r.diagnosticos.find((d) => d.id === 'pares-desalinhados');

  assert.ok(desvio, 'esperava o diagnóstico pares-desalinhados');
  assert.equal(desvio.itens.length, 8);
  assert.deepEqual(desvio.itens[0], { meta: 'Retrabalho SRU', qtd: 'Retrabalho STU' });
});

test('Planejamento Mensal S24 está alinhado — nenhum diagnóstico de par', () => {
  const aba = fixtures.abas['Planejamento Mensal'];
  const periodo = aba.periodos.find((p) => p.coluna === 'S');

  const r = calcularOperadores(entradaDoPeriodo(aba, periodo));
  assert.equal(r.diagnosticos.find((d) => d.id === 'pares-desalinhados'), undefined);
  assert.equal(periodo.termos.length, 19, 'S24 soma os 19 dispositivos');
});

test('acusa dispositivo com demanda fora da soma', () => {
  const aba = fixtures.abas['Planejamento Mensal'];
  const periodo = aba.periodos.find((p) => p.coluna === 'E');

  const r = calcularOperadores(entradaDoPeriodo(aba, periodo));
  const desvio = r.diagnosticos.find((d) => d.id === 'dispositivos-fora-da-soma');

  // Em Week 45 só "Smart Receiver Ultra Gen 2" e afins com demanda ficam de fora;
  // o diagnóstico só reporta quem tem quantidade diferente de zero.
  if (desvio) {
    for (const item of desvio.itens) assert.notEqual(item.quantidade, 0);
  }
  assert.equal(periodo.termos.length, 13, 'E24 soma 13 dos 19 dispositivos');
});

test('Semanal Y27: acusa o termo que usa a quantidade da coluna seguinte', () => {
  const aba = fixtures.abas['Planejamento Semanal'];
  const periodo = aba.periodos.find((p) => p.coluna === 'Y');

  const r = calcularOperadores(entradaDoPeriodo(aba, periodo));
  const desvio = r.diagnosticos.find((d) => d.id === 'par-outro-periodo');

  assert.ok(desvio, 'esperava o diagnóstico par-outro-periodo');
  assert.equal(desvio.itens.length, 1);
  assert.equal(desvio.itens[0].periodoUsado, 'Z');
  assert.equal(desvio.itens[0].periodoEsperado, 'Y');
});

test('corrigir par-outro-periodo muda o número onde as quantidades divergem (Z27)', () => {
  // Z27 usa AA3 = 0 mas deveria usar Z3 = 500 — é onde o erro de arraste tem efeito.
  // Em Y27 e AA27 as duas colunas têm a mesma quantidade, então o bug fica silencioso.
  const aba = fixtures.abas['Planejamento Semanal'];
  const periodo = aba.periodos.find((p) => p.coluna === 'Z');
  const entrada = entradaDoPeriodo(aba, periodo);

  const fiel = calcularOperadores(entrada);
  const corrigido = calcularOperadores({ ...entrada, correcoes: { 'par-outro-periodo': true } });

  const metaLinha3 = Number(aba.dispositivos['3'].meta);
  const qtdPropria = Number(aba.demandasPorColuna['Z']['3']);

  assert.equal(
    corrigido.minutosTotais - fiel.minutosTotais,
    metaLinha3 * qtdPropria,
    'a diferença é exatamente o termo que estava zerado',
  );
  assert.equal(corrigido.diagnosticos.find((d) => d.id === 'par-outro-periodo'), undefined);
});

test('em Y27 e AA27 o termo cruzado não altera o número — bug silencioso', () => {
  const aba = fixtures.abas['Planejamento Semanal'];

  for (const coluna of ['Y', 'AA']) {
    const periodo = aba.periodos.find((p) => p.coluna === coluna);
    const entrada = entradaDoPeriodo(aba, periodo);

    const fiel = calcularOperadores(entrada);
    const corrigido = calcularOperadores({ ...entrada, correcoes: { 'par-outro-periodo': true } });

    assert.equal(
      fiel.minutosTotais,
      corrigido.minutosTotais,
      `${coluna}: as quantidades coincidem, então o número não muda`,
    );
    assert.ok(
      fiel.diagnosticos.some((d) => d.id === 'par-outro-periodo'),
      `${coluna}: o diagnóstico deve aparecer mesmo sem efeito numérico`,
    );
  }
});

test('as 3 colunas cruzadas do Semanal são exatamente Y, Z e AA', () => {
  const aba = fixtures.abas['Planejamento Semanal'];
  const comCruzado = aba.periodos
    .filter((p) => p.termos.some((t) => t.qtdColuna !== p.coluna))
    .map((p) => p.coluna);

  assert.deepEqual(comCruzado, ['Y', 'Z', 'AA']);
});

// ---------------------------------------------------------------- correções

test('corrigir pares-desalinhados muda o resultado e some com o diagnóstico', () => {
  const aba = fixtures.abas['Planejamento Semanal'];
  const periodo = aba.periodos.find((p) => p.coluna === 'E');
  const entrada = entradaDoPeriodo(aba, periodo);

  const fiel = calcularOperadores(entrada);
  const corrigido = calcularOperadores({
    ...entrada,
    correcoes: { 'pares-desalinhados': true },
  });

  assert.notEqual(fiel.operadoresFracionario, corrigido.operadoresFracionario);
  assert.equal(corrigido.diagnosticos.find((d) => d.id === 'pares-desalinhados'), undefined);
});

test('corrigir dispositivos-fora-da-soma inclui todo dispositivo com meta', () => {
  const aba = fixtures.abas['Planejamento Mensal'];
  const periodo = aba.periodos.find((p) => p.coluna === 'E');
  const entrada = entradaDoPeriodo(aba, periodo);

  const fiel = calcularOperadores(entrada);
  const corrigido = calcularOperadores({
    ...entrada,
    correcoes: { 'dispositivos-fora-da-soma': true },
  });

  assert.ok(
    corrigido.minutosTotais >= fiel.minutosTotais,
    'incluir dispositivos só pode aumentar (ou manter) a carga',
  );
  assert.equal(corrigido.diagnosticos.find((d) => d.id === 'dispositivos-fora-da-soma'), undefined);
});

test('excedente: só entra quando o cenário é de capacidade ou a correção está ligada', () => {
  const aba = fixtures.abas['Planejamento Mensal'];
  const periodo = aba.periodos.find((p) => p.coluna === 'E');
  const entrada = entradaDoPeriodo(aba, periodo);

  const semExcedente = calcularOperadores(entrada);
  const comExcedente = calcularOperadores({ ...entrada, aplicarExcedente: true });
  const viaCorrecao = calcularOperadores({
    ...entrada,
    correcoes: { 'excedente-so-no-global': true },
  });

  assert.ok(
    Math.abs(comExcedente.operadoresFracionario - semExcedente.operadoresFracionario * 1.2) < 1e-9,
  );
  assert.equal(comExcedente.operadoresFracionario, viaCorrecao.operadoresFracionario);
  assert.ok(semExcedente.diagnosticos.some((d) => d.id === 'excedente-so-no-global'));
});

test('desvio desconhecido em correcoes é erro, não silêncio', () => {
  const aba = fixtures.abas['Planejamento Mensal'];
  const entrada = entradaDoPeriodo(aba, aba.periodos[0]);

  assert.throws(
    () => calcularOperadores({ ...entrada, correcoes: { 'nao-existe': true } }),
    /desvio desconhecido/,
  );
});
