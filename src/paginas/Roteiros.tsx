import { useMemo, useState } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { apiDelete, apiPatch } from '../lib/api'
import { useApi } from '../lib/hooks'
import { fmtInt } from '../lib/formato'
import { ROTULO_TIPO_LINHA, type Processo, type TipoLinha } from '../lib/tipos'
import { Carregando, CelulaNumero, Erro } from '../components/comuns'

type Dados = {
  produtos: { id: number; nome: string; ativo: boolean }[]
  processos: Processo[]
  aliases: { produto_id: number; alias: string }[]
  produtosSemRoteiro: { id: number; nome: string }[]
}

const ORDEM_TIPO: TipoLinha[] = ['defasagem', 'industrializacao', 'producao_montagem']

/** Processos e sequências (aba Base simplificada), editável. */
export function Roteiros() {
  const { dados, erro, carregando, recarregar } = useApi<Dados>('roteiros')
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')
  const [tipoFiltro, setTipoFiltro] = useState<TipoLinha | ''>('')

  const visiveis = useMemo(() => {
    const termo = filtro.trim().toLowerCase()
    return (dados?.processos ?? []).filter(
      (p) =>
        (!tipoFiltro || p.tipo_linha === tipoFiltro) &&
        (!termo ||
          p.produto.toLowerCase().includes(termo) ||
          p.nome.toLowerCase().includes(termo) ||
          (p.sku_filho ?? '').toLowerCase().includes(termo)),
    )
  }, [dados, filtro, tipoFiltro])

  const porProduto = useMemo(() => {
    const mapa = new Map<string, Processo[]>()
    for (const p of visiveis) {
      if (!mapa.has(p.produto)) mapa.set(p.produto, [])
      mapa.get(p.produto)!.push(p)
    }
    for (const lista of mapa.values()) {
      lista.sort(
        (a, b) =>
          ORDEM_TIPO.indexOf(a.tipo_linha) - ORDEM_TIPO.indexOf(b.tipo_linha) ||
          (a.sequencia ?? 99) - (b.sequencia ?? 99),
      )
    }
    return mapa
  }, [visiveis])

  async function salvar(id: number, campo: string, valor: unknown) {
    setErroSalvar(null)
    try {
      await apiPatch(`roteiros?id=${id}`, { [campo]: valor })
      recarregar()
    } catch (e) {
      setErroSalvar((e as Error).message)
    }
  }

  async function remover(id: number, nome: string) {
    if (!confirm(`Remover o processo "${nome}"?`)) return
    try {
      await apiDelete(`roteiros?id=${id}`)
      recarregar()
    } catch (e) {
      setErroSalvar((e as Error).message)
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Processos e sequências</h1>
          <p className="page-subtitle">
            Equivale à aba Base simplificada. É o roteiro que a explosão de demanda usa.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input-field w-auto"
            value={tipoFiltro}
            onChange={(e) => setTipoFiltro(e.target.value as TipoLinha | '')}
          >
            <option value="">todos os tipos</option>
            {ORDEM_TIPO.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO_LINHA[t]}
              </option>
            ))}
          </select>
          <input
            className="input-field w-56"
            placeholder="produto, processo ou SKU…"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
          />
        </div>
      </div>

      <Erro mensagem={erro ?? erroSalvar} />

      {carregando && !dados ? (
        <Carregando />
      ) : !dados ? (
        <div className="empty-state">Nenhum roteiro — importe a planilha primeiro.</div>
      ) : (
        <div className="space-y-6">
          {(dados.produtosSemRoteiro.length > 0 || dados.aliases.length > 0) && (
            <section className="panel border-amber-200 bg-amber-50/60 px-4 py-3 space-y-2">
              {dados.produtosSemRoteiro.length > 0 && (
                <div className="flex items-start gap-2 text-sm text-amber-900">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <p>
                    <strong>{dados.produtosSemRoteiro.length} produto(s) sem nenhum processo</strong>{' '}
                    mas com SKU mapeado — a demanda deles não gera linha nenhuma:{' '}
                    {dados.produtosSemRoteiro.map((p) => p.nome).join(', ')}.
                  </p>
                </div>
              )}
              {dados.aliases.length > 0 && (
                <div className="flex items-start gap-2 text-sm text-amber-900">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <p>
                    <strong>{dados.aliases.length} grafia(s) alternativa(s)</strong> preservadas da
                    planilha (nome com espaço sobrando conta como outro produto lá):{' '}
                    {dados.aliases.map((a) => `"${a.alias}"`).join(', ')}.
                  </p>
                </div>
              )}
            </section>
          )}

          <section className="panel overflow-hidden">
            <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h2 className="font-heading font-semibold text-sm">
                {visiveis.length} processo(s) em {porProduto.size} produto(s)
              </h2>
              <span className="text-xs text-slate-500">
                Leadtime em dias regressivos até a produção
              </span>
            </header>

            <div className="overflow-auto max-h-[72vh]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="th">Processo</th>
                    <th className="th">Tipo de linha</th>
                    <th className="th text-right">Seq.</th>
                    <th className="th text-right">Paralelismo</th>
                    <th className="th text-right">Leadtime</th>
                    <th className="th text-right">Operadores</th>
                    <th className="th text-right">Pç/hr</th>
                    <th className="th text-right">Total/dia</th>
                    <th className="th">Produto filho</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody>
                  {[...porProduto.entries()].map(([produto, lista]) => (
                    <>
                      <tr key={`p-${produto}`} className="bg-slate-50">
                        <td className="td font-semibold" colSpan={10}>
                          {produto}{' '}
                          <span className="text-slate-500 font-normal">
                            · {lista.length} processo(s)
                          </span>
                        </td>
                      </tr>
                      {lista.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/60">
                          <td className="td pl-6">{p.nome}</td>
                          <td className="td">
                            <span className="chip">{ROTULO_TIPO_LINHA[p.tipo_linha]}</span>
                          </td>
                          <td className="td-num p-0">
                            <CelulaNumero
                              valor={p.sequencia}
                              decimais={0}
                              onConfirmar={(v) => salvar(p.id, 'sequencia', v)}
                            />
                          </td>
                          <td className="td-num p-0">
                            <CelulaNumero
                              valor={p.paralelismo === null ? null : Number(p.paralelismo)}
                              onConfirmar={(v) => salvar(p.id, 'paralelismo', v)}
                            />
                          </td>
                          <td className="td-num p-0">
                            <CelulaNumero
                              valor={p.leadtime_dias}
                              decimais={0}
                              onConfirmar={(v) => salvar(p.id, 'leadtimeDias', v)}
                            />
                          </td>
                          <td className="td-num p-0">
                            <CelulaNumero
                              valor={p.operadores === null ? null : Number(p.operadores)}
                              decimais={0}
                              onConfirmar={(v) => salvar(p.id, 'operadores', v)}
                            />
                          </td>
                          <td className={`td-num p-0 ${p.sem_taxa ? 'bg-amber-50' : ''}`}>
                            <CelulaNumero
                              valor={p.pcs_hora === null ? null : Number(p.pcs_hora)}
                              onConfirmar={(v) => salvar(p.id, 'pcsHora', v)}
                            />
                          </td>
                          <td className="td-num text-slate-500">
                            {p.pcs_hora === null
                              ? '—'
                              : fmtInt(Number(p.pcs_hora) * 8)}
                          </td>
                          <td className="td data-code">{p.sku_filho ?? '—'}</td>
                          <td className="td text-right">
                            <button
                              className="text-slate-400 hover:text-red-600"
                              onClick={() => remover(p.id, p.nome)}
                              title="Remover processo"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="px-4 py-2 border-t border-slate-200 text-xs text-slate-500">
              Total/dia é Pç/hr × 8 h. Na planilha esse valor é digitado em algumas linhas e
              calculado em outras — aqui ele é sempre derivado. Célula de Pç/hr em âmbar =
              sem taxa cadastrada, o que zera o tempo estimado.
            </footer>
          </section>
        </div>
      )}
    </>
  )
}
