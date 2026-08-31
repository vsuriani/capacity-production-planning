'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query } = require('../_lib/db');

/**
 * Processos e sequências (aba Base simplificada).
 *
 * GET    /api/roteiros                          -> produtos + processos + pendências
 * POST   /api/roteiros                          -> cria processo
 * POST   /api/roteiros?acao=produto             -> cria produto  { nome }
 * PATCH  /api/roteiros?id=N                     -> altera processo
 * PATCH  /api/roteiros?acao=produto&id=N        -> renomeia produto  { nome }
 * POST   /api/roteiros?acao=filho               -> anexa produto filho { processoId, skuCodigo }
 * DELETE /api/roteiros?acao=filho&processoId=N&skuCodigo=X -> desanexa
 * DELETE /api/roteiros?id=N                     -> remove processo
 * DELETE /api/roteiros?acao=produto&id=N        -> remove produto (recusa se em uso)
 * DELETE /api/roteiros?acao=produto&id=N&cascata=1 -> remove produto + roteiro + mapeamentos
 */
const CAMPOS = {
  produtoId: 'produto_id',
  tipoLinha: 'tipo_linha',
  nome: 'nome',
  sequencia: 'sequencia',
  paralelismo: 'paralelismo',
  leadtimeDias: 'leadtime_dias',
  operadores: 'operadores',
  pcsHora: 'pcs_hora',
  origemTotalDia: 'origem_total_dia',
};
// `skusFilho` não entra aqui: desde a migration 007 é uma tabela, não uma coluna. Anexa e
// desanexa pelas ações `filho`, no mesmo espírito de `sku?acao=mapear`.

async function handler(req, res) {
  if (!exigirAuth(req, res)) return;
  const id = req.query.id ? Number(req.query.id) : null;

  if (req.method === 'GET') return listar(res);
  if (req.method === 'POST') {
    if (req.query.acao === 'produto') return criarProduto(req, res);
    if (req.query.acao === 'filho') return anexarFilho(req, res);
    return criar(req, res);
  }
  if (req.method === 'PATCH') {
    return req.query.acao === 'produto' ? renomearProduto(id, req, res) : atualizar(id, req, res);
  }
  if (req.method === 'DELETE') {
    if (req.query.acao === 'filho') return desanexarFilho(req, res);
    if (!id) return res.status(400).json({ erro: 'id obrigatório' });
    if (req.query.acao === 'produto') return removerProduto(id, req, res);
    await query('DELETE FROM processo WHERE id = $1', [id]);
    return res.json({ ok: true });
  }
  res.status(405).json({ erro: 'Método não permitido' });
}

async function listar(res) {
  const [produtos, processos, aliases, semRoteiro] = await Promise.all([
    query('SELECT id, nome, ativo FROM produto ORDER BY nome'),
    query(
      // Os filhos vêm como array na própria linha: a tela desenha um chip por SKU, e um
      // segundo request só para isso deixaria a lista e os chips fora de sincronia.
      // `COALESCE(…, '{}')` para o processo sem filho nenhum chegar como [] e não como null.
      `SELECT p.id, p.produto_id, pr.nome AS produto, p.tipo_linha, p.nome, p.sequencia,
              p.paralelismo, p.leadtime_dias, p.operadores, p.pcs_hora,
              p.origem_total_dia,
              (p.pcs_hora IS NULL OR p.pcs_hora <= 0) AS sem_taxa,
              COALESCE((SELECT array_agg(f.sku_codigo ORDER BY f.sku_codigo)
                          FROM processo_sku_filho f WHERE f.processo_id = p.id), '{}') AS skus_filho
         FROM processo p
         JOIN produto pr ON pr.id = p.produto_id
        ORDER BY pr.nome, p.tipo_linha, p.sequencia NULLS LAST, p.id`,
    ),
    query('SELECT produto_id, alias FROM produto_alias ORDER BY alias'),
    // Produtos citados no mapa SKU→produto que não têm nenhum processo cadastrado.
    query(
      `SELECT DISTINCT pr.id, pr.nome
         FROM produto pr
         JOIN sku_produto sp ON sp.produto_id = pr.id
        WHERE NOT EXISTS (SELECT 1 FROM processo p WHERE p.produto_id = pr.id)
        ORDER BY pr.nome`,
    ),
  ]);

  res.json({
    produtos: produtos.rows,
    processos: processos.rows,
    aliases: aliases.rows,
    produtosSemRoteiro: semRoteiro.rows,
  });
}

/**
 * Cria um produto (a unidade de roteiro).
 *
 * Produto é cadastro global — não pertence a cenário nenhum, e é por isso que criar um aqui
 * basta para ele já aparecer no seletor de todo processo. Nasce sem roteiro: a tela mostra o
 * grupo vazio para que o primeiro passo seja lançado em seguida.
 *
 * O nome é chave natural (`produto.nome` é UNIQUE) e a planilha tinha "Smart Trac Ultra Gen 2" e
 * "Smart Trac Ultra Gen 2 " como produtos distintos — daí o `trim()` antes de gravar. Nome que
 * já existe volta 409 com o id de quem ocupou, para a tela poder apontar o produto certo em vez
 * de só reclamar.
 */
async function criarProduto(req, res) {
  const nome = String(req.body?.nome ?? '').trim();
  if (!nome) return res.status(400).json({ erro: 'nome é obrigatório' });

  const { rows: existente } = await query('SELECT id FROM produto WHERE nome = $1', [nome]);
  if (existente[0]) {
    return res.status(409).json({ erro: `Já existe o produto "${nome}"`, id: existente[0].id });
  }

  const { rows } = await query('INSERT INTO produto (nome) VALUES ($1) RETURNING id, nome', [nome]);
  res.json(rows[0]);
}

/**
 * Quem aponta para um produto. As três têm FK com `ON DELETE CASCADE`, então apagar o produto
 * apaga tudo isto junto — contar antes é o que deixa a tela dizer o tamanho do estrago em vez
 * de descobrir depois.
 */
const USO_DO_PRODUTO = [
  { tabela: 'processo', rotulo: 'processo(s) no roteiro' },
  { tabela: 'sku_produto', rotulo: 'mapeamento(s) de SKU' },
  { tabela: 'produto_alias', rotulo: 'alias de nome' },
];

async function contarUsoDoProduto(id) {
  const contagens = await Promise.all(
    USO_DO_PRODUTO.map((r) =>
      query(`SELECT count(*)::int AS n FROM ${r.tabela} WHERE produto_id = $1`, [id]),
    ),
  );
  return USO_DO_PRODUTO.map((r, i) => ({ ...r, n: contagens[i].rows[0].n })).filter((r) => r.n > 0);
}

/**
 * Renomeia o produto.
 *
 * Barato e seguro: **nada referencia produto por texto**. `produto_alias` é escrito só pelo
 * importador e lido só pela listagem, e as três FKs são por id — então um UPDATE no nome basta,
 * sem repontar ninguém (é o oposto de renomear um SKU, que é chave natural em quatro tabelas).
 *
 * O nome antigo não vira alias: alias existe para absorver grafia divergente da planilha na
 * importação, não para guardar histórico de rename.
 */
async function renomearProduto(id, req, res) {
  if (!id) return res.status(400).json({ erro: 'id obrigatório' });

  const nome = String(req.body?.nome ?? '').trim();
  if (!nome) return res.status(400).json({ erro: 'nome é obrigatório' });

  const { rows: atual } = await query('SELECT nome FROM produto WHERE id = $1', [id]);
  if (!atual[0]) return res.status(404).json({ erro: `Produto #${id} não existe.` });

  // Mesma forma de `criarProduto`: o 409 devolve o id de quem ocupou, para a tela apontar o
  // produto certo em vez de só reclamar.
  const { rows: ocupado } = await query('SELECT id FROM produto WHERE nome = $1 AND id <> $2', [
    nome,
    id,
  ]);
  if (ocupado[0]) {
    return res.status(409).json({ erro: `Já existe o produto "${nome}"`, id: ocupado[0].id });
  }

  const { rows } = await query(
    'UPDATE produto SET nome = $2 WHERE id = $1 RETURNING id, nome',
    [id, nome],
  );
  res.json(rows[0]);
}

/**
 * Remove o produto. Sem `?cascata=1`, recusa enquanto alguém apontar para ele.
 *
 * O padrão é o de `sku.js`: recusar com a lista do que está em uso. A diferença é que aqui
 * existe o caminho de forçar, porque exigir apagar 10 processos um a um antes de apagar o
 * produto não é usável — e as FKs já sabem cascatear. O flag tem de ser explícito para que
 * nenhum DELETE acidental (um id errado, um retry) leve um roteiro inteiro embora.
 */
async function removerProduto(id, req, res) {
  const { rows: atual } = await query('SELECT nome FROM produto WHERE id = $1', [id]);
  if (!atual[0]) return res.status(404).json({ erro: `Produto #${id} não existe.` });
  const nome = atual[0].nome;

  const emUso = await contarUsoDoProduto(id);
  if (emUso.length && req.query.cascata !== '1') {
    return res.status(409).json({
      erro:
        `O produto "${nome}" está em uso: ` +
        emUso.map((r) => `${r.n} ${r.rotulo}`).join(', ') +
        '. Remover leva tudo isso junto — repita com cascata=1 para confirmar.',
      emUso,
    });
  }

  // Contado antes do DELETE: depois da cascata não há o que contar.
  const removidos = Object.fromEntries(USO_DO_PRODUTO.map((r) => [r.tabela, 0]));
  for (const r of emUso) removidos[r.tabela] = r.n;

  await query('DELETE FROM produto WHERE id = $1', [id]);
  res.json({ ok: true, nome, removidos });
}

async function criar(req, res) {
  const b = req.body || {};
  if (!b.produtoId || !b.tipoLinha || !b.nome) {
    return res.status(400).json({ erro: 'produtoId, tipoLinha e nome são obrigatórios' });
  }
  const { rows } = await query(
    `INSERT INTO processo (produto_id, tipo_linha, nome, sequencia, paralelismo,
                           leadtime_dias, operadores, pcs_hora, origem_total_dia)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      b.produtoId, b.tipoLinha, b.nome, b.sequencia ?? null, b.paralelismo ?? null,
      b.leadtimeDias ?? 0, b.operadores ?? null, b.pcsHora ?? null,
      b.origemTotalDia || 'taxa',
    ],
  );

  // Lista opcional no cadastro, para o seed conseguir recriar um processo inteiro num POST só.
  // Pela tela os filhos são anexados depois, um chip por vez.
  for (const sku of b.skusFilho ?? []) {
    await query(
      `INSERT INTO processo_sku_filho (processo_id, sku_codigo)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [rows[0].id, String(sku).trim()],
    );
  }

  res.json({ id: rows[0].id });
}

/**
 * Anexa um SKU à lista de produtos filhos do processo.
 *
 * `ON CONFLICT DO NOTHING` porque a PK é o par: clicar duas vezes no mesmo SKU não é erro,
 * é a mesma verdade. A FK para `sku(codigo)` é quem barra um código que não está na Base de
 * PROD — traduzida aqui em 400, senão a tela mostraria "Erro interno".
 */
async function anexarFilho(req, res) {
  const processoId = Number(req.body?.processoId);
  const skuCodigo = String(req.body?.skuCodigo ?? '').trim();
  if (!processoId || !skuCodigo) {
    return res.status(400).json({ erro: 'processoId e skuCodigo são obrigatórios' });
  }

  const { rows } = await query('SELECT 1 FROM sku WHERE codigo = $1', [skuCodigo]);
  if (!rows.length) {
    return res.status(400).json({ erro: `O código ${skuCodigo} não está na Base de PROD.` });
  }

  await query(
    `INSERT INTO processo_sku_filho (processo_id, sku_codigo)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [processoId, skuCodigo],
  );
  res.json({ ok: true });
}

async function desanexarFilho(req, res) {
  const processoId = Number(req.query.processoId);
  const skuCodigo = String(req.query.skuCodigo ?? '').trim();
  if (!processoId || !skuCodigo) {
    return res.status(400).json({ erro: 'processoId e skuCodigo são obrigatórios' });
  }
  await query('DELETE FROM processo_sku_filho WHERE processo_id = $1 AND sku_codigo = $2', [
    processoId,
    skuCodigo,
  ]);
  res.json({ ok: true });
}

async function atualizar(id, req, res) {
  if (!id) return res.status(400).json({ erro: 'id obrigatório' });

  const sets = [];
  const valores = [id];
  for (const [chave, coluna] of Object.entries(CAMPOS)) {
    if (req.body?.[chave] !== undefined) {
      valores.push(req.body[chave]);
      sets.push(`${coluna} = $${valores.length}`);
    }
  }
  if (!sets.length) return res.status(400).json({ erro: 'nada para atualizar' });

  await query(`UPDATE processo SET ${sets.join(', ')} WHERE id = $1`, valores);
  res.json({ ok: true });
}

module.exports = { handler };
