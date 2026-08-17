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
