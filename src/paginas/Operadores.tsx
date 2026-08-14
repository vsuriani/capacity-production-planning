import { useMemo, useState } from 'react'
import { AlertTriangle, OctagonAlert, RefreshCw } from 'lucide-react'
import { apiPost } from '../lib/api'
import { useApi, useCenarioSelecionado } from '../lib/hooks'
import { fmtDecimal, fmtData, fmtDiaSemana, fmtInt } from '../lib/formato'
import type { Diagnostico } from '../lib/tipos'
import { PainelDiagnostico } from '../components/Diagnostico'
import { Carregando, Erro, Kpi, SeletorCenario } from '../components/comuns'

type Heat = {
  dias: { data: string; horas: number[]; total: number; acimaDaJornada: number }[]
  qtdOperadores: number
  jornadaLiquida: number
  jornadaCheia: number
}

/**
 * Heat map de ocupação (aba Dimensionamento de Operadores).
 *
 * Encoding: a ocupação é MAGNITUDE, então rampa sequencial de um único matiz — o Blue de
 * marca, passos 100→600, lightness monotônica decrescente (validado: 0,932 → 0,882 → 0,714
 * → 0,546). Estouro de jornada é ESTADO, não magnitude: usa a paleta de status
 * (amber/red) e nunca só a cor — vem com ícone e rótulo.
 *
 * Cada célula traz o número (rótulo direto), o que também resolve o contraste baixo dos
 * passos claros contra a superfície.
 */
function estiloDaCelula(horas: number, jornadaLiquida: number, jornadaCheia: number) {
  if (horas <= 0) return { classe: 'heat-0', estado: null }
  if (horas > jornadaCheia) return { classe: 'heat-critico', estado: 'critico' as const }
  if (horas > jornadaLiquida) return { classe: 'heat-atencao', estado: 'atencao' as const }
  if (horas >= jornadaLiquida - 0.5) return { classe: 'heat-4', estado: null }
  if (horas <= 2) return { classe: 'heat-1', estado: null }
  if (horas <= 5) return { classe: 'heat-2', estado: null }
  return { classe: 'heat-3', estado: null }
}

export function Operadores() {
  const { cenarios, id, setId } = useCenarioSelecionado('mensal')
  const { dados, erro, carregando, recarregar } = useApi<Heat>(
    id ? `alocacao?cenario=${id}` : null,
  )
  const [recalculando, setRecalculando] = useState(false)
  const [erroCalc, setErroCalc] = useState<string | null>(null)
  const [diagnosticos, setDiagnosticos] = useState<Diagnostico[]>([])

  async function recalcular() {
    if (!id) return
    setRecalculando(true)
    setErroCalc(null)
    try {
      const r = await apiPost<{ diagnosticos: Diagnostico[] }>(
        `alocacao?cenario=${id}&acao=calcular`,
      )
      setDiagnosticos(r.diagnosticos)
      recarregar()
    } catch (e) {
      setErroCalc((e as Error).message)
    } finally {
      setRecalculando(false)
    }
  }

  const resumo = useMemo(() => {
    const dias = dados?.dias ?? []
    const todas = dias.flatMap((d) => d.horas)
    const ocupadas = todas.filter((h) => h > 0)
    return {
      dias: dias.length,
      pico: todas.length ? Math.max(...todas) : 0,
      media: ocupadas.length ? ocupadas.reduce((s, h) => s + h, 0) / ocupadas.length : 0,
      estouros: dias.reduce((s, d) => s + d.acimaDaJornada, 0),
    }
  }, [dados])

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dimensionamento de operadores</h1>
          <p className="page-subtitle">
            Equivale à aba Dimensionamento de Operadores. Horas alocadas por operador em cada
            dia, a partir da lista de demanda.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SeletorCenario cenarios={cenarios} id={id} onSelecionar={setId} />
          <button className="btn-primary" onClick={recalcular} disabled={recalculando || !id}>
            <RefreshCw size={15} className={recalculando ? 'animate-spin' : ''} />
            {recalculando ? 'Calculando…' : 'Recalcular'}
          </button>
        </div>
      </div>

      <Erro mensagem={erro ?? erroCalc} />

      {carregando && !dados ? (
        <Carregando />
      ) : !dados || dados.dias.length === 0 ? (
        <div className="empty-state">
          Nenhuma alocação — gere a demanda no calendário e clique em Recalcular.
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi rotulo="Dias com carga" valor={fmtInt(resumo.dias)} />
            <Kpi
              rotulo="Pico por operador"
              valor={`${fmtDecimal(resumo.pico)} h`}
              tom={resumo.pico > dados.jornadaCheia ? 'alerta' : 'normal'}
            />
            <Kpi rotulo="Média ocupada" valor={`${fmtDecimal(resumo.media)} h`} />
            <Kpi
              rotulo="Estouros de jornada"
              valor={fmtInt(resumo.estouros)}
              tom={resumo.estouros > 0 ? 'alerta' : 'normal'}
              detalhe={`acima de ${fmtDecimal(dados.jornadaLiquida)} h`}
            />
          </div>

          <section className="panel overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
              <h2 className="font-heading font-semibold text-sm">
                Ocupação por dia e operador (horas)
              </h2>
              <Legenda jornadaLiquida={dados.jornadaLiquida} jornadaCheia={dados.jornadaCheia} />
            </header>

            <div className="overflow-auto max-h-[65vh]">
              <table className="border-separate border-spacing-0.5 text-sm">
                <thead>
                  <tr>
                    <th className="th sticky left-0 z-20 bg-slate-50 rounded">Dia</th>
                    {Array.from({ length: dados.qtdOperadores }, (_, i) => (
                      <th key={i} className="th text-center rounded min-w-14">
                        Op {i + 1}
                      </th>
                    ))}
                    <th className="th text-right rounded">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.dias.map((dia) => (
                    <tr key={dia.data}>
                      <td className="td sticky left-0 z-10 bg-white whitespace-nowrap">
                        {fmtData(dia.data)}{' '}
                        <span className="text-slate-400 text-xs">{fmtDiaSemana(dia.data)}</span>
                      </td>
                      {dia.horas.map((horas, i) => {
                        const s = estiloDaCelula(horas, dados.jornadaLiquida, dados.jornadaCheia)
                        return (
                          <td
                            key={i}
                            className={`${s.classe} text-center tabular-nums px-2 py-1.5 rounded`}
                            title={
                              `Operador ${i + 1} · ${fmtData(dia.data)}\n` +
                              `${fmtDecimal(horas)} h de ${fmtDecimal(dados.jornadaLiquida)} h` +
                              (s.estado === 'critico'
                                ? '\nAcima da jornada cheia'
                                : s.estado === 'atencao'
                                  ? '\nAcima da jornada líquida'
                                  : '')
                            }
                          >
                            <span className="inline-flex items-center gap-1">
                              {s.estado === 'critico' && <OctagonAlert size={11} />}
                              {s.estado === 'atencao' && <AlertTriangle size={11} />}
                              {horas > 0 ? fmtDecimal(horas) : '·'}
                            </span>
                          </td>
                        )
                      })}
                      <td className="td-num font-medium">{fmtDecimal(dia.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {diagnosticos.length > 0 && (
            <PainelDiagnostico
              diagnosticos={diagnosticos}
              correcoes={cenarios.find((c) => c.id === id)?.correcoes ?? {}}
              onAlternar={() => {
                /* as correções da alocação são as do cenário: aqui o painel é somente leitura */
              }}
            />
          )}
        </div>
      )}
    </>
  )
}

function Legenda({
  jornadaLiquida,
  jornadaCheia,
}: {
  jornadaLiquida: number
  jornadaCheia: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
      <span className="label-overline">Ocupação</span>
      <div className="flex items-center gap-1">
        <span className="h-3.5 w-5 rounded heat-0 border border-slate-200" />
        <span>livre</span>
      </div>
      <div className="flex items-center gap-0.5">
        <span className="h-3.5 w-5 rounded heat-1" />
        <span className="h-3.5 w-5 rounded heat-2" />
        <span className="h-3.5 w-5 rounded heat-3" />
        <span className="h-3.5 w-5 rounded heat-4" />
        <span className="ml-1">até {fmtDecimal(jornadaLiquida)} h</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="h-3.5 w-5 rounded heat-atencao inline-flex items-center justify-center">
          <AlertTriangle size={9} />
        </span>
        <span>acima da jornada</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="h-3.5 w-5 rounded heat-critico inline-flex items-center justify-center">
          <OctagonAlert size={9} />
        </span>
        <span>acima de {fmtDecimal(jornadaCheia)} h</span>
      </div>
    </div>
  )
}
