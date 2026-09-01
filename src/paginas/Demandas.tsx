import { useMemo, useState } from 'react'
import { Download, Plus, Trash2 } from 'lucide-react'
import { apiDelete, apiPatch, apiPost } from '../lib/api'
import { useApi, useCenarioSelecionado } from '../lib/hooks'
import { fmtDecimal, fmtDiaSemana, fmtInt } from '../lib/formato'
import { ROTULO_TIPO_LINHA, type Demanda, type Processo, type TipoLinha } from '../lib/tipos'
import {
  Carregando, CelulaData, CelulaNumero, CelulaSelecao, CelulaTexto, Erro, Kpi, SeletorCenario,
} from '../components/comuns'

/**
 * `retrabalho` só existe aqui — o cadastro de Processos e sequências não o oferece, então a
 * geração nunca produz uma linha desse tipo. É rótulo para o que o supervisor lança na mão.
 */
const TIPOS: TipoLinha[] = ['defasagem', 'industrializacao', 'producao_montagem', 'retrabalho']
const OPCOES_TIPO = TIPOS.map((t) => ({ valor: t, rotulo: ROTULO_TIPO_LINHA[t] }))

/**
 * Lista de demanda (aba Demandas Defasagem).
 *
 * A geração é um ponto de partida: quem decide data, quantidade e alocação é o supervisor
 * de produção. Por isso quase toda coluna é editável, inclusive o dia do processo — só o
 * tempo não é, porque é derivado (`quantidade ÷ Pç/hr`).
 */
export function Demandas() {
  const { cenarios, id, setId } = useCenarioSelecionado('mensal')
  const [tipo, setTipo] = useState<TipoLinha | ''>('')
  const [sku, setSku] = useState('')
  const [somenteAbertas, setSomenteAbertas] = useState(false)

  const filtros = new URLSearchParams()
  if (id) filtros.set('cenario', String(id))
  if (tipo) filtros.set('tipo', tipo)
  if (sku.trim()) filtros.set('sku', sku.trim())
  if (somenteAbertas) filtros.set('feito', 'false')

  const { dados, erro, carregando, recarregar } = useApi<{
    demandas: Demanda[]
    total: number
  }>(id ? `demandas?${filtros}` : null)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)

  // Catálogos: SKU e processo são escolha fechada, vinda do cadastro.
  const { dados: catalogoSku } = useApi<{ itens: { codigo: string; descricao: string }[] }>('sku')
  const { dados: catalogoRoteiros } = useApi<{ processos: Processo[] }>('roteiros')

  const opcoesSku = useMemo(
    () =>
      (catalogoSku?.itens ?? []).map((s) => ({
        valor: s.codigo,
        rotulo: s.descricao ? `${s.codigo} — ${s.descricao}` : s.codigo,
      })),
    [catalogoSku],
  )

  const opcoesProcesso = useMemo(
    () =>
      (catalogoRoteiros?.processos ?? []).map((p) => ({
        valor: String(p.id),
        rotulo: p.nome,
        grupo: `${p.produto} · ${ROTULO_TIPO_LINHA[p.tipo_linha]}`,
      })),
    [catalogoRoteiros],
  )

  const processoPorId = useMemo(
    () => new Map((catalogoRoteiros?.processos ?? []).map((p) => [p.id, p])),
    [catalogoRoteiros],
  )

  /**
   * Tempo é derivado, não digitado: `quantidade ÷ Pç/hr`, como a geração calcula. Operadores
   * não entra nesta conta — ele é o consumo de gente na alocação.
   */
  const tempoDe = (quantidade: number, pcsHora: number | null) =>
    pcsHora && pcsHora > 0 ? quantidade / pcsHora : null

  async function editar(linhaId: number, mudancas: Record<string, unknown>) {
    setErroSalvar(null)
    try {
      await apiPatch(`demandas?id=${linhaId}`, mudancas)
      recarregar()
    } catch (e) {
      setErroSalvar((e as Error).message)
    }
  }

  /** Trocar o processo adota o cadastro dele: identidade, operadores, Pç/hr e o tempo. */
  function escolherProcesso(linha: Demanda, processoId: number) {
    const p = processoPorId.get(processoId)
    if (!p) return
    const pcsHora = p.pcs_hora === null ? null : Number(p.pcs_hora)
    editar(linha.id, {
      processoId: p.id,
      processoNome: p.nome,
      tipoLinha: p.tipo_linha,
      operadores: p.operadores === null ? null : Number(p.operadores),
      pcsHora,
      tempoHoras: pcsHora && pcsHora > 0 ? Number(linha.quantidade) / pcsHora : null,
    })
  }

  async function adicionar() {
    if (!id) return
    const hoje = new Date().toISOString().slice(0, 10)
    try {
      await apiPost('demandas', {
        cenarioId: id,
        tipoLinha: 'producao_montagem',
        diaProcesso: hoje,
        diaProducao: hoje,
        skuCodigo: 'NOVO',
        processoNome: 'Processo manual',
        quantidade: 0,
      })
      recarregar()
    } catch (e) {
      setErroSalvar((e as Error).message)
    }
  }

  async function remover(linhaId: number) {
    if (!confirm('Remover esta linha da lista de demanda?')) return
    try {
      await apiDelete(`demandas?id=${linhaId}`)
      recarregar()
    } catch (e) {
      setErroSalvar((e as Error).message)
    }
  }

  const resumo = useMemo(() => {
    const linhas = dados?.demandas ?? []
    const horas = linhas.reduce((s, l) => s + Number(l.tempo_horas ?? 0), 0)
    return {
      exibidas: linhas.length,
      feitas: linhas.filter((l) => l.feito).length,
      manuais: linhas.filter((l) => l.origem === 'manual').length,
      horas,
      semTempo: linhas.filter((l) => l.tempo_horas === null).length,
    }
  }, [dados])

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Lista de demanda</h1>
          <p className="page-subtitle">
            A geração é o ponto de partida — as datas e o resto são editáveis. O tempo é
            calculado (Qtd ÷ Pç/hr). Exporta em CSV para abrir no Sheets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SeletorCenario cenarios={cenarios} id={id} onSelecionar={setId} />
          <button className="btn-ghost" onClick={adicionar} disabled={!id}>
            <Plus size={15} /> Linha manual
          </button>
          <a
            className="btn-primary"
            href={`/api/demandas?${filtros}&formato=csv`}
            aria-disabled={!id}
          >
            <Download size={15} /> CSV
          </a>
        </div>
      </div>

      <Erro mensagem={erro ?? erroSalvar} />

      <div className="panel px-4 py-3 mb-4 flex flex-wrap items-center gap-3">
        <select
          className="input-field w-auto"
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
        <input
          className="input-field w-40"
          placeholder="código SAP…"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={somenteAbertas}
            onChange={(e) => setSomenteAbertas(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-blue-600/25"
          />
          só pendentes
        </label>
      </div>

      {carregando && !dados ? (
        <Carregando />
      ) : !dados || dados.demandas.length === 0 ? (
        <div className="empty-state">
          Nenhuma linha — monte a grade no calendário e clique em Gerar demanda.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi rotulo="Linhas exibidas" valor={`${fmtInt(resumo.exibidas)} / ${fmtInt(dados.total)}`} />
            <Kpi rotulo="Concluídas" valor={fmtInt(resumo.feitas)} />
            <Kpi rotulo="Carga listada" valor={`${fmtDecimal(resumo.horas)} h`} />
            <Kpi
              rotulo="Sem tempo estimado"
              valor={fmtInt(resumo.semTempo)}
              tom={resumo.semTempo > 0 ? 'alerta' : 'normal'}
              detalhe={resumo.semTempo > 0 ? 'processo sem Pç/hr' : undefined}
            />
          </div>

          <section className="panel overflow-hidden">
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="th">Feito</th>
                    <th className="th">Tipo</th>
                    <th className="th">Dia do processo</th>
                    <th className="th">Dia da produção</th>
                    <th className="th">SKU</th>
                    <th className="th">Processo</th>
                    <th className="th text-right">Qtd</th>
                    <th className="th text-right">Oper.</th>
                    <th className="th text-right">Pç/hr</th>
                    <th className="th text-right">Tempo (h)</th>
                    <th className="th">Lote</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody>
                  {dados.demandas.map((l) => (
                    <tr
                      key={l.id}
                      className={`hover:bg-slate-50/60 ${l.feito ? 'text-slate-400' : ''}`}
                    >
                      <td className="td">
                        <input
                          type="checkbox"
                          checked={l.feito}
                          onChange={(e) => editar(l.id, { feito: e.target.checked })}
                          className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-blue-600/25"
                          title={
                            l.feito && l.feito_por
                              ? `Marcado por ${l.feito_por}`
                              : 'Marcar como feito'
                          }
                        />
                      </td>
                      <td className="td p-0 min-w-44">
                        <CelulaSelecao
                          valor={l.tipo_linha}
                          opcoes={OPCOES_TIPO}
                          onConfirmar={(v) => editar(l.id, { tipoLinha: v })}
                        />
                      </td>
                      <td className="td p-0 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <CelulaData
                            valor={l.dia_processo}
                            onConfirmar={(v) => editar(l.id, { diaProcesso: v })}
                          />
                          <span className="text-slate-400 text-xs pr-2">
                            {fmtDiaSemana(l.dia_processo)}
                          </span>
                        </div>
                      </td>
                      <td className="td p-0 whitespace-nowrap">
                        <CelulaData
                          valor={l.dia_producao}
                          onConfirmar={(v) => editar(l.id, { diaProducao: v })}
                        />
                      </td>
                      <td className="td p-0 min-w-36">
                        <CelulaSelecao
                          valor={l.sku_codigo}
                          opcoes={opcoesSku}
                          className="data-code"
                          onConfirmar={(v) => editar(l.id, { skuCodigo: v })}
                        />
                      </td>
                      <td className="td p-0 min-w-64">
                        <div className="flex items-center">
                          <CelulaSelecao
                            valor={String(l.processo_id ?? '')}
                            opcoes={
                              l.processo_id === null
                                ? [{ valor: '', rotulo: l.processo_nome || '— sem processo —' },
                                   ...opcoesProcesso]
                                : opcoesProcesso
                            }
                            onConfirmar={(v) => escolherProcesso(l, Number(v))}
                          />
                          {l.origem === 'manual' && <span className="chip mr-2">manual</span>}
                        </div>
                      </td>
                      <td className="td-num p-0">
                        <CelulaNumero
                          valor={Number(l.quantidade)}
                          decimais={0}
                          onConfirmar={(v) =>
                            editar(l.id, {
                              quantidade: v,
                              tempoHoras: tempoDe(v, l.pcs_hora === null ? null : Number(l.pcs_hora)),
                            })
                          }
                        />
                      </td>
                      <td className="td-num p-0">
                        <CelulaNumero
                          valor={l.operadores === null ? null : Number(l.operadores)}
                          decimais={0}
                          onConfirmar={(v) => editar(l.id, { operadores: v })}
                        />
                      </td>
                      <td className="td-num p-0">
                        <CelulaNumero
                          valor={l.pcs_hora === null ? null : Number(l.pcs_hora)}
                          onConfirmar={(v) =>
                            editar(l.id, { pcsHora: v, tempoHoras: tempoDe(Number(l.quantidade), v) })
                          }
                        />
                      </td>
                      <td
                        className={`td-num ${l.tempo_horas === null ? 'bg-amber-50 text-amber-800' : 'text-slate-500'}`}
                        title="Qtd ÷ Pç/hr"
                      >
                        {l.tempo_horas === null ? 'sem taxa' : fmtDecimal(l.tempo_horas)}
                      </td>
                      <td className="td p-0 min-w-32">
                        <CelulaTexto
                          valor={l.lote}
                          className="data-code"
                          onConfirmar={(v) => editar(l.id, { lote: v })}
                        />
                      </td>
                      <td className="td text-right">
                        <button
                          className="text-slate-400 hover:text-red-600"
                          onClick={() => remover(l.id)}
                          title="Remover linha"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="px-4 py-2 border-t border-slate-200 text-xs text-slate-500">
              As células salvam ao sair do campo (Enter confirma, Esc desfaz); o tempo se
              recalcula quando muda a Qtd ou o Pç/hr. Marcar como feito
              registra quem e quando. Regerar a demanda no calendário reescreve as linhas geradas
              — as edições feitas aqui se perdem; linhas manuais e as já marcadas como feitas
              são preservadas.
            </footer>
          </section>
        </div>
      )}
    </>
  )
}
