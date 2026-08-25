/**
 * Verifica o Dimensionamento Global ponta a ponta: carga dos tempos e do forecast, a conta por
 * mês e a camada de ajuste que sobrepõe o forecast.
 *
 * A tela é uma **simulação sem cenário** — este script prova isso partindo de um banco onde a
 * planilha nunca foi importada: nenhum `cenario`, nenhum `dispositivo`, só as migrations.
 *
 * Roda num Postgres em WASM próprio — não toca o banco de dev.
 *
 * Uso: node scripts/verificar_dimensionamento.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { lerForecast, lerMapa, lerTempos } from './_forecast.mjs'
import { feriadosNacionais } from './_feriados_br.mjs'

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
const perto = (rotulo, real, esperado, tol = 0.005) =>
  Math.abs(real - esperado) < tol
    ? ok(`${rotulo}: ${real.toFixed(4)}`)
    : falha(`${rotulo}: ${real}, esperava ~${esperado}`)

const db = new PGlite()
for (const arq of readdirSync(path.join(raiz, 'api', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()) {
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
  if (!r.ok) throw new Error(`${metodo} ${rota} -> ${r.status} ${t.slice(0, 300)}`)
  return t ? JSON.parse(t) : null
}

const grade = () => pedir('GET', 'dimensionamento')
const contar = async (tabela) =>
  (await db.query(`SELECT count(*)::int AS n FROM ${tabela}`)).rows[0].n

// ---------------------------------------------------------------- banco vazio

console.log('\nbanco sem planilha importada')
conferir('cenários', await contar('cenario'), 0)
conferir('dispositivos', await contar('dispositivo'), 0)

const vazia = await grade()
conferir('a rota responde mesmo assim', vazia.dispositivos.length, 0)
conferir('e sem meses', vazia.meses.length, 0)

// ---------------------------------------------------------------- tempos

console.log('\ntempos por dispositivo')

const tempos = lerTempos(raiz)
const cargaTempos = await pedir('POST', 'dimensionamento?acao=tempos', { tempos })
conferir('dispositivos', cargaTempos.dispositivos, 11)
conferir('criados no cadastro', cargaTempos.dispositivosCriados, 11)
conferir('componentes', cargaTempos.componentes, tempos.reduce((s, t) => s + t.componentes.length, 0))

// Recarregar substitui, não duplica.
await pedir('POST', 'dimensionamento?acao=tempos', { tempos })
conferir('recarregar não duplica componentes', await contar('dispositivo_metrica'), cargaTempos.componentes)
conferir('nem cria dispositivo de novo', await contar('dispositivo'), 11)

// Os totais da tabela de tempos, conferidos contra o motor.
let d = await grade()
const totalDe = new Map(
  readFileSync(path.join(raiz, 'docs', 'tempos-dispositivo.tsv'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split('\t'))
    .filter((l) => l[1] === 'total')
    .map((l) => [l[0], { parcial: Number(l[3]), real: Number(l[4]) }]),
)
const divergentes = d.metricas.filter((m) => {
  const esperado = totalDe.get(m.dispositivo)
  return (
    !esperado ||
    Math.abs(m.parcial - esperado.parcial) > 1e-9 ||
    Math.abs(m.real - esperado.real) > 0.005
  )
})
if (divergentes.length === 0) ok('os 11 totais batem com docs/tempos-dispositivo.tsv')
else falha(`divergem: ${divergentes.map((m) => m.dispositivo).join(', ')}`)

// ---------------------------------------------------------------- forecast

console.log('\ncarga do forecast')

const linhas = lerForecast(raiz)
const mapa = lerMapa(raiz)
const carga = await pedir('POST', 'forecast', { linhas, mapa })
conferir('células gravadas', carga.linhas, linhas.length)
conferir('models mapeados', carga.mapa, mapa.length)
conferir('models sem dispositivo', (await pedir('GET', 'forecast')).modelsSemDispositivo.length, 0)

const somaForecast = async () =>
  Number((await db.query('SELECT sum(quantidade) AS s FROM forecast')).rows[0].s)
const antes = await somaForecast()
await pedir('POST', 'forecast', { linhas, mapa })
conferir('recarregar não duplica', await contar('forecast'), linhas.length)
conferir('recarregar mantém o total', await somaForecast(), antes)

// ---------------------------------------------------------------- a conta

console.log('\na conta do Global')

d = await grade()
conferir('dispositivos na grade', d.dispositivos.length, 11)
conferir('meses (os 16 do forecast)', d.meses.length, 16)
conferir('primeiro mês', d.meses[0].periodo, 'Setembro/2026')
conferir('último mês', d.meses.at(-1).periodo, 'Dezembro/2027')

// A abertura da linha: os PRODs debaixo de cada dispositivo, como na planilha.
conferir('models na abertura', d.models.length, 23)
const doStuEx2 = d.models
  .filter((m) => m.dispositivoId === d.dispositivos.find((x) => x.nome === 'Smart Trac Ultra Gen 2 EX').id)
  .map((m) => m.model)
  .sort()
conferir('Smart Trac Ultra Gen 2 EX abre em', doStuEx2.join(', '), 'PROD-0164, PROD-0165')

// Os PRODs abertos somam a linha do dispositivo enquanto não houver ajuste.
const somaDosModels = (nome, periodo) =>
  d.models
    .filter((m) => m.dispositivoId === d.dispositivos.find((x) => x.nome === nome).id)
    .reduce((s, m) => s + m.porMes.find((p) => p.periodo === periodo).quantidade, 0)
const naLinha = (nome, periodo) =>
  d.quantidades.find(
    (q) => q.dispositivoId === d.dispositivos.find((x) => x.nome === nome).id && q.periodo === periodo,
  ).efetiva
conferir(
  'a soma dos PRODs fecha com a linha (Smart Trac Ultra Gen 2 EX, Set/2026)',
  somaDosModels('Smart Trac Ultra Gen 2 EX', 'Setembro/2026'),
  naLinha('Smart Trac Ultra Gen 2 EX', 'Setembro/2026'),
)
// PROD-0177 ficou só em Uni Trac (a linha OEET saiu do forecast).
const doOee = d.models.filter(
  (m) => m.dispositivoId === d.dispositivos.find((x) => x.nome === 'OEE Trac').id,
)
conferir('OEE Trac abre só em', doOee.map((m) => m.model).join(', '), 'PROD-0156')

// Sem dias úteis digitados, todo mês é #DIV/0! — é a decisão de não auto-preencher.
conferir('mês sem dias úteis não calcula', d.resultados[0].erro, 'dias-uteis-zero')

// ---------------------------------------------------------------- dias úteis

console.log('\ndias úteis do calendário')

for (const ano of [2026, 2027]) {
  for (const f of feriadosNacionais(ano)) {
    await pedir('POST', 'parametros?feriado=1', f)
  }
}
conferir('feriados cadastrados', await contar('feriado'), 20)

const contagem = await pedir('POST', 'dimensionamento?acao=dias-uteis')
conferir('meses preenchidos', contagem.preenchidos, 16)

const diasDe = (periodo) => contagem.meses.find((m) => m.periodo === periodo)?.diasUteis
// Setembro, Outubro e Novembro/2026 batem com o print da planilha.
conferir('Setembro/2026', diasDe('Setembro/2026'), 21)
conferir('Outubro/2026', diasDe('Outubro/2026'), 21)
conferir('Novembro/2026 (dois feriados em dia útil)', diasDe('Novembro/2026'), 19)

// A ação não atropela o que foi digitado: por padrão só preenche o que está vazio.
await pedir('PATCH', 'dimensionamento', { meses: [{ ano: 2026, mes: 12, diasUteis: 14 }] })
const denovo = await pedir('POST', 'dimensionamento?acao=dias-uteis')
conferir('rodar de novo não preenche nada', denovo.preenchidos, 0)
conferir(
  'e o valor digitado à mão fica',
  (await grade()).meses.find((m) => m.periodo === 'Dezembro/2026').diasUteis,
  14,
)

d = await grade()

const setembro = d.resultados.find((r) => r.periodo === 'Setembro/2026')
const parcialDe = new Map(d.metricas.map((m) => [m.dispositivoId, m.parcial]))
const esperado =
  d.quantidades
    .filter((q) => q.periodo === 'Setembro/2026')
    .reduce((s, q) => s + parcialDe.get(q.dispositivoId) * q.efetiva, 0) /
  60 /
  (21 * 7.5) /
  0.85
perto('Setembro/2026 calculado', setembro.operadoresFracionario, esperado, 1e-9)
conferir('Setembro/2026 headcount = ROUNDUP', setembro.operadores, Math.ceil(esperado - 1e-9))

// O excedente de 20% fica de fora: o headcount é o ROUNDUP puro, não ROUNDUP(×1,2).
if (setembro.operadores !== Math.ceil(setembro.operadoresFracionario * 1.2 - 1e-9)) {
  ok('o excedente de 20% não entra no headcount')
} else {
  falha('não dá para distinguir com/sem excedente neste mês — escolher outro caso')
}

// Mês inteiro sem demanda devolve 0, não -0.
await pedir('PATCH', 'dimensionamento', { meses: [{ ano: 2027, mes: 12, diasUteis: 20 }] })
d = await grade()
const dezembro = d.resultados.find((r) => r.periodo === 'Dezembro/2027')
if (Object.is(dezembro.operadores, -0)) falha('Dezembro/2027 devolveu -0')
else ok(`Dezembro/2027 devolve ${dezembro.operadores}, sem -0`)

// ---------------------------------------------------------------- ajuste

console.log('\najuste sobrepondo o forecast')

const uniTrac = d.dispositivos.find((x) => x.nome === 'Uni Trac')
const celula = () =>
  grade().then((g) =>
    g.quantidades.find((q) => q.dispositivoId === uniTrac.id && q.periodo === 'Outubro/2026'),
  )

const original = await celula()
conferir('Uni Trac / Outubro/2026 vem do forecast', original.forecast, 300)
conferir('e nasce sem ajuste', original.ajuste, null)

const ajustar = (quantidade) =>
  pedir('PATCH', 'dimensionamento', {
    ajustes: [{ dispositivoId: uniTrac.id, ano: 2026, mes: 10, quantidade }],
  })

await ajustar(1234)
const ajustada = await celula()
conferir('ajuste sobrepõe', ajustada.efetiva, 1234)
conferir('e o forecast segue visível por baixo', ajustada.forecast, 300)

// O ponto da camada separada: recarregar o forecast não apaga o ajuste, nem os dias úteis.
await pedir('POST', 'forecast', { linhas, mapa })
await pedir('POST', 'dimensionamento?acao=tempos', { tempos })
conferir('recarregar preserva o ajuste', (await celula()).efetiva, 1234)
conferir(
  'e preserva os dias úteis digitados',
  (await grade()).meses.find((m) => m.periodo === 'Setembro/2026').diasUteis,
  21,
)

await ajustar(null)
const voltou = await celula()
conferir('quantidade null volta ao forecast', voltou.efetiva, 300)
conferir('e apaga o ajuste', voltou.ajuste, null)

// ---------------------------------------------------------------- model órfão

console.log('\nmodel sem dispositivo')

await pedir('POST', 'forecast', {
  linhas: [
    ...linhas,
    { country: 'BR', produto: 'XX', model: 'PROD-9999', ano: 2026, mes: 9, quantidade: 500 },
  ],
  mapa,
})
const comOrfao = await grade()
conferir('aparece no aviso', comOrfao.modelsSemDispositivo.length, 1)
conferir('com o model certo', comOrfao.modelsSemDispositivo[0]?.model, 'PROD-9999')
conferir(
  'e não muda o headcount de Setembro',
  comOrfao.resultados.find((r) => r.periodo === 'Setembro/2026').operadores,
  setembro.operadores,
)

servidor.close()
await db.close()

console.log(falhas === 0 ? '\nDimensionamento Global verificado.\n' : `\n${falhas} falha(s).\n`)
process.exitCode = falhas === 0 ? 0 : 1
