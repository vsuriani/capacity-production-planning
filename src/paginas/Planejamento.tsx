import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, GitCompare } from 'lucide-react'
import { apiPatch } from '../lib/api'
import { useApi, useCenarioSelecionado } from '../lib/hooks'
import { OPERADORES_DA_LINHA } from '../lib/escopo'
import { fmtDecimal, fmtInt } from '../lib/formato'
import type { DetalheCenario } from '../lib/tipos'
import { Carregando, CelulaNumero, Erro, Kpi, SeletorCenario } from '../components/comuns'

/**
 * Abre o diálogo de impressão do navegador, que é de onde sai o PDF do relatório.
 *
 * Força o tema claro antes e devolve o anterior no `afterprint` — papel é branco, e a paleta
 * escura sairia como uma mancha de tinta. O `afterprint` em vez de restaurar logo depois do
 * `print()` porque nem todo navegador bloqueia a thread enquanto o diálogo está aberto.
 *
 * O que sai no papel é decidido pelo bloco `@media print` de `src/index.css`.
 */
function imprimir() {
  const html = document.documentElement
  const anterior = html.dataset.theme
  const restaurar = () => {
    if (anterior) html.dataset.theme = anterior
    window.removeEventListener('afterprint', restaurar)
  }
  window.addEventListener('afterprint', restaurar)
  html.dataset.theme = 'light'
  window.print()
}

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

  const total = useMemo(() => {
    const rs = dados?.resultados ?? []
    const validos = rs.filter((r) => r.operadores !== null)
    const horas = rs.reduce((s, r) => s + r.horasTotais, 0)
    return {
      horas,
      pico: validos.length ? Math.max(...validos.map((r) => r.operadores!)) : 0,
      periodosComErro: rs.filter((r) => r.erro).length,
      // Quanto cada posto da linha absorve no mês se a carga for repartida pela equipe cheia.
      // Divide pela capacidade instalada (constante), não pelo pico, que é o que a demanda pediu.
      horaHomem: horas / OPERADORES_DA_LINHA,
    }
  }, [dados])

  const emitidoEm = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cenário semanal</h1>
          <p className="page-subtitle nao-imprime">
            Meta e demanda por semana do mês. A fórmula é a da planilha, mas o headcount é o
            ROUNDUP do cálculo — o catálogo das divergências está em Importação.
          </p>
          {/* No papel o título não basta: o relatório precisa dizer de qual cenário é e de quando. */}
          <p className="so-impressao page-subtitle">
            {dados?.cenario.nome ?? '—'} · emitido em {emitidoEm}
          </p>
        </div>
        <div className="flex items-center gap-3 nao-imprime">
          <SeletorCenario cenarios={cenarios} id={id} onSelecionar={setId} />
          <button className="btn-ghost" onClick={imprimir} disabled={!dados}>
            <FileText size={15} /> PDF
          </button>
          <Link to="/cenarios" className="btn-ghost">
            <GitCompare size={15} /> Cenários
          </Link>
        </div>
      </div>

      <Erro mensagem={erro ?? erroSalvar} />

      {carregando && !dados ? (
        <Carregando />
      ) : !dados ? (
        <div className="empty-state">Nenhum cenário semanal — importe a planilha primeiro.</div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi rotulo="Pico de operadores" valor={fmtInt(total.pico)} detalhe="maior período" />
            <Kpi rotulo="Carga total" valor={`${fmtDecimal(total.horas)} h`} detalhe="todos os períodos" />
            {/*
              O card "Períodos sem dias úteis" saiu, mas o aviso não: período sem dia útil é
              #DIV/0! e some da conta, então ele desce para o detalhe daqui (e cada período
              afetado continua marcado no rodapé da grade).
            */}
            <Kpi
              rotulo="Períodos"
              valor={fmtInt(dados.periodos.length)}
              tom={total.periodosComErro > 0 ? 'alerta' : 'normal'}
              detalhe={
                total.periodosComErro > 0
                  ? `${total.periodosComErro} sem dias úteis (#DIV/0!)`
                  : undefined
              }
            />
            <Kpi
              rotulo="Hora/Homem mês"
              valor={`${fmtDecimal(total.horaHomem)} h`}
              detalhe={`carga ÷ ${OPERADORES_DA_LINHA} operadores`}
            />
          </div>

          <section className="panel overflow-hidden">
            <header className="px-4 py-3 border-b border-slate-200">
              <h2 className="font-heading font-semibold text-sm">Demanda e headcount</h2>
            </header>

            <div className="overflow-auto max-h-[70vh] impressao-solta">
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
            <footer className="px-4 py-2 border-t border-slate-200 text-xs text-slate-500 nao-imprime">
              A grade lista todo dispositivo ativo, mesmo o que ainda não tem meta, demanda ou
              roteiro cadastrado — ele aparece zerado e passa a contar assim que receber um
              número. Dispositivo fora de uso é escondido no cadastro e sai também da soma.
            </footer>
          </section>
        </div>
      )}
    </>
  )
}
