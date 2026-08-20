/**
 * Verifica que os tempos por dispositivo de um cenário novo saem SEMPRE do cenário semanal,
 * qualquer que seja o tipo do cenário criado.
 *
 * Roda num Postgres em WASM próprio — não toca o banco de dev.
 *
 * Uso: node scripts/verificar_tempos_padrao.mjs
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

const db = new PGlite()
for (const arq of readdirSync(path.join(raiz, 'api', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(path.join(raiz, 'api', 'migrations', arq), 'utf8'))
}

const dbPath = require.resolve(path.join(raiz, 'api', '_lib', 'db.js'))
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: (sql, params) => db.query(sql, params),
    transacao: async (fn) => fn(db),
    getPool: () => db,
    esperarBanco: async () => {},
    migrar: async () => {},
  },
}

const express = require(path.join(raiz, 'api', 'node_modules', 'express'))
const { loadRoutes } = require(path.join(raiz, 'api', '_lib', 'routes.js'))
const app = express()
app.use('/api', express.json({ limit: '15mb' }))
loadRoutes(app)
const servidor = app.listen(0)
const base = `http://localhost:${servidor.address().port}`

const H = { 'X-Auth-Email': 'vsuriani@tractian.com', 'Content-Type': 'application/json' }
const pedir = async (metodo, rota, corpo) => {
  const r = await fetch(`${base}/api/${rota}`, {
    method: metodo,
    headers: H,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`${metodo} ${rota} -> ${r.status} ${t.slice(0, 200)}`)
  return t ? JSON.parse(t) : null
}

const tempos = async (id) => {
  const { rows } = await db.query(
    'SELECT dispositivo_id, meta_min_peca FROM cenario_meta WHERE cenario_id = $1 ORDER BY dispositivo_id',
    [id],
  )
  return rows.map((r) => Number(r.meta_min_peca))
}

// ---------------------------------------------------------------- cenário

console.log('\ntempos por dispositivo herdados do semanal')

for (const [i, nome] of ['Tampografia', 'Bateria EX', 'Montagem'].entries()) {
  await db.query('INSERT INTO dispositivo (nome, ordem) VALUES ($1, $2)', [nome, i])
}

// Um semanal com tempos de verdade e um mensal zerado — o retrato de Agosto/2026 depois da
// recuperação, que é o caso que motivou a mudança.
const semanal = await pedir('POST', 'cenarios', { tipo: 'semanal', mes: 8, ano: 2026, nome: 'Semanal com tempos' })
await db.query('UPDATE cenario_meta SET meta_min_peca = 12.5 WHERE cenario_id = $1', [semanal.id])
conferir('semanal semeado com 3 dispositivos', (await tempos(semanal.id)).length, 3)

const mensalZerado = await pedir('POST', 'cenarios', { tipo: 'mensal', mes: 8, ano: 2026, nome: 'Mensal zerado' })
await db.query('UPDATE cenario_meta SET meta_min_peca = 0 WHERE cenario_id = $1', [mensalZerado.id])

// 1. mensal novo herda do semanal, e não do mensal zerado que é mais recente
const mensal = await pedir('POST', 'cenarios', { tipo: 'mensal', mes: 9, ano: 2026, nome: 'Mensal novo' })
const doMensal = await tempos(mensal.id)
if (doMensal.every((t) => t === 12.5) && doMensal.length === 3) {
  ok('mensal novo nasceu com os tempos do semanal (12,5), não com os zeros do mensal anterior')
} else {
  falha(`mensal novo veio com ${JSON.stringify(doMensal)}, esperava [12.5, 12.5, 12.5]`)
}

// 2. semanal novo continua herdando do semanal
const semanal2 = await pedir('POST', 'cenarios', { tipo: 'semanal', mes: 9, ano: 2026, nome: 'Semanal novo' })
const doSemanal = await tempos(semanal2.id)
if (doSemanal.every((t) => t === 12.5)) ok('semanal novo herda do semanal, como já era')
else falha(`semanal novo veio com ${JSON.stringify(doSemanal)}`)

// 3. o semanal oficial ganha do semanal mais recente
await db.query('UPDATE cenario SET oficial = true WHERE id = $1', [semanal.id])
await db.query('UPDATE cenario_meta SET meta_min_peca = 99 WHERE cenario_id = $1', [semanal2.id])
const mensal3 = await pedir('POST', 'cenarios', { tipo: 'mensal', mes: 10, ano: 2026, nome: 'Mensal 3' })
const doOficial = await tempos(mensal3.id)
if (doOficial.every((t) => t === 12.5)) ok('o semanal oficial é a base, mesmo com um semanal mais novo')
else falha(`veio ${JSON.stringify(doOficial)}, esperava os 12,5 do oficial`)

// 4. cenário sem nenhum tempo > 0 não é eleito base
await db.query('DELETE FROM cenario WHERE id = ANY($1)', [[semanal.id, semanal2.id, mensal.id, mensal3.id]])
const soZerados = await pedir('POST', 'cenarios', { tipo: 'mensal', mes: 11, ano: 2026, nome: 'Só zerados' })
const doZerado = await tempos(soZerados.id)
if (doZerado.length === 3 && doZerado.every((t) => t === 0)) {
  ok('sem candidato com tempo > 0, o cenário nasce com todos os dispositivos em 0')
} else {
  falha(`veio ${JSON.stringify(doZerado)}, esperava três zeros`)
}

servidor.close()
await db.close()

console.log(falhas === 0 ? '\nTempos-padrão verificados.\n' : `\n${falhas} falha(s).\n`)
process.exitCode = falhas === 0 ? 0 : 1
