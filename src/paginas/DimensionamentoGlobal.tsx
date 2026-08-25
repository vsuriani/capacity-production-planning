import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { apiPatch, apiPost } from '../lib/api'
import { useApi } from '../lib/hooks'
import { fmtDecimal, fmtInt } from '../lib/formato'
import type { Grade, MetricaGlobal, ModelGlobal, QuantidadeGlobal } from '../lib/tipos'
import { Carregando, CelulaNumero, Erro, Kpi } from '../components/comuns'

/**
 * Dimensionamento Global: quantos operadores a linha precisa por mês, ao longo de todo o
 * horizonte do forecast.
 *
 * **É uma simulação, não um cenário** — não tem seletor, não é escopada por `MES_EM_USO` e não
 * se duplica nem se compara. É uma visão só, que se mexe e se olha.
 *
 * A quantidade de cada célula nasce do forecast e pode ser ajustada por cima; o ajuste mora em
 * `global_ajuste`, separado do forecast, e é por isso que recarregar o forecast não apaga o que
 * foi digitado. Digitar de volta o número do forecast desfaz o ajuste.
 */
export function DimensionamentoGlobal() {
  const { dados, erro, carregando, recarregar } = useApi<Grade>('dimensionamento')
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const [abertos, setAbertos] = useState<Set<number>>(new Set())
  const [abertosGrade, setAbertosGrade] = useState<Set<number>>(new Set())

  /** Os PRODs de cada dispositivo, para abrir a linha da grade como na planilha. */
  const modelsDe = useMemo(() => {
    const mapa = new Map<number, ModelGlobal[]>()
    for (const m of dados?.models ?? []) {
      if (!mapa.has(m.dispositivoId)) mapa.set(m.dispositivoId, [])
      mapa.get(m.dispositivoId)!.push(m)
    }
    return mapa
  }, [dados])

  const quantidadeDe = useMemo(
    () =>
      new Map(
        (dados?.quantidades ?? []).map((q) => [`${q.dispositivoId}|${q.periodo}`, q] as const),
      ),
    [dados],
  )
  const resultadoDe = useMemo(
    () => new Map((dados?.resultados ?? []).map((r) => [r.periodo, r])),
    [dados],
  )

  const resumo = useMemo(() => {
    const validos = (dados?.resultados ?? []).filter((r) => r.operadores !== null)
    const pico = validos.reduce<(typeof validos)[number] | null>(
      (maior, r) => (maior === null || r.operadores! > maior.operadores! ? r : maior),
      null,
    )
    return {
      pico,
      semDiasUteis: (dados?.meses ?? []).filter((m) => m.diasUteis === null).length,
      ajustados: (dados?.quantidades ?? []).filter((q) => q.ajuste !== null).length,
    }
  }, [dados])

  async function salvar(corpo: Record<string, unknown>) {
    setErroSalvar(null)
    try {
      await apiPatch('dimensionamento', corpo)
      recarregar()
    } catch (e) {
      setErroSalvar((e as Error).message)
    }
  }

  /**
   * Conta os dias úteis dos meses ainda vazios, do calendário e dos feriados cadastrados.
   * Só os vazios: quem já foi digitado à mão é decisão, e não se sobrescreve sozinho.
   */
  async function preencherDiasUteis() {
    setErroSalvar(null)
    try {
      await apiPost('dimensionamento?acao=dias-uteis')
      recarregar()
    } catch (e) {
      setErroSalvar((e as Error).message)
    }
  }

  /** Digitar exatamente o número do forecast desfaz o ajuste, em vez de gravar um igual. */
  const gravarQuantidade = (celula: QuantidadeGlobal, valor: number) =>
    salvar({
      ajustes: [
        {
          dispositivoId: celula.dispositivoId,
          ano: celula.ano,
          mes: celula.mes,
          quantidade: valor === celula.forecast ? null : valor,
        },
      ],
    })

  const descartarAjustes = () =>
    salvar({
      ajustes: (dados?.quantidades ?? [])
        .filter((q) => q.ajuste !== null)
        .map((q) => ({
          dispositivoId: q.dispositivoId,
          ano: q.ano,
          mes: q.mes,
          quantidade: null,
        })),
    })

  const alternarEm =
    (definir: typeof setAbertos) =>
    (dispositivoId: number) =>
      definir((atual) => {
        const novo = new Set(atual)
        if (novo.has(dispositivoId)) novo.delete(dispositivoId)
        else novo.add(dispositivoId)
        return novo
      })

  const alternar = alternarEm(setAbertos)
  const alternarGrade = alternarEm(setAbertosGrade)

  const cabecalho = (
    <div className="page-header">
      <div>
        <h1 className="page-title">Dimensionamento Global</h1>
        <p className="page-subtitle">
          Headcount mês a mês no horizonte do forecast. A quantidade vem do forecast e pode ser
          ajustada na célula; digitar de volta o número original desfaz o ajuste.
        </p>
      </div>
    </div>
  )

  if (carregando && !dados) {
    return (
      <>
        {cabecalho}
        <Erro mensagem={erro ?? erroSalvar} />
        <Carregando />
      </>
    )
  }

  const semDados = !dados || dados.dispositivos.length === 0 || dados.meses.length === 0

  if (semDados) {
    return (
      <>
        {cabecalho}
        <Erro mensagem={erro ?? erroSalvar} />
        <div className="empty-state">
          <p className="font-medium">Sem forecast carregado.</p>
          <p className="mt-2">
            Os dados vêm dos três arquivos em <span className="data-code">docs/</span>. Para
            carregá-los:
          </p>
          <p className="data-code mt-3">node scripts/importar_dimensionamento.mjs</p>
        </div>
      </>
    )
  }

  const { meses, metricas, parametros } = dados

  // Cabeçalho em dois níveis: uma célula por ano, depois o mês.
  const anos: { ano: number; meses: number }[] = []
  for (const m of meses) {
    const ultimo = anos.at(-1)
    if (ultimo?.ano === m.ano) ultimo.meses++
    else anos.push({ ano: m.ano, meses: 1 })
  }

  return (
    <>
      {cabecalho}

      <Erro mensagem={erro ?? erroSalvar} />

      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi
            rotulo="Pico de operadores"
            valor={fmtInt(resumo.pico?.operadores ?? null)}
            detalhe={resumo.pico?.periodo ?? 'nenhum mês calculado'}
          />
          <Kpi rotulo="Meses no forecast" valor={fmtInt(meses.length)} />
          <Kpi
            rotulo="Meses sem dias úteis"
            valor={fmtInt(resumo.semDiasUteis)}
            tom={resumo.semDiasUteis > 0 ? 'alerta' : 'normal'}
            detalhe={resumo.semDiasUteis > 0 ? 'não entram na conta' : undefined}
          />
          <Kpi
            rotulo="Células ajustadas"
            valor={fmtInt(resumo.ajustados)}
            detalhe={resumo.ajustados > 0 ? 'sobrepõem o forecast' : 'tudo como veio do forecast'}
          />
        </div>

        <BlocoReferencia
          metricas={metricas}
          abertos={abertos}
          onAlternar={alternar}
          coefEficiencia={parametros.coefEficiencia}
          coefExcedente={parametros.coefExcedente}
          onGravarComponente={(componenteId, valor) =>
            salvar({ componentes: [{ id: componenteId, valor }] })
          }
        />

        <section className="panel overflow-hidden">
          <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3">
            <h2 className="font-heading font-semibold text-sm">Forecast e dimensionamento</h2>
            <div className="flex items-center gap-2">
              {resumo.semDiasUteis > 0 && (
                <button
                  className="btn-ghost"
                  onClick={preencherDiasUteis}
                  title="Conta os dias úteis do calendário, descontando os feriados cadastrados. Só preenche os meses vazios."
                >
                  <CalendarClock size={15} /> Preencher {resumo.semDiasUteis} dias úteis
                </button>
              )}
              {resumo.ajustados > 0 && (
                <button className="btn-ghost" onClick={descartarAjustes}>
                  <RotateCcw size={15} /> Voltar tudo ao forecast
                </button>
              )}
            </div>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="th sticky left-0 z-20 bg-slate-50" rowSpan={2}>
                    Dispositivo
                  </th>
                  {anos.map((a) => (
                    <th key={a.ano} className="th text-center" colSpan={a.meses}>
                      {a.ano}
                    </th>
                  ))}
                </tr>
                <tr>
                  {meses.map((m) => (
                    <th key={m.periodo} className="th text-right" title={m.periodo}>
                      {m.periodo.split('/')[0].slice(0, 3)}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {dados.dispositivos.map((d) => {
                  const models = modelsDe.get(d.id) ?? []
                  const aberto = abertosGrade.has(d.id)
                  return [
                    <tr key={d.id} className="hover:bg-slate-50/60">
                      <td className="td sticky left-0 z-10 bg-white font-medium p-0">
                        <button
                          className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left"
                          onClick={() => alternarGrade(d.id)}
                          aria-expanded={aberto}
                          title={`${models.length} PROD no forecast`}
                        >
                          {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {d.nome}
                        </button>
                      </td>
                      {meses.map((m) => {
                        const celula = quantidadeDe.get(`${d.id}|${m.periodo}`)
                        if (!celula) return <td key={m.periodo} className="td-num" />
                        const ajustada = celula.ajuste !== null
                        return (
                          <td
                            key={m.periodo}
                            className={`td-num p-0 ${ajustada ? 'bg-amber-50' : ''}`}
                            title={
                              ajustada
                                ? `Ajustado. Forecast: ${fmtInt(celula.forecast)} — digite esse valor para desfazer.`
                                : undefined
                            }
                          >
                            <CelulaNumero
                              valor={celula.efetiva}
                              decimais={0}
                              className={ajustada ? 'font-semibold text-amber-800' : ''}
                              onConfirmar={(valor) => gravarQuantidade(celula, valor)}
                            />
                          </td>
                        )
                      })}
                    </tr>,
                    // A abertura é o forecast puro, e não é editável: quem se ajusta é o
                    // dispositivo inteiro. Se houver ajuste no mês, os PRODs não somam a linha
                    // de cima — é justamente o que se quer enxergar.
                    ...(aberto
                      ? models.map((mod) => (
                          <tr key={`${d.id}-${mod.model}`} className="bg-slate-50/40">
                            <td className="td sticky left-0 z-10 bg-slate-50 pl-9">
                              <span className="data-code">{mod.model}</span>
                              {mod.produto && (
                                <span className="text-slate-400 text-xs ml-2">{mod.produto}</span>
                              )}
                            </td>
                            {mod.porMes.map((celula) => (
                              <td
                                key={celula.periodo}
                                // pr-2 alinha com a CelulaNumero da linha de cima, que fica
                                // num td `p-0` e traz o próprio px-2.
                                className={`td-num pr-2 ${
                                  celula.quantidade === 0 ? 'text-slate-300' : 'text-slate-500'
                                }`}
                              >
                                {fmtInt(celula.quantidade)}
                              </td>
                            ))}
                          </tr>
                        ))
                      : []),
                  ]
                })}
              </tbody>

              <tfoot className="bg-slate-50">
                <tr>
                  <td className="td sticky left-0 z-10 bg-slate-50 font-medium">
                    Dias Úteis no mês
                  </td>
                  {meses.map((m) => (
                    <td key={m.periodo} className="td-num p-0">
                      <CelulaNumero
                        valor={m.diasUteis}
                        decimais={0}
                        placeholder="—"
                        onConfirmar={(diasUteis) =>
                          salvar({ meses: [{ ano: m.ano, mes: m.mes, diasUteis }] })
                        }
                      />
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="td sticky left-0 z-10 bg-slate-50 text-slate-500">
                    Quantidade Calculado
                  </td>
                  {meses.map((m) => {
                    const r = resultadoDe.get(m.periodo)
                    return (
                      <td key={m.periodo} className="td-num text-slate-500">
                        {r?.erro ? '#DIV/0!' : fmtDecimal(r?.operadoresFracionario ?? null)}
                      </td>
                    )
                  })}
                </tr>
                <tr>
                  <td className="td sticky left-0 z-10 bg-slate-50 font-semibold">
                    Quantidade Produção Real
                  </td>
                  {meses.map((m) => {
                    const r = resultadoDe.get(m.periodo)
                    return (
                      <td key={m.periodo} className="td-num font-semibold text-primary-700">
                        {r?.erro ? '—' : fmtInt(r?.operadores ?? null)}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {dados.modelsSemDispositivo.length > 0 && (
          <section className="panel px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">
                  {dados.modelsSemDispositivo.length} model(s) do forecast sem dispositivo
                </p>
                <p className="text-slate-500 mt-0.5">
                  Sem dispositivo não há tempo, então esse volume não entra em nenhuma conta
                  acima.
                </p>
                <ul className="mt-2 space-y-0.5">
                  {dados.modelsSemDispositivo.map((m) => (
                    <li key={m.model} className="data-code">
                      {m.model} · {m.produto} · {fmtInt(m.quantidade)} peças
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}
      </div>
    </>
  )
}

/**
 * Valores de referência: o tempo-padrão de cada dispositivo, com a composição escondida atrás
 * de um clique — é a mesma dobra da planilha.
 *
 *   Parcial = Σ(aditivos) + retrabalho × (1 − FTR)      Real = Parcial ÷ Coef. Eficiência
 */
function BlocoReferencia({
  metricas,
  abertos,
  onAlternar,
  coefEficiencia,
  coefExcedente,
  onGravarComponente,
}: {
  metricas: MetricaGlobal[]
  abertos: Set<number>
  onAlternar: (dispositivoId: number) => void
  coefEficiencia: number
  coefExcedente: number
  onGravarComponente: (componenteId: number, valor: number) => void
}) {
  const pct = (v: number) => `${fmtDecimal(v * 100)}%`

  return (
    <section className="panel overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-heading font-semibold text-sm">Valores de referência</h2>
        <div className="flex items-center gap-2">
          <span className="chip">Coef. Eficiência {pct(coefEficiencia)}</span>
          <span
            className="chip"
            title="Não entra no headcount: a linha de produção é ROUNDUP puro."
          >
            Coef. Excedente {pct(coefExcedente)} · não aplicado
          </span>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="th">Dispositivo</th>
              <th className="th w-16" />
              <th className="th text-right">Métrica Prod. Parcial</th>
              <th className="th text-right">Métrica Prod. Real</th>
            </tr>
          </thead>
          <tbody>
            {metricas.map((m) => {
              const aberto = abertos.has(m.dispositivoId)
              return [
                <tr key={m.dispositivoId} className="hover:bg-slate-50/60">
                  <td className="td font-medium p-0">
                    <button
                      className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left"
                      onClick={() => onAlternar(m.dispositivoId)}
                      aria-expanded={aberto}
                    >
                      {aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      {m.dispositivo}
                    </button>
                  </td>
                  <td className="td" />
                  <td className="td-num font-semibold">{fmtDecimal(m.parcial)}</td>
                  <td className="td-num font-semibold text-primary-700">{fmtDecimal(m.real)}</td>
                </tr>,
                ...(aberto
                  ? m.componentes.map((c) => {
                      // O FTR é fração no banco e porcentagem na planilha — a tela fala
                      // porcentagem, como o usuário lê.
                      const ehFtr = c.papel === 'ftr'
                      return (
                        <tr key={`${m.dispositivoId}-${c.id}`} className="bg-slate-50/40">
                          <td className="td pl-9 text-slate-500">- {c.rotulo}</td>
                          <td className="td text-slate-400 text-xs">{ehFtr ? '%' : 'min'}</td>
                          <td className="td-num p-0">
                            <CelulaNumero
                              valor={ehFtr ? c.valor * 100 : c.valor}
                              onConfirmar={(valor) =>
                                onGravarComponente(c.id, ehFtr ? valor / 100 : valor)
                              }
                            />
                          </td>
                          <td className="td-num text-slate-400">
                            {ehFtr || coefEficiencia <= 0
                              ? ''
                              : fmtDecimal(c.valor / coefEficiencia)}
                          </td>
                        </tr>
                      )
                    })
                  : []),
              ]
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
