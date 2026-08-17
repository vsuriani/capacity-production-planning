import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet } from './api'
import { noMesEmUso } from './escopo'
import type { Cenario, TipoCenario } from './tipos'

/** Carrega uma rota e reexpõe o estado de erro/carregando + um recarregar(). */
export function useApi<T>(rota: string | null) {
  const [dados, setDados] = useState<T | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(rota !== null)

  const recarregar = useCallback(() => {
    if (!rota) {
      setDados(null)
      setCarregando(false)
      return
    }
    setCarregando(true)
    apiGet<T>(rota)
      .then((r) => {
        setDados(r)
        setErro(null)
      })
      .catch((e: Error) => setErro(e.message))
      .finally(() => setCarregando(false))
  }, [rota])

  useEffect(recarregar, [recarregar])

  return { dados, erro, carregando, recarregar, setDados }
}

/**
 * Cenário selecionado para um tipo, com preferência guardada no localStorage.
 *
 * O seletor lista só os cenários do mês em uso (`MES_EM_USO`) — os meses importados da
 * planilha ficam de fora. O oficial (ou o primeiro) é o default.
 */
export function useCenarioSelecionado(tipo: TipoCenario) {
  const { dados, recarregar: recarregarLista } = useApi<{ cenarios: Cenario[] }>(
    `cenarios?tipo=${tipo}`,
  )
  const cenarios = useMemo(() => (dados?.cenarios ?? []).filter(noMesEmUso), [dados])
  const chave = `cenario:${tipo}`
  const [id, setIdBruto] = useState<number | null>(null)

  useEffect(() => {
    if (!cenarios.length) return
    setIdBruto((atual) => {
      if (atual && cenarios.some((c) => c.id === atual)) return atual
      // Um id salvo de outro mês não vale mais: cai no default.
      const salvo = Number(localStorage.getItem(chave))
      if (salvo && cenarios.some((c) => c.id === salvo)) return salvo

      return (cenarios.find((c) => c.oficial) ?? cenarios[0]).id
    })
  }, [cenarios, chave])

  const setId = useCallback(
    (novo: number) => {
      localStorage.setItem(chave, String(novo))
      setIdBruto(novo)
    },
    [chave],
  )

  return { cenarios, id, setId, recarregarLista }
}
