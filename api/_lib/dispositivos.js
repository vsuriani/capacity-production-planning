'use strict';

/**
 * Normalização de nome de dispositivo.
 *
 * O catálogo em si mora no banco (`dispositivo`, semeado por
 * `006_catalogo_dispositivos.sql`). O que mora aqui é o de-para necessário nos dois caminhos
 * que criam linha a partir de **texto solto**, e que por isso podem ressuscitar um nome antigo
 * num banco zerado:
 *
 *   - `importacao.js`   — o payload de `scripts/importar_planilha.py`, que lê a planilha e
 *                         ainda traz "OEE Trac" e os quatro dispositivos escondidos;
 *   - `dimensionamento.js` (`?acao=tempos`) — a carga da tabela de tempos do Global, cuja
 *                         origem (`docs/tempos-dispositivo.tsv`) também é da planilha.
 *
 * A planilha é somente leitura e não vai ser corrigida na origem, então a tradução acontece na
 * entrada.
 */

/** Nome antigo -> nome atual. O rename em si é feito pela migration; isto é para o texto que chega depois. */
const RENOMEADOS = {
  'OEE Trac': 'Uni Trac 2.0',
};

/**
 * Dispositivos que a planilha lista mas que saíram de uso — nascem `ativo = false`.
 *
 * Em banco que já rodou as migrations 005/006 isto é redundante; existe para o banco zerado,
 * onde a importação insere a linha do nada e ela voltaria ativa.
 */
const OCULTOS = [
  'Ima na Base',
  'Tampografia',
  'Bateria EX',
  'Garra OEE Trac',
];

const nomeCanonico = (nome) => RENOMEADOS[nome] ?? nome;

const estaOculto = (nome) => OCULTOS.includes(nomeCanonico(nome));

module.exports = { RENOMEADOS, OCULTOS, nomeCanonico, estaOculto };
