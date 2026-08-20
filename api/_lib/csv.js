'use strict';

/**
 * CSV para abrir no Sheets/Excel em pt-BR.
 *
 * Duas decisões que vieram da exportação da Lista de demanda e valem para qualquer saída:
 * separador `;` e decimal com vírgula (é o que o Sheets em pt-BR reconhece como número), e
 * BOM na frente, para o Excel abrir em UTF-8 sem perguntar.
 */

function celulaCsv(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'boolean') return valor ? 'VERDADEIRO' : 'FALSO';
  const texto = typeof valor === 'number' ? String(valor).replace('.', ',') : String(valor);
  return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/**
 * @param {[string, string][]} colunas  pares [campo, rótulo]
 * @param {object[]} linhas
 */
function montarCsv(colunas, linhas) {
  const cabecalho = colunas.map(([, rotulo]) => rotulo).join(';');
  const corpo = linhas.map((l) => colunas.map(([campo]) => celulaCsv(l[campo])).join(';'));
  return '﻿' + [cabecalho, ...corpo].join('\r\n');
}

function responderCsv(res, nomeArquivo, colunas, linhas) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
  res.send(montarCsv(colunas, linhas));
}

module.exports = { celulaCsv, montarCsv, responderCsv };
