/**
 * Confere o cenário Agosto/2026 contra os valores que a planilha exibe hoje.
 *
 * Os esperados vieram da própria aba Planejamento Semanal (bloco Agosto): as metas, a
 * demanda por semana, os dias úteis e o headcount — calculado e digitado.
 *
 * Uso: node scripts/verificar_agosto.mjs
 *   (pré-requisito: python scripts/importar_planilha.py --dump --dry-run)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const require = createRequire(import.meta.url)
const raiz = path.join(import.meta.dirname, '..')

let falhas = 0
const ok = (m) => console.log(`  ok    ${m}`)
const falha = (m) => {
  falhas++
  console.log(`  FALHA ${m}`)
}

// --------------------------------------------------- o que a planilha mostra

const METAS = {
  'Bateria EX Gen 2': 8, 'Ima na Base': 1, 'Tampografia Case': 0.48,
  'Tampografia Sensor': 0.48, 'Retrabalho STU': 5, 'Retrabalho SRU': 8,
  'Retrabalho Energy': 6, 'Smart Trac Ultra Gen 1': 4.6, 'Smart Trac Ultra Ex': 4.4,
  'Smart Receiver Ultra': 33.27, 'Smart Receiver Ultra Gen 2': 20,
  'Smart Trac Ultra Gen 2': 5.25, 'Smart Trac Ultra Gen 2 EX': 5.25,
  'Defasagem Smart Gen 2 EX': 3, 'Fechar Smart Gen 2 EX': 2.25, 'Energy Trac': 22.7,
  'Energy Trac EE': 6, 'Uni Trac': 4.1, 'Garra Uni Trac': 15.3, 'Omni Trac': 5.1,
  'Omni Receiver': 5.1,
}

const DEMANDA = {
  'Bateria EX Gen 2': { 'Week 3': 1000, 'Week 4': 1400 },
  'Tampografia Sensor': { 'Week 2': 1000, 'Week 3': 1500, 'Week 4': 1000 },
  'Smart Trac Ultra Ex': { 'Week 2': 100 },
  'Smart Receiver Ultra': { 'Week 2': 200, 'Week 3': 200, 'Week 4': 100 },
  'Smart Trac Ultra Gen 2 EX': { 'Week 2': 250 },
  'Defasagem Smart Gen 2 EX': { 'Week 2': 1900 },
  'Fechar Smart Gen 2 EX': { 'Week 4': 1000 },
  'Uni Trac': { 'Week 3': 300 },
  'Garra Uni Trac': { 'Week 2': 50 },
}

const DIAS_UTEIS = { 'Week 1': 0, 'Week 2': 5, 'Week 3': 5, 'Week 4': 5 }
// "Operadores Linha" calculado e, abaixo, o digitado à mão.
const CALCULADO = { 'Week 2': 8.03, 'Week 3': 8.68, 'Week 4': 9.02 }
const DIGITADO = { 'Week 1': 8, 'Week 2': 8, 'Week 3': 8, 'Week 4': 8 }

// --------------------------------------------------- monta o app

const db = new PGlite()
for (const a of readdirSync(path.join(raiz, 'api', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(path.join(raiz, 'api', 'migrations', a), 'utf8'))
}
const dbPath = require.resolve(path.join(raiz, 'api', '_lib', 'db.js'))
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: (sql, p) => db.query(sql, p),
    transacao: async (fn) => fn(db),
    getPool: () => db, esperarBanco: async () => {}, migrar: async () => {},
  },
}
const { aplicarPayload } = require(path.join(raiz, 'api', '_handlers', 'importacao.js'))
await aplicarPayload(
  db,
  JSON.parse(readFileSync(path.join(raiz, '.cache', 'payload-importacao.json'), 'utf8')),
  'vsuriani@tractian.com',
)

const { carregarCenario, calcularCenario } = require(path.join(raiz, 'api', '_lib', 'cenario.js'))

const { rows: achado } = await db.query(
  `SELECT id, nome FROM cenario WHERE tipo = 'semanal' AND mes = 8 AND ano = 2026 AND importado`,
)
if (!achado.length) {
  falha('não achei o cenário semanal Agosto/2026 importado')
} else {
  console.log(`\ncenário: ${achado[0].nome} (id ${achado[0].id})`)
  const dados = await carregarCenario(achado[0].id)
  const { resultados } = calcularCenario(dados)

  const nomeDe = new Map(dados.dispositivos.map((d) => [d.id, d.nome]))

  // ---- metas ----
  console.log('\nmetas (min/peça)')
  let metasOk = 0
  for (const m of dados.metas) {
    const nome = nomeDe.get(m.dispositivo_id)
    const esperado = METAS[nome]
    if (esperado === undefined) continue
    if (Math.abs(Number(m.meta_min_peca) - esperado) < 1e-6) metasOk++
    else falha(`meta de ${nome}: ${m.meta_min_peca}, esperava ${esperado}`)
  }
  if (metasOk === Object.keys(METAS).length) ok(`${metasOk} metas conferem`)
  else falha(`só ${metasOk} de ${Object.keys(METAS).length} metas conferem`)

  // ---- demanda ----
  console.log('\ndemanda por semana')
  const doApp = new Map(
    dados.demandas.map((d) => [`${nomeDe.get(d.dispositivo_id)}|${d.periodo}`, Number(d.quantidade)]),
  )
  let demOk = 0
  let demTotal = 0
  for (const [disp, semanas] of Object.entries(DEMANDA)) {
    for (const [semana, qtd] of Object.entries(semanas)) {
      demTotal++
      const real = doApp.get(`${disp}|${semana}`) ?? 0
      if (real === qtd) demOk++
      else falha(`${disp} / ${semana}: app ${real}, planilha ${qtd}`)
    }
  }
  if (demOk === demTotal) ok(`${demOk} células de demanda conferem`)

  // ---- dias úteis ----
  console.log('\ndias úteis')
  for (const p of dados.periodos) {
    const esperado = DIAS_UTEIS[p.periodo]
    if (esperado === undefined) continue
    if (Number(p.dias_uteis) === esperado) ok(`${p.periodo}: ${esperado}`)
    else falha(`${p.periodo}: app ${p.dias_uteis}, planilha ${esperado}`)
  }

  // ---- headcount ----
  console.log('\nheadcount (o teste que importa)')
  for (const r of resultados) {
    const calc = CALCULADO[r.periodo]
    const dig = DIGITADO[r.periodo]

    if (calc === undefined) {
      // Week 1 tem 0 dias úteis -> #DIV/0! na planilha
      if (r.erro === 'dias-uteis-zero') ok(`${r.periodo}: #DIV/0! reproduzido (0 dias úteis)`)
      else falha(`${r.periodo}: esperava erro de dias úteis, veio ${r.operadoresFracionario}`)
      continue
    }

    const bate = Math.abs(r.operadoresFracionario - calc) < 0.005
    if (bate) ok(`${r.periodo}: calculado ${r.operadoresFracionario.toFixed(2)} = planilha ${calc}`)
    else falha(`${r.periodo}: app ${r.operadoresFracionario?.toFixed(4)}, planilha ${calc}`)

    if (r.operadores === dig) ok(`${r.periodo}: exibido ${r.operadores} = digitado na planilha`)
    else falha(`${r.periodo}: exibido ${r.operadores}, planilha digitou ${dig}`)
  }
}

await db.close()
console.log(falhas === 0 ? '\nAgosto/2026 confere com a planilha.\n' : `\n${falhas} falha(s).\n`)
process.exitCode = falhas === 0 ? 0 : 1
