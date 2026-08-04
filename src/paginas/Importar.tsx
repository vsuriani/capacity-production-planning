import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { useApi } from '../lib/hooks'
import { fmtInt } from '../lib/formato'
import type { Desvio } from '../lib/tipos'
import { Carregando, Erro } from '../components/comuns'

type Importacao = {
  id: number
  quando: string
  quem: string
  planilha: string
  contagens: Record<string, number>
  avisos: { tipo: string; [k: string]: unknown }[]
}

/**
 * Importação e catálogo de desvios.
 *
 * A importação roda por script, com credencial de LEITURA. O app nunca escreve na
 * planilha — nem aqui, nem em nenhuma outra tela.
 */
export function Importar() {
  const { dados, erro, carregando } = useApi<{ importacoes: Importacao[] }>('importacao')
  const { dados: catalogo } = useApi<{ desvios: Desvio[] }>('desvios')

  const ultima = dados?.importacoes[0]

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Importação</h1>
          <p className="page-subtitle">
            Carga inicial a partir da planilha. Depois dela, o app é a fonte da verdade.
          </p>
        </div>
      </div>

      <Erro mensagem={erro} />

      <div className="space-y-6">
        <section className="panel border-emerald-200 bg-emerald-50/50 px-4 py-3 flex items-start gap-2">
          <ShieldCheck size={16} className="text-emerald-700 mt-0.5 shrink-0" />
          <div className="text-sm text-emerald-900">
            <strong>A planilha é somente leitura.</strong> O importador usa escopo{' '}
            <span className="data-code">spreadsheets.readonly</span> e não existe nenhuma rota
            neste app que escreva no Google Sheets.
          </div>
        </section>

        <section className="panel px-4 py-4">
          <h2 className="font-heading font-semibold text-sm mb-2">Como rodar</h2>
          <pre className="bg-slate-900 text-slate-100 rounded-md p-3 text-xs overflow-x-auto">
{`export GOOGLE_APPLICATION_CREDENTIALS=~/.secrets/tractian-bi-operations-dashboard.json

python scripts/importar_planilha.py --dry-run   # confere o que seria importado
python scripts/importar_planilha.py             # importa de verdade`}
          </pre>
          <p className="text-xs text-slate-500 mt-2">
            A importação é idempotente: rodar de novo atualiza os cadastros e reescreve os
            cenários importados, sem duplicar nada.
          </p>
        </section>

        {carregando && !dados ? (
          <Carregando linhas={3} />
        ) : !ultima ? (
          <div className="empty-state">
            Nenhuma importação registrada ainda — rode o script acima.
          </div>
        ) : (
          <section className="panel overflow-hidden">
            <header className="px-4 py-3 border-b border-slate-200">
              <h2 className="font-heading font-semibold text-sm">Histórico</h2>
            </header>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="th">Quando</th>
                  <th className="th">Quem</th>
                  <th className="th">Contagens</th>
                  <th className="th">Avisos</th>
                </tr>
              </thead>
              <tbody>
                {dados!.importacoes.map((imp) => {
                  const porTipo = imp.avisos.reduce<Record<string, number>>((acc, a) => {
                    acc[a.tipo] = (acc[a.tipo] ?? 0) + 1
                    return acc
                  }, {})
                  return (
                    <tr key={imp.id} className="hover:bg-slate-50/60">
                      <td className="td whitespace-nowrap">
                        {new Date(imp.quando).toLocaleString('pt-BR')}
                      </td>
                      <td className="td text-slate-600">{imp.quem}</td>
                      <td className="td">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(imp.contagens).map(([k, v]) => (
                            <span key={k} className="chip">
                              {k}: {fmtInt(v)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="td">
                        {Object.keys(porTipo).length === 0 ? (
                          <span className="chip-ok">nenhum</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(porTipo).map(([k, v]) => (
                              <span key={k} className="chip-warn">
                                {k}: {v}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )}

        {catalogo && (
          <section className="panel overflow-hidden">
            <header className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
              <AlertTriangle size={15} className="text-amber-600" />
              <h2 className="font-heading font-semibold text-sm">
                Catálogo de divergências conhecidas ({catalogo.desvios.length})
              </h2>
            </header>
            <p className="px-4 py-2 text-xs text-slate-500 border-b border-slate-100">
              O app reproduz cada uma delas por padrão. Ligar a correção é escolha por cenário,
              nas telas de planejamento.
            </p>
            <ul className="divide-y divide-slate-100">
              {catalogo.desvios.map((d) => (
                <li key={d.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{d.titulo}</span>
                    <span className="chip data-code">{d.id}</span>
                    <span className="chip">{d.aba}</span>
                  </div>
                  <p className="text-sm text-slate-600 mt-1">{d.planilha}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    <strong>Impacto:</strong> {d.impacto}
                  </p>
                  <p className="text-xs text-slate-500">
                    <strong>Se corrigido:</strong> {d.correcao}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  )
}
