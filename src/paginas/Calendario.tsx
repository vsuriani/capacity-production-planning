import { useMemo, useState } from 'react'
import { CalendarPlus, Play, Save } from 'lucide-react'
import { apiPatch, apiPost } from '../lib/api'
import { useApi, useCenarioSelecionado } from '../lib/hooks'
import { MESES, fmtData, fmtDiaSemana, fmtInt } from '../lib/formato'
import type { Bloco, Diagnostico, SlotProjecao } from '../lib/tipos'
import { PainelDiagnostico } from '../components/Diagnostico'
import { Carregando, Erro, Kpi, SeletorCenario } from '../components/comuns'

type Dados = {
  cenario: { id: number; nome: string; mes: number | null; ano: number | null }
  projecao: { id: number; mes: number; ano: number; qtd_operadores: number } | null
  semanas: { semana: number; dias: string[] }[]
  slots: SlotProjecao[]
}

const BLOCOS: { chave: Bloco; rotulo: string; linhas: number }[] = [
  { chave: 'producao', rotulo: 'Produção', linhas: 10 },
  { chave: 'industrializacao', rotulo: 'Industrialização', linhas: 10 },
]

type Rascunho = Map<string, { skuCodigo: string; quantidade: number }>

const chaveSlot = (data: string, bloco: Bloco, ordem: number) => `${data}|${bloco}|${ordem}`

/**
 * Calendário de produção (aba Projeção das linhas).
 *
 * A grade é 5 semanas × 6 dias (seg–sáb) começando na primeira segunda-feira do mês,
 * com dois blocos por dia. Na planilha isso vive em 53 colunas com aritmética de índice;
 * aqui as datas são calculadas e cada slot é uma linha do banco.
 */
export function Calendario() {
  const { cenarios, id, setId } = useCenarioSelecionado('mensal')
  const { dados, erro, carregando, recarregar } = useApi<Dados>(
    id ? `projecao?cenario=${id}` : null,
  )

  const [rascunho, setRascunho] = useState<Rascunho>(new Map())
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)
  const [criando, setCriando] = useState(false)

  async function criarCalendario() {
    if (!id || !dados?.cenario) return
    const { mes, ano } = dados.cenario
    if (!mes || !ano) {
      setErroAcao('Este cenário não tem mês definido — só cenários mensais têm calendário.')
      return
    }
    setCriando(true)
    setErroAcao(null)
    try {
      await apiPatch(`projecao?cenario=${id}`, { mes, ano, qtdOperadores: 8 })
      recarregar()
    } catch (e) {
      setErroAcao((e as Error).message)
    } finally {
      setCriando(false)
    }
  }
  const [resultado, setResultado] = useState<{
    geradas: number
    diagnosticos: Diagnostico[]
  } | null>(null)

  const slotDe = useMemo(() => {
    const mapa: Rascunho = new Map()
    for (const s of dados?.slots ?? []) {
      mapa.set(chaveSlot(s.data, s.bloco, s.ordem), {
        skuCodigo: s.sku_codigo,
        quantidade: Number(s.quantidade),
      })
    }
    for (const [k, v] of rascunho) mapa.set(k, v)
    return mapa
  }, [dados, rascunho])

  function alterar(data: string, bloco: Bloco, ordem: number, campo: 'skuCodigo' | 'quantidade', valor: string) {
    const k = chaveSlot(data, bloco, ordem)
    const atual = slotDe.get(k) ?? { skuCodigo: '', quantidade: 0 }
    const novo =
      campo === 'skuCodigo'
        ? { ...atual, skuCodigo: valor.toUpperCase() }
        : { ...atual, quantidade: Number(valor.replace(',', '.')) || 0 }
    setRascunho(new Map(rascunho).set(k, novo))
  }

  async function salvar() {
    if (!id || !dados?.projecao) return
    setErroAcao(null)
    const slots = [...slotDe.entries()]
      .map(([k, v]) => {
        const [data, bloco, ordem] = k.split('|')
        return { data, bloco: bloco as Bloco, ordem: Number(ordem), ...v }
      })
      .filter((s) => s.skuCodigo.trim())
    try {
      await apiPatch(`projecao?cenario=${id}`, {
        mes: dados.projecao.mes,
        ano: dados.projecao.ano,
        qtdOperadores: dados.projecao.qtd_operadores,
        slots,
      })
      setRascunho(new Map())
      recarregar()
    } catch (e) {
      setErroAcao((e as Error).message)
    }
  }

  async function trocarPeriodo(campo: 'mes' | 'ano' | 'qtdOperadores', valor: number) {
    if (!id) return
    const p = dados?.projecao
    try {
      await apiPatch(`projecao?cenario=${id}`, {
        mes: campo === 'mes' ? valor : (p?.mes ?? 1),
        ano: campo === 'ano' ? valor : (p?.ano ?? new Date().getFullYear()),
        qtdOperadores: campo === 'qtdOperadores' ? valor : (p?.qtd_operadores ?? 8),
      })
      recarregar()
    } catch (e) {
      setErroAcao((e as Error).message)
    }
  }

  async function gerar() {
    if (!id) return
    setGerando(true)
    setErroAcao(null)
    try {
      setResultado(
        await apiPost<{ geradas: number; diagnosticos: Diagnostico[] }>(
          `projecao?cenario=${id}&acao=gerar`,
        ),
      )
    } catch (e) {
      setErroAcao((e as Error).message)
    } finally {
      setGerando(false)
    }
  }

  const preenchidos = [...slotDe.values()].filter((s) => s.skuCodigo.trim()).length

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Calendário de produção</h1>
          <p className="page-subtitle">
            Equivale à aba Projeção das linhas. 5 semanas × 6 dias a partir da primeira
            segunda-feira do mês.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SeletorCenario cenarios={cenarios} id={id} onSelecionar={setId} />
          <button className="btn-ghost" onClick={salvar} disabled={rascunho.size === 0}>
            <Save size={15} /> Salvar {rascunho.size > 0 && `(${rascunho.size})`}
          </button>
          <button className="btn-primary" onClick={gerar} disabled={gerando || !id}>
            <Play size={15} /> {gerando ? 'Gerando…' : 'Gerar demanda'}
          </button>
        </div>
      </div>

      <Erro mensagem={erro ?? erroAcao} />

      {carregando && !dados ? (
        <Carregando />
      ) : !dados?.projecao ? (
        <section className="panel p-10 text-center">
          <CalendarPlus size={22} className="mx-auto mb-3 text-slate-400" strokeWidth={1.5} />
          <p className="text-sm text-slate-600 mb-1">
            <strong>{dados?.cenario.nome}</strong> ainda não tem calendário montado.
          </p>
          <p className="text-xs text-slate-500 mb-4">
            A grade nasce com as 5 semanas do mês (seg–sáb, da primeira segunda-feira) e os
            blocos de Produção e Industrialização vazios, prontos para receber os códigos SAP.
          </p>
          <button className="btn-primary mx-auto" onClick={criarCalendario} disabled={criando}>
            <CalendarPlus size={15} />
            {criando ? 'Criando…' : `Criar calendário de ${dados?.cenario.nome}`}
          </button>
        </section>
      ) : (
        <div className="space-y-6">
          <div className="panel px-4 py-3 flex flex-wrap items-end gap-4">
            <label className="block">
              <span className="label-overline">Mês</span>
              <select
                className="input-field w-40"
                value={dados.projecao.mes}
                onChange={(e) => trocarPeriodo('mes', Number(e.target.value))}
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
                value={dados.projecao.ano}
                onChange={(e) => trocarPeriodo('ano', Number(e.target.value))}
              />
            </label>
            <label className="block">
              <span className="label-overline">Operadores na linha</span>
              <input
                type="number"
                className="input-field w-28"
                value={dados.projecao.qtd_operadores}
                onChange={(e) => trocarPeriodo('qtdOperadores', Number(e.target.value))}
              />
            </label>
            <div className="ml-auto flex gap-3">
              <Kpi rotulo="Slots preenchidos" valor={fmtInt(preenchidos)} />
            </div>
          </div>

          {resultado && (
            <section className="panel border-primary-200 bg-primary-50/50 px-4 py-3">
              <p className="text-sm text-primary-900">
                <strong>{resultado.geradas} linha(s)</strong> gravadas na lista de demanda.
              </p>
            </section>
          )}

          {dados.semanas.map((semana) => (
            <section key={semana.semana} className="panel overflow-hidden">
              <header className="px-4 py-2.5 border-b border-slate-200 flex items-center gap-3">
                <h2 className="font-heading font-semibold text-sm">Semana {semana.semana}</h2>
                <span className="text-xs text-slate-500">
                  {fmtData(semana.dias[0])} — {fmtData(semana.dias[5])}
                </span>
              </header>

              <div className="overflow-x-auto">
                <div className="flex min-w-max">
                  {semana.dias.map((dia) => (
                    <div key={dia} className="w-56 shrink-0 border-r border-slate-100 last:border-r-0">
                      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200">
                        <div className="text-sm font-medium text-slate-800">{fmtData(dia)}</div>
                        <div className="label-overline">{fmtDiaSemana(dia)}</div>
                      </div>

                      {BLOCOS.map((bloco) => (
                        <div key={bloco.chave} className="border-b border-slate-100 last:border-b-0">
                          <div className="px-3 pt-2 label-overline">{bloco.rotulo}</div>
                          <div className="p-2 space-y-1">
                            {Array.from({ length: bloco.linhas }, (_, ordem) => {
                              const s = slotDe.get(chaveSlot(dia, bloco.chave, ordem))
                              const vazio = !s?.skuCodigo?.trim()
                              // Mostra as linhas com dado + uma vazia para digitar.
                              const primeiraVazia =
                                vazio &&
                                ordem ===
                                  Array.from({ length: bloco.linhas }).findIndex(
                                    (_, i) =>
                                      !slotDe.get(chaveSlot(dia, bloco.chave, i))?.skuCodigo?.trim(),
                                  )
                              if (vazio && !primeiraVazia) return null
                              return (
                                <div key={ordem} className="flex gap-1">
                                  <input
                                    className="cell-input flex-1 text-left font-mono text-xs border-slate-200"
                                    placeholder="COD-0000"
                                    value={s?.skuCodigo ?? ''}
                                    onChange={(e) =>
                                      alterar(dia, bloco.chave, ordem, 'skuCodigo', e.target.value)
                                    }
                                  />
                                  <input
                                    className="cell-input w-16 border-slate-200"
                                    inputMode="numeric"
                                    placeholder="0"
                                    value={s?.quantidade ? String(s.quantidade) : ''}
                                    onChange={(e) =>
                                      alterar(dia, bloco.chave, ordem, 'quantidade', e.target.value)
                                    }
                                  />
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ))}

          {resultado && resultado.diagnosticos.length > 0 && (
            <PainelDiagnostico
              diagnosticos={resultado.diagnosticos}
              correcoes={cenarios.find((c) => c.id === id)?.correcoes ?? {}}
              onAlternar={() => {
                /* correções são do cenário — ajuste em Semanal/Mensal */
              }}
            />
          )}
        </div>
      )}
    </>
  )
}
