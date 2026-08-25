/**
 * Cadastra os feriados nacionais brasileiros de um ou mais anos na tabela `feriado`.
 *
 * A tabela é compartilhada: quem consulta é `diasUteisDoMes()`/`ehDiaUtil()` do motor, então o
 * cadastro vale para o Dimensionamento Global, para os dias úteis de um cenário novo e para o
 * bloco mensal do Início.
 *
 * Só os feriados **por lei** — ver o porquê em `_feriados_br.mjs`. É idempotente: a rota faz
 * `ON CONFLICT DO UPDATE`, então rodar de novo não duplica.
 *
 * Uso:
 *   node scripts/cadastrar_feriados.mjs 2026 2027
 *   node scripts/cadastrar_feriados.mjs 2026 --api http://localhost:3101
 */
import { feriadosNacionais } from './_feriados_br.mjs'

const args = process.argv.slice(2)
const opcao = (nome, padrao = null) => {
  const i = args.indexOf(`--${nome}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao
}

const API = opcao('api', 'http://localhost:3101').replace(/\/$/, '')
const EMAIL = opcao('email', 'vsuriani@tractian.com')

const anos = args.filter((a) => /^\d{4}$/.test(a)).map(Number)
if (!anos.length) {
  console.error('informe ao menos um ano: node scripts/cadastrar_feriados.mjs 2026 2027')
  process.exit(1)
}

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

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const diaDaSemana = (iso) => DIAS[new Date(`${iso}T00:00:00Z`).getUTCDay()]

for (const ano of anos) {
  console.log(`\nferiados nacionais de ${ano}`)
  for (const f of feriadosNacionais(ano)) {
    await pedir('POST', 'parametros?feriado=1', f)
    const fds = diaDaSemana(f.data) === 'sáb' || diaDaSemana(f.data) === 'dom'
    console.log(
      `  ok    ${f.data} ${diaDaSemana(f.data)}  ${f.descricao}${fds ? '  (cai no fim de semana)' : ''}`,
    )
  }
}

const { feriados } = await pedir('GET', 'parametros')
console.log(`\n  ·     ${feriados.length} feriados cadastrados no total\n`)
