'use strict';

/**
 * Registro dos desvios conhecidos entre a planilha e o cálculo correto.
 *
 * Decisão do projeto: o app é FIEL à planilha por padrão. Cada desvio aqui é
 * exibido na tela com a descrição do que a planilha faz e o impacto medido; ligar
 * a correção é ação explícita do usuário, gravada em cenario.correcoes.
 *
 * Nenhum desvio muda de default sozinho.
 */

const DESVIOS = [
  {
    id: 'pares-desalinhados',
    titulo: 'Meta multiplicada pela quantidade de outro dispositivo',
    aba: 'Planejamento Semanal',
    planilha:
      'Na soma de "Operadores Linha" a Meta da linha X é multiplicada pela quantidade da linha Y. ' +
      'Fórmula copiada da aba mensal depois de inserir linhas: as referências $B$n travadas com $ ' +
      'não acompanharam o deslocamento.',
    correcao: 'Cada Meta passa a multiplicar a quantidade do próprio dispositivo.',
    impacto: 'Semanal E27: 8 de 13 termos desalinhados. S27: 11 de 16.',
  },
  {
    id: 'par-outro-periodo',
    titulo: 'Termo usando a quantidade de outro período',
    aba: 'Planejamento Semanal',
    planilha:
      'Alguns termos multiplicam a Meta pela quantidade de OUTRA coluna, ou seja, de outro ' +
      'período: Y27 (Week 2) usa $B$3*Z3, puxando a quantidade da Week 3. Erro de arraste em ' +
      'um único termo, propagado para as colunas seguintes.',
    correcao: 'Todo termo passa a usar a quantidade do próprio período.',
    impacto: 'Y27, Z27 e AA27 do Semanal, sempre no dispositivo da linha 3 (Bateria EX Gen 2).',
  },
  {
    id: 'dispositivos-fora-da-soma',
    titulo: 'Dispositivos ausentes da soma de operadores',
    aba: 'Planejamento Mensal / Semanal',
    planilha:
      'A soma é uma lista fixa de termos escrita à mão na fórmula. Dispositivo sem termo não entra ' +
      'na conta, mesmo tendo demanda no período.',
    correcao: 'Todo dispositivo com Meta e demanda entra na soma.',
    impacto: 'Mensal E24: 6 fora. Semanal E27: 9 fora. S27: 6 fora.',
  },
  {
    id: 'leadtime-caso-a-caso',
    titulo: 'Leadtime por regras fixas de dia-da-semana',
    aba: 'Code.gs / Código.gs (diaDefasagem)',
    planilha:
      'Oito ramos if/else combinando dia da semana e leadtime (segunda com leadtime 2 volta 2 dias, ' +
      'terça volta 1, segunda/terça com leadtime ≥3 voltam leadtime+1, etc.). Quarta com leadtime 4 ' +
      'não casa com nenhum ramo e cai no else genérico. Sábado/domingo são puxados para a sexta.',
    correcao: 'Subtrai N dias úteis de verdade, considerando a tabela de feriados.',
    impacto: 'Divergência de 1 a 2 dias dependendo da combinação.',
  },
  {
    id: 'jornada-divergente',
    titulo: 'Quatro jornadas diferentes na mesma planilha',
    aba: 'Fórmulas / Base simplificada / PlotarProjeção.gs',
    planilha:
      'As fórmulas de operadores usam 8 − 0,5 = 7,5 h. A coluna "Total no dia" da Base simplificada ' +
      'usa 8 h. O validarCapacidade do PlotarProjeção usa 8,8 h. O teste.gs usa 7,5 h.',
    correcao: 'Uma jornada só, vinda dos parâmetros (jornada_horas − pausa_horas).',
    impacto: 'A capacidade diária de um operador varia até 17% entre telas.',
  },
  {
    id: 'excedente-so-no-global',
    titulo: 'Folga de headcount aplicada em uma aba só',
    aba: '🚧 Dimensionamento Global',
    planilha:
      'O coeficiente de excedente (+20%) é somado ao headcount apenas na aba Global. ' +
      'Planejamento Mensal e Semanal não aplicam nenhuma folga.',
    correcao: 'O excedente passa a valer para os três cenários.',
    impacto: 'Global pede ~20% mais operadores que Mensal/Semanal para a mesma demanda.',
  },
  {
    id: 'arredondado-manual',
    titulo: 'Headcount arredondado digitado à mão',
    aba: 'Planejamento Mensal / Semanal',
    planilha:
      'A linha "Operadores Linha" arredondada só usa ROUNDUP nas colunas semanais (E:R). Nas ' +
      'colunas mensais (S:AF) o número é digitado à mão e não acompanha o cálculo — Mensal T ' +
      'calcula 8,50 e exibe 8; no Semanal os 14 meses trazem valores fixos entre 6 e 9.',
    correcao: 'O arredondado passa a ser sempre ROUNDUP do calculado.',
    impacto: '25 colunas mensais com headcount desconectado do cálculo (14 no Semanal, 11 no Mensal).',
  },
  {
    id: 'sku-sem-roteiro-silencioso',
    titulo: 'SKU sem roteiro é ignorado sem aviso',
    aba: 'Code.gs (calculoDefasagem)',
    planilha:
      'Se o código SAP não está em nenhum array de produto, ou está mapeado para um produto sem ' +
      'linhas na Base simplificada, o loop simplesmente não gera linha nenhuma — sem erro.',
    correcao: 'O SKU aparece na lista de pendências e a demanda não é perdida em silêncio.',
    impacto:
      'Hoje: PROD-0157, PROD-0158, PROD-0163, PROD-0165 e PROR-0006 sem mapeamento; ' +
      'PROD-0164 e PROD-0172 mapeados para roteiros vazios.',
  },
  {
    id: 'produto-nome-divergente',
    titulo: 'Junção de produto por texto exato',
    aba: 'Base simplificada',
    planilha:
      'A comparação é string exata, então nome com espaço sobrando ou grafia diferente vira outro ' +
      'produto: "OEE" não casa com "OEE Trac", e "Smart Trac Ultra Gen 2 " (espaço no fim) é ' +
      'distinto de "Smart Trac Ultra Gen 2".',
    correcao: 'Usa a tabela de alias e compara normalizado (trim + minúsculas).',
    impacto: '3 produtos órfãos hoje: "Acessórios", "OEE" e "Smart Trac Ultra Gen 2 ".',
  },
  {
    id: 'sku-em-dois-grupos',
    titulo: 'SKU em dois grupos gera linha duplicada',
    aba: 'Code.gs (calculoIndustrializacao)',
    planilha:
      'O loop de correspondência não tem break: um código SAP presente em dois arrays de produto ' +
      'gera as linhas dos dois roteiros.',
    correcao: 'Usa o primeiro mapeamento e sinaliza a ambiguidade para resolução no cadastro.',
    impacto: 'ITCS-0002, ITCS-0019 e ITCH-0011 estão em dois grupos cada.',
  },
  {
    id: 'alocacao-dia-anterior',
    titulo: 'Alocação gravada no dia errado e último dia perdido',
    aba: 'EstudoPorOperador.gs',
    planilha:
      'O acumulado é gravado quando o script detecta troca de dia, mas rotulado com diaAnterior. ' +
      'Na primeira iteração diaAnterior é null (gera a linha vazia com zeros) e, no fim do loop, ' +
      'não há flush — o último dia nunca é gravado.',
    correcao: 'Grava sob o próprio dia e faz o flush final.',
    impacto: 'Primeira linha vazia e o último dia do período sem alocação.',
  },
  {
    id: 'check-feito-ignorado',
    titulo: 'Marcar como feito não exclui da conta',
    aba: 'EstudoPorOperador.gs',
    planilha:
      'A checagem é check == "true", comparando o booleano do checkbox com a string "true". ' +
      'Em JavaScript isso é sempre falso, então a coluna "Check de atividade feita" nunca exclui nada.',
    correcao: 'Processo marcado como feito não consome hora de operador.',
    impacto: 'Atividades concluídas continuam ocupando operador no dimensionamento.',
  },
  {
    id: 'tempo-sem-guarda',
    titulo: 'Tempo estimado sem proteção para Pç/Hr zerado',
    aba: 'Code.gs',
    planilha:
      'tempoEstimado = qtd / pcsHora sem verificar o divisor. Com Pç/Hr vazio ou zero o resultado ' +
      'é Infinity, que aparece como célula vazia na planilha.',
    correcao: 'Tempo fica nulo e o processo entra na lista de pendências de cadastro.',
    impacto:
      'Latente: hoje os 87 processos da Base simplificada têm Pç/Hr preenchido. Mas a aba ' +
      'Demandas Defasagem já tem linhas com Tempo Estimado vazio, resultado do Infinity.',
  },
];

const POR_ID = new Map(DESVIOS.map((d) => [d.id, d]));

/**
 * Falha alto se cenario.correcoes tiver chave que não é desvio conhecido — um id
 * digitado errado viraria "correção sempre desligada" em silêncio.
 */
function validarCorrecoes(correcoes) {
  for (const id of Object.keys(correcoes || {})) {
    if (!POR_ID.has(id)) throw new Error(`desvio desconhecido: ${id}`);
  }
}

/**
 * @param {Record<string, boolean>} correcoes  cenario.correcoes
 * @returns {(id: string) => boolean} true quando a correção está ligada
 */
function corrigido(correcoes) {
  const mapa = correcoes || {};
  validarCorrecoes(mapa);
  return (id) => {
    if (!POR_ID.has(id)) throw new Error(`desvio desconhecido: ${id}`);
    return mapa[id] === true;
  };
}

/** Diagnóstico pronto para a UI: o desvio + o que foi observado neste cálculo. */
function diagnostico(id, detalhe, extra = {}) {
  const desvio = POR_ID.get(id);
  if (!desvio) throw new Error(`desvio desconhecido: ${id}`);
  return { ...desvio, detalhe, ...extra };
}

module.exports = { DESVIOS, POR_ID, corrigido, validarCorrecoes, diagnostico };
