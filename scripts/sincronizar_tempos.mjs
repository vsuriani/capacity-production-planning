/**
 * Lê a planilha "Análises Best Laps" e mostra o que ela mudaria no app.
 *
 * Em produção quem faz isso é o agendador dentro do `server.cjs`, de 24 em 24 horas. Este script
 * existe para dois usos que o agendador não cobre:
 *
 *   --dry-run    conferir o diff ANTES de armar o sync num ambiente (não escreve nada)
 *   --fixture    recongelar `api/_lib/motor/tempos.fixture.json`, quando a planilha mudar de
 *                forma e os testes precisarem acompanhar
 *
 * Sem flag, empurra para a API o `?acao=sync`, como faz o `importar_dimensionamento.mjs`.
 *
 * Credencial: GOOGLE_SA_JSON (conteúdo) ou GOOGLE_APPLICATION_CREDENTIALS (caminho).
 * Planilha:   TEMPOS_SHEET_ID, ou o padrão abaixo.
 *
 * Uso:
 *   node scripts/sincronizar_tempos.mjs --dry-run
 *   node scripts/sincronizar_tempos.mjs --fixture
 *   node scripts/sincronizar_tempos.mjs --api http://localhost:3101
 */
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const raiz = path.join(import.meta.dirname, '..')

const args = process.argv.slice(2)
const opcao = (nome, padrao = null) => {
  const i = args.indexOf(`--${nome}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao
}

const SHEET = process.env.TEMPOS_SHEET_ID || '1sTJrXZ3TBi444ZFJCg9PR8L74RnYCQm4jlRWgnrdeCU'
const ABA = process.env.TEMPOS_SHEET_ABA || 'Perfomancedev'
const API = opcao('api', 'http://localhost:3101').replace(/\/$/, '')
const EMAIL = opcao('email', 'vsuriani@tractian.com')

const { lerAba, configurado } = require(path.join(raiz, 'api', '_lib', 'sheets.js'))
const { agregarTempos, normalizar } = require(path.join(raiz, 'api', '_lib', 'motor', 'tempos.js'))

if (!configurado()) {
  console.error(
    'Sem credencial. Defina GOOGLE_SA_JSON (conteúdo) ou GOOGLE_APPLICATION_CREDENTIALS (caminho).',
  )
  process.exit(1)
}

const num = (v) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

console.log(`\nlendo "${ABA}" de ${SHEET}`)
const linhas = await lerAba(SHEET, ABA)
console.log(`  ${linhas.length} linhas`)

const atividades = linhas.map((l) => ({
  deviceModel: (l.device_model ?? '').trim(),
  processo: (l.process ?? '').trim(),
  processType: (l.process_type ?? '').trim() || null,
  bestLap: num(l.best_lap),
  goal: num(l.goal),
  goalMin: num(l.goal_min),
  goalMax: num(l.goal_max),
  mesMedicao: num(l.month),
  obsoleta: String(l.obsoletas ?? '').toUpperCase() === 'TRUE',
}))

// ---------------------------------------------------------------- --fixture

if (args.includes('--fixture')) {
  const destino = path.join(raiz, 'api', '_lib', 'motor', 'tempos.fixture.json')
  writeFileSync(
    destino,
    JSON.stringify(
      {
        _origem: `planilha "Análises Best Laps" (${SHEET}), aba ${ABA}`,
        _congelado_em: new Date().toISOString().slice(0, 10),
        _regenerar: 'node scripts/sincronizar_tempos.mjs --fixture',
        atividades,
      },
      null,
      1,
    ) + '\n',
  )
  console.log(`\nfixture regravada: ${atividades.length} atividades`)
  console.log('Rode `npm test` — se algum número travado mudou, é decisão, não detalhe.\n')
  process.exit(0)
}

// ---------------------------------------------------------------- --dry-run

if (args.includes('--dry-run')) {
  // Sem banco: usa o de-para que a migration 010 semeia, para o diff ser o mesmo que o app veria.
  const PARES = [
    ['Energy Trac', 'Energy Trac'],
    ['Smart Trac Ultra Ex', 'Smart Trac Ultra Ex'],
    ['Smart Receiver Ultra', 'Smart Receiver Ultra'],
    ['Smart Trac Ultra Gen 2', 'Smart Trac Ultra Gen 2'],
    ['Smart Trac Ultra Gen 2 Ex', 'Smart Trac Ultra Gen 2 EX'],
    ['Omni Trac', 'Omni Trac'],
    ['Omni Receiver', 'Omni Receiver'],
    ['Uni Trac', 'Uni Trac'],
    ['OEE Trac', 'Uni Trac 2.0'],
    ['Garra OEE', 'Garra Uni Trac'],
    ['Smart Trac Ultra', 'Smart Trac Ultra Gen 1'],
  ]
  const dePara = new Map(PARES.map(([dm, nome], i) => [normalizar(dm), { id: i + 1, nome }]))

  const { resultado, pendencias, resumo } = agregarTempos({
    atividades,
    dePara,
    dispositivosAtivos: PARES.map(([, nome], i) => ({ id: i + 1, nome })),
  })

  console.log(
    `\nusadas ${resumo.usadas} de ${resumo.lidas} ` +
      `(${resumo.descartadas.obsoleta} obsoletas, ${resumo.descartadas.semDeviceModel} sem device ` +
      `model, ${resumo.descartadas.rollup} de rollup "montar completo")`,
  )

  console.log('\n  dispositivo                        total  defasagem   indust.     prod.')
  for (const r of resultado) {
    const c = (v) => (v > 0 ? v.toFixed(2).padStart(10) : '         —')
    console.log(
      `  ${r.dispositivo.padEnd(30)}${r.total.toFixed(2).padStart(7)}${c(r.defasagem)}${c(r.industrializacao)}${c(r.producao)}`,
    )
  }

  console.log('\npendências')
  for (const p of pendencias) {
    console.log(`  [${p.tipo}] ${p.mensagem}`)
    for (const item of p.itens.slice(0, 6)) {
      console.log(
        `      ${Object.entries(item)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('/') : v}`)
          .join(' · ')}`,
      )
    }
    if (p.itens.length > 6) console.log(`      … +${p.itens.length - 6}`)
  }

  console.log('\n--dry-run: nada gravado.\n')
  process.exit(0)
}

// ---------------------------------------------------------------- empurra para a API

const r = await fetch(`${API}/api/tempos?acao=sync`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Auth-Email': EMAIL },
})
const dados = await r.json()
if (!r.ok) {
  console.error(`\nfalhou (${r.status}): ${dados.erro}\n`)
  process.exit(1)
}
console.log(`\nsync ok: ${dados.linhas} linhas, ${dados.alteracoes.length} alteração(ões)`)
for (const a of dados.alteracoes) {
  console.log(`  ${a.dispositivo}: ${a.de} -> ${a.para}`)
}
console.log()
