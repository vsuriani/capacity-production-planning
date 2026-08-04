import { useEffect, useState } from 'react'
import { AlertCircle, Star } from 'lucide-react'
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
  const atual = cenarios.find((c) => c.id === id)
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
            {c.oficial ? ' ★' : ''}
          </option>
        ))}
      </select>
      {atual?.oficial && (
        <span className="chip-ok">
          <Star size={11} /> oficial
        </span>
      )}
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
