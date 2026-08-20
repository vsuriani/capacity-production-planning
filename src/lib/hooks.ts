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
 * O seletor lista **todos os meses**, com o mês em uso (`MES_EM_USO`) na frente, e abre nele —
 * `MES_EM_USO` é o default da tela, não mais um filtro. Ele filtrava porque o banco carregava os
 * 14 cenários mensais importados da planilha e o seletor virava uma lista ilegível; esses
 * cenários foram apagados em 17/08 (`desvincular_planilha.mjs`), e esconder o resto passou a
 * esconder justamente o cenário que o usuário acabou de criar para o mês que vem.
 */
export function useCenarioSelecionado(tipo: TipoCenario) {
  const { dados, recarregar: recarregarLista } = useApi<{ cenarios: Cenario[] }>(
    `cenarios?tipo=${tipo}`,
  )
  const cenarios = useMemo(
    () =>
      [...(dados?.cenarios ?? [])].sort(
        (a, b) =>
          Number(noMesEmUso(b)) - Number(noMesEmUso(a)) ||
          (b.ano ?? 0) - (a.ano ?? 0) ||
          (b.mes ?? 0) - (a.mes ?? 0) ||
          b.criado_em.localeCompare(a.criado_em),
      ),
    [dados],
  )
  const chave = `cenario:${tipo}`
  const [id, setIdBruto] = useState<number | null>(null)

  useEffect(() => {
    if (!cenarios.length) return
    setIdBruto((atual) => {
      if (atual && cenarios.some((c) => c.id === atual)) return atual
      // A escolha da última sessão vale, inclusive de outro mês: trabalhar no mês que vem é
      // uma sessão inteira, não um clique.
      const salvo = Number(localStorage.getItem(chave))
      if (salvo && cenarios.some((c) => c.id === salvo)) return salvo

      // Sem preferência, abre no mês em uso; só cai no resto se ele não tiver cenário.
      const doMes = cenarios.filter(noMesEmUso)
      const preferidos = doMes.length ? doMes : cenarios
      return (preferidos.find((c) => c.oficial) ?? preferidos[0]).id
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
