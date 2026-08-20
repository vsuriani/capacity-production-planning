import { useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCheck, Download, Eraser, Inbox, OctagonAlert, Wand2,
} from 'lucide-react'
import { apiPatch, apiPost } from '../lib/api'
import { useApi, useCenarioSelecionado } from '../lib/hooks'
import { fmtData, fmtDecimal, fmtDiaSemana, fmtInt } from '../lib/formato'
import { ROTULO_TIPO_LINHA, type TipoLinha } from '../lib/tipos'
import { Carregando, Erro, Kpi, SeletorCenario } from '../components/comuns'

type LinhaSimulada = {
  id: number
  tipo_linha: TipoLinha
  dia_processo: string
  dia_ideal: string | null
  sku_codigo: string
  processo_nome: string
  quantidade: string
  operadores: string | null
  tempo_horas: string | null
  lote: string
  feito: boolean
}

type Dimensionamento = {
  linhas: number
  semTempo: number
  horasParede: number
  homemHora: number
  operadoresMinimo: number
  operadoresEmpacotado: number | null
  naoCabem: number
  ocupacao: number
  estado: 'vazio' | 'ok' | 'apertado' | 'estourado' | 'impossivel'
}

type DiaSimulado = {
  data: string
  util: boolean
  feriado: string | null
  linhas: LinhaSimulada[]
  dimensionamento: Dimensionamento
}

type Dados = {
  cenario: { id: number; nome: string; mes: number | null; ano: number | null }
  mes: number
  ano: number
  capacidade: number
  jornadaLiquida: number
  semanas: { semana: number; dias: string[] }[]
  dias: DiaSimulado[]
  pool: LinhaSimulada[]
  foraDaGrade: LinhaSimulada[]
  total: number
}

/**
 * Ocupação é MAGNITUDE, então rampa sequencial (as mesmas classes do heat map de Operadores).
 * Estouro e impossibilidade são ESTADO: paleta de status, e nunca só cor — vêm com ícone e
 * rótulo, como `Operadores.tsx` estabeleceu.
 */
const ESTADO = {
  vazio: { classe: 'heat-0', rotulo: 'vazio', Icone: null },
  ok: { classe: 'heat-2', rotulo: 'cabe', Icone: null },
  apertado: { classe: 'heat-4', rotulo: 'apertado', Icone: null },
  estourado: { classe: 'heat-atencao', rotulo: 'falta gente', Icone: AlertTriangle },
  impossivel: { classe: 'heat-critico', rotulo: 'não cabe', Icone: OctagonAlert },
} as const

/**
 * Simulação ideal: a lista de demanda virando calendário operacional.
 *
 * A geração calcula o dia de cada processo pelas regras caso-a-caso da planilha e ninguém
 * confere se aquele dia cabe na linha. Aqui o supervisor posiciona cada demanda no dia em que
 * ela vai acontecer de verdade, vendo o dimensionamento do dia enquanto move, e só então
 * aplica — até o Aplicar, a Lista de demanda e o heat map ficam intactos.
 *
 * Arrastar é o gesto principal; clicar na demanda e depois no dia faz o mesmo, porque drag and
 * drop nativo não funciona por teclado nem em toque. O pool é tabela, e não cards, para ler
 * igual à Lista de demanda.
 */
export function Simulacao() {
  const { cenarios, id, setId } = useCenarioSelecionado('mensal')
  const { dados, erro, carregando, recarregar } = useApi<Dados>(
    id ? `simulacao?cenario=${id}` : null,
  )
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [selecionada, setSelecionada] = useState<number | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  const [aplicado, setAplicado] = useState<{ aplicadas: number; noPool: number } | null>(null)

  async function agir(fn: () => Promise<unknown>) {
    setOcupado(true)
    setErroAcao(null)
    try {
      await fn()
      recarregar()
    } catch (e) {
      setErroAcao((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  /** `dia` null devolve a demanda ao pool. */
  function mover(linhaId: number, dia: string | null) {
    setSelecionada(null)
    setAplicado(null)
    agir(() => apiPatch(`simulacao?cenario=${id}`, { movimentos: [{ id: linhaId, dia }] }))
  }

  async function aplicar() {
    if (!id) return
    if (!confirm('Gravar os dias da simulação na lista de demanda?')) return
    setAplicado(null)
    await agir(async () => {
      const r = await apiPost<{ aplicadas: number; noPool: number }>(
        `simulacao?cenario=${id}&acao=aplicar`,
      )
      // O heat map lê a lista de demanda, então recalcula junto — é a mesma rota do botão
      // Recalcular da tela de Operadores, não uma segunda implementação.
      await apiPost(`alocacao?cenario=${id}&acao=calcular`)
      setAplicado(r)
    })
  }

  const resumo = useMemo(() => {
    const dias = dados?.dias ?? []
    const comCarga = dias.filter((d) => d.dimensionamento.linhas > 0)
    return {
      alocadas: (dados?.total ?? 0) - (dados?.pool.length ?? 0),
      homemHora: comCarga.reduce((s, d) => s + d.dimensionamento.homemHora, 0),
      problemas: comCarga.filter(
        (d) => d.dimensionamento.estado === 'estourado' || d.dimensionamento.estado === 'impossivel',
      ).length,
      pico: comCarga.reduce(
        (s, d) =>
          Math.max(s, d.dimensionamento.operadoresEmpacotado ?? d.dimensionamento.operadoresMinimo),
        0,
      ),
    }
  }, [dados])

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Simulação ideal</h1>
          <p className="page-subtitle">
            Posicione cada demanda do mês no dia em que ela vai acontecer de verdade. O
            dimensionamento de cada dia acompanha; a lista de demanda só muda no Aplicar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SeletorCenario cenarios={cenarios} id={id} onSelecionar={setId} />
          <button
            className="btn-ghost"
            disabled={ocupado || !id}
            title="Traz cada demanda para o dia que a geração calculou, como ponto de partida"
            onClick={() => agir(() => apiPost(`simulacao?cenario=${id}&acao=preencher`))}
          >
            <Wand2 size={15} /> Preencher com os dias gerados
          </button>
          <button
            className="btn-ghost"
            disabled={ocupado || !id}
            onClick={() => agir(() => apiPost(`simulacao?cenario=${id}&acao=esvaziar`))}
          >
            <Eraser size={15} /> Esvaziar
          </button>
          <a
            className="btn-ghost"
            href={`/api/simulacao?cenario=${id}&formato=csv`}
            aria-disabled={!id || resumo.alocadas === 0}
            title={
              resumo.alocadas === 0
                ? 'Nada plotado ainda — posicione ao menos uma demanda'
                : 'Exporta o calendário plotado, dia a dia'
            }
          >
            <Download size={15} /> CSV
          </a>
          <button className="btn-primary" disabled={ocupado || !id} onClick={aplicar}>
            <CheckCheck size={15} /> Aplicar na lista
          </button>
        </div>
      </div>

      <Erro mensagem={erro ?? erroAcao} />

      {carregando && !dados ? (
        <Carregando />
      ) : !dados ? (
        <div className="empty-state">
          Escolha um cenário mensal — é ele que carrega a lista de demanda do mês.
        </div>
      ) : dados.total === 0 ? (
        <div className="empty-state">
          <strong>{dados.cenario.nome}</strong> não tem demanda nenhuma. Monte a grade no
          Calendário e clique em Gerar demanda primeiro.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi
              rotulo="Alocadas"
              valor={`${fmtInt(resumo.alocadas)} / ${fmtInt(dados.total)}`}
              detalhe={dados.pool.length > 0 ? `${fmtInt(dados.pool.length)} no pool` : 'mês inteiro posicionado'}
            />
            <Kpi rotulo="Homem-hora alocada" valor={`${fmtDecimal(resumo.homemHora)} h`} />
            <Kpi
              rotulo="Pico de operadores"
              valor={fmtInt(resumo.pico)}
              tom={resumo.pico > dados.capacidade ? 'alerta' : 'normal'}
              detalhe={`a linha tem ${fmtInt(dados.capacidade)}`}
            />
            <Kpi
              rotulo="Dias com problema"
              valor={fmtInt(resumo.problemas)}
              tom={resumo.problemas > 0 ? 'alerta' : 'normal'}
              detalhe="falta gente ou não cabe"
            />
          </div>

          {aplicado && (
            <section className="panel border-primary-200 bg-primary-50/50 px-4 py-3">
              <p className="text-sm text-primary-900">
                <strong>{aplicado.aplicadas} linha(s)</strong> mudaram de dia na lista de demanda,
                e o heat map de Operadores foi recalculado.
                {aplicado.noPool > 0 && (
                  <>
                    {' '}
                    {aplicado.noPool} continuam no pool e mantiveram o dia que a geração calculou.
                  </>
                )}
              </p>
            </section>
          )}

          <PainelPool
            linhas={dados.pool}
            selecionada={selecionada}
            onSelecionar={setSelecionada}
            onSoltar={(linhaId) => mover(linhaId, null)}
          />

          {dados.foraDaGrade.length > 0 && (
            <section className="panel border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
              <AlertTriangle size={15} className="inline mr-1.5 -mt-0.5" />
              {dados.foraDaGrade.length} demanda(s) alocadas em dias fora da grade deste mês —
              elas não aparecem no quadro abaixo, mas continuam na lista.
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
                  {semana.dias.map((data) => {
                    const dia = dados.dias.find((d) => d.data === data)
                    if (!dia) return null
                    return (
                      <CelulaDoDia
                        key={data}
                        dia={dia}
                        capacidade={dados.capacidade}
                        jornadaLiquida={dados.jornadaLiquida}
                        selecionada={selecionada}
                        sobre={sobre === data}
                        onSobre={(ativo) => setSobre(ativo ? data : null)}
                        onSoltar={(linhaId) => mover(linhaId, data)}
                        onSelecionar={setSelecionada}
                      />
                    )
                  })}
                </div>
              </div>
            </section>
          ))}

          <p className="text-xs text-slate-500">
            Arraste a demanda para o dia, ou clique nela e depois no dia. Regerar a demanda no
            Calendário apaga as linhas geradas — e leva a simulação junto.
          </p>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- pool

/**
 * O pool é tabela, e não cards, para ler igual à Lista de demanda — mesmas colunas, mesma
 * ordem. Cada linha é arrastável; a seção inteira é alvo de drop, para devolver.
 */
function PainelPool({
  linhas,
  selecionada,
  onSelecionar,
  onSoltar,
}: {
  linhas: LinhaSimulada[]
  selecionada: number | null
  onSelecionar: (id: number | null) => void
  onSoltar: (id: number) => void
}) {
  const [filtro, setFiltro] = useState('')
  const [sobre, setSobre] = useState(false)

  const visiveis = useMemo(() => {
    const termo = filtro.trim().toLowerCase()
    if (!termo) return linhas
    return linhas.filter(
      (l) =>
        l.sku_codigo.toLowerCase().includes(termo) ||
        l.processo_nome.toLowerCase().includes(termo),
    )
  }, [linhas, filtro])

  return (
    <section
      className={`panel overflow-hidden ${sobre ? 'ring-2 ring-primary-400' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setSobre(true)
      }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => {
        e.preventDefault()
        setSobre(false)
        const id = Number(e.dataTransfer.getData('text/plain'))
        if (id) onSoltar(id)
      }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
        <h2 className="font-heading font-semibold text-sm flex items-center gap-2">
          <Inbox size={15} className="text-slate-400" strokeWidth={1.75} />
          Não alocadas ({fmtInt(linhas.length)})
          {filtro && visiveis.length !== linhas.length && (
            <span className="text-slate-500 font-normal">· {fmtInt(visiveis.length)} no filtro</span>
          )}
        </h2>
        <input
          className="input-field w-56"
          placeholder="SKU ou processo…"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
      </header>

      {linhas.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500 text-center">
          Tudo posicionado. Arraste uma demanda para cá para tirá-la do calendário.
        </p>
      ) : (
        <div className="overflow-auto max-h-72">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="th">Tipo</th>
                <th className="th">Dia gerado</th>
                <th className="th">SKU</th>
                <th className="th">Processo</th>
                <th className="th text-right">Qtd</th>
                <th className="th text-right">Oper.</th>
                <th className="th text-right">Tempo (h)</th>
                <th className="th text-right">Homem-hora</th>
                <th className="th">Lote</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => {
                const tempo = l.tempo_horas === null ? null : Number(l.tempo_horas)
                const operadores = Number(l.operadores || 0)
                return (
                  <tr
                    key={l.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', String(l.id))
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onClick={() => onSelecionar(selecionada === l.id ? null : l.id)}
                    title="Arraste para um dia, ou clique aqui e depois no dia"
                    className={`cursor-grab active:cursor-grabbing ${
                      selecionada === l.id
                        ? 'bg-primary-50 ring-2 ring-inset ring-primary-400'
                        : 'hover:bg-slate-50/60'
                    }`}
                  >
                    <td className="td">
                      <span className="chip">{ROTULO_TIPO_LINHA[l.tipo_linha]}</span>
                    </td>
                    <td className="td whitespace-nowrap text-slate-500">
                      {fmtData(l.dia_processo)}{' '}
                      <span className="text-slate-400 text-xs">{fmtDiaSemana(l.dia_processo)}</span>
                    </td>
                    <td className="td data-code">{l.sku_codigo}</td>
                    <td className="td max-w-72 truncate" title={l.processo_nome}>
                      {l.processo_nome}
                    </td>
                    <td className="td-num">{fmtInt(l.quantidade)}</td>
                    <td className="td-num">{fmtInt(operadores)}</td>
                    <td className={`td-num ${tempo === null ? 'bg-amber-50 text-amber-800' : ''}`}>
                      {tempo === null ? 'sem taxa' : fmtDecimal(tempo)}
                    </td>
                    <td className="td-num text-slate-500" title="Tempo × operadores">
                      {tempo === null ? '—' : fmtDecimal(tempo * operadores)}
                    </td>
                    <td className="td data-code text-slate-500">{l.lote}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- dia

function CelulaDoDia({
  dia,
  capacidade,
  jornadaLiquida,
  selecionada,
  sobre,
  onSobre,
  onSoltar,
  onSelecionar,
}: {
  dia: DiaSimulado
  capacidade: number
  jornadaLiquida: number
  selecionada: number | null
  sobre: boolean
  onSobre: (ativo: boolean) => void
  onSoltar: (id: number) => void
  onSelecionar: (id: number | null) => void
}) {
  const d = dia.dimensionamento
  const estado = ESTADO[d.estado]
  const exigido = d.operadoresEmpacotado ?? d.operadoresMinimo

  return (
    <div
      className={`w-56 shrink-0 border-r border-slate-100 last:border-r-0 flex flex-col ${
        sobre ? 'bg-primary-50' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        onSobre(true)
      }}
      onDragLeave={() => onSobre(false)}
      onDrop={(e) => {
        e.preventDefault()
        onSobre(false)
        const id = Number(e.dataTransfer.getData('text/plain'))
        if (id) onSoltar(id)
      }}
      onClick={() => {
        if (selecionada !== null) onSoltar(selecionada)
      }}
    >
      <div className={`px-3 py-2 border-b border-slate-200 ${dia.util ? 'bg-slate-50' : 'bg-slate-100'}`}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium text-slate-800">{fmtData(dia.data)}</span>
          <span className="label-overline">{fmtDiaSemana(dia.data)}</span>
        </div>
        {!dia.util && (
          <div className="text-xs text-slate-500 mt-0.5">
            {dia.feriado ? `feriado · ${dia.feriado}` : 'fim de semana'}
          </div>
        )}
      </div>

      <div
        className={`${estado.classe} px-3 py-1.5 text-xs flex items-center gap-1.5 whitespace-nowrap overflow-hidden`}
        title={
          `${fmtDecimal(d.homemHora)} h de gente · ${fmtDecimal(d.horasParede)} h de parede\n` +
          `mínimo ${d.operadoresMinimo} operador(es), ` +
          `${d.operadoresEmpacotado === null ? 'sem arranjo possível' : `${d.operadoresEmpacotado} no arranjo real`}\n` +
          `a linha tem ${capacidade}, jornada de ${fmtDecimal(jornadaLiquida)} h`
        }
      >
        {estado.Icone && <estado.Icone size={11} />}
        {d.linhas === 0 ? (
          <span>livre</span>
        ) : (
          <>
            <span className="font-medium tabular-nums">{exigido} op</span>
            <span className="opacity-75">· {fmtDecimal(d.homemHora)} h</span>
            <span className="ml-auto">{estado.rotulo}</span>
          </>
        )}
      </div>

      {d.naoCabem > 0 && (
        <div className="px-3 py-1 text-xs text-red-700 bg-red-50 border-b border-red-100">
          {d.naoCabem} processo(s) mais longos que a jornada
        </div>
      )}

      <div className="p-2 space-y-1 min-h-24 flex-1">
        {dia.linhas.map((l) => (
          <CardDemanda
            key={l.id}
            linha={l}
            selecionada={selecionada === l.id}
            onSelecionar={onSelecionar}
            jornadaLiquida={jornadaLiquida}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- card

function CardDemanda({
  linha,
  selecionada,
  onSelecionar,
  jornadaLiquida,
}: {
  linha: LinhaSimulada
  selecionada: boolean
  onSelecionar: (id: number | null) => void
  jornadaLiquida?: number
}) {
  const tempo = linha.tempo_horas === null ? null : Number(linha.tempo_horas)
  const operadores = Number(linha.operadores || 0)
  const longo = tempo !== null && jornadaLiquida !== undefined && tempo > jornadaLiquida
  const mudouDeDia = linha.dia_ideal !== null && linha.dia_ideal !== linha.dia_processo

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(linha.id))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={(e) => {
        e.stopPropagation()
        onSelecionar(selecionada ? null : linha.id)
      }}
      title={
        `${linha.sku_codigo} · ${linha.processo_nome}\n` +
        `${fmtInt(linha.quantidade)} peças · ${operadores} operador(es) · ` +
        `${tempo === null ? 'sem tempo estimado' : `${fmtDecimal(tempo)} h`}\n` +
        `dia gerado: ${fmtData(linha.dia_processo)}`
      }
      className={`cursor-grab active:cursor-grabbing rounded border px-2 py-1 text-xs bg-white ${
        selecionada
          ? 'border-primary-500 ring-2 ring-primary-300'
          : longo
            ? 'border-red-300'
            : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="flex items-center gap-1">
        <span className="data-code text-[11px] text-slate-500">{linha.sku_codigo}</span>
        {mudouDeDia && (
          <span className="text-[10px] text-primary-700" title="movida em relação ao dia gerado">
            ●
          </span>
        )}
        <span className="ml-auto tabular-nums text-slate-500">
          {tempo === null ? 'sem taxa' : `${fmtDecimal(tempo)} h`} · {operadores} op
        </span>
      </div>
      <div className="truncate text-slate-800">{linha.processo_nome}</div>
      <div className="text-[10px] text-slate-400">{ROTULO_TIPO_LINHA[linha.tipo_linha]}</div>
    </div>
  )
}
