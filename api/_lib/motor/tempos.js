'use strict';

/**
 * Agregação dos tempos da planilha "Análises Best Laps" (aba Perfomancedev).
 *
 * Recebe as atividades cruas do snapshot e devolve, por dispositivo, os tempos que o app usa.
 * Puro: sem HTTP, sem banco — como o resto de `api/_lib/motor/`.
 *
 * ## A regra
 *
 *   total (a montagem)  = Σ goal dos processos do device model, SEM "Processo de montar completo"
 *   defasagem           = Σ goal das linhas com process_type = 'Defasagem'
 *   industrializacao    = Σ goal das linhas com process_type = 'Industrialização'
 *   producao            = Σ goal das linhas com process_type = 'Produção'
 *
 * O tempo de montagem de um produto é a **soma dos processos dele**. `defasagem`,
 * `industrializacao` e `producao` são recortes informativos DENTRO do total, para a tela mostrar
 * a composição — não são parcelas a somar por fora.
 *
 * ## "Processo de montar completo" fica FORA da soma
 *
 * Essa linha é um rollup: ela repete, num número só, o trabalho que as outras linhas do mesmo
 * produto já detalham. Decisão de negócio (PCP/Engenharia, 16/09/2026), e vale para TODOS os
 * produtos — inclusive aqueles em que ela é a única linha de produção.
 *
 * O dado confirma, onde a decomposição está completa. Comparando o rollup com a soma das linhas
 * de Produção do mesmo device model:
 *
 *   Omni Trac      rollup 12,08   Σ detalhe 12,08   exato
 *   Omni Receiver  rollup 16,47   Σ detalhe 16,47   exato
 *
 * Dois casamentos exatos em casas decimais: a linha É a soma das outras, e contar as duas
 * dobraria o tempo. Nos outros seis device models com rollup os valores divergem (de −64% a
 * +174%), o que diz que a decomposição ali está parcial ou o rollup está velho — não que a
 * regra mude. Quem manda é o detalhe, que é o que a Engenharia mantém.
 *
 * Garra Uni Trac não tem rollup e por isso é imune à escolha, servindo de âncora:
 * Σ = 15,34 contra `meta_padrao` = 15,30. Smart Trac Ultra Ex dá 4,17 contra 4,40 (−5,2%);
 * somando o rollup daria 6,35, que erra por +44%.
 *
 * Trade-off registrado: Energy Trac dá 14,18 contra os 22,70 do cadastro (somando o rollup daria
 * 22,55, quase exato). Ali o detalhe de Produção soma 5,79 contra um rollup de 8,37 — falta
 * decomposição na planilha. Se o 22,70 estiver certo, a correção é na origem, não aqui.
 *
 * (O aditivo "Montagem X" de `dispositivo_metrica` vale 8,37 em Energy Trac e casa com a linha
 * de rollup — mas ele é UM componente do parcial daquela tela, não o tempo-padrão do
 * dispositivo. Foi essa colisão de vocabulário que gerou a primeira versão errada disto.)
 *
 * ## Pendência, nunca zero
 *
 * Toda falha de cobertura sai em `pendencias`. Zero calado é o bug que originou este projeto —
 * 6 códigos SAP que não geravam demanda nenhuma, em silêncio.
 *
 * Não reusa `diagnostico()` de `desvios.js` de propósito: aquele catálogo é das 13 divergências
 * da planilha de Dimensionamento, com política de correção por cenário (`correcoes`). Isto aqui
 * é qualidade de dado de outra fonte — misturar os dois daria a falsa impressão de que se pode
 * "ligar a correção" de um device model que não existe.
 */

/** Só o que precisa casar: caixa, acentuação e espaço em excesso não são diferença de verdade. */
const normalizar = (texto) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const numero = (valor) => {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(String(valor).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/**
 * A linha de rollup, que fica fora da soma.
 *
 * Nome deliberadamente literal — descreve a LINHA da planilha, não o conceito de montagem. A
 * primeira versão disto chamava um helper equivalente de `ehMontagem` e usava o valor dele como
 * o tempo-padrão; o nome ambíguo foi metade do erro.
 */
const ehRollup = (processo) => normalizar(processo).includes('montar completo');

const TIPOS = {
  defasagem: 'defasagem',
  industrializacao: 'industrializacao',
  producao: 'producao',
};

/** 'Industrialização' -> 'industrializacao'; 'Produção' -> 'producao'. Vazio vira null. */
function tipoDe(processType) {
  const t = normalizar(processType);
  if (!t) return null;
  return TIPOS[t] ?? null;
}

const pendencia = (tipo, mensagem, itens = []) => ({ tipo, mensagem, itens });

/**
 * @param {object} entrada
 * @param {object[]} entrada.atividades      linhas cruas: {deviceModel, processo, processType,
 *                                           goal, mesMedicao, obsoleta}
 * @param {Map<string, {id: number, nome: string}>} entrada.dePara  deviceModel -> dispositivo
 * @param {{id: number, nome: string}[]} [entrada.dispositivosAtivos]  para cobrar cobertura
 */
function agregarTempos({ atividades, dePara, dispositivosAtivos = [] }) {
  const pendencias = [];

  // ---------------------------------------------------------------- 1. filtro
  //
  // Linha obsoleta, sem device model ou sem goal não é dado — mas o descarte é contado, para a
  // tela conseguir dizer "188 linhas lidas, 184 usadas" em vez de só mostrar o resultado.

  const descartadas = { obsoleta: 0, semDeviceModel: 0, semGoal: 0, rollup: 0 };
  const vivas = [];

  for (const a of atividades) {
    if (a.obsoleta) {
      descartadas.obsoleta++;
      continue;
    }
    if (!String(a.deviceModel ?? '').trim()) {
      descartadas.semDeviceModel++;
      continue;
    }
    if (numero(a.goal) === null) {
      descartadas.semGoal++;
      continue;
    }
    // Fora da soma, e CONTADO: a tela precisa poder dizer quantas linhas de rollup foram
    // ignoradas, senão "167 de 188" vira um número sem explicação.
    if (ehRollup(a.processo)) {
      descartadas.rollup++;
      continue;
    }
    vivas.push({ ...a, goal: numero(a.goal), mesMedicao: numero(a.mesMedicao) ?? 0 });
  }

  // ---------------------------------------------------------------- 2. dedup
  //
  // A planilha repete o par (device model, processo) com `month` diferente — são medições de
  // épocas distintas. Fica a de maior mês.
  //
  // Mas a coluna `month` NÃO TEM ANO: entre month 11 e month 3 não dá para saber qual é mais
  // recente. O desempate é convenção, então cada par duplicado vira pendência — quem olha a tela
  // precisa saber que houve escolha, e a planilha precisa ganhar uma coluna de ano.

  const porChave = new Map();
  const duplicados = new Map();

  for (const a of vivas) {
    const chave = `${normalizar(a.deviceModel)}|${normalizar(a.processo)}`;
    const atual = porChave.get(chave);
    if (!atual) {
      porChave.set(chave, a);
      continue;
    }
    if (!duplicados.has(chave)) duplicados.set(chave, [atual]);
    duplicados.get(chave).push(a);
    if (a.mesMedicao > atual.mesMedicao) porChave.set(chave, a);
  }

  if (duplicados.size) {
    pendencias.push(
      pendencia(
        'medicao-duplicada',
        `${duplicados.size} par(es) (device model, processo) aparecem mais de uma vez. A coluna ` +
          '`month` não tem ano, então o desempate pelo mês maior é convenção — confirmar com a ' +
          'Engenharia ou pedir uma coluna de data.',
        [...duplicados.values()].map((lista) => ({
          deviceModel: lista[0].deviceModel,
          processo: lista[0].processo,
          meses: lista.map((x) => x.mesMedicao),
          valores: lista.map((x) => x.goal),
          escolhido: porChave.get(`${normalizar(lista[0].deviceModel)}|${normalizar(lista[0].processo)}`)
            .goal,
        })),
      ),
    );
  }

  // ---------------------------------------------------------------- 3. agregação

  const porDeviceModel = new Map();
  for (const a of porChave.values()) {
    const dm = a.deviceModel.trim();
    if (!porDeviceModel.has(dm)) porDeviceModel.set(dm, []);
    porDeviceModel.get(dm).push(a);
  }

  const resultado = [];
  const semDispositivo = [];
  const semTipo = [];

  for (const [deviceModel, lista] of porDeviceModel) {
    const dispositivo = dePara.get(normalizar(deviceModel));
    if (!dispositivo) {
      semDispositivo.push({ deviceModel, atividades: lista.length });
      continue;
    }

    // O total é a montagem do produto. A linha de rollup já saiu no filtro.
    const total = lista.reduce((s, a) => s + a.goal, 0);

    // Recortes DENTRO do total, só para a tela mostrar a composição. Nunca somados por fora.
    const somaDe = (tipo) =>
      lista.filter((a) => tipoDe(a.processType) === tipo).reduce((s, a) => s + a.goal, 0);

    const defasagem = somaDe(TIPOS.defasagem);
    const industrializacao = somaDe(TIPOS.industrializacao);
    const producao = somaDe(TIPOS.producao);

    // `process_type` em branco não tira a linha do total — ela é um processo do produto do
    // mesmo jeito. Mas o resto que não se explica pelos três recortes fica visível, senão a
    // composição na tela não fecha com o total e parece bug.
    const semClassificacao = total - defasagem - industrializacao - producao;
    if (semClassificacao > 1e-9) {
      semTipo.push({
        deviceModel,
        dispositivo: dispositivo.nome,
        minutos: Number(semClassificacao.toFixed(4)),
        linhas: lista.filter((a) => tipoDe(a.processType) === null).map((a) => a.processo),
      });
    }

    resultado.push({
      deviceModel,
      dispositivoId: dispositivo.id,
      dispositivo: dispositivo.nome,
      total,
      defasagem,
      industrializacao,
      producao,
      atividades: lista.length,
    });
  }

  resultado.sort((a, b) => a.dispositivo.localeCompare(b.dispositivo, 'pt-BR'));

  // ---------------------------------------------------------------- 4. cobertura

  if (semDispositivo.length) {
    pendencias.push(
      pendencia(
        'device-model-sem-dispositivo',
        `${semDispositivo.length} device model(s) da planilha sem par no cadastro — os tempos ` +
          'deles são ignorados. Mapear em /tempos.',
        semDispositivo,
      ),
    );
  }

  if (semTipo.length) {
    pendencias.push(
      pendencia(
        'processo-sem-tipo',
        `${semTipo.length} dispositivo(s) com processo sem \`process_type\` — o tempo entra no ` +
          'total, mas não aparece em nenhum dos recortes da tela.',
        semTipo,
      ),
    );
  }

  const cobertos = new Set(resultado.map((r) => r.dispositivoId));
  const descobertos = dispositivosAtivos.filter((d) => !cobertos.has(d.id));
  if (descobertos.length) {
    pendencias.push(
      pendencia(
        'dispositivo-sem-tempo',
        `${descobertos.length} dispositivo(s) ativo(s) sem tempo na planilha — seguem com o ` +
          'valor do cadastro.',
        descobertos.map((d) => ({ dispositivo: d.nome })),
      ),
    );
  }

  return {
    resultado,
    pendencias,
    resumo: {
      lidas: atividades.length,
      usadas: porChave.size,
      descartadas,
      deviceModels: porDeviceModel.size,
      dispositivos: resultado.length,
    },
  };
}

module.exports = { agregarTempos, normalizar, tipoDe, ehRollup };
