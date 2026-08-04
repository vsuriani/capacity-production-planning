import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPatch } from './api'
import type { Cenario, Correcoes, TipoCenario } from './tipos'

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
 * O oficial (ou o primeiro) é o default.
 */
export function useCenarioSelecionado(tipo: TipoCenario) {
  const { dados, recarregar: recarregarLista } = useApi<{ cenarios: Cenario[] }>(
    `cenarios?tipo=${tipo}`,
  )
  const cenarios = useMemo(() => dados?.cenarios ?? [], [dados])
  const chave = `cenario:${tipo}`
  const [id, setIdBruto] = useState<number | null>(null)

  useEffect(() => {
    if (!cenarios.length) return
    setIdBruto((atual) => {
      if (atual && cenarios.some((c) => c.id === atual)) return atual
      const salvo = Number(localStorage.getItem(chave))
      if (salvo && cenarios.some((c) => c.id === salvo)) return salvo

      // Cada cenário planeja um mês; o default é o mês corrente. Os outros ficam no
      // seletor como histórico.
      const agora = new Date()
      const doMes = cenarios.find(
        (c) => c.mes === agora.getMonth() + 1 && c.ano === agora.getFullYear(),
      )
      return (doMes ?? cenarios.find((c) => c.oficial) ?? cenarios[0]).id
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

/** Liga/desliga a correção de um desvio no cenário e recarrega o cálculo. */
export function useCorrecoes(cenarioId: number | null, correcoes: Correcoes, aoSalvar: () => void) {
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const alternar = useCallback(
    async (desvio: string, ligado: boolean) => {
      if (!cenarioId) return
      setSalvando(true)
      setErro(null)
      try {
        await apiPatch(`cenarios?id=${cenarioId}`, {
          correcoes: { ...correcoes, [desvio]: ligado },
        })
        aoSalvar()
      } catch (e) {
        setErro((e as Error).message)
      } finally {
        setSalvando(false)
      }
    },
    [cenarioId, correcoes, aoSalvar],
  )

  return { alternar, salvando, erro }
}
