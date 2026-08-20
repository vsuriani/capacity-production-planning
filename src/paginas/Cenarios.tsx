import { useMemo, useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { apiDelete, apiGet, apiPost } from '../lib/api'
import { useApi } from '../lib/hooks'
import { noMesEmUso } from '../lib/escopo'
import { MESES, fmtData, fmtDecimal, fmtInt } from '../lib/formato'
import type { Cenario, TipoCenario } from '../lib/tipos'
import { Carregando, Erro } from '../components/comuns'

type Comparacao = {
  comparacao: {
    cenario: { id: number; nome: string; tipo: string; correcoes: Record<string, boolean> }
    resultados: { periodo: string; operadores: number | null; operadoresFracionario: number | null }[]
    totalDiagnosticos: number
  }[]
}

/** Cenários: listar, duplicar, excluir e comparar headcount lado a lado. */
export function Cenarios() {
  const { dados, erro, carregando, recarregar } = useApi<{ cenarios: Cenario[] }>('cenarios')
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [selecionados, setSelecionados] = useState<number[]>([])
  const [comparacao, setComparacao] = useState<Comparacao | null>(null)

  const [criando, setCriando] = useState(false)
  const [novo, setNovo] = useState({
    tipo: 'semanal' as TipoCenario,
    mes: new Date().getMonth() + 1,
    ano: new Date().getFullYear(),
    nome: '',
  })

  async function criar() {
    await agir(async () => {
      await apiPost('cenarios', {
        tipo: novo.tipo,
        nome: novo.nome || undefined,
        mes: novo.mes,
        ano: novo.ano,
      })
      setCriando(false)
      setNovo({ ...novo, nome: '' })
    })
  }

  // Só o semanal do mês em uso. Os outros tipos e os demais meses importados continuam no
  // banco, fora da lista.
  const porTipo = useMemo(() => {
    const mapa = new Map<string, Cenario[]>()
    for (const c of dados?.cenarios ?? []) {
      if (c.tipo !== 'semanal' || !noMesEmUso(c)) continue
      if (!mapa.has(c.tipo)) mapa.set(c.tipo, [])
      mapa.get(c.tipo)!.push(c)
    }
    return mapa
  }, [dados])

  async function agir(fn: () => Promise<unknown>) {
    setErroAcao(null)
    try {
      await fn()
      recarregar()
    } catch (e) {
      setErroAcao((e as Error).message)
    }
  }

  async function comparar() {
    setErroAcao(null)
    try {
      setComparacao(await apiGet<Comparacao>(`cenarios?comparar=${selecionados.join(',')}`))
    } catch (e) {
      setErroAcao((e as Error).message)
    }
  }

  function alternarSelecao(id: number) {
    setSelecionados((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id].slice(-4),
    )
  }

  const periodosComparados = useMemo(() => {
    if (!comparacao?.comparacao.length) return []
    return comparacao.comparacao[0].resultados.map((r) => r.periodo)
  }, [comparacao])

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cenários</h1>
          <p className="page-subtitle">
            Cada cenário guarda a própria demanda e a própria política de correções — é assim
            que se compara "fiel à planilha" com "corrigido".
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setCriando((v) => !v)}>
            <Plus size={15} /> Novo cenário
          </button>
          <button
            className="btn-primary"
            onClick={comparar}
            disabled={selecionados.length < 2}
            title={selecionados.length < 2 ? 'Selecione ao menos dois cenários' : ''}
          >
            Comparar {selecionados.length > 0 && `(${selecionados.length})`}
          </button>
        </div>
      </div>

      <Erro mensagem={erro ?? erroAcao} />

      {criando && (
        <section className="panel px-4 py-4 mb-5">
          <h2 className="font-heading font-semibold text-sm mb-1">Novo cenário</h2>
          <p className="text-xs text-slate-500 mb-3">
            Nasce com os tempos por dispositivo do cenário mais recente do mesmo tipo, os dias
            úteis já contados do calendário e os termos da fórmula alinhados. Processos e
            sequências, Base de PROD e o mapa SKU → produto são cadastros globais — o cenário
            aponta para eles, não copia.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="label-overline">Tipo</span>
              <select
                className="input-field w-44"
                value={novo.tipo}
                onChange={(e) => setNovo({ ...novo, tipo: e.target.value as TipoCenario })}
              >
                <option value="semanal">Semanal</option>
                <option value="mensal">Mensal</option>
              </select>
            </label>

            <label className="block">
              <span className="label-overline">Mês</span>
              <select
                className="input-field w-40"
                value={novo.mes}
                onChange={(e) => setNovo({ ...novo, mes: Number(e.target.value) })}
              >
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label-overline">Ano</span>
              <input
                type="number"
                className="input-field w-28"
                value={novo.ano}
                onChange={(e) => setNovo({ ...novo, ano: Number(e.target.value) })}
              />
            </label>

            <label className="block flex-1 min-w-48">
              <span className="label-overline">Nome (opcional)</span>
              <input
                className="input-field"
                placeholder={`${MESES[novo.mes - 1]}/${novo.ano}`}
                value={novo.nome}
                onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
              />
            </label>

            <button className="btn-primary" onClick={criar}>
              Criar
            </button>
          </div>
        </section>
      )}

      {carregando && !dados ? (
        <Carregando />
      ) : (
        <div className="space-y-6">
          {[...porTipo.entries()].map(([tipo, lista]) => (
            <section key={tipo} className="panel overflow-hidden">
              <header className="px-4 py-3 border-b border-slate-200">
                <h2 className="font-heading font-semibold text-sm capitalize">{tipo}</h2>
              </header>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="th w-10" />
                    <th className="th">Nome</th>
                    <th className="th">Período</th>
                    <th className="th text-right">Períodos</th>
                    <th className="th text-right">Demandas</th>
                    <th className="th">Correções ligadas</th>
                    <th className="th">Criado</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((c) => {
                    const correcoes = Object.entries(c.correcoes ?? {})
                      .filter(([, v]) => v)
                      .map(([k]) => k)
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/60">
                        <td className="td">
                          <input
                            type="checkbox"
                            checked={selecionados.includes(c.id)}
                            onChange={() => alternarSelecao(c.id)}
                            className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-blue-600/25"
                          />
                        </td>
                        <td className="td font-medium">{c.nome}</td>
                        <td className="td text-slate-500">
                          {c.mes && c.ano ? `${String(c.mes).padStart(2, '0')}/${c.ano}` : '—'}
                        </td>
                        <td className="td-num">{fmtInt(c.periodos ?? 0)}</td>
                        <td className="td-num">{fmtInt(c.demandas ?? 0)}</td>
                        <td className="td">
                          {correcoes.length === 0 ? (
                            <span className="chip">fiel à planilha</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {correcoes.map((k) => (
                                <span key={k} className="chip-ok data-code">
                                  {k}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="td text-xs text-slate-500">
                          {fmtData(c.criado_em)}
                          <br />
                          {c.criado_por}
                        </td>
                        <td className="td text-right whitespace-nowrap">
                          <button
                            className="text-slate-400 hover:text-primary-600 mr-2"
                            title="Duplicar"
                            onClick={() =>
                              agir(() =>
                                apiPost(`cenarios?duplicarDe=${c.id}`, {
                                  nome: `${c.nome} (cópia)`,
                                }),
                              )
                            }
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            className="text-slate-400 hover:text-red-600"
                            title="Excluir"
                            onClick={() => {
                              if (confirm(`Excluir o cenário "${c.nome}"?`)) {
                                agir(() => apiDelete(`cenarios?id=${c.id}`))
                              }
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          ))}

          {comparacao && comparacao.comparacao.length >= 2 && (
            <section className="panel overflow-hidden">
              <header className="px-4 py-3 border-b border-slate-200">
                <h2 className="font-heading font-semibold text-sm">
                  Comparação de headcount por período
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  A diferença é o efeito das correções ligadas em cada cenário.
                </p>
              </header>
              <div className="overflow-auto max-h-[60vh]">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="th sticky left-0 z-20 bg-slate-50">Período</th>
                      {comparacao.comparacao.map((c) => (
                        <th key={c.cenario.id} className="th text-right">
                          {c.cenario.nome}
                          <div className="font-normal normal-case tracking-normal text-slate-400">
                            {Object.values(c.cenario.correcoes ?? {}).filter(Boolean).length} correção(ões)
                          </div>
                        </th>
                      ))}
                      <th className="th text-right">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodosComparados.map((periodo, i) => {
                      const valores = comparacao.comparacao.map(
                        (c) => c.resultados[i]?.operadores ?? null,
                      )
                      const validos = valores.filter((v): v is number => v !== null)
                      const delta = validos.length >= 2 ? Math.max(...validos) - Math.min(...validos) : 0
                      return (
                        <tr key={periodo} className="hover:bg-slate-50/60">
                          <td className="td sticky left-0 z-10 bg-white font-medium">{periodo}</td>
                          {comparacao.comparacao.map((c, j) => (
                            <td key={c.cenario.id} className="td-num">
                              {valores[j] === null ? '—' : fmtInt(valores[j])}
                              <span className="text-slate-400 text-xs ml-1">
                                {fmtDecimal(c.resultados[i]?.operadoresFracionario ?? null)}
                              </span>
                            </td>
                          ))}
                          <td
                            className={`td-num font-semibold ${delta > 0 ? 'text-amber-700' : 'text-slate-400'}`}
                          >
                            {delta > 0 ? `+${fmtInt(delta)}` : '0'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </>
  )
}
