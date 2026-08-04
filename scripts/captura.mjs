/**
 * Screenshot de uma rota do app em tema claro ou escuro, via DevTools Protocol.
 *
 * O tema do app segue o localStorage e, sem preferência salva, o
 * prefers-color-scheme — que só é emulável pelo CDP (as flags de linha de comando do
 * Chrome não afetam esse media query em headless).
 *
 * Uso: node scripts/captura.mjs <rota> <light|dark> <arquivo.png> [altura]
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const [rota, tema = 'light', saida = 'tela.png', altura = '1300'] = process.argv.slice(2)
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORTA = 9315

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  `--remote-debugging-port=${PORTA}`,
  `--user-data-dir=C:/Windows/Temp/chrome-cdp-${tema}`,
  'about:blank',
], { stdio: 'ignore' })

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

async function alvo() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORTA}/json/list`)
      const abas = await r.json()
      const pagina = abas.find((a) => a.type === 'page')
      if (pagina?.webSocketDebuggerUrl) return pagina.webSocketDebuggerUrl
    } catch {
      /* o Chrome ainda não abriu a porta */
    }
    await esperar(300)
  }
  throw new Error('não consegui falar com o Chrome pelo CDP')
}

const ws = new WebSocket(await alvo())
await new Promise((r) => (ws.onopen = r))

let seq = 0
const pendentes = new Map()
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pendentes.has(msg.id)) {
    pendentes.get(msg.id)(msg.result)
    pendentes.delete(msg.id)
  }
}
const cdp = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq
    pendentes.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

await cdp('Page.enable')
await cdp('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: Number(altura),
  deviceScaleFactor: 1,
  mobile: false,
})
await cdp('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-color-scheme', value: tema }],
})

await cdp('Page.navigate', { url: `http://localhost:5273/${rota}` })
await esperar(6000) // dá tempo do /api responder e o React montar

const { data } = await cdp('Page.captureScreenshot', { format: 'png' })
writeFileSync(saida, Buffer.from(data, 'base64'))
console.log(`${saida}: ${Buffer.from(data, 'base64').length} bytes (tema ${tema})`)

ws.close()
chrome.kill()
