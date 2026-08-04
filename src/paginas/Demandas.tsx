import { useMemo, useState } from 'react'
import { Download, Plus, Trash2 } from 'lucide-react'
import { apiDelete, apiPatch, apiPost } from '../lib/api'
import { useApi, useCenarioSelecionado } from '../lib/hooks'
import { fmtData, fmtDecimal, fmtDiaSemana, fmtInt } from '../lib/formato'
import { ROTULO_TIPO_LINHA, type Demanda, type TipoLinha } from '../lib/tipos'
import { Carregando, CelulaNumero, Erro, Kpi, SeletorCenario } from '../components/comuns'

const TIPOS: TipoLinha[] = ['defasagem', 'industrializacao', 'producao_montagem']

/** Lista de demanda (aba Demandas Defasagem), editável no app. */
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

  async function editar(linhaId: number, campo: string, valor: unknown) {
    setErroSalvar(null)
    try {
      await apiPatch(`demandas?id=${linhaId}`, { [campo]: valor })
      recarregar()
    } catch (e) {
      setErroSalvar((e as Error).message)
    }
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
            Equivale à aba Demandas Defasagem. Editável aqui; exporta em CSV para abrir no
            Sheets.
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
                          onChange={(e) => editar(l.id, 'feito', e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-blue-600/25"
                          title={
                            l.feito && l.feito_por
                              ? `Marcado por ${l.feito_por}`
                              : 'Marcar como feito'
                          }
                        />
                      </td>
                      <td className="td">
                        <span className="chip">{ROTULO_TIPO_LINHA[l.tipo_linha]}</span>
                      </td>
                      <td className="td whitespace-nowrap">
                        {fmtData(l.dia_processo)}{' '}
                        <span className="text-slate-400 text-xs">
                          {fmtDiaSemana(l.dia_processo)}
                        </span>
                      </td>
                      <td className="td whitespace-nowrap text-slate-500">
                        {fmtData(l.dia_producao)}
                      </td>
                      <td className="td data-code">{l.sku_codigo}</td>
                      <td className="td max-w-72 truncate" title={l.processo_nome}>
                        {l.processo_nome}
                        {l.origem === 'manual' && <span className="chip ml-2">manual</span>}
                      </td>
                      <td className="td-num p-0">
                        <CelulaNumero
                          valor={Number(l.quantidade)}
                          decimais={0}
                          onConfirmar={(v) => editar(l.id, 'quantidade', v)}
                        />
                      </td>
                      <td className="td-num p-0">
                        <CelulaNumero
                          valor={l.operadores === null ? null : Number(l.operadores)}
                          decimais={0}
                          onConfirmar={(v) => editar(l.id, 'operadores', v)}
                        />
                      </td>
                      <td className="td-num p-0">
                        <CelulaNumero
                          valor={l.pcs_hora === null ? null : Number(l.pcs_hora)}
                          onConfirmar={(v) => editar(l.id, 'pcsHora', v)}
                        />
                      </td>
                      <td
                        className={`td-num ${l.tempo_horas === null ? 'bg-amber-50 text-amber-800' : ''}`}
                      >
                        {l.tempo_horas === null ? 'sem taxa' : fmtDecimal(l.tempo_horas)}
                      </td>
                      <td className="td data-code">{l.lote}</td>
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
              Marcar como feito registra quem e quando, e tira a carga do heat map quando a
              correção <span className="data-code">check-feito-ignorado</span> está ligada no
              cenário. Regerar a demanda preserva as linhas manuais e o que já estava feito.
            </footer>
          </section>
        </div>
      )}
    </>
  )
}
