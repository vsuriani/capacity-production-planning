'use strict';

const { query } = require('./db');

/**
 * Insere uma linha de demanda lançada à mão.
 *
 * Mora aqui porque duas telas criam linha manual — a Lista de demanda e o Planejado × Realizado
 * — e elas têm de nascer idênticas. A diferença entre as duas é só o `diaIdeal`: quem cria pelo
 * Planejado × Realizado precisa da linha já alocada, senão ela cairia no pool da Simulação e não
 * apareceria na própria tela onde foi criada.
 *
 * @param {object} campos  corpo da requisição, em camelCase
 * @param {string} email   quem está criando, para a trilha de autoria
 * @param {{diaIdeal?: string|null}} [opcoes]
 * @returns {Promise<{id: number, skuCodigo: string, processoNome: string}>}
 */
async function inserirLinhaManual(campos, email, { diaIdeal = null } = {}) {
  const b = campos || {};
  const { rows } = await query(
    `INSERT INTO demanda_processo
       (cenario_id, tipo_linha, dia_processo, dia_producao, dia_ideal, sku_codigo, processo_id,
        processo_nome, quantidade, operadores, pcs_hora, tempo_horas, lote, origem,
        atualizado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'manual',$14)
     RETURNING id, sku_codigo, processo_nome`,
    [
      b.cenarioId, b.tipoLinha, b.diaProcesso, b.diaProducao, diaIdeal, b.skuCodigo,
      b.processoId ?? null, b.processoNome || '', b.quantidade ?? 0, b.operadores ?? null,
      b.pcsHora ?? null, b.tempoHoras ?? null, b.lote || '', email,
    ],
  );
  return {
    id: rows[0].id,
    skuCodigo: rows[0].sku_codigo,
    processoNome: rows[0].processo_nome,
  };
}

/** Os campos sem os quais a linha não faz sentido. Devolve a mensagem de erro, ou null. */
function faltandoNaLinhaManual(campos) {
  const b = campos || {};
  if (!b.cenarioId || !b.diaProcesso || !b.diaProducao || !b.skuCodigo || !b.tipoLinha) {
    return 'cenarioId, tipoLinha, diaProcesso, diaProducao e skuCodigo são obrigatórios';
  }
  return null;
}

module.exports = { inserirLinhaManual, faltandoNaLinhaManual };
