/**
 * Verificação da Fase 1 sem Docker: aplica as migrations num Postgres em WASM (pglite)
 * e confere que o roteamento file-based e a auth pelo header respondem.
 *
 * Uso: node scripts/verificar_base.mjs
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

// ---------------------------------------------------------------- schema

console.log('\nmigrations (Postgres em WASM)')
const db = new PGlite()
const dirMigrations = path.join(raiz, 'api', 'migrations')

for (const arquivo of readdirSync(dirMigrations).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await db.exec(readFileSync(path.join(dirMigrations, arquivo), 'utf8'))
    ok(`${arquivo} aplicada`)
  } catch (erro) {
    falha(`${arquivo}: ${erro.message}`)
  }
}

const ESPERADAS = [
  'sku', 'produto', 'produto_alias', 'processo', 'sku_produto', 'dispositivo', 'feriado',
  'parametro', 'cenario', 'cenario_parametro', 'cenario_meta', 'cenario_periodo',
  'cenario_demanda', 'cenario_formula_par', 'metrica_componente', 'projecao', 'projecao_slot',
  'demanda_processo', 'alocacao_operador', 'importacao',
]

const { rows } = await db.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
)
const criadas = new Set(rows.map((r) => r.table_name))
const faltando = ESPERADAS.filter((t) => !criadas.has(t))
if (faltando.length) falha(`tabelas faltando: ${faltando.join(', ')}`)
else ok(`${ESPERADAS.length} tabelas criadas`)

const { rows: params } = await db.query('SELECT chave, valor FROM parametro ORDER BY chave')
if (params.length === 5) ok(`parâmetros semeados: ${params.map((p) => `${p.chave}=${p.valor}`).join(' ')}`)
else falha(`esperava 5 parâmetros, veio ${params.length}`)

// O índice parcial deve permitir um oficial por tipo, e barrar o segundo.
await db.exec(`INSERT INTO cenario (nome, tipo, oficial) VALUES ('a', 'mensal', true)`)
try {
  await db.exec(`INSERT INTO cenario (nome, tipo, oficial) VALUES ('b', 'mensal', true)`)
  falha('cenario_oficial_idx deixou passar dois oficiais do mesmo tipo')
} catch {
  ok('cenario_oficial_idx barra dois oficiais do mesmo tipo')
}
await db.exec(`INSERT INTO cenario (nome, tipo, oficial) VALUES ('c', 'semanal', true)`)
ok('cenario_oficial_idx permite um oficial por tipo')

await db.close()

// ---------------------------------------------------------------- rotas + auth

console.log('\nroteamento file-based e auth')
const express = require(path.join(raiz, 'api', 'node_modules', 'express'))
const { loadRoutes } = require(path.join(raiz, 'api', '_lib', 'routes.js'))

const app = express()
app.use('/api', express.json())
const rotas = loadRoutes(app)
ok(`rotas carregadas: ${rotas.join(', ')}`)

const servidor = app.listen(0)
const porta = servidor.address().port

const semHeader = await fetch(`http://localhost:${porta}/api/me`)
if (semHeader.status === 401) ok('/api/me sem X-Auth-Email -> 401')
else falha(`/api/me sem header devolveu ${semHeader.status}, esperava 401`)

const comHeader = await fetch(`http://localhost:${porta}/api/me`, {
  headers: { 'X-Auth-Email': 'vsuriani@tractian.com' },
})
const corpo = await comHeader.json()
if (comHeader.status === 200 && corpo.email === 'vsuriani@tractian.com') {
  ok('/api/me com X-Auth-Email -> 200 + e-mail')
} else {
  falha(`/api/me com header devolveu ${comHeader.status} ${JSON.stringify(corpo)}`)
}

const dominioErrado = await fetch(`http://localhost:${porta}/api/me`, {
  headers: { 'X-Auth-Email': 'alguem@gmail.com' },
})
if (dominioErrado.status === 401) ok('/api/me rejeita e-mail fora de @tractian.com')
else falha(`e-mail externo devolveu ${dominioErrado.status}, esperava 401`)

servidor.close()

console.log(falhas === 0 ? '\nFase 1 verificada.\n' : `\n${falhas} falha(s).\n`)

// process.exitCode (e não process.exit) — sair à força durante o teardown do pglite
// dispara um assert do libuv no Windows.
process.exitCode = falhas === 0 ? 0 : 1
