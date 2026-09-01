'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query } = require('../_lib/db');
const { inserirLinhaManual, faltandoNaLinhaManual } = require('../_lib/demanda');

/**
 * Planejado × Realizado: o apontamento de produção.
 *
 * Fecha o ciclo que terminava na Simulação ideal. Lista o que foi **alocado** lá
 * (`dia_ideal IS NOT NULL`) e recebe, linha a linha, o que de fato aconteceu: feito inteiro,
 * feito em parte (e quanto), ou cancelado.
 *
 * GET    /api/realizado?cenario=N[&de=&ate=&tipo=&pendentes=1] -> linhas + indicadores + log
 * PATCH  /api/realizado?id=N       -> { status, quantidadeRealizada }
 * POST   /api/realizado?cenario=N  -> linha manual, já alocada no dia
 * DELETE /api/realizado?id=N       -> só linha manual
 */

/**
 * Os indicadores olham só para a montagem final (decisão do usuário).
 *
 * Por TIPO e não pelo nome do processo: hoje todo `producao_montagem` se chama "Processo de
 * montar completo", mas amarrar o KPI ao texto faria um rename no cadastro quebrá-lo em
 * silêncio. Fica de fora o "Montar completo" do Bateria EX Gen2, que é industrialização —
 * submontagem de bateria, não aparelho pronto.
 */
const TIPO_DO_INDICADOR = 'producao_montagem';

const STATUS = ['pendente', 'total', 'parcial', 'cancelado'];

async function handler(req, res) {
  const email = exigirAuth(req, res);
  if (!email) return;

  if (req.method === 'GET') return obter(req, res);
  if (req.method === 'POST') return criar(req, res, email);
  if (req.method === 'PATCH') return apontar(req, res, email);
  if (req.method === 'DELETE') return remover(req, res, email);

  res.status(405).json({ erro: 'Método não permitido' });
}

// ---------------------------------------------------------------- leitura

async function obter(req, res) {
  const cenarioId = Number(req.query.cenario);
  if (!cenarioId) return res.status(400).json({ erro: 'cenario obrigatório' });

  const [linhas, log] = await Promise.all([
    query(
      `SELECT id, tipo_linha, dia_ideal::text, dia_processo::text, dia_producao::text,
              sku_codigo, processo_id, processo_nome, quantidade, operadores, pcs_hora,
              tempo_horas, lote, origem, status_realizado, quantidade_realizada,
              apontado_por, apontado_em
         FROM demanda_processo
        WHERE cenario_id = $1
          AND dia_ideal IS NOT NULL
          AND ($2::date IS NULL OR dia_ideal >= $2)
          AND ($3::date IS NULL OR dia_ideal <= $3)
          AND ($4::text IS NULL OR tipo_linha::text = $4)
          AND ($5::boolean IS NOT TRUE OR status_realizado = 'pendente')
        ORDER BY dia_ideal, tipo_linha, sku_codigo, processo_nome`,
      [
        cenarioId,
        req.query.de || null,
        req.query.ate || null,
        req.query.tipo || null,
        req.query.pendentes === '1',
      ],
    ),
    query(
      `SELECT id, demanda_id, quando, quem, acao, sku_codigo, processo_nome, detalhe
         FROM apontamento_evento
        WHERE cenario_id = $1
        ORDER BY quando DESC, id DESC
        LIMIT 200`,
      [cenarioId],
    ),
  ]);

  res.json({
    linhas: linhas.rows,
    log: log.rows,
    tipoDoIndicador: TIPO_DO_INDICADOR,
    indicadores: await calcularIndicadores(cenarioId),
  });
}

/**
 * Os dois indicadores, ambos em PEÇAS e restritos à montagem final.
 *
 * `planejadoAteHoje` é o que dá sentido ao pace: a aderência é medida contra o plano acumulado
 * até hoje, não contra uma rampa uniforme pelo mês. Sem isso o número acusaria atraso num dia em
 * que nada estava planejado, e perdoaria atraso num dia de pico.
 *
 * Os filtros da tela NÃO entram aqui de propósito — indicador que muda quando se filtra a tabela
 * não é indicador do mês, é soma de tela.
 */
async function calcularIndicadores(cenarioId) {
  const { rows } = await query(
    `SELECT
       COALESCE(sum(quantidade), 0)                                        AS planejado,
       COALESCE(sum(quantidade_realizada), 0)                              AS realizado,
       COALESCE(sum(quantidade) FILTER (WHERE dia_ideal <= current_date), 0) AS planejado_ate_hoje,
       count(*)                                                            AS linhas,
       count(*) FILTER (WHERE status_realizado <> 'pendente')              AS apontadas,
       count(*) FILTER (WHERE status_realizado = 'cancelado')              AS canceladas
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

// ---------------------------------------------------------------- escrita

/**
 * Aponta uma linha.
 *
 * A quantidade é derivada do status, não aceita solta: 'total' copia o planejado, 'cancelado'
 * grava 0 e 'pendente' limpa. Só 'parcial' pede número — e ele tem de caber no planejado, senão
 * o realizado do mês passaria do planejado sem ninguém perceber.
 */
async function apontar(req, res, email) {
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ erro: 'id obrigatório' });

  const status = String(req.body?.status ?? '');
  if (!STATUS.includes(status)) {
    return res.status(400).json({ erro: `status deve ser um de: ${STATUS.join(', ')}` });
  }

  const [linha] = (
    await query(
      `SELECT cenario_id, sku_codigo, processo_nome, quantidade, status_realizado
         FROM demanda_processo WHERE id = $1`,
      [id],
    )
  ).rows;
  if (!linha) return res.status(404).json({ erro: `Linha #${id} não existe.` });

  const planejado = Number(linha.quantidade);
  let quantidade;
  if (status === 'total') quantidade = planejado;
  else if (status === 'cancelado') quantidade = 0;
  else if (status === 'pendente') quantidade = null;
  else {
    quantidade = Number(req.body?.quantidadeRealizada);
    if (!Number.isFinite(quantidade) || quantidade < 0) {
      return res.status(400).json({ erro: 'Informe a quantidade realizada.' });
    }
    if (quantidade > planejado) {
      return res.status(400).json({
        erro: `A quantidade realizada (${quantidade}) passa do planejado (${planejado}).`,
      });
    }
  }

  // `feito` acompanha: é o mesmo fato que a Lista de demanda mostra no check.
  const feito = status === 'total';
  await query(
    `UPDATE demanda_processo
        SET status_realizado = $2, quantidade_realizada = $3,
            apontado_por = $4, apontado_em = now(),
            feito = $5,
            feito_por = CASE WHEN $5 THEN $4 ELSE NULL END,
            feito_em  = CASE WHEN $5 THEN now() ELSE NULL END,
            atualizado_por = $4, atualizado_em = now()
      WHERE id = $1`,
    [id, status, quantidade, email, feito],
  );

  await registrar(linha.cenario_id, id, email, 'apontou', linha, descreverApontamento(status, quantidade, planejado));
  res.json({ ok: true });
}

function descreverApontamento(status, quantidade, planejado) {
  if (status === 'pendente') return 'voltou para pendente';
  if (status === 'cancelado') return `cancelado (${planejado} pç planejadas)`;
  if (status === 'total') return `realizado total: ${planejado} pç`;
  return `realizado parcial: ${quantidade} de ${planejado} pç`;
}

/** Linha manual desta tela nasce ALOCADA — senão iria para o pool e sumiria da própria tela. */
async function criar(req, res, email) {
  const cenarioId = Number(req.query.cenario);
  if (!cenarioId) return res.status(400).json({ erro: 'cenario obrigatório' });

  const campos = { ...(req.body || {}), cenarioId };
  const falta = faltandoNaLinhaManual(campos);
  if (falta) return res.status(400).json({ erro: falta });

  const criada = await inserirLinhaManual(campos, email, { diaIdeal: campos.diaProcesso });
  await registrar(
    cenarioId,
    criada.id,
    email,
    'criou-linha',
    { sku_codigo: criada.skuCodigo, processo_nome: criada.processoNome },
    `linha manual em ${campos.diaProcesso}`,
  );
  res.json({ id: criada.id });
}

/** Só sai o que foi lançado à mão: apagar demanda gerada é assunto da Lista de demanda. */
async function remover(req, res, email) {
  const id = Number(req.query.id);
  if (!id) return res.status(400).json({ erro: 'id obrigatório' });

  const [linha] = (
    await query(
      'SELECT cenario_id, sku_codigo, processo_nome, origem FROM demanda_processo WHERE id = $1',
      [id],
    )
  ).rows;
  if (!linha) return res.status(404).json({ erro: `Linha #${id} não existe.` });
  if (linha.origem !== 'manual') {
    return res.status(409).json({
      erro: 'Esta linha veio da geração. Remova pela Lista de demanda, ou aponte como cancelada.',
    });
  }

  await query('DELETE FROM demanda_processo WHERE id = $1', [id]);
  await registrar(linha.cenario_id, null, email, 'removeu-linha', linha, 'linha manual removida');
  res.json({ ok: true });
}

/** O SKU e o processo vão copiados: o evento tem de sobreviver à exclusão da linha. */
function registrar(cenarioId, demandaId, quem, acao, linha, detalhe) {
  return query(
    `INSERT INTO apontamento_evento
       (cenario_id, demanda_id, quem, acao, sku_codigo, processo_nome, detalhe)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [cenarioId, demandaId, quem, acao, linha.sku_codigo || '', linha.processo_nome || '', detalhe],
  );
}

module.exports = { handler };
