/**
 * Prova que os tempos da planilha "Análises Best Laps" entram no app pelos números certos.
 *
 * É o `verificar_agosto.mjs` desta feature: em vez de conferir contra valor inventado, confere
 * contra o que JÁ ESTAVA em `dispositivo_metrica` (docs/tempos-dispositivo.tsv) — uma derivação
 * independente, feita por outra pessoa, a partir da mesma planilha. Duas derivações batendo na
 * mesma casa decimal é o que valida a regra de agregação.
 *
 * Roda sem Docker e sem a planilha: o snapshot congelado em
 * `api/_lib/motor/tempos.fixture.json` entra como se tivesse vindo de um sync.
 *
 * Uso: node scripts/verificar_tempos_bestlap.mjs
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
const conferir = (rotulo, real, esperado) => {
  const bate = Math.abs(Number(real) - Number(esperado)) < 0.005
  bate ? ok(`${rotulo}: ${real}`) : falha(`${rotulo}: ${real}, esperava ${esperado}`)
}

// ---------------------------------------------------------------- banco WASM

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

// ---------------------------------------------------------------- migration 010

console.log('\nmigration 010: de-para semeado')
const { rows: dePara } = await db.query(
  `SELECT m.device_model, d.nome FROM dispositivo_device_model m
     JOIN dispositivo d ON d.id = m.dispositivo_id ORDER BY m.device_model`,
)
conferir('pares no de-para', dePara.length, 11)

const par = (dm) => dePara.find((p) => p.device_model === dm)?.nome
conferir_igual('OEE Trac renomeado', par('OEE Trac'), 'Uni Trac 2.0')
conferir_igual('Garra OEE renomeada', par('Garra OEE'), 'Garra Uni Trac')
conferir_igual('caixa normalizada', par('Smart Trac Ultra Gen 2 Ex'), 'Smart Trac Ultra Gen 2 EX')

function conferir_igual(rotulo, real, esperado) {
  real === esperado ? ok(`${rotulo}: ${real}`) : falha(`${rotulo}: ${real}, esperava ${esperado}`)
}

// ---------------------------------------------------------------- carrega o snapshot

const fixture = JSON.parse(
  readFileSync(path.join(raiz, 'api', '_lib', 'motor', 'tempos.fixture.json'), 'utf8'),
)

const { rows: sync } = await db.query(
  `INSERT INTO tempo_sync (origem, linhas) VALUES ('manual', $1) RETURNING id`,
  [fixture.atividades.length],
)
const syncId = sync[0].id

for (const a of fixture.atividades) {
  await db.query(
    `INSERT INTO tempo_atividade
       (sync_id, device_model, processo, process_type, best_lap, goal, goal_min, goal_max,
        mes_medicao, obsoleta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      syncId,
      a.deviceModel,
      a.processo,
      a.processType,
      a.bestLap,
      a.goal,
      a.goalMin,
      a.goalMax,
      a.mesMedicao,
      a.obsoleta,
    ],
  )
}

// ---------------------------------------------------------------- servidor

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
  return { status: r.status, dados: await r.json() }
}

// ---------------------------------------------------------------- GET /api/tempos

console.log('\nGET /api/tempos')
const { status, dados } = await pedir('GET', 'tempos')
conferir('status', status, 200)
conferir('linhas lidas', dados.resumo.lidas, 188)
conferir('obsoletas descartadas', dados.resumo.descartadas.obsoleta, 2)
conferir('device model sem par descartado', dados.resumo.descartadas.semDeviceModel, 2)
conferir('linhas de rollup fora da soma', dados.resumo.descartadas.rollup, 8)

const doDisp = (nome) => dados.tempos.find((t) => t.dispositivo === nome)

// O rollup é uma linha que repete, num número só, o que as outras já detalham. Onde a
// decomposição da planilha está completa ele vale EXATAMENTE a soma do detalhe — e é isso que
// prova que somar os dois dobraria o tempo. O total abaixo já exclui o rollup.
console.log('\no rollup vale a soma do detalhe (prova de que é rollup)')
const rollupDe = (dm) =>
  fixture.atividades.find(
    (a) => a.deviceModel === dm && /montar completo/i.test(a.processo) && !a.obsoleta,
  ).goal
conferir('Omni Trac · total', doDisp('Omni Trac').total, 12.08)
conferir('Omni Trac · rollup da planilha', rollupDe('Omni Trac'), 12.08)
conferir('Omni Receiver · total', doDisp('Omni Receiver').total, 16.47)
conferir('Omni Receiver · rollup da planilha', rollupDe('Omni Receiver'), 16.47)

// Garra Uni Trac não tem rollup, então é imune à decisão de incluir ou excluir: serve de âncora
// contra o meta_padrao que já estava no cadastro (15,30).
console.log('\nâncoras contra o cadastro que já existia')
conferir('Garra Uni Trac · total', doDisp('Garra Uni Trac').total, 15.34)
conferir('Smart Trac Ultra Ex · total', doDisp('Smart Trac Ultra Ex').total, 4.17)

// A defasagem não é afetada pela exclusão (o rollup é de Produção), então continua batendo com
// os aditivos derivados à mão em docs/tempos-dispositivo.tsv.
console.log('\ndefasagem: continua exata contra dispositivo_metrica')
conferir('Energy Trac · defasagem', doDisp('Energy Trac').defasagem, 8.78)
conferir('Smart Trac Ultra Ex · defasagem', doDisp('Smart Trac Ultra Ex').defasagem, 1.12)

// Os recortes por tipo são fatias DENTRO do total, não parcelas a somar por fora.
const comp = doDisp('Smart Trac Ultra Ex')
conferir(
  'Smart Trac Ultra Ex · composição fecha com o total',
  comp.defasagem + comp.industrializacao + comp.producao,
  comp.total,
)

console.log('\npendências (nada some calado)')
const pend = (tipo) => dados.pendencias.find((p) => p.tipo === tipo)
ok(`duplicados reportados: ${pend('medicao-duplicada')?.itens.length ?? 0}`)
ok(`device models sem par: ${pend('device-model-sem-dispositivo')?.itens.length ?? 0}`)
ok(`processo sem process_type: ${pend('processo-sem-tipo')?.itens.length ?? 0}`)
ok(`dispositivos ativos sem tempo: ${pend('dispositivo-sem-tempo')?.itens.length ?? 0}`)

if (!pend('medicao-duplicada')) falha('duplicados deveriam ser reportados')
if (!pend('device-model-sem-dispositivo')) falha('device models sem par deveriam ser reportados')

// ---------------------------------------------------------------- aplicação no cadastro

console.log('\naplicação no cadastro (dispositivo.meta_padrao)')
const { aplicarNoCadastro } = require(path.join(raiz, 'api', '_handlers', 'tempos.js'))
const alteracoes = await aplicarNoCadastro(syncId)
ok(`${alteracoes.length} alteração(ões) registrada(s)`)

const meta = async (nome) => {
  const { rows } = await db.query('SELECT meta_padrao FROM dispositivo WHERE nome = $1', [nome])
  return Number(rows[0].meta_padrao)
}
conferir('Energy Trac · meta_padrao', await meta('Energy Trac'), 14.18)
conferir('Garra Uni Trac · meta_padrao', await meta('Garra Uni Trac'), 15.34)
conferir('Omni Trac · meta_padrao', await meta('Omni Trac'), 12.08)

// Dispositivo fora da planilha mantém o cadastro — nunca zerado, que na fórmula de headcount
// significaria "este dispositivo não custa nada".
conferir('Retrabalho STU · fora da planilha, preservado', await meta('Retrabalho STU'), 5.0)

// O Dimensionamento Global não é tocado: o aditivo "Montagem" de lá é a linha de rollup, não o
// tempo-padrão, e escrever o total ali dobraria a defasagem no parcial.
console.log('\ndispositivo_metrica NÃO é tocada')
// Semeia os aditivos reais do Energy Trac (docs/tempos-dispositivo.tsv) antes de conferir. Sem
// isto a tabela estaria vazia e a asserção seria 0 == 0, provando só que nada foi INSERIDO —
// não que o valor existente sobrevive. É o valor sobreviver que importa: a versão anterior
// gravava 14,18 no aditivo "Montagem", que vale 8,37, e dobrava a defasagem no parcial.
for (const [rotulo, papel, valor] of [
  ['Defasagem Energy Trac', 'aditivo', 8.78],
  ['Montagem Energy Trac', 'aditivo', 8.37],
  ['Retrabalho Energy Trac', 'retrabalho', 8.0],
  ['FTR Energy Trac', 'ftr', 0.8],
]) {
  await db.query(
    `INSERT INTO dispositivo_metrica (dispositivo_id, ordem, rotulo, papel, valor)
     SELECT id, 0, $2, $3, $4 FROM dispositivo WHERE nome = $1`,
    ['Energy Trac', rotulo, papel, valor],
  )
}
const { rows: metricaAntes } = await db.query(
  'SELECT count(*)::int AS n, coalesce(sum(valor), 0)::text AS s FROM dispositivo_metrica',
)
conferir('aditivos semeados', metricaAntes[0].n, 4)
await aplicarNoCadastro(syncId)
const { rows: metricaDepois } = await db.query(
  'SELECT count(*)::int AS n, coalesce(sum(valor), 0)::text AS s FROM dispositivo_metrica',
)
conferir('linhas de dispositivo_metrica', metricaDepois[0].n, metricaAntes[0].n)
metricaDepois[0].s === metricaAntes[0].s
  ? ok(`soma de dispositivo_metrica intacta: ${metricaDepois[0].s}`)
  : falha(`dispositivo_metrica mudou: ${metricaAntes[0].s} -> ${metricaDepois[0].s}`)

const { rows: aditivoMontagem } = await db.query(
  `SELECT valor FROM dispositivo_metrica m JOIN dispositivo d ON d.id = m.dispositivo_id
    WHERE d.nome = 'Energy Trac' AND m.rotulo = 'Montagem Energy Trac'`,
)
conferir('aditivo "Montagem" segue 8,37 (o rollup), não o total', aditivoMontagem[0].valor, 8.37)

console.log('\nsync idempotente')
await aplicarNoCadastro(syncId)
conferir('Energy Trac · meta_padrao após 3 syncs', await meta('Energy Trac'), 14.18)

// ---------------------------------------------------------------- cenário não é tocado

console.log('\ncenário só muda por ação explícita')
const { rows: cen } = await db.query(
  `INSERT INTO cenario (nome, tipo, mes, ano, criado_por)
   VALUES ('teste', 'semanal', 8, 2026, 'vsuriani@tractian.com') RETURNING id`,
)
await db.query(
  `INSERT INTO cenario_meta (cenario_id, dispositivo_id, meta_min_peca)
   SELECT $1, id, 99 FROM dispositivo WHERE nome = 'Energy Trac'`,
  [cen[0].id],
)

await aplicarNoCadastro(syncId)
const metaCenario = async () => {
  const { rows } = await db.query(
    `SELECT meta_min_peca FROM cenario_meta m JOIN dispositivo d ON d.id = m.dispositivo_id
      WHERE m.cenario_id = $1 AND d.nome = 'Energy Trac'`,
    [cen[0].id],
  )
  return Number(rows[0].meta_min_peca)
}
conferir('sync NÃO mexe no cenário', await metaCenario(), 99)

const r = await pedir('POST', 'tempos?acao=aplicar-cenario', { cenarioId: cen[0].id })
conferir('aplicar-cenario status', r.status, 200)
conferir('agora o cenário recebeu', await metaCenario(), 14.18)

// ---------------------------------------------------------------- mapear pendência

console.log('\nmapear resolve pendência sem migration')
const antes = (await pedir('GET', 'tempos')).dados.pendencias.find(
  (p) => p.tipo === 'device-model-sem-dispositivo',
).itens.length
await pedir('POST', 'tempos?acao=mapear', {
  deviceModel: 'Smart Trac Pro',
  dispositivo: 'Energy Trac Pro',
})
const depois = (await pedir('GET', 'tempos')).dados.pendencias.find(
  (p) => p.tipo === 'device-model-sem-dispositivo',
).itens.length
conferir('pendências caíram em 1', antes - depois, 1)

// ---------------------------------------------------------------- fim

servidor.close()
console.log(falhas === 0 ? '\nTUDO OK\n' : `\n${falhas} FALHA(S)\n`)
process.exitCode = falhas === 0 ? 0 : 1
