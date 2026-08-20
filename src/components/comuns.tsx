import { useEffect, useState } from 'react'
import { AlertCircle } from 'lucide-react'
import type { Cenario } from '../lib/tipos'

export function Erro({ mensagem }: { mensagem: string | null }) {
  if (!mensagem) return null
  return (
    <div className="panel border-red-200 bg-red-50 px-4 py-3 mb-4 flex items-start gap-2">
      <AlertCircle size={16} className="text-red-600 mt-0.5 shrink-0" />
      <p className="text-sm text-red-800">{mensagem}</p>
    </div>
  )
}

export function Carregando({ linhas = 6 }: { linhas?: number }) {
  return (
    <div className="panel p-4 space-y-2">
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="skeleton h-6" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  )
}

export function SeletorCenario({
  cenarios,
  id,
  onSelecionar,
}: {
  cenarios: Cenario[]
  id: number | null
  onSelecionar: (id: number) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="label-overline">Cenário</label>
      <select
        className="input-field w-auto min-w-64"
        value={id ?? ''}
        onChange={(e) => onSelecionar(Number(e.target.value))}
      >
        {cenarios.length === 0 && <option value="">nenhum cenário</option>}
        {cenarios.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
      </select>
    </div>
  )
}

export function Kpi({
  rotulo,
  valor,
  detalhe,
  tom = 'normal',
}: {
  rotulo: string
  valor: string
  detalhe?: string
  tom?: 'normal' | 'alerta'
}) {
  return (
    <div className="kpi-card">
      <div className="label-overline">{rotulo}</div>
      <div className={`kpi-value ${tom === 'alerta' ? 'text-amber-700' : ''}`}>{valor}</div>
      {detalhe && <div className="text-xs text-slate-500">{detalhe}</div>}
    </div>
  )
}

/** Célula de texto editável, mesma mecânica da CelulaNumero. */
export function CelulaTexto({
  valor,
  onConfirmar,
  placeholder = '',
  className = '',
}: {
  valor: string | null
  onConfirmar: (valor: string) => void
  placeholder?: string
  className?: string
}) {
  const [texto, setTexto] = useState(valor ?? '')
  const [editando, setEditando] = useState(false)

  useEffect(() => {
    if (!editando) setTexto(valor ?? '')
  }, [valor, editando])

  const confirmar = () => {
    setEditando(false)
    const limpo = texto.trim()
    if (limpo !== (valor ?? '')) onConfirmar(limpo)
  }

  return (
    <input
      className={`cell-input text-left ${className}`}
      placeholder={placeholder}
      value={texto}
      onFocus={() => setEditando(true)}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setEditando(false)
          setTexto(valor ?? '')
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

/** Célula de data (ISO). Só comunica quando a data está completa e mudou. */
export function CelulaData({
  valor,
  onConfirmar,
  className = '',
}: {
  valor: string | null
  onConfirmar: (valor: string) => void
  className?: string
}) {
  return (
    <input
      type="date"
      className={`cell-input text-left ${className}`}
      value={(valor ?? '').slice(0, 10)}
      onChange={(e) => {
        const novo = e.target.value
        if (novo.length === 10 && novo !== (valor ?? '').slice(0, 10)) onConfirmar(novo)
      }}
    />
  )
}

export type OpcaoCelula = { valor: string; rotulo: string; grupo?: string }

/**
 * Célula de escolha fechada. Opções com `grupo` viram `<optgroup>` — é o que torna uma lista
 * longa (os 87 processos) navegável.
 *
 * O valor atual entra na lista quando não está no catálogo, para o select nunca aparecer
 * vazio nem trocar o dado da linha sozinho.
 */
export function CelulaSelecao({
  valor,
  opcoes,
  onConfirmar,
  className = '',
}: {
  valor: string
  opcoes: OpcaoCelula[]
  onConfirmar: (valor: string) => void
  className?: string
}) {
  const lista = opcoes.some((o) => o.valor === valor)
    ? opcoes
    : [{ valor, rotulo: valor === '' ? '—' : `${valor} (fora do cadastro)` }, ...opcoes]

  const soltas = lista.filter((o) => !o.grupo)
  const grupos = new Map<string, OpcaoCelula[]>()
  for (const o of lista) {
    if (!o.grupo) continue
    if (!grupos.has(o.grupo)) grupos.set(o.grupo, [])
    grupos.get(o.grupo)!.push(o)
  }

  const item = (o: OpcaoCelula) => (
    <option key={`${o.grupo ?? ''}|${o.valor}`} value={o.valor}>
      {o.rotulo}
    </option>
  )

  return (
    <select
      className={`cell-input text-left ${className}`}
      value={valor}
      onChange={(e) => e.target.value !== valor && onConfirmar(e.target.value)}
    >
      {soltas.map(item)}
      {[...grupos].map(([rotulo, itens]) => (
        <optgroup key={rotulo} label={rotulo}>
          {itens.map(item)}
        </optgroup>
      ))}
    </select>
  )
}

/**
 * Célula numérica editável das grades densas: mantém o texto local enquanto o usuário
 * digita e só comunica no blur/Enter, para não recalcular a cada tecla.
 */
export function CelulaNumero({
  valor,
  onConfirmar,
  className = '',
  placeholder = '',
  decimais = 2,
}: {
  valor: number | null
  onConfirmar: (valor: number) => void
  className?: string
  placeholder?: string
  decimais?: number
}) {
  const formatar = (v: number | null) =>
    v === null || v === undefined ? '' : String(Number(v.toFixed(decimais))).replace('.', ',')

  const [texto, setTexto] = useState(formatar(valor))
  const [editando, setEditando] = useState(false)

  useEffect(() => {
    if (!editando) setTexto(formatar(valor))
  }, [valor, editando]) // eslint-disable-line react-hooks/exhaustive-deps

  const confirmar = () => {
    setEditando(false)
    const numero = Number(texto.replace(',', '.'))
    if (texto.trim() === '' || Number.isNaN(numero)) {
      setTexto(formatar(valor))
      return
    }
    if (numero !== valor) onConfirmar(numero)
  }

  return (
    <input
      className={`cell-input ${className}`}
      inputMode="decimal"
      placeholder={placeholder}
      value={texto}
      onFocus={() => setEditando(true)}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={confirmar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          setEditando(false)
          setTexto(formatar(valor))
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}
