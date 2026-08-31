/**
 * Recarrega `seeds/cadastros.json` num banco vazio, pelas rotas /api reais.
 *
 * O par de `exportar_cadastros.mjs`. O caso de uso é o banco de dev recriado do zero: o
 * dev-server sobe, aplica as migrations e fica com as tabelas vazias — daí este script
 * devolve produtos, roteiros, catálogo de SKU e o mapa SKU→produto.
 *
 * **Remapeia produto por nome.** Os ids do banco novo não são os do dump; o que casa as duas
 * pontas é `produto.nome`, que é UNIQUE no schema. Produto que já existe volta 409 com o id
 * de quem ocupou, e é esse id que entra no mapa — por isso rodar de novo não duplica produto.
 *
 * **Não é idempotente para processo.** `POST /api/roteiros` sempre insere, então rodar duas
 * vezes contra um banco que já tem roteiro duplica os passos. Por isso o script recusa
 * carregar quando já existe processo cadastrado, a menos que venha `--forcar`.
 *
 * Uso:
 *   node scripts/carregar_cadastros.mjs
 *   node scripts/carregar_cadastros.mjs --arquivo seeds/cadastros.json --api http://localhost:3101
 *   node scripts/carregar_cadastros.mjs --forcar     # aceita banco que já tem roteiro
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opcao = (nome, padrao = null) => {
  const i = args.indexOf(`--${nome}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao
}
const temFlag = (nome) => args.includes(`--${nome}`)

const API = opcao('api', 'http://localhost:3101').replace(/\/$/, '')
const EMAIL = opcao('email', 'vsuriani@tractian.com')
const ARQUIVO = path.join(import.meta.dirname, '..', opcao('arquivo', 'seeds/cadastros.json'))

async function pedir(metodo, rota, corpo) {
  const r = await fetch(`${API}/api/${rota}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'X-Auth-Email': EMAIL },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  const texto = await r.text()
  const dados = texto ? JSON.parse(texto) : null
  if (!r.ok && r.status !== 409) {
    throw new Error(`${metodo} ${rota} -> ${r.status} ${texto.slice(0, 300)}`)
  }
  return { status: r.status, dados }
}

const seed = JSON.parse(readFileSync(ARQUIVO, 'utf8'))
console.log(`seed de ${seed.gerado_em} (${seed.origem})`)

const atual = await pedir('GET', 'roteiros')
if (atual.dados.processos.length > 0 && !temFlag('forcar')) {
  console.error(
    `\nO banco já tem ${atual.dados.processos.length} processo(s). Carregar por cima ia ` +
      `duplicar os passos do roteiro (POST /api/roteiros sempre insere).\n` +
      `Se é isso mesmo que você quer, repita com --forcar.`,
  )
  process.exit(1)
}

// ---------------------------------------------------------------- produtos

const idDoProduto = new Map()
let produtosNovos = 0
for (const p of seed.produtos) {
  const { status, dados } = await pedir('POST', 'roteiros?acao=produto', { nome: p.nome })
  // 409 traz o id de quem já ocupava o nome — é o remapeamento acontecendo.
  idDoProduto.set(p.nome, dados.id)
  if (status !== 409) produtosNovos++
}
console.log(`  produtos     ${produtosNovos} criados, ${seed.produtos.length - produtosNovos} já existiam`)

const idOuFalha = (nome, onde) => {
  const id = idDoProduto.get(nome)
  if (!id) throw new Error(`${onde}: produto "${nome}" não está em seed.produtos`)
  return id
}

// ---------------------------------------------------------------- processos

// Os produtos filhos ficam para depois do bloco de SKU: `processo_sku_filho` tem FK para
// `sku(codigo)`, e neste ponto o catálogo ainda está vazio. Guarda o id de cada processo
// criado para reencontrá-lo lá embaixo.
const idDoProcesso = []
for (const p of seed.processos) {
  const { dados } = await pedir('POST', 'roteiros', {
    produtoId: idOuFalha(p.produto, `processo "${p.nome}"`),
    tipoLinha: p.tipo_linha,
    nome: p.nome,
    sequencia: p.sequencia,
    paralelismo: p.paralelismo,
    leadtimeDias: p.leadtime_dias,
    operadores: p.operadores,
    pcsHora: p.pcs_hora,
    origemTotalDia: p.origem_total_dia,
  })
  idDoProcesso.push(dados.id)
}
console.log(`  processos    ${seed.processos.length} criados`)

// ---------------------------------------------------------------- sku

let skuNovos = 0
for (const s of seed.sku) {
  const { status } = await pedir('POST', 'sku', {
    codigo: s.codigo,
    descricao: s.descricao,
    grupoItem: s.grupo_item,
    ncm: s.ncm,
    ativo: s.ativo,
  })
  if (status !== 409) skuNovos++
}
console.log(`  sku          ${skuNovos} criados, ${seed.sku.length - skuNovos} já existiam`)

// ---------------------------------------------------------------- mapeamentos

// A rota faz ON CONFLICT DO NOTHING, então isto é idempotente de verdade.
for (const m of seed.mapeamentos) {
  await pedir('POST', 'sku?acao=mapear', {
    skuCodigo: m.sku_codigo,
    produtoId: idOuFalha(m.produto, `mapeamento de ${m.sku_codigo}`),
    escopo: m.escopo,
  })
}
console.log(`  mapeamentos  ${seed.mapeamentos.length} aplicados`)

// ---------------------------------------------------------------- produtos filhos

// Agora que o catálogo existe, a FK de `processo_sku_filho` deixa anexar.
let filhos = 0
for (const [i, p] of seed.processos.entries()) {
  for (const sku of p.skus_filho ?? []) {
    await pedir('POST', 'roteiros?acao=filho', { processoId: idDoProcesso[i], skuCodigo: sku })
    filhos++
  }
}
console.log(`  filhos       ${filhos} anexados`)

// ---------------------------------------------------------------- o que não volta

// Duas colunas não têm rota de escrita hoje. Em vez de restaurar pela metade em silêncio, o
// script imprime o SQL — é raro, é uma linha, e some no dia em que a rota existir.
const pendencias = []
for (const a of seed.aliases) {
  pendencias.push(
    `INSERT INTO produto_alias (produto_id, alias) SELECT id, ${sqlTexto(a.alias)} ` +
      `FROM produto WHERE nome = ${sqlTexto(a.produto)} ON CONFLICT DO NOTHING;`,
  )
}
for (const m of seed.mapeamentos.filter((m) => m.so_no_codigo_morto)) {
  pendencias.push(
    `UPDATE sku_produto SET so_no_codigo_morto = true WHERE sku_codigo = ` +
      `${sqlTexto(m.sku_codigo)} AND escopo = ${sqlTexto(m.escopo)};`,
  )
}
for (const p of seed.produtos.filter((p) => !p.ativo)) {
  pendencias.push(`UPDATE produto SET ativo = false WHERE nome = ${sqlTexto(p.nome)};`)
}

if (pendencias.length) {
  console.log(`\n${pendencias.length} item(ns) sem rota de escrita — rode no banco à mão:`)
  for (const sql of pendencias) console.log(`  ${sql}`)
}

function sqlTexto(valor) {
  return `'${String(valor).replaceAll("'", "''")}'`
}
