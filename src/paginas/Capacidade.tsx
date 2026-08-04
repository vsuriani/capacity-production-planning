import { useMemo, useState } from 'react'
import { apiPatch } from '../lib/api'
import { useApi, useCenarioSelecionado, useCorrecoes } from '../lib/hooks'
import { fmtDecimal, fmtInt } from '../lib/formato'
import type { DetalheCenario } from '../lib/tipos'
import { PainelDiagnostico } from '../components/Diagnostico'
import { Carregando, CelulaNumero, Erro, Kpi, SeletorCenario } from '../components/comuns'

const ROTULO_PAPEL = {
  aditivo: 'soma',
  retrabalho: 'retrabalho',
  ftr: 'FTR',
} as const

/**
 * Cenário de capacidade (aba 🚧 Dimensionamento Global).
 *
 * Aqui a "Meta" de cada dispositivo não é digitada: ela é composta a partir dos
 * componentes de tempo —  parcial = Σ(aditivos) + retrabalho × (1 − FTR) — e a métrica
 * real é a parcial dividida pelo coeficiente de eficiência.
 */
export function Capacidade() {
  const { cenarios, id, setId } = useCenarioSelecionado('capacidade')
  const { dados, erro, carregando, recarregar } = useApi<DetalheCenario>(
    id ? `cenarios?id=${id}` : null,
  )
  const { alternar, salvando, erro: erroCorrecao } = useCorrecoes(
    id,
    dados?.cenario.correcoes ?? {},
    recarregar,
  )
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)

  const demandaDe = useMemo(
    () =>
      new Map(
        (dados?.demandas ?? []).map((d) => [`${d.dispositivo_id}|${d.periodo}`, Number(d.quantidade)]),
      ),
    [dados],
  )
  const resultadoDe = useMemo(
    () => new Map((dados?.resultados ?? []).map((r) => [r.periodo, r])),
    [dados],
  )
  const componentesDe = useMemo(() => {
    const mapa = new Map<number, DetalheCenario['componentes']>()
    for (const c of dados?.componentes ?? []) {
      if (!mapa.has(c.dispositivo_id)) mapa.set(c.dispositivo_id, [])
      mapa.get(c.dispositivo_id)!.push(c)
    }
    return mapa
  }, [dados])

  async function salvar(corpo: Record<string, unknown>) {
    if (!id) return
    setErroSalvar(null)
    try {
      await apiPatch('planejamento', { cenarioId: id, ...corpo })
      recarregar()
    } catch (e) {
      setErroSalvar((e as Error).message)
    }
  }

  const pico = useMemo(() => {
    const validos = (dados?.resultados ?? []).filter((r) => r.operadores !== null)
    return validos.length ? Math.max(...validos.map((r) => r.operadores!)) : 0
  }, [dados])

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cenário de capacidade</h1>
          <p className="page-subtitle">
            Equivale à aba 🚧 Dimensionamento Global. A métrica de cada dispositivo é composta
            dos componentes de tempo, e o headcount inclui a folga de excedente.
          </p>
        </div>
        <SeletorCenario cenarios={cenarios} id={id} onSelecionar={setId} />
      </div>

      <Erro mensagem={erro ?? erroCorrecao ?? erroSalvar} />

      {carregando && !dados ? (
        <Carregando />
      ) : !dados ? (
        <div className="empty-state">
          Nenhum cenário de capacidade — importe a planilha primeiro.
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi rotulo="Pico de operadores" valor={fmtInt(pico)} detalhe="com excedente" />
            <Kpi
              rotulo="Coef. de eficiência"
              valor={fmtDecimal(dados.parametros.coefEficiencia)}
              detalhe="divide a métrica parcial"
            />
            <Kpi
              rotulo="Coef. de excedente"
              valor={`${fmtInt(dados.parametros.coefExcedente * 100)}%`}
              detalhe="folga de headcount"
            />
            <Kpi
              rotulo="Jornada líquida"
              valor={`${fmtDecimal(dados.parametros.jornadaHoras - dados.parametros.pausaHoras)} h`}
              detalhe={`${dados.parametros.jornadaHoras} h − ${dados.parametros.pausaHoras} h`}
            />
          </div>

          <section className="panel overflow-hidden">
            <header className="px-4 py-3 border-b border-slate-200">
              <h2 className="font-heading font-semibold text-sm">Composição da métrica</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                parcial = soma dos aditivos + retrabalho × (1 − FTR) · real = parcial ÷ coef. de
                eficiência
              </p>
            </header>

            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="th">Dispositivo / componente</th>
                    <th className="th">Papel</th>
                    <th className="th text-right">Valor</th>
                    <th className="th text-right">Parcial</th>
                    <th className="th text-right">Real (min/pç)</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.metricas.map((m) => (
                    <>
                      <tr key={`d-${m.dispositivoId}`} className="bg-slate-50/80">
                        <td className="td font-semibold">{m.dispositivo}</td>
                        <td className="td" />
                        <td className="td" />
                        <td className="td-num font-medium">{fmtDecimal(m.parcial)}</td>
                        <td className="td-num font-semibold text-primary-700">
                          {fmtDecimal(m.real)}
                        </td>
                      </tr>
                      {(componentesDe.get(m.dispositivoId) ?? []).map((c) => (
                        <tr key={`c-${m.dispositivoId}-${c.ordem}`} className="hover:bg-slate-50/60">
                          <td className="td pl-8 text-slate-600">{c.rotulo}</td>
                          <td className="td">
                            <span className={c.papel === 'ftr' ? 'chip-warn' : 'chip'}>
                              {ROTULO_PAPEL[c.papel]}
                            </span>
                          </td>
                          <td className="td-num p-0">
                            <CelulaNumero
                              valor={Number(c.valor)}
                              onConfirmar={(valor) =>
                                salvar({ componentes: [{ id: c.id, valor }] })
                              }
                            />
                          </td>
                          <td className="td" />
                          <td className="td" />
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel overflow-hidden">
            <header className="px-4 py-3 border-b border-slate-200">
              <h2 className="font-heading font-semibold text-sm">Demanda mensal e headcount</h2>
            </header>

            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="th sticky left-0 z-20 bg-slate-50">Dispositivo</th>
                    {dados.periodos.map((p) => (
                      <th key={p.periodo} className="th text-right">
                        {p.periodo}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dados.dispositivos.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/60">
                      <td className="td sticky left-0 z-10 bg-white font-medium">{d.nome}</td>
                      {dados.periodos.map((p) => (
                        <td key={p.periodo} className="td-num p-0">
                          <CelulaNumero
                            valor={demandaDe.get(`${d.id}|${p.periodo}`) ?? 0}
                            decimais={0}
                            onConfirmar={(quantidade) =>
                              salvar({
                                demandas: [
                                  { dispositivoId: d.id, periodo: p.periodo, quantidade },
                                ],
                              })
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50">
                  <tr>
                    <td className="td sticky left-0 z-10 bg-slate-50 font-medium">Dias úteis</td>
                    {dados.periodos.map((p) => (
                      <td key={p.periodo} className="td-num p-0">
                        <CelulaNumero
                          valor={Number(p.dias_uteis)}
                          decimais={0}
                          onConfirmar={(diasUteis) =>
                            salvar({
                              periodos: [{ periodo: p.periodo, ordem: p.ordem, diasUteis }],
                            })
                          }
                        />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="td sticky left-0 z-10 bg-slate-50 text-slate-500">
                      Calculado
                    </td>
                    {dados.periodos.map((p) => (
                      <td key={p.periodo} className="td-num text-slate-500">
                        {fmtDecimal(resultadoDe.get(p.periodo)?.operadoresFracionario ?? null)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="td sticky left-0 z-10 bg-slate-50 font-semibold">
                      Operadores
                    </td>
                    {dados.periodos.map((p) => (
                      <td key={p.periodo} className="td-num font-semibold text-primary-700">
                        {fmtInt(resultadoDe.get(p.periodo)?.operadores ?? null)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <PainelDiagnostico
            diagnosticos={dados.diagnosticos}
            correcoes={dados.cenario.correcoes}
            onAlternar={alternar}
            salvando={salvando}
          />
        </div>
      )}
    </>
  )
}
