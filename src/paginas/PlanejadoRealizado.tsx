import { useMemo, useState } from 'react'
import { History, Plus, Trash2 } from 'lucide-react'
import { apiDelete, apiPatch, apiPost } from '../lib/api'
import { useApi, useCenarioSelecionado } from '../lib/hooks'
import { fmtData, fmtDiaSemana, fmtInt, fmtDecimal } from '../lib/formato'
import {
  ROTULO_STATUS, ROTULO_TIPO_LINHA, type StatusRealizado, type TipoLinha,
} from '../lib/tipos'
import {
  Carregando, CelulaNumero, CelulaSelecao, Erro, Kpi, SeletorCenario,
} from '../components/comuns'

type Linha = {
  id: number
  tipo_linha: TipoLinha
  dia_ideal: string
  dia_processo: string
  sku_codigo: string
  processo_nome: string
  quantidade: string
  origem: 'gerado' | 'manual'
  status_realizado: StatusRealizado
  quantidade_realizada: string | null
  apontado_por: string | null
  apontado_em: string | null
}

type Evento = {
  id: number
  quando: string
  quem: string
  acao: string
  sku_codigo: string
  processo_nome: string
  detalhe: string
}

type Dados = {
  linhas: Linha[]
  log: Evento[]
  tipoDoIndicador: TipoLinha
  indicadores: {
    planejado: number
    realizado: number
    planejadoAteHoje: number
    /** realizado ÷ planejado vencido. null quando nada venceu ainda. */
    aderencia: number | null
    conclusao: number | null
    linhas: number
    apontadas: number
    canceladas: number
  }
}

const TIPOS: TipoLinha[] = ['defasagem', 'industrializacao', 'producao_montagem', 'retrabalho']
const STATUS: StatusRealizado[] = ['pendente', 'total', 'parcial', 'cancelado']
const OPCOES_STATUS = STATUS.map((s) => ({ valor: s, rotulo: ROTULO_STATUS[s] }))

/** O chip de status é estado, não magnitude: paleta de status, e nunca só a cor. */
const TOM_STATUS: Record<StatusRealizado, string> = {
  pendente: 'chip',
  total: 'chip-ok',
  parcial: 'chip-warn',
  cancelado: 'chip-danger',
}

const ROTULO_ACAO: Record<string, string> = {
  apontou: 'apontou',
  'criou-linha': 'criou linha',
  'removeu-linha': 'removeu linha',
}

/**
 * Planejado × Realizado: o apontamento de produção.
 *
 * Fecha o ciclo que terminava na Simulação ideal. A tabela é o que foi **alocado** lá
 * (`dia_ideal`), e cada linha recebe o que de fato aconteceu — inteiro, em parte, ou cancelado.
 *
 * Os dois indicadores olham só para Produção / Montagem, em peças: é a montagem final do
 * aparelho, e é isso que "Planejado × Realizado" significa para o PCP. Defasagem e
 * industrialização são etapas-meio; contá-las inflaria o número com peça que ainda não virou
 * produto.
 */
export function PlanejadoRealizado() {
  const { cenarios, id, setId } = useCenarioSelecionado('mensal')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [tipo, setTipo] = useState<TipoLinha | ''>('')
  const [soPendentes, setSoPendentes] = useState(false)
  const [erroAcao, setErroAcao] = useState<string | null>(null)

  const busca = new URLSearchParams()
  if (de) busca.set('de', de)
  if (ate) busca.set('ate', ate)
  if (tipo) busca.set('tipo', tipo)
  if (soPendentes) busca.set('pendentes', '1')

  const { dados, erro, carregando, recarregar } = useApi<Dados>(
    id ? `realizado?cenario=${id}${busca.size ? `&${busca}` : ''}` : null,
  )

  async function agir(fn: () => Promise<unknown>) {
    setErroAcao(null)
    try {
      await fn()
      recarregar()
    } catch (e) {
      setErroAcao((e as Error).message)
    }
  }

  /**
   * Trocar o status já grava. Só "parcial" fica esperando a quantidade — e nasce com 0 para a
   * célula abrir editável, em vez de a linha ficar num limbo sem número.
   */
  const apontar = (linha: Linha, status: StatusRealizado, quantidade?: number) =>
    agir(() =>
      apiPatch(`realizado?id=${linha.id}`, {
        status,
        quantidadeRealizada:
          status === 'parcial' ? (quantidade ?? Number(linha.quantidade_realizada ?? 0)) : undefined,
      }),
    )

  async function remover(linha: Linha) {
    if (!confirm(`Remover a linha manual "${linha.processo_nome}"?`)) return
    await agir(() => apiDelete(`realizado?id=${linha.id}`))
  }

  /** Nasce alocada em hoje, para ser editada na própria tabela — igual à Lista de demanda. */
  async function adicionar() {
    if (!id) return
    const hoje = new Date().toISOString().slice(0, 10)
    await agir(() =>
      apiPost(`realizado?cenario=${id}`, {
        tipoLinha: 'producao_montagem',
        diaProcesso: hoje,
        diaProducao: hoje,
        skuCodigo: 'NOVO',
        processoNome: 'Processo manual',
        quantidade: 0,
      }),
    )
  }

  const ind = dados?.indicadores

  const totalRealizadoExibido = useMemo(
    () => (dados?.linhas ?? []).reduce((s, l) => s + Number(l.quantidade_realizada ?? 0), 0),
    [dados],
  )

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Planejado × Realizado</h1>
          <p className="page-subtitle">
            O que a Simulação ideal alocou, com o apontamento do que aconteceu de verdade. Os
            indicadores olham só para <strong>Produção / Montagem</strong> — a montagem final do
            aparelho — e contam peças.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <SeletorCenario cenarios={cenarios} id={id} onSelecionar={setId} />
          <button className="btn-primary" onClick={adicionar} disabled={!id}>
            <Plus size={15} /> Linha manual
          </button>
        </div>
      </div>

      <Erro mensagem={erro ?? erroAcao} />

      {carregando && !dados ? (
        <Carregando />
      ) : !dados ? (
        <div className="empty-state">Escolha um cenário.</div>
      ) : dados.indicadores.linhas === 0 && dados.linhas.length === 0 ? (
        <div className="empty-state">
          Nada alocado neste cenário — posicione as demandas na Simulação ideal primeiro.
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi
              rotulo="Pace de produção"
              valor={`${fmtInt(ind!.realizado)} / ${fmtInt(ind!.planejado)}`}
              detalhe={
                ind!.conclusao === null
                  ? 'peças de montagem'
                  : `${fmtDecimal(ind!.conclusao * 100)}% do mês, em peças`
              }
            />
            <Kpi
              rotulo="Planejado × Realizado"
              // 100% = no ritmo. Acima disso está adiantado, e o número passa de 100 de
              // propósito — truncar em 100% esconderia justamente quem puxou produção.
              valor={ind!.aderencia === null ? '—' : `${fmtDecimal(ind!.aderencia * 100)}%`}
              tom={ind!.aderencia !== null && ind!.aderencia < 1 ? 'alerta' : 'normal'}
              detalhe={
                ind!.aderencia === null
                  ? 'nada planejado até hoje'
                  : `${fmtInt(ind!.realizado)} de ${fmtInt(ind!.planejadoAteHoje)} pç vencidas`
              }
            />
            <Kpi
              rotulo="Linhas apontadas"
              valor={`${fmtInt(ind!.apontadas)} / ${fmtInt(ind!.linhas)}`}
              detalhe="só montagem"
            />
            <Kpi
              rotulo="Canceladas"
              valor={fmtInt(ind!.canceladas)}
              tom={ind!.canceladas > 0 ? 'alerta' : 'normal'}
            />
          </div>

          <section className="panel px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="label-overline">De</span>
                <input
                  type="date"
                  className="input-field w-40"
                  value={de}
                  onChange={(e) => setDe(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="label-overline">Até</span>
                <input
                  type="date"
                  className="input-field w-40"
                  value={ate}
                  onChange={(e) => setAte(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="label-overline">Tipo</span>
                <select
                  className="input-field w-52"
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as TipoLinha | '')}
                >
                  <option value="">todos os tipos</option>
                  {TIPOS.map((t) => (
                    <option key={t} value={t}>
                      {ROTULO_TIPO_LINHA[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm pb-2">
                <input
                  type="checkbox"
                  checked={soPendentes}
                  onChange={(e) => setSoPendentes(e.target.checked)}
                />
                só pendentes
              </label>
              {(de || ate || tipo || soPendentes) && (
                <button
                  className="btn-ghost pb-2"
                  onClick={() => {
                    setDe('')
                    setAte('')
                    setTipo('')
                    setSoPendentes(false)
                  }}
                >
                  limpar filtros
                </button>
              )}
            </div>
          </section>

          <section className="panel overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
              <h2 className="font-heading font-semibold text-sm">
                {fmtInt(dados.linhas.length)} linha(s) alocada(s)
              </h2>
              <span className="text-xs text-slate-500">
                {fmtInt(totalRealizadoExibido)} peça(s) apontada(s) no que está em tela
              </span>
            </header>

            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="th">Dia</th>
                    <th className="th">Tipo</th>
                    <th className="th">SKU</th>
                    <th className="th">Processo</th>
                    <th className="th text-right">Planejado</th>
                    <th className="th">Status</th>
                    <th className="th text-right">Realizado</th>
                    <th className="th">Apontado por</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody>
                  {dados.linhas.map((l) => {
                    const conta = l.tipo_linha === dados.tipoDoIndicador
                    return (
                      <tr key={l.id} className="hover:bg-slate-50/60">
                        <td className="td whitespace-nowrap">
                          {fmtData(l.dia_ideal)}{' '}
                          <span className="text-slate-400 text-xs">
                            {fmtDiaSemana(l.dia_ideal)}
                          </span>
                        </td>
                        <td className="td">
                          <span className={conta ? 'chip' : 'text-slate-500 text-xs'}>
                            {ROTULO_TIPO_LINHA[l.tipo_linha]}
                          </span>
                        </td>
                        <td className="td data-code">{l.sku_codigo}</td>
                        <td className="td">
                          {l.processo_nome}
                          {l.origem === 'manual' && (
                            <span className="chip ml-2 text-[10px]">manual</span>
                          )}
                        </td>
                        <td className="td-num">{fmtInt(l.quantidade)}</td>
                        <td className="td p-0 min-w-52">
                          <CelulaSelecao
                            valor={l.status_realizado}
                            opcoes={OPCOES_STATUS}
                            className={TOM_STATUS[l.status_realizado]}
                            onConfirmar={(v) => apontar(l, v as StatusRealizado)}
                          />
                        </td>
                        <td className="td-num p-0">
                          {l.status_realizado === 'parcial' ? (
                            <CelulaNumero
                              valor={Number(l.quantidade_realizada ?? 0)}
                              decimais={0}
                              onConfirmar={(v) => apontar(l, 'parcial', v)}
                            />
                          ) : (
                            <span className="px-2 text-slate-500">
                              {l.quantidade_realizada === null
                                ? '—'
                                : fmtInt(l.quantidade_realizada)}
                            </span>
                          )}
                        </td>
                        <td className="td text-xs text-slate-500 whitespace-nowrap">
                          {l.apontado_por ? (
                            <>
                              {l.apontado_por.split('@')[0]}
                              <br />
                              {new Date(l.apontado_em!).toLocaleString('pt-BR')}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="td text-right">
                          {l.origem === 'manual' && (
                            <button
                              className="text-slate-400 hover:text-red-600"
                              onClick={() => remover(l)}
                              title="Remover linha manual"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <footer className="px-4 py-2 border-t border-slate-200 text-xs text-slate-500">
              A tabela lista o que a Simulação ideal alocou. Trocar o status grava na hora;
              "Realizado parcialmente" libera a coluna Realizado, que não pode passar do
              planejado. "Realizado totalmente" também marca o check da linha na Lista de demanda
              — é o mesmo fato. Só linha manual pode ser removida aqui; demanda gerada se cancela.
            </footer>
          </section>

          <section className="panel overflow-hidden">
            <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
              <History size={15} className="text-slate-500" />
              <h2 className="font-heading font-semibold text-sm">
                Registro de alterações
                {dados.log.length > 0 && (
                  <span className="text-slate-500 font-normal">
                    {' '}
                    · {fmtInt(dados.log.length)} evento(s)
                  </span>
                )}
              </h2>
            </header>

            {dados.log.length === 0 ? (
              <div className="empty-state">
                Nada registrado ainda. Apontar uma linha ou lançar uma manual deixa rastro aqui.
              </div>
            ) : (
              <div className="overflow-auto max-h-[40vh]">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="th">Quando</th>
                      <th className="th">Quem</th>
                      <th className="th">Ação</th>
                      <th className="th">SKU</th>
                      <th className="th">Processo</th>
                      <th className="th">Detalhe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.log.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-50/60">
                        <td className="td whitespace-nowrap text-slate-500">
                          {new Date(e.quando).toLocaleString('pt-BR')}
                        </td>
                        <td className="td">{e.quem.split('@')[0]}</td>
                        <td className="td">
                          <span className="chip">{ROTULO_ACAO[e.acao] ?? e.acao}</span>
                        </td>
                        <td className="td data-code">{e.sku_codigo}</td>
                        <td className="td">{e.processo_nome}</td>
                        <td className="td text-slate-600">{e.detalhe}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  )
}
