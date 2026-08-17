import { Link } from 'react-router-dom'
import {
  ArrowUpRight, CalendarRange, ClipboardList, Database, LayoutGrid, ListTree, Users,
} from 'lucide-react'
import { useApi } from '../lib/hooks'
import type { TipoCenario } from '../lib/tipos'
import { fmtData, fmtDecimal, fmtDiaSemana, fmtInt } from '../lib/formato'
import { Carregando, Erro } from '../components/comuns'

type Resumo = {
  email: string
  cenarios: {
    id: number
    nome: string
    tipo: TipoCenario
    oficial: boolean
    periodos: number
    pico: number | null
    picoPeriodo: string | null
    horas: number
    diagnosticos: number
    correcoesLigadas: number
    semDiasUteis: number
    /** Semana do mês que contém hoje. Null quando o cenário não é do mês corrente. */
    semanaVigente: {
      periodo: string
      operadores: number | null
      horas: number
      erro: string | null
    } | null
  }[]
  totalCenarios: number
  cadastro: { sku: number; produto: number; processo: number; mapeamentos: number; feriados: number }
  demanda: {
    total: number
    feitas: number
    sem_tempo: number
    horas: number
    de: string | null
    ate: string | null
  }
  proximosDias: { data: string; processos: number; horas: number }[]
  skuSemRoteiro: string[]
  ultimaImportacao: { quando: string; quem: string } | null
}

function saudacao() {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

function primeiroNome(email: string) {
  const usuario = email.split('@')[0]
  return usuario.charAt(0).toUpperCase() + usuario.slice(1)
}

export function Inicio() {
  const { dados, erro, carregando } = useApi<Resumo>('resumo')

  const hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  // O Semanal é a única tela de planejamento; o mensal só carrega o calendário do mês.
  const semanal = (dados?.cenarios ?? []).find((c) => c.tipo === 'semanal')

  // O número do card é o da semana vigente. Só cai no pico do mês quando o cenário em uso
  // não é do mês corrente — aí não existe "semana vigente" para mostrar.
  const operadores = semanal?.semanaVigente
    ? semanal.semanaVigente.operadores
    : semanal?.pico ?? null

  const pendentes = dados ? dados.demanda.total - dados.demanda.feitas : 0
  const cargaMax = Math.max(1, ...(dados?.proximosDias ?? []).map((d) => d.horas))

  return (
    <>
      <header className="mb-7">
        <h1 className="text-2xl font-heading font-bold tracking-tight">
          {saudacao()}
          {dados ? `, ${primeiroNome(dados.email)}` : ''}
        </h1>
        <p className="page-subtitle capitalize">{hoje}</p>
      </header>

      <Erro mensagem={erro} />

      {carregando && !dados ? (
        <Carregando linhas={8} />
      ) : !dados ? null : (
        <div className="space-y-5">
          {/* ---------------- headcount do cenário semanal ---------------- */}
          <section className="panel overflow-hidden">
            <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
              <h2 className="font-heading font-semibold text-sm">Headcount necessário</h2>
              <span className="label-overline">
                {dados.totalCenarios} cenário(s) ·{' '}
                {semanal?.semanaVigente ? 'semana vigente' : 'pico do semanal'}
              </span>
            </header>

            {!semanal ? (
              <p className="px-4 py-8 text-sm text-slate-500 text-center">
                Nenhum cenário semanal ainda — rode a importação.
              </p>
            ) : (
              <Link
                to="/semanal"
                className="block px-5 py-4 hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center gap-2 mb-2">
                  <LayoutGrid size={14} className="text-slate-400" strokeWidth={1.75} />
                  <span className="label-overline">Semanal</span>
                  {semanal.oficial && <span className="chip-ok">oficial</span>}
                  <ArrowUpRight
                    size={13}
                    className="ml-auto text-slate-300 group-hover:text-primary-700 transition-colors"
                  />
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-heading font-bold tabular-nums">
                    {operadores === null ? '—' : fmtInt(operadores)}
                  </span>
                  <span className="text-sm text-slate-500">operadores</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {semanal.semanaVigente ? (
                    <>
                      esta semana · {semanal.semanaVigente.periodo} ·{' '}
                      {semanal.semanaVigente.erro
                        ? 'sem dias úteis'
                        : `${fmtDecimal(semanal.semanaVigente.horas)} h na semana`}
                    </>
                  ) : (
                    <>
                      no pico{semanal.picoPeriodo ? ` · ${semanal.picoPeriodo}` : ''} ·{' '}
                      {fmtDecimal(semanal.horas)} h no total
                    </>
                  )}
                </p>

                <div className="flex flex-wrap gap-1.5 mt-3">
                  {semanal.correcoesLigadas > 0 && (
                    <span className="chip">{semanal.correcoesLigadas} correção(ões)</span>
                  )}
                  {semanal.semDiasUteis > 0 && (
                    <span className="chip-danger">{semanal.semDiasUteis} sem dias úteis</span>
                  )}
                </div>
              </Link>
            )}
          </section>

          {/* ---------------- carga dos próximos dias + pendências ---------------- */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <section className="panel overflow-hidden lg:col-span-2">
              <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
                <h2 className="font-heading font-semibold text-sm">
                  Carga dos próximos dias
                </h2>
                <Link to="/demandas" className="label-overline hover:text-primary-700">
                  lista de demanda →
                </Link>
              </header>

              {dados.proximosDias.length === 0 ? (
                <p className="px-4 py-8 text-sm text-slate-500 text-center">
                  Nada pendente. Gere a demanda no{' '}
                  <Link to="/calendario" className="text-primary-700 underline">
                    calendário
                  </Link>
                  .
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {dados.proximosDias.map((d) => (
                    <li key={d.data} className="px-4 py-2.5 flex items-center gap-4">
                      <div className="w-28 shrink-0">
                        <div className="text-sm font-medium">{fmtData(d.data)}</div>
                        <div className="label-overline">{fmtDiaSemana(d.data)}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary-600"
                            style={{ width: `${Math.max(3, (d.horas / cargaMax) * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div className="w-32 shrink-0 text-right">
                        <span className="text-sm font-medium tabular-nums">
                          {fmtDecimal(d.horas)} h
                        </span>
                        <span className="text-xs text-slate-500 ml-2 tabular-nums">
                          {fmtInt(d.processos)} proc.
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel overflow-hidden">
              <header className="px-4 py-3 border-b border-slate-200">
                <h2 className="font-heading font-semibold text-sm">Pendências</h2>
              </header>
              <ul className="divide-y divide-slate-100">
                <Pendencia
                  rotulo="Processos a fazer"
                  valor={fmtInt(pendentes)}
                  detalhe={`de ${fmtInt(dados.demanda.total)} na lista`}
                  para="/demandas"
                  tom={pendentes > 0 ? 'neutro' : 'ok'}
                />
                <Pendencia
                  rotulo="SKU sem roteiro"
                  valor={fmtInt(dados.skuSemRoteiro.length)}
                  detalhe={
                    dados.skuSemRoteiro.length > 0
                      ? dados.skuSemRoteiro.slice(0, 4).join(', ') +
                        (dados.skuSemRoteiro.length > 4 ? '…' : '')
                      : 'toda a grade gera demanda'
                  }
                  para="/sku"
                  tom={dados.skuSemRoteiro.length > 0 ? 'atencao' : 'ok'}
                />
                <Pendencia
                  rotulo="Sem tempo estimado"
                  valor={fmtInt(dados.demanda.sem_tempo)}
                  detalhe="processo sem Pç/hr cadastrado"
                  para="/roteiros"
                  tom={dados.demanda.sem_tempo > 0 ? 'atencao' : 'ok'}
                />
                <Pendencia
                  rotulo="Feriados cadastrados"
                  valor={fmtInt(dados.cadastro.feriados)}
                  detalhe="usados no cálculo de dias úteis"
                  para="/calendario"
                  tom="neutro"
                />
              </ul>
            </section>
          </div>

          {/* ---------------- cadastro ---------------- */}
          <section className="panel overflow-hidden">
            <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
              <h2 className="font-heading font-semibold text-sm">Cadastro</h2>
              {dados.ultimaImportacao && (
                <span className="label-overline">
                  importado {new Date(dados.ultimaImportacao.quando).toLocaleDateString('pt-BR')} por{' '}
                  {dados.ultimaImportacao.quem}
                </span>
              )}
            </header>
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-200">
              <Cadastro rotulo="SKU" valor={dados.cadastro.sku} para="/sku" Icone={Database} />
              <Cadastro
                rotulo="Processos"
                valor={dados.cadastro.processo}
                para="/roteiros"
                Icone={ListTree}
              />
              <Cadastro
                rotulo="Mapeamentos SKU → produto"
                valor={dados.cadastro.mapeamentos}
                para="/sku"
                Icone={ClipboardList}
              />
              <Cadastro
                rotulo="Produtos"
                valor={dados.cadastro.produto}
                para="/roteiros"
                Icone={Users}
              />
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            <Link to="/calendario" className="btn-primary">
              <CalendarRange size={15} /> Montar o calendário
            </Link>
            <Link to="/operadores" className="btn-ghost">
              <Users size={15} /> Ver ocupação dos operadores
            </Link>
          </div>
        </div>
      )}
    </>
  )
}

function Pendencia({
  rotulo,
  valor,
  detalhe,
  para,
  tom,
}: {
  rotulo: string
  valor: string
  detalhe: string
  para: string
  tom: 'ok' | 'atencao' | 'neutro'
}) {
  return (
    <li>
      <Link to={para} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
        <div className="min-w-0 flex-1">
          <div className="text-sm">{rotulo}</div>
          <div className="text-xs text-slate-500 truncate" title={detalhe}>
            {detalhe}
          </div>
        </div>
        <span
          className={`text-lg font-heading font-semibold tabular-nums ${
            tom === 'atencao' ? 'text-amber-700' : tom === 'ok' ? 'text-emerald-700' : ''
          }`}
        >
          {valor}
        </span>
      </Link>
    </li>
  )
}

function Cadastro({
  rotulo,
  valor,
  para,
  Icone,
}: {
  rotulo: string
  valor: number
  para: string
  Icone: typeof Database
}) {
  return (
    <Link to={para} className="px-5 py-4 hover:bg-slate-50 transition-colors">
      <div className="flex items-center gap-2 mb-1">
        <Icone size={13} className="text-slate-400" strokeWidth={1.75} />
        <span className="label-overline truncate">{rotulo}</span>
      </div>
      <div className="text-xl font-heading font-semibold tabular-nums">{fmtInt(valor)}</div>
    </Link>
  )
}
