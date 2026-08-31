/**
 * Dump dos cadastros globais para `seeds/cadastros.json`, via as rotas /api reais.
 *
 * Por que existe: em dev o banco mora em `.cache/pgdata`, que está no .gitignore e não
 * sobrevive a um kill forçado do dev-server (o servidor sobe recriando o banco VAZIO — já
 * aconteceu, ver AGENTS.md 2026-08-20). O catálogo de SKU e o mapa SKU→produto são trabalho
 * manual do supervisor, não saem de lugar nenhum automaticamente. Este dump é o que os põe
 * dentro do repo.
 *
 * **Tudo é chaveado por NOME, nunca por id.** Depois de um banco recriado as sequences
 * reiniciam e os ids de `produto` são outros — quem restaura (`carregar_cadastros.mjs`)
 * remapeia nome → id novo. Por isso `processos[].produto` e `mapeamentos[].produto` guardam
 * o nome do produto, e o id fica de fora do arquivo.
 *
 * Escopo: produto, processo, sku, sku_produto e produto_alias. Fora do escopo, de propósito:
 * cenário, calendário, lista de demanda e alocação — são derivados, se regeram a partir
 * destes; e `feriado`, que já tem `cadastrar_feriados.mjs`.
 *
 * Uso:
 *   node scripts/exportar_cadastros.mjs
 *   node scripts/exportar_cadastros.mjs --api http://localhost:3101 --saida seeds/cadastros.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opcao = (nome, padrao = null) => {
  const i = args.indexOf(`--${nome}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao
}

const API = opcao('api', 'http://localhost:3101').replace(/\/$/, '')
const EMAIL = opcao('email', 'vsuriani@tractian.com')
const SAIDA = path.join(import.meta.dirname, '..', opcao('saida', 'seeds/cadastros.json'))

async function pedir(rota) {
  const r = await fetch(`${API}/api/${rota}`, { headers: { 'X-Auth-Email': EMAIL } })
  const texto = await r.text()
  if (!r.ok) throw new Error(`GET ${rota} -> ${r.status} ${texto.slice(0, 300)}`)
  return JSON.parse(texto)
}

const [roteiros, sku] = await Promise.all([pedir('roteiros'), pedir('sku')])

// `listar` de sku.js tem LIMIT 500. Bater no teto significaria dump silenciosamente
// incompleto — a coisa exata que um backup não pode fazer.
if (sku.itens.length >= 500 && sku.itens.length < sku.total) {
  throw new Error(
    `catálogo com ${sku.total} itens e a rota devolveu ${sku.itens.length} (LIMIT 500 de ` +
      `sku.js). Aumente o LIMIT antes de exportar, senão o dump nasce truncado.`,
  )
}

const nomeDoProduto = new Map(roteiros.produtos.map((p) => [p.id, p.nome]));

/** Falha alto: id de produto sem nome viraria uma referência órfã no seed. */
const produtoDe = (id, onde) => {
  const nome = nomeDoProduto.get(id)
  if (!nome) throw new Error(`${onde}: produto #${id} não está na lista de produtos`)
  return nome
}

const seed = {
  gerado_em: new Date().toISOString(),
  origem: API,
  produtos: roteiros.produtos.map((p) => ({ nome: p.nome, ativo: p.ativo })),
  processos: roteiros.processos.map((p) => ({
    produto: produtoDe(p.produto_id, `processo "${p.nome}"`),
    tipo_linha: p.tipo_linha,
    nome: p.nome,
    sequencia: p.sequencia,
    paralelismo: p.paralelismo,
    leadtime_dias: p.leadtime_dias,
    operadores: p.operadores,
    pcs_hora: p.pcs_hora,
    skus_filho: p.skus_filho ?? [],
    origem_total_dia: p.origem_total_dia,
  })),
  sku: sku.itens.map((s) => ({
    codigo: s.codigo,
    descricao: s.descricao,
    grupo_item: s.grupo_item,
    ncm: s.ncm,
    ativo: s.ativo,
  })),
  mapeamentos: sku.mapeamentos.map((m) => ({
    sku_codigo: m.sku_codigo,
    produto: produtoDe(m.produto_id, `mapeamento de ${m.sku_codigo}`),
    escopo: m.escopo,
    so_no_codigo_morto: m.so_no_codigo_morto,
  })),
  aliases: roteiros.aliases.map((a) => ({
    produto: produtoDe(a.produto_id, `alias "${a.alias}"`),
    alias: a.alias,
  })),
}

mkdirSync(path.dirname(SAIDA), { recursive: true })
writeFileSync(SAIDA, `${JSON.stringify(seed, null, 2)}\n`, 'utf8')

console.log(`seed gravado em ${path.relative(process.cwd(), SAIDA)}`)
console.log(`  produtos     ${seed.produtos.length}`)
console.log(`  processos    ${seed.processos.length}`)
console.log(`  sku          ${seed.sku.length}`)
console.log(`  mapeamentos  ${seed.mapeamentos.length}`)
console.log(`  aliases      ${seed.aliases.length}`)
