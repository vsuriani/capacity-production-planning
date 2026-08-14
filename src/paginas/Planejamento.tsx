import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GitCompare, Wand2 } from 'lucide-react'
import { apiPatch, apiPost } from '../lib/api'
import { useApi, useCenarioSelecionado, useCorrecoes } from '../lib/hooks'
import { fmtDecimal, fmtInt } from '../lib/formato'
import type { DetalheCenario } from '../lib/tipos'
import { PainelDiagnostico } from '../components/Diagnostico'
import { Carregando, CelulaNumero, Erro, Kpi, SeletorCenario } from '../components/comuns'

/**
 * Grade de planejamento semanal: uma linha por dispositivo (Meta + demanda por semana) e,
 * no pé, a carga em horas e o headcount calculado.
 *
 * Equivale à aba Planejamento Semanal, escopada ao mês do cenário — as Semana 1–5 são as
 * mesmas que o Calendário monta.
 */
export function Planejamento() {
  const { cenarios, id, setId } = useCenarioSelecionado('semanal')
  const { dados, erro, carregando, recarregar } = useApi<DetalheCenario>(
    id ? `cenarios?id=${id}` : null,
  )
  const { alternar, salvando, erro: erroCorrecao } = useCorrecoes(
    id,
    dados?.cenario.correcoes ?? {},
    recarregar,
  )
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)

  const metaDe = useMemo(
    () => new Map((dados?.metas ?? []).map((m) => [m.dispositivo_id, Number(m.meta_min_peca)])),
    [dados],
  )
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

  async function acao(nome: 'alinhar-termos' | 'incluir-faltantes') {
    if (!id) return
    setErroSalvar(null)
    try {
      await apiPost(`planejamento?acao=${nome}`, { cenarioId: id })
      recarregar()
    } catch (e) {
      setErroSalvar((e as Error).message)
    }
  }

  const total = useMemo(() => {
    const rs = dados?.resultados ?? []
    const validos = rs.filter((r) => r.operadores !== null)
    return {
      horas: rs.reduce((s, r) => s + r.horasTotais, 0),
      pico: validos.length ? Math.max(...validos.map((r) => r.operadores!)) : 0,
      periodosComErro: rs.filter((r) => r.erro).length,
    }
  }, [dados])

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cenário semanal</h1>
          <p className="page-subtitle">
            Equivale à aba Planejamento Semanal. O cálculo é fiel à planilha; as divergências
            conhecidas estão no diagnóstico abaixo.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SeletorCenario cenarios={cenarios} id={id} onSelecionar={setId} />
          <Link to="/cenarios" className="btn-ghost">
            <GitCompare size={15} /> Cenários
          </Link>
        </div>
      </div>

      <Erro mensagem={erro ?? erroCorrecao ?? erroSalvar} />

      {carregando && !dados ? (
        <Carregando />
      ) : !dados ? (
        <div className="empty-state">Nenhum cenário semanal — importe a planilha primeiro.</div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi rotulo="Pico de operadores" valor={fmtInt(total.pico)} detalhe="maior período" />
            <Kpi rotulo="Carga total" valor={`${fmtDecimal(total.horas)} h`} detalhe="todos os períodos" />
            <Kpi rotulo="Períodos" valor={fmtInt(dados.periodos.length)} />
            <Kpi
              rotulo="Períodos sem dias úteis"
              valor={fmtInt(total.periodosComErro)}
              tom={total.periodosComErro > 0 ? 'alerta' : 'normal'}
              detalhe={total.periodosComErro > 0 ? 'aparecem como #DIV/0! na planilha' : undefined}
            />
          </div>

          <section className="panel overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
              <h2 className="font-heading font-semibold text-sm">Demanda e headcount</h2>
              <div className="flex gap-2">
                <button className="btn-ghost" onClick={() => acao('alinhar-termos')}>
                  <Wand2 size={15} /> Alinhar termos da fórmula
                </button>
                <button className="btn-ghost" onClick={() => acao('incluir-faltantes')}>
                  <Wand2 size={15} /> Incluir dispositivos faltantes
                </button>
              </div>
            </header>

            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="th sticky left-0 z-20 bg-slate-50">Dispositivo</th>
                    <th className="th text-right">Meta (min/pç)</th>
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
                      <td className="td-num p-0">
                        <CelulaNumero
                          valor={metaDe.get(d.id) ?? 0}
                          onConfirmar={(valor) =>
                            salvar({ metas: [{ dispositivoId: d.id, valor }] })
                          }
                        />
                      </td>
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
                    <td className="td" />
                    {dados.periodos.map((p) => (
                      <td key={p.periodo} className="td-num p-0">
                        <CelulaNumero
                          valor={Number(p.dias_uteis)}
                          decimais={0}
                          onConfirmar={(diasUteis) =>
                            salvar({
                              periodos: [
                                { periodo: p.periodo, ordem: p.ordem, diasUteis },
                              ],
                            })
                          }
                        />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="td sticky left-0 z-10 bg-slate-50 text-slate-500">
                      Carga (horas)
                    </td>
                    <td className="td" />
                    {dados.periodos.map((p) => (
                      <td key={p.periodo} className="td-num text-slate-500">
                        {fmtDecimal(resultadoDe.get(p.periodo)?.horasTotais ?? 0)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="td sticky left-0 z-10 bg-slate-50 text-slate-500">
                      Operadores (fracionário)
                    </td>
                    <td className="td" />
                    {dados.periodos.map((p) => {
                      const r = resultadoDe.get(p.periodo)
                      return (
                        <td key={p.periodo} className="td-num text-slate-500">
                          {r?.erro ? '#DIV/0!' : fmtDecimal(r?.operadoresFracionario ?? null)}
                        </td>
                      )
                    })}
                  </tr>
                  <tr>
                    <td className="td sticky left-0 z-10 bg-slate-50 font-semibold">
                      Operadores
                    </td>
                    <td className="td" />
                    {dados.periodos.map((p) => {
                      const r = resultadoDe.get(p.periodo)
                      return (
                        <td key={p.periodo} className="td-num font-semibold text-primary-700">
                          {r?.erro ? '—' : fmtInt(r?.operadores ?? null)}
                        </td>
                      )
                    })}
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
