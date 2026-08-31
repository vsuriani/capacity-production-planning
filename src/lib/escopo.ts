/**
 * O mês que o app está planejando.
 *
 * O banco guarda os cenários importados da planilha (um por mês, de 12/2025 a 05/2027), mas o
 * app trabalha em um mês só: as telas e o seletor de cenário mostram apenas este. Os outros
 * seguem gravados como histórico, acessíveis pela API.
 *
 * Para virar o mês, é esta constante — e só ela.
 */
export const MES_EM_USO = { mes: 8, ano: 2026 } as const

/** true quando o cenário é do mês em uso. */
export function noMesEmUso(cenario: { mes: number | null; ano: number | null }) {
  return cenario.mes === MES_EM_USO.mes && cenario.ano === MES_EM_USO.ano
}

/**
 * O tamanho da equipe da linha — a capacidade instalada, não o que o cálculo pediu.
 *
 * É o divisor do KPI **Hora/Homem mês** do Cenário semanal: quantas horas cada posto absorve no
 * mês se a carga for repartida pela equipe cheia. Por isso é constante e não o "Pico de
 * operadores" do card ao lado: o pico é o que a demanda exige e varia a cada cenário, enquanto
 * este número é quanta gente a linha tem.
 *
 * Para mudar o tamanho da equipe, é esta constante — e só ela.
 */
export const OPERADORES_DA_LINHA = 9
