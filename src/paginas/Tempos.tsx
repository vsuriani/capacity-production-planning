import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, ShieldCheck } from 'lucide-react'
import { useApi } from '../lib/hooks'
import { fmtDecimal, fmtInt } from '../lib/formato'
import { apiPost } from '../lib/api'
import { Carregando, Erro } from '../components/comuns'

type Tempo = {
  deviceModel: string
  dispositivoId: number
  dispositivo: string
  total: number
  defasagem: number
  industrializacao: number
  producao: number
  atividades: number
}

type Diff = {
  dispositivoId: number
  dispositivo: string
  deviceModel: string
  atual: number
  planilha: number
  delta: number
  percentual: number | null
}

type Pendencia = {
  tipo: string
  mensagem: string
  itens: Record<string, unknown>[]
}

type Sync = {
  id: number
  quando: string
  linhas: number
  origem: string
  erro: string | null
  aplicado: boolean
  alteracoes: { dispositivo: string; campo: string; de: number; para: number }[] | null
}

type Resposta = {
  configurado: boolean
  ultimoSync: Sync | null
  historico: Sync[]
  tempos: Tempo[]
  diff: Diff[]
  pendencias: Pendencia[]
  resumo: {
    lidas: number
    usadas: number
    descartadas: { obsoleta: number; semDeviceModel: number; semGoal: number; rollup: number }
    deviceModels: number
    dispositivos: number
  }
  dispositivos: { id: number; nome: string; metaPadrao: number }[]
}

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

/**
 * Tempos vindos da planilha "Análises Best Laps".
 *
 * O produto principal desta tela é o DIFF: o que o sync mudou no cadastro, de quanto, e para
 * qual dispositivo. Um tempo que muda sozinho sem deixar rastro é o problema que este projeto
 * inteiro existe para matar — daí o histórico logo abaixo.
 */
export function Tempos() {
  const { dados, erro, carregando, recarregar } = useApi<Resposta>('tempos')
  const [sincronizando, setSincronizando] = useState(false)
  const [erroSync, setErroSync] = useState<string | null>(null)

  async function sincronizar() {
    setSincronizando(true)
    setErroSync(null)
    try {
      await apiPost('tempos?acao=sync')
      recarregar()
    } catch (e) {
      setErroSync((e as Error).message)
    } finally {
      setSincronizando(false)
    }
  }

  if (carregando) return <Carregando />

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tempos</h1>
          <p className="page-subtitle">
            Tempo-padrão por dispositivo, lido da planilha Análises Best Laps.
          </p>
        </div>
        <button className="btn-primary" onClick={sincronizar} disabled={sincronizando}>
          <RefreshCw size={14} className={sincronizando ? 'animate-spin' : ''} />
          {sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}
        </button>
      </div>

      <Erro mensagem={erro ?? erroSync} />

      <div className="space-y-6">
        <section className="panel border-emerald-200 bg-emerald-50/50 px-4 py-3 flex items-start gap-2">
          <ShieldCheck size={16} className="text-emerald-700 mt-0.5 shrink-0" />
          <div className="text-sm text-emerald-900">
            <strong>A planilha é somente leitura.</strong> O sync usa escopo{' '}
            <span className="data-code">spreadsheets.readonly</span>. O tempo usado é a coluna{' '}
            <span className="data-code">goal</span>, em minuto-operador por peça; a eficiência
            continua no app, em <span className="data-code">coef_eficiencia</span>.
          </div>
        </section>

        {dados && !dados.configurado && (
          <section className="panel border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-700 mt-0.5 shrink-0" />
            <div className="text-sm text-amber-900">
              <strong>Sync desarmado neste ambiente.</strong> Faltam{' '}
              <span className="data-code">TEMPOS_SHEET_ID</span> e/ou{' '}
              <span className="data-code">GOOGLE_SA_JSON</span>. A tela mostra o último snapshot
              gravado.
            </div>
          </section>
        )}

        {dados?.ultimoSync && (
          <section className="panel px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5 text-slate-600">
              <Clock size={14} />
              última leitura <strong>{quando(dados.ultimoSync.quando)}</strong>
            </span>
            <span className="text-slate-600">
              {fmtInt(dados.resumo.lidas)} linhas lidas, {fmtInt(dados.resumo.usadas)} usadas
              {dados.resumo.descartadas.rollup > 0 &&
                ` (${fmtInt(dados.resumo.descartadas.rollup)} de rollup fora da soma)`}
            </span>
            <span className="text-slate-600">
              {fmtInt(dados.resumo.dispositivos)} dispositivos cobertos
            </span>
          </section>
        )}

        {/* ---------------------------------------------------------------- diff */}

        <section className="panel">
          <header className="px-4 py-3 border-b border-slate-200">
            <h2 className="font-heading font-semibold text-sm">
              O que a planilha muda no cadastro
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Só o cadastro (<span className="data-code">meta_padrao</span>) muda sozinho. Cenário
              em andamento só muda por ação explícita, em /cenarios.
            </p>
          </header>

          {dados?.diff.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500 flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600" />
              O cadastro já está igual à planilha.
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="th">Dispositivo</th>
                  <th className="th">Device model</th>
                  <th className="th text-right">Em uso</th>
                  <th className="th text-right">Planilha</th>
                  <th className="th text-right">Delta</th>
                </tr>
              </thead>
              <tbody>
                {dados?.diff.map((d) => (
                  <tr key={d.dispositivoId}>
                    <td className="td font-medium">{d.dispositivo}</td>
                    <td className="td text-slate-500">{d.deviceModel}</td>
                    <td className="td-num">{fmtDecimal(d.atual)}</td>
                    <td className="td-num font-medium">
                      {fmtDecimal(d.planilha)}
                    </td>
                    <td
                      className={`td-num ${
                        d.delta > 0 ? 'text-amber-700' : 'text-primary-700'
                      }`}
                    >
                      {d.delta > 0 ? '+' : ''}
                      {fmtDecimal(d.delta)}
                      {d.percentual !== null && (
                        <span className="text-xs text-slate-400 ml-1">
                          ({d.percentual > 0 ? '+' : ''}
                          {(d.percentual * 100).toFixed(0)}%)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ---------------------------------------------------------------- tempos */}

        <section className="panel">
          <header className="px-4 py-3 border-b border-slate-200">
            <h2 className="font-heading font-semibold text-sm">Tempo por dispositivo</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              O total é a soma dos processos do device model. A linha “Processo de montar completo”
              fica <strong>fora</strong> — ela é um rollup do que as outras já detalham. Defasagem,
              industrialização e produção são recortes dentro do total.
            </p>
          </header>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="th">Dispositivo</th>
                <th className="th">Device model</th>
                <th className="th text-right">Total</th>
                <th className="th text-right">Defasagem</th>
                <th className="th text-right">Industrialização</th>
                <th className="th text-right">Produção</th>
                <th className="th text-right">Atividades</th>
              </tr>
            </thead>
            <tbody>
              {dados?.tempos.map((t) => (
                <tr key={t.dispositivoId}>
                  <td className="td font-medium">{t.dispositivo}</td>
                  <td className="td text-slate-500">{t.deviceModel}</td>
                  <td className="td-num font-medium">{fmtDecimal(t.total)}</td>
                  <td className="td-num text-slate-600">
                    {t.defasagem > 0 ? fmtDecimal(t.defasagem) : '—'}
                  </td>
                  <td className="td-num text-slate-600">
                    {t.industrializacao > 0 ? fmtDecimal(t.industrializacao) : '—'}
                  </td>
                  <td className="td-num text-slate-600">
                    {t.producao > 0 ? fmtDecimal(t.producao) : '—'}
                  </td>
                  <td className="td-num text-slate-400">{t.atividades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ---------------------------------------------------------------- pendências */}

        {dados && dados.pendencias.length > 0 && (
          <section className="panel border-amber-200">
            <header className="px-4 py-3 border-b border-amber-200 bg-amber-50/50 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-700" />
              <h2 className="font-heading font-semibold text-sm text-amber-900">
                Pendências ({dados.pendencias.length})
              </h2>
            </header>
            <div className="divide-y divide-slate-100">
              {dados.pendencias.map((p) => (
                <details key={p.tipo} className="px-4 py-3">
                  <summary className="text-sm cursor-pointer">
                    <span className="data-code mr-2">{p.tipo}</span>
                    {p.mensagem}
                  </summary>
                  <ul className="mt-2 ml-4 text-xs text-slate-600 space-y-1">
                    {p.itens.map((item, i) => (
                      <li key={i} className="tabular-nums">
                        {Object.entries(item)
                          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' / ') : v}`)
                          .join(' · ')}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* ---------------------------------------------------------------- histórico */}

        <section className="panel">
          <header className="px-4 py-3 border-b border-slate-200">
            <h2 className="font-heading font-semibold text-sm">Histórico de leituras</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              É o que responde “por que o número de terça era outro”.
            </p>
          </header>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="th">Quando</th>
                <th className="th">Origem</th>
                <th className="th text-right">Linhas</th>
                <th className="th">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {dados?.historico.map((s) => (
                <tr key={s.id}>
                  <td className="td tabular-nums">{quando(s.quando)}</td>
                  <td className="td text-slate-500">{s.origem}</td>
                  <td className="td-num">{s.erro ? '—' : fmtInt(s.linhas)}</td>
                  <td className="td">
                    {s.erro ? (
                      <span className="text-red-700">{s.erro}</span>
                    ) : s.alteracoes && s.alteracoes.length > 0 ? (
                      <span className="text-slate-600">
                        {s.alteracoes.length} alteração(ões):{' '}
                        {s.alteracoes
                          .slice(0, 3)
                          .map((a) => `${a.dispositivo} ${fmtDecimal(a.de)}→${fmtDecimal(a.para)}`)
                          .join(', ')}
                        {s.alteracoes.length > 3 && ` +${s.alteracoes.length - 3}`}
                      </span>
                    ) : (
                      <span className="text-slate-400">sem mudança</span>
                    )}
                  </td>
                </tr>
              ))}
              {dados?.historico.length === 0 && (
                <tr>
                  <td colSpan={4} className="td text-slate-500 py-6 text-center">
                    Nenhuma leitura ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </>
  )
}
