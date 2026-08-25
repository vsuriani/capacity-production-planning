/**
 * Leitura dos TSV do forecast em docs/.
 *
 * Compartilhado pelo importador (`importar_forecast.mjs`) e pela verificação
 * (`verificar_dimensionamento.mjs`), para os dois carregarem exatamente o mesmo dado.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const tsv = (arquivo) =>
  readFileSync(arquivo, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split('\t'))

/**
 * docs/forecast.tsv -> uma linha por célula.
 * Cabeçalho: Country, Product, Model e depois os meses como "MM/AAAA".
 */
export function lerForecast(raiz) {
  const [cabecalho, ...linhas] = tsv(path.join(raiz, 'docs', 'forecast.tsv'))

  const colunas = cabecalho
    .map((rotulo, indice) => ({ rotulo: rotulo.trim(), indice }))
    .filter((c) => /^\d{2}\/\d{4}$/.test(c.rotulo))
    .map(({ rotulo, indice }) => {
      const [mes, ano] = rotulo.split('/')
      return { indice, mes: Number(mes), ano: Number(ano) }
    })

  if (!colunas.length) throw new Error('docs/forecast.tsv sem nenhuma coluna de mês MM/AAAA')

  const celulas = []
  for (const linha of linhas) {
    const [country, produto, model] = linha.map((v) => v.trim())
    if (!model) continue
    for (const c of colunas) {
      celulas.push({
        country,
        produto,
        model,
        ano: c.ano,
        mes: c.mes,
        quantidade: Number(linha[c.indice] ?? 0) || 0,
      })
    }
  }
  return celulas
}

/** docs/dispositivos-forecast.tsv -> [{ model, dispositivo }]. */
export function lerMapa(raiz) {
  const [, ...linhas] = tsv(path.join(raiz, 'docs', 'dispositivos-forecast.tsv'))
  return linhas
    .map((l) => ({ dispositivo: (l[0] ?? '').trim(), model: (l[2] ?? '').trim() }))
    .filter((m) => m.model && m.dispositivo)
}

/**
 * docs/tempos-dispositivo.tsv -> [{ dispositivo, componentes: [{rotulo, papel, valor}] }].
 *
 * A linha `total` é derivada (`Σ(aditivos) + retrabalho × (1 − FTR)`) e não é carregada — o
 * motor a recalcula. Ela fica no arquivo para conferência a olho.
 */
export function lerTempos(raiz) {
  const [, ...linhas] = tsv(path.join(raiz, 'docs', 'tempos-dispositivo.tsv'))

  const porDispositivo = new Map()
  for (const [nome, papel, rotulo, parcial] of linhas) {
    const dispositivo = (nome ?? '').trim()
    if (!dispositivo) continue
    if (!porDispositivo.has(dispositivo)) porDispositivo.set(dispositivo, [])
    if (papel === 'total') continue
    porDispositivo.get(dispositivo).push({
      rotulo: (rotulo ?? '').trim(),
      papel,
      valor: Number(parcial) || 0,
    })
  }

  return [...porDispositivo].map(([dispositivo, componentes]) => ({ dispositivo, componentes }))
}
