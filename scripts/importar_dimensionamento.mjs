/**
 * Carrega os dados do Dimensionamento Global — os três TSV de docs/ — no app.
 *
 *   tempos-dispositivo.tsv       -> POST /api/dimensionamento?acao=tempos
 *   forecast.tsv + dispositivos-forecast.tsv -> POST /api/forecast
 *
 * Tudo por HTTP, como o `desvincular_planilha.mjs` — o datadir do pglite fica travado pelo dev
 * server, então escrever direto no banco não é opção em dev.
 *
 * As duas rotas **substituem** o conjunto inteiro (o dado chega revisado por completo). Os
 * ajustes feitos na tela não se perdem nisso: eles moram em `global_ajuste`, que este script
 * não toca. Os dias úteis digitados também ficam (`global_mes`).
 *
 * Uso:
 *   node scripts/importar_dimensionamento.mjs
 *   node scripts/importar_dimensionamento.mjs --so-forecast
 *   node scripts/importar_dimensionamento.mjs --api http://localhost:3101
 */
import path from 'node:path'
import { lerForecast, lerMapa, lerTempos } from './_forecast.mjs'

const args = process.argv.slice(2)
const opcao = (nome, padrao = null) => {
  const i = args.indexOf(`--${nome}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao
}

const API = opcao('api', 'http://localhost:3101').replace(/\/$/, '')
const EMAIL = opcao('email', 'vsuriani@tractian.com')
const raiz = path.join(import.meta.dirname, '..')

async function pedir(metodo, rota, corpo) {
  const r = await fetch(`${API}/api/${rota}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'X-Auth-Email': EMAIL },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  const texto = await r.text()
  if (!r.ok) throw new Error(`${metodo} ${rota} -> ${r.status} ${texto.slice(0, 300)}`)
  return texto ? JSON.parse(texto) : null
}

const ok = (msg) => console.log(`  ok    ${msg}`)
const info = (msg) => console.log(`  ·     ${msg}`)

// ---------------------------------------------------------------- tempos

if (!args.includes('--so-forecast')) {
  const tempos = lerTempos(raiz)
  console.log('\ntempos por dispositivo (docs/tempos-dispositivo.tsv)')
  info(`${tempos.length} dispositivos, ${tempos.reduce((s, t) => s + t.componentes.length, 0)} componentes`)

  const r = await pedir('POST', 'dimensionamento?acao=tempos', { tempos })
  ok(`${r.componentes} componentes gravados`)
  if (r.dispositivosCriados) info(`${r.dispositivosCriados} dispositivo(s) criado(s) no cadastro`)
}

// ---------------------------------------------------------------- forecast

const linhas = lerForecast(raiz)
const mapa = lerMapa(raiz)

const models = new Set(linhas.map((l) => l.model))
const meses = [...new Set(linhas.map((l) => `${l.ano}-${String(l.mes).padStart(2, '0')}`))].sort()

console.log('\nforecast (docs/forecast.tsv)')
info(`${linhas.length} células, ${models.size} models`)
info(`${meses.length} meses, de ${meses[0]} a ${meses.at(-1)}`)
info(`mapa com ${mapa.length} models`)

const r = await pedir('POST', 'forecast', { linhas, mapa })
ok(`${r.linhas} linhas gravadas, mapa com ${r.mapa}`)

// ---------------------------------------------------------------- conferência

const grade = await pedir('GET', 'dimensionamento')

console.log('\na grade')
ok(`${grade.dispositivos.length} dispositivos × ${grade.meses.length} meses`)

if (grade.modelsSemDispositivo.length) {
  info(`sem dispositivo: ${grade.modelsSemDispositivo.map((m) => m.model).join(', ')}`)
} else {
  ok('todo model do forecast tem dispositivo')
}

const semDias = grade.meses.filter((m) => m.diasUteis === null)
if (semDias.length) info(`${semDias.length} mês(es) ainda sem dias úteis — digitar na tela`)

for (const r of grade.resultados.filter((x) => !x.erro)) {
  info(`${r.periodo}: ${r.operadoresFracionario.toFixed(2)} -> ${r.operadores} operadores`)
}
console.log()
