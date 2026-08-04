/**
 * Verificação da Fase 3 sem Docker: aplica o payload REAL da planilha num Postgres em
 * WASM e confere as contagens e as consultas que as telas vão fazer.
 *
 * Pré-requisito:
 *   python scripts/importar_planilha.py --dump --dry-run
 *
 * Uso: node scripts/verificar_importacao.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const require = createRequire(import.meta.url)
const raiz = path.join(import.meta.dirname, '..')

let falhas = 0
const ok = (msg) => console.log(`  ok    ${msg}`)
const falha = (msg) => {
  falhas++
  console.log(`  FALHA ${msg}`)
}
const conferir = (rotulo, real, esperado) =>
  real === esperado ? ok(`${rotulo}: ${real}`) : falha(`${rotulo}: ${real}, esperava ${esperado}`)

// ---------------------------------------------------------------- setup

const db = new PGlite()
const dirMigrations = path.join(raiz, 'api', 'migrations')
for (const arquivo of readdirSync(dirMigrations).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(path.join(dirMigrations, arquivo), 'utf8'))
}

const payloadPath = path.join(raiz, '.cache', 'payload-importacao.json')
let payload
try {
  payload = JSON.parse(readFileSync(payloadPath, 'utf8'))
} catch {
  console.log(
    `\nPayload não encontrado em ${payloadPath}\n` +
      'Rode antes: python scripts/importar_planilha.py --dump --dry-run\n',
  )
  process.exitCode = 1
  await db.close()
  throw new Error('payload ausente')
}

const { aplicarPayload } = require(path.join(raiz, 'api', '_handlers', 'importacao.js'))

// ---------------------------------------------------------------- importação

console.log('\nimportação do payload real')
const r1 = await aplicarPayload(db, payload, 'vsuriani@tractian.com')

conferir('sku', r1.contagens.sku, 199)
conferir('processo', r1.contagens.processo, 87)
conferir('dispositivo', r1.contagens.dispositivo, 26)
conferir('cenario', r1.contagens.cenario, 3)
conferir('projecao_slot', r1.contagens.projecao_slot, 27)
conferir('demanda_processo', r1.contagens.demanda_processo, 75)
conferir('metrica_componente', r1.contagens.metrica_componente, 40)
ok(`sku_produto: ${r1.contagens.sku_produto}`)
ok(`alocacao_operador: ${r1.contagens.alocacao_operador}`)

if (r1.avisos.length) {
  const porTipo = {}
  for (const a of r1.avisos) porTipo[a.tipo] = (porTipo[a.tipo] ?? 0) + 1
  ok(`avisos: ${JSON.stringify(porTipo)}`)
} else {
  ok('nenhum aviso')
}

// ---------------------------------------------------------------- idempotência

console.log('\nidempotência (segunda importação do mesmo payload)')
const r2 = await aplicarPayload(db, payload, 'vsuriani@tractian.com')

for (const tabela of [
  'sku', 'produto', 'processo', 'sku_produto', 'dispositivo', 'cenario',
  'cenario_formula_par', 'metrica_componente', 'projecao_slot', 'demanda_processo',
]) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${tabela}`)
  const esperado = { sku: 199, processo: 87, dispositivo: 26, cenario: 3, projecao_slot: 27, demanda_processo: 75 }[tabela]
  if (esperado !== undefined) conferir(`${tabela} após 2ª carga`, rows[0].n, esperado)
  else ok(`${tabela}: ${rows[0].n}`)
}
if (r2.contagens.cenario !== 3) falha('a 2ª carga deveria reusar os 3 cenários, não criar novos')

// ---------------------------------------------------------------- consultas das telas

console.log('\nconsultas que as telas vão fazer')

const q = async (sql, params) => (await db.query(sql, params)).rows

const [{ n: skuSemRoteiro }] = await q(`
  SELECT count(*)::int AS n FROM (
    SELECT DISTINCT s.sku_codigo
      FROM projecao_slot s
      LEFT JOIN sku_produto sp
        ON sp.sku_codigo = s.sku_codigo
       AND sp.escopo = (CASE WHEN s.bloco = 'industrializacao' THEN 'industrializacao' ELSE 'producao' END)::escopo_sku
     WHERE sp.sku_codigo IS NULL
  ) t`)
ok(`SKU da grade sem mapeamento: ${skuSemRoteiro}`)

const ambiguos = await q(`
  SELECT sku_codigo, escopo, count(*)::int AS n
    FROM sku_produto GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY 1`)
const esperadosAmbiguos = ['ITCH-0011', 'ITCS-0002', 'ITCS-0019']
const achados = ambiguos.map((a) => a.sku_codigo).sort()
if (JSON.stringify(achados) === JSON.stringify(esperadosAmbiguos)) {
  ok(`SKU em dois produtos: ${achados.join(', ')}`)
} else {
  falha(`SKU ambíguos: ${achados.join(', ')}, esperava ${esperadosAmbiguos.join(', ')}`)
}

const desalinhados = await q(`
  SELECT c.tipo, count(*)::int AS n
    FROM cenario_formula_par p
    JOIN cenario c ON c.id = p.cenario_id
   WHERE p.meta_dispositivo_id <> p.qtd_dispositivo_id
   GROUP BY 1 ORDER BY 1`)
ok(`termos desalinhados por cenário: ${JSON.stringify(desalinhados)}`)

const cruzados = await q(`SELECT count(*)::int AS n FROM cenario_formula_par WHERE qtd_periodo IS NOT NULL`)
conferir('termos apontando para outro período', cruzados[0].n, 3)

const [{ nome: alias }] = await q(`SELECT alias AS nome FROM produto_alias LIMIT 1`)
conferir('alias preservado', alias, 'Smart Trac Ultra Gen 2 ')

const [{ n: manuais }] = await q(`
  SELECT count(*)::int AS n FROM cenario_periodo WHERE dias_uteis > 0`)
ok(`períodos com dias úteis > 0: ${manuais}`)

const params = await q(`
  SELECT cp.chave, cp.valor FROM cenario_parametro cp
    JOIN cenario c ON c.id = cp.cenario_id AND c.tipo = 'capacidade' ORDER BY 1`)
ok(`parâmetros do cenário de capacidade: ${params.map((p) => `${p.chave}=${p.valor}`).join(' ')}`)

const historico = await q('SELECT count(*)::int AS n FROM importacao')
conferir('registros de importação', historico[0].n, 2)

await db.close()

console.log(falhas === 0 ? '\nFase 3 verificada.\n' : `\n${falhas} falha(s).\n`)
process.exitCode = falhas === 0 ? 0 : 1
