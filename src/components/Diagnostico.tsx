import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react'
import type { Correcoes, Diagnostico as TDiagnostico } from '../lib/tipos'

/**
 * Painel de diagnóstico: o mecanismo central do app.
 *
 * O cálculo é FIEL à planilha por padrão. Cada divergência conhecida aparece aqui com o
 * que a planilha faz, o impacto medido e o que muda se a correção for ligada. Nada é
 * corrigido sem ação explícita — a escolha fica gravada no cenário.
 */
export function PainelDiagnostico({
  diagnosticos,
  correcoes,
  onAlternar,
  salvando,
}: {
  diagnosticos: TDiagnostico[]
  correcoes: Correcoes
  onAlternar: (id: string, ligado: boolean) => void
  salvando?: boolean
}) {
  const ligadas = Object.entries(correcoes).filter(([, v]) => v).length

  return (
    <section className="panel">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          {diagnosticos.length > 0 ? (
            <AlertTriangle size={16} className="text-amber-600" strokeWidth={2} />
          ) : (
            <ShieldCheck size={16} className="text-emerald-600" strokeWidth={2} />
          )}
          <h2 className="font-heading font-semibold text-sm text-slate-900">
            Diagnóstico
          </h2>
          <span className="chip">{diagnosticos.length} divergência(s) ativa(s)</span>
          {ligadas > 0 && <span className="chip-ok">{ligadas} correção(ões) ligada(s)</span>}
        </div>
        {salvando && <span className="text-xs text-slate-500">salvando…</span>}
      </header>

      {diagnosticos.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">
          Nenhuma divergência conhecida neste cenário — o cálculo bate com a planilha e não há
          nada pendente de correção.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {diagnosticos.map((d) => (
            <ItemDiagnostico
              key={d.id}
              diagnostico={d}
              ligado={correcoes[d.id] === true}
              onAlternar={onAlternar}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function ItemDiagnostico({
  diagnostico: d,
  ligado,
  onAlternar,
}: {
  diagnostico: TDiagnostico
  ligado: boolean
  onAlternar: (id: string, ligado: boolean) => void
}) {
  const [aberto, setAberto] = useState(false)

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <button
          onClick={() => setAberto(!aberto)}
          className="mt-0.5 text-slate-400 hover:text-slate-700 shrink-0"
          aria-label={aberto ? 'Recolher' : 'Expandir'}
        >
          {aberto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-900">{d.titulo}</span>
            <span className="chip">{d.aba}</span>
          </div>
          <p className="text-sm text-slate-600 mt-0.5">{d.detalhe}</p>

          {aberto && (
            <div className="mt-3 space-y-3 text-sm">
              <Campo rotulo="O que a planilha faz">{d.planilha}</Campo>
              <Campo rotulo="Impacto medido">{d.impacto}</Campo>
              <Campo rotulo="Se a correção for ligada">{d.correcao}</Campo>

              {d.periodos && d.periodos.length > 0 && (
                <Campo rotulo="Períodos afetados">
                  <span className="data-code">{d.periodos.join(', ')}</span>
                </Campo>
              )}

              {d.itens && d.itens.length > 0 && (
                <Campo rotulo={`Itens (${d.itens.length})`}>
                  <ul className="mt-1 space-y-0.5 max-h-52 overflow-y-auto">
                    {d.itens.slice(0, 60).map((item, i) => (
                      <li key={i} className="data-code">
                        {Object.entries(item)
                          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' + ') : String(v)}`)
                          .join(' · ')}
                      </li>
                    ))}
                    {d.itens.length > 60 && (
                      <li className="text-xs text-slate-500">
                        …e mais {d.itens.length - 60}
                      </li>
                    )}
                  </ul>
                </Campo>
              )}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 shrink-0 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={ligado}
            onChange={(e) => onAlternar(d.id, e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-blue-600/25"
          />
          <span className="text-xs text-slate-600 whitespace-nowrap">Aplicar correção</span>
        </label>
      </div>
    </li>
  )
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label-overline">{rotulo}</div>
      <div className="text-slate-700">{children}</div>
    </div>
  )
}
