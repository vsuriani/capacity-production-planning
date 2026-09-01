'use strict';

const { query } = require('./db');

/**
 * Os indicadores de Planejado × Realizado, num lugar só.
 *
 * Mora aqui porque duas telas os mostram — a própria aba e o Início — e um dashboard que
 * calcula o mesmo número de dois jeitos é um dashboard que uma hora mente.
 */

/**
 * O recorte dos indicadores: só a montagem final (decisão do usuário).
 *
 * Por TIPO e não pelo nome do processo: hoje todo `producao_montagem` se chama "Processo de
 * montar completo", mas amarrar o KPI ao texto faria um rename no cadastro quebrá-lo em
 * silêncio. Fica de fora o "Montar completo" do Bateria EX Gen2, que é industrialização —
 * submontagem de bateria, não aparelho pronto.
 */
const TIPO_DO_INDICADOR = 'producao_montagem';

/**
 * Peças planejadas × realizadas do cenário, e a aderência ao plano vencido.
 *
 * `planejadoAteHoje` é o que dá sentido ao pace: a aderência é medida contra o plano acumulado
 * até hoje, não contra uma rampa uniforme pelo mês. Sem isso o número acusaria atraso num dia em
 * que nada estava planejado, e perdoaria atraso num dia de pico.
 */
async function indicadoresDoCenario(cenarioId) {
  const { rows } = await query(
    `SELECT
       COALESCE(sum(quantidade), 0)                                          AS planejado,
       COALESCE(sum(quantidade_realizada), 0)                                AS realizado,
       COALESCE(sum(quantidade) FILTER (WHERE dia_ideal <= current_date), 0) AS planejado_ate_hoje,
       count(*)                                                              AS linhas,
       count(*) FILTER (WHERE status_realizado <> 'pendente')                AS apontadas,
       count(*) FILTER (WHERE status_realizado = 'cancelado')                AS canceladas
     FROM demanda_processo
    WHERE cenario_id = $1 AND dia_ideal IS NOT NULL AND tipo_linha = $2`,
    [cenarioId, TIPO_DO_INDICADOR],
  );

  const r = rows[0];
  const planejado = Number(r.planejado);
  const realizado = Number(r.realizado);
  const planejadoAteHoje = Number(r.planejado_ate_hoje);

  return {
    planejado,
    realizado,
    planejadoAteHoje,
    // Sem plano vencido ainda, não existe aderência a medir — null vira "—" na tela, em vez de
    // uma divisão por zero disfarçada de 0%.
    aderencia: planejadoAteHoje > 0 ? realizado / planejadoAteHoje : null,
    conclusao: planejado > 0 ? realizado / planejado : null,
    linhas: Number(r.linhas),
    apontadas: Number(r.apontadas),
    canceladas: Number(r.canceladas),
  };
}

module.exports = { TIPO_DO_INDICADOR, indicadoresDoCenario };
