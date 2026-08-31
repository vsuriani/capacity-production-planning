'use strict';

const { exigirAuth } = require('../_lib/auth');
const { query, transacao } = require('../_lib/db');

/**
 * Base de PROD (catálogo) + mapa SKU → produto.
 *
 * GET    /api/sku                     -> catálogo, mapeamentos, pendências
 * GET    /api/sku?busca=texto         -> filtra o catálogo
 * POST   /api/sku                     -> { codigo, descricao, grupoItem, ncm } cadastra o código
 * POST   /api/sku?acao=mapear         -> { skuCodigo, produtoId, escopo }
 * DELETE /api/sku?acao=mapear&skuCodigo=&produtoId=&escopo=
 * DELETE /api/sku?codigo=X            -> remove o código (recusa se estiver em uso)
 * PATCH  /api/sku?codigo=X            -> codigo (renomeia), descricao, grupoItem, ncm, ativo
 */
async function handler(req, res) {
  if (!exigirAuth(req, res)) return;

  if (req.method === 'GET') return listar(req, res);
  if (req.method === 'POST' && req.query.acao === 'mapear') return mapear(req, res);
  if (req.method === 'POST') return criar(req, res);
  if (req.method === 'DELETE' && req.query.acao === 'mapear') return desmapear(req, res);
  if (req.method === 'DELETE') return remover(req, res);
  if (req.method === 'PATCH') return atualizar(req, res);

  res.status(405).json({ erro: 'Método não permitido' });
}

/** O código é chave natural e casa por igualdade exata na explosão — normaliza. */
const normalizarCodigo = (bruto) => String(bruto ?? '').trim().toUpperCase();

/** Texto de campo opcional: '' vira null, que é como "sem valor" mora no banco. */
const textoOuNulo = (bruto) => {
  const limpo = String(bruto ?? '').trim();
  return limpo === '' ? null : limpo;
};

/**
 * Onde o código aparece fora da tabela `sku`. Só `processo.sku_filho` tem FK; as outras
 * três guardam o código como texto solto, então renomear e remover têm de olhar para elas
 * na mão.
 */
const REFERENCIAS = [
  { tabela: 'sku_produto', coluna: 'sku_codigo', rotulo: 'mapeamento(s) para produto' },
  { tabela: 'projecao_slot', coluna: 'sku_codigo', rotulo: 'linha(s) na grade do calendário' },
  { tabela: 'demanda_processo', coluna: 'sku_codigo', rotulo: 'linha(s) na lista de demanda' },
  { tabela: 'processo', coluna: 'sku_filho', rotulo: 'processo(s) com ele como produto filho' },
];

async function contarReferencias(codigo) {
  const contagens = await Promise.all(
    REFERENCIAS.map((r) =>
      query(`SELECT count(*)::int AS n FROM ${r.tabela} WHERE ${r.coluna} = $1`, [codigo]),
    ),
  );
  return REFERENCIAS.map((r, i) => ({ ...r, n: contagens[i].rows[0].n })).filter((r) => r.n > 0);
}

async function listar(req, res) {
  const busca = req.query.busca ? `%${String(req.query.busca).toLowerCase()}%` : null;

  const [itens, mapeamentos, semRoteiro, ambiguos, total] = await Promise.all([
    query(
      `SELECT codigo, descricao, grupo_item, ncm, ativo
         FROM sku
        WHERE $1::text IS NULL
           OR lower(codigo) LIKE $1 OR lower(descricao) LIKE $1
        ORDER BY codigo
        LIMIT 500`,
      [busca],
    ),
    query(
      `SELECT sp.sku_codigo, sp.produto_id, pr.nome AS produto, sp.escopo, sp.so_no_codigo_morto,
              (SELECT count(*) FROM processo p WHERE p.produto_id = sp.produto_id)::int AS processos
         FROM sku_produto sp
         JOIN produto pr ON pr.id = sp.produto_id
        ORDER BY sp.sku_codigo, sp.escopo`,
    ),
    // SKU usados na grade de algum cenário que não geram demanda nenhuma.
    query(
      `SELECT s.sku_codigo,
              s.bloco,
              sum(s.quantidade) AS quantidade,
              CASE WHEN sp.sku_codigo IS NULL THEN 'sem mapeamento SKU → produto'
                   ELSE 'produto mapeado sem processos do tipo esperado' END AS motivo
         FROM projecao_slot s
         LEFT JOIN sku_produto sp
           ON sp.sku_codigo = s.sku_codigo
          AND sp.escopo = (CASE WHEN s.bloco = 'industrializacao'
                                THEN 'industrializacao' ELSE 'producao' END)::escopo_sku
         LEFT JOIN processo p
           ON p.produto_id = sp.produto_id
          AND p.tipo_linha = ANY (
                CASE WHEN s.bloco = 'industrializacao'
                     THEN ARRAY['industrializacao']::tipo_linha[]
                     ELSE ARRAY['defasagem','producao_montagem']::tipo_linha[] END)
        WHERE p.id IS NULL
        GROUP BY s.sku_codigo, s.bloco, sp.sku_codigo
        ORDER BY s.sku_codigo`,
    ),
    query(
      `SELECT sku_codigo, escopo, array_agg(pr.nome ORDER BY pr.nome) AS produtos
         FROM sku_produto sp
         JOIN produto pr ON pr.id = sp.produto_id
        GROUP BY sku_codigo, escopo
       HAVING count(*) > 1
        ORDER BY sku_codigo`,
    ),
    query('SELECT count(*)::int AS n FROM sku'),
  ]);

  res.json({
    itens: itens.rows,
    total: total.rows[0].n,
    mapeamentos: mapeamentos.rows,
    pendencias: semRoteiro.rows,
    ambiguos: ambiguos.rows,
  });
}

async function criar(req, res) {
  const b = req.body || {};
  const codigo = normalizarCodigo(b.codigo);
  if (!codigo) return res.status(400).json({ erro: 'codigo é obrigatório' });

  const existe = await query('SELECT 1 FROM sku WHERE codigo = $1', [codigo]);
  if (existe.rows.length) {
    return res.status(409).json({ erro: `O código ${codigo} já existe no catálogo.` });
  }

  await query(
    `INSERT INTO sku (codigo, descricao, grupo_item, ncm, ativo)
     VALUES ($1, $2, $3, $4, COALESCE($5, true))`,
    [codigo, String(b.descricao ?? '').trim(), textoOuNulo(b.grupoItem), textoOuNulo(b.ncm),
     typeof b.ativo === 'boolean' ? b.ativo : null],
  );

  // Mapeamento opcional junto do cadastro: código sem produto não gera linha nenhuma.
  if (b.produtoId) {
    await query(
      `INSERT INTO sku_produto (sku_codigo, produto_id, escopo)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [codigo, Number(b.produtoId), b.escopo || 'producao'],
    );
  }

  res.status(201).json({ codigo });
}

async function mapear(req, res) {
  const { skuCodigo, produtoId, escopo } = req.body || {};
  if (!skuCodigo || !produtoId || !escopo) {
    return res.status(400).json({ erro: 'skuCodigo, produtoId e escopo são obrigatórios' });
  }
  await query(
    `INSERT INTO sku_produto (sku_codigo, produto_id, escopo)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [skuCodigo, produtoId, escopo],
  );
  res.json({ ok: true });
}

async function desmapear(req, res) {
  const { skuCodigo, produtoId, escopo } = req.query;
  if (!skuCodigo || !produtoId || !escopo) {
    return res.status(400).json({ erro: 'skuCodigo, produtoId e escopo são obrigatórios' });
  }
  await query(
    'DELETE FROM sku_produto WHERE sku_codigo = $1 AND produto_id = $2 AND escopo = $3',
    [skuCodigo, Number(produtoId), escopo],
  );
  res.json({ ok: true });
}

/**
 * Atualiza os campos que vierem no corpo — sem `COALESCE`, para dar para limpar grupo e NCM
 * de propósito (mesmo motivo da rota de demandas).
 *
 * `codigo` no corpo renomeia o item, o que é uma operação à parte: ele é a chave e três
 * tabelas o guardam como texto solto.
 */
async function atualizar(req, res) {
  const codigo = req.query.codigo;
  if (!codigo) return res.status(400).json({ erro: 'codigo obrigatório' });
  const b = req.body || {};

  const atual = await query('SELECT 1 FROM sku WHERE codigo = $1', [codigo]);
  if (!atual.rows.length) return res.status(404).json({ erro: `Código ${codigo} não existe.` });

  const campos = [];
  const valores = [codigo];
  const gravar = (coluna, valor) => {
    valores.push(valor);
    campos.push(`${coluna} = $${valores.length}`);
  };

  if (b.descricao !== undefined) gravar('descricao', String(b.descricao ?? '').trim());
  if (b.grupoItem !== undefined) gravar('grupo_item', textoOuNulo(b.grupoItem));
  if (b.ncm !== undefined) gravar('ncm', textoOuNulo(b.ncm));
  if (b.ativo !== undefined) gravar('ativo', Boolean(b.ativo));

  if (campos.length) {
    await query(
      `UPDATE sku SET ${campos.join(', ')}, atualizado = now() WHERE codigo = $1`,
      valores,
    );
  }

  const novo = b.codigo === undefined ? null : normalizarCodigo(b.codigo);
  if (novo !== null && novo !== codigo) {
    if (!novo) return res.status(400).json({ erro: 'O código não pode ficar vazio.' });
    const erro = await renomear(codigo, novo);
    if (erro) return res.status(409).json({ erro });
    return res.json({ ok: true, codigo: novo });
  }

  res.json({ ok: true, codigo });
}

/**
 * Renomear é criar o novo, repontar quem apontava e apagar o velho — nessa ordem, porque a FK
 * de `processo.sku_filho` barra o `UPDATE` direto da chave.
 */
async function renomear(codigo, novo) {
  const ocupado = await query('SELECT 1 FROM sku WHERE codigo = $1', [novo]);
  if (ocupado.rows.length) return `O código ${novo} já existe no catálogo.`;

  await transacao(async (cliente) => {
    await cliente.query(
      `INSERT INTO sku (codigo, descricao, grupo_item, ncm, ativo)
       SELECT $2, descricao, grupo_item, ncm, ativo FROM sku WHERE codigo = $1`,
      [codigo, novo],
    );
    for (const r of REFERENCIAS) {
      await cliente.query(
        `UPDATE ${r.tabela} SET ${r.coluna} = $2 WHERE ${r.coluna} = $1`,
        [codigo, novo],
      );
    }
    await cliente.query('DELETE FROM sku WHERE codigo = $1', [codigo]);
  });
  return null;
}

/** Remove o código do catálogo. Recusa enquanto alguém apontar para ele. */
async function remover(req, res) {
  const codigo = req.query.codigo;
  if (!codigo) return res.status(400).json({ erro: 'codigo obrigatório' });

  const emUso = await contarReferencias(codigo);
  if (emUso.length) {
    return res.status(409).json({
      erro:
        `O código ${codigo} está em uso: ` +
        emUso.map((r) => `${r.n} ${r.rotulo}`).join(', ') +
        '. Desfaça esses vínculos antes de remover.',
    });
  }

  const { rows } = await query('DELETE FROM sku WHERE codigo = $1 RETURNING codigo', [codigo]);
  if (!rows.length) return res.status(404).json({ erro: `Código ${codigo} não existe.` });
  res.json({ ok: true });
}

module.exports = { handler };
