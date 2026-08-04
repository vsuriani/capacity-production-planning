'use strict';

const { corrigido } = require('./desvios');

/**
 * Datas trafegam como 'YYYY-MM-DD' e são manipuladas em UTC — a planilha e o Apps
 * Script trabalhavam com Date local, o que embaralhava o dia perto da meia-noite.
 */

function paraData(iso) {
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function paraIso(data) {
  return data.toISOString().slice(0, 10);
}

function somarDias(iso, dias) {
  const d = paraData(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return paraIso(d);
}

/** 0 = domingo … 6 = sábado */
function diaDaSemana(iso) {
  return paraData(iso).getUTCDay();
}

/**
 * Porte literal de `diaSemana()` do Código.gs: sábado volta 1 dia, domingo volta 2 —
 * ambos caem na sexta.
 */
function puxarParaSexta(iso) {
  const dow = diaDaSemana(iso);
  if (dow === 6) return somarDias(iso, -1);
  if (dow === 0) return somarDias(iso, -2);
  return iso;
}

/**
 * Porte literal de `diaDefasagem()` do Código.gs, na mesma ordem de avaliação.
 * A ordem importa: `leadTime == 1` é testado DEPOIS dos ramos de segunda/terça.
 */
function diaDefasagemFiel(isoProducao, leadTime) {
  const dow = diaDaSemana(isoProducao);
  const lt = Number(leadTime);

  if (dow === 1 && lt === 2) return puxarParaSexta(somarDias(isoProducao, -lt));
  if (dow === 2 && lt === 2) return puxarParaSexta(somarDias(isoProducao, -(lt - 1)));
  if ((dow === 1 || dow === 2) && lt >= 3) return puxarParaSexta(somarDias(isoProducao, -(lt + 1)));
  if (lt === 1) return puxarParaSexta(isoProducao);
  if (dow === 3 && lt === 5) return puxarParaSexta(somarDias(isoProducao, -(lt + 1)));
  if (dow === 3 && (lt === 3 || lt === 2)) return puxarParaSexta(somarDias(isoProducao, -(lt - 1)));
  if (dow >= 4 && lt < 4) return puxarParaSexta(somarDias(isoProducao, -(lt - 1)));
  return puxarParaSexta(somarDias(isoProducao, -lt));
}

/**
 * Subtrai N dias úteis de verdade, pulando fim de semana e feriados.
 * leadTime 0 ou 1 = o próprio dia (mantém a semântica de "produz no mesmo dia").
 */
function subtrairDiasUteis(isoProducao, leadTime, feriados = new Set()) {
  const ehUtil = (iso) => {
    const dow = diaDaSemana(iso);
    return dow !== 0 && dow !== 6 && !feriados.has(iso);
  };

  let atual = isoProducao;
  while (!ehUtil(atual)) atual = somarDias(atual, -1);

  let restantes = Math.max(0, Number(leadTime) - 1);
  while (restantes > 0) {
    atual = somarDias(atual, -1);
    if (ehUtil(atual)) restantes--;
  }
  return atual;
}

/** Escolhe a implementação conforme cenario.correcoes. */
function diaDoProcesso(isoProducao, leadTime, correcoes = {}, feriados = new Set()) {
  return corrigido(correcoes)('leadtime-caso-a-caso')
    ? subtrairDiasUteis(isoProducao, leadTime, feriados)
    : diaDefasagemFiel(isoProducao, leadTime);
}

/**
 * Grade da aba "Projeção das linhas": 5 semanas × 6 dias (seg–sáb), começando na
 * primeira segunda-feira do mês.
 *
 * Porte da fórmula C6: IF(WEEKDAY(DATE(ano;mes;2))=2; DATE(ano;mes;2);
 *                        DATE(ano;mes;2) - WEEKDAY(DATE(ano;mes;2)) + 2)
 * WEEKDAY do Sheets é 1=domingo…7=sábado; getUTCDay é 0=domingo…6=sábado.
 */
function gradeDoMes(mes, ano) {
  const diaDois = paraIso(new Date(Date.UTC(ano, mes - 1, 2)));
  const weekdaySheets = diaDaSemana(diaDois) + 1;
  const inicio = weekdaySheets === 2 ? diaDois : somarDias(diaDois, -weekdaySheets + 2);

  const semanas = [];
  let cursor = inicio;
  for (let s = 0; s < 5; s++) {
    const dias = [];
    for (let d = 0; d < 6; d++) {
      dias.push(cursor);
      cursor = somarDias(cursor, 1);
    }
    cursor = somarDias(cursor, 1); // pula o domingo
    semanas.push({ semana: s + 1, dias });
  }
  return semanas;
}

/** `dataLote()` do Código.gs: "#" + yyyyMMdd. */
function loteDaData(iso) {
  return `#${String(iso).slice(0, 10).replace(/-/g, '')}`;
}

module.exports = {
  paraData,
  paraIso,
  somarDias,
  diaDaSemana,
  puxarParaSexta,
  diaDefasagemFiel,
  subtrairDiasUteis,
  diaDoProcesso,
  gradeDoMes,
  loteDaData,
};
