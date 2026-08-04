/** Formatação pt-BR usada nas grades. */

const numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const numeroPreciso = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

export function fmtNum(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  const n = Number(valor)
  if (!Number.isFinite(n)) return '∞'
  return numero.format(n)
}

export function fmtDecimal(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  const n = Number(valor)
  if (!Number.isFinite(n)) return '∞'
  return numeroPreciso.format(n)
}

export function fmtInt(valor: number | string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—'
  const n = Number(valor)
  if (!Number.isFinite(n)) return '∞'
  return inteiro.format(n)
}

/** Datas trafegam como 'YYYY-MM-DD' — formatar sem passar por Date evita fuso. */
export function fmtData(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export function fmtDiaSemana(iso: string | null | undefined): string {
  if (!iso) return ''
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number)
  return DIAS[new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()]
}

export const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]
