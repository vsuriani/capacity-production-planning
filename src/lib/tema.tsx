import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type Tema = 'light' | 'dark'

const CHAVE = 'tema'

function temaInicial(): Tema {
  const salvo = localStorage.getItem(CHAVE)
  if (salvo === 'light' || salvo === 'dark') return salvo
  // Sem preferência salva, segue o sistema.
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const Contexto = createContext<{ tema: Tema; alternar: () => void }>({
  tema: 'light',
  alternar: () => {},
})

export function ProvedorTema({ children }: { children: React.ReactNode }) {
  const [tema, setTema] = useState<Tema>(temaInicial)

  useEffect(() => {
    document.documentElement.dataset.theme = tema
    localStorage.setItem(CHAVE, tema)
  }, [tema])

  // Acompanha o sistema só enquanto o usuário não escolheu manualmente.
  useEffect(() => {
    if (localStorage.getItem(CHAVE)) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const aoMudar = (e: MediaQueryListEvent) => setTema(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', aoMudar)
    return () => mq.removeEventListener('change', aoMudar)
  }, [])

  const alternar = useCallback(() => setTema((t) => (t === 'dark' ? 'light' : 'dark')), [])

  return <Contexto.Provider value={{ tema, alternar }}>{children}</Contexto.Provider>
}

export const useTema = () => useContext(Contexto)
