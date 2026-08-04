import { useMemo, useState } from 'react'
import { AlertTriangle, Copy, Trash2 } from 'lucide-react'
import { apiDelete, apiPost } from '../lib/api'
import { useApi } from '../lib/hooks'
import { fmtInt } from '../lib/formato'
import { Carregando, Erro, Kpi } from '../components/comuns'

type Dados = {
  itens: { codigo: string; descricao: string; grupo_item: string | null; ncm: string | null; ativo: boolean }[]
  total: number
  mapeamentos: {
    sku_codigo: string
    produto_id: number
    produto: string
    escopo: 'producao' | 'industrializacao'
    so_no_codigo_morto: boolean
    processos: number
  }[]
  pendencias: { sku_codigo: string; bloco: string; quantidade: string; motivo: string }[]
  ambiguos: { sku_codigo: string; escopo: string; produtos: string[] }[]
}

/** Base de PROD: catálogo de SKU e o mapa SKU → produto que a explosão usa. */
export function Sku() {
  const [busca, setBusca] = useState('')
  const { dados, erro, carregando, recarregar } = useApi<Dados>(
    `sku${busca.trim() ? `?busca=${encodeURIComponent(busca.trim())}` : ''}`,
  )
  const { dados: roteiros } = useApi<{ produtos: { id: number; nome: string }[] }>('roteiros')
  const [erroAcao, setErroAcao] = useState<string | null>(null)

  const mapaPorSku = useMemo(() => {
    const mapa = new Map<string, Dados['mapeamentos']>()
    for (const m of dados?.mapeamentos ?? []) {
      if (!mapa.has(m.sku_codigo)) mapa.set(m.sku_codigo, [])
      mapa.get(m.sku_codigo)!.push(m)
    }
    return mapa
  }, [dados])

  async function mapear(skuCodigo: string, produtoId: number, escopo: string) {
    setErroAcao(null)
    try {
      await apiPost('sku?acao=mapear', { skuCodigo, produtoId, escopo })
      recarregar()
    } catch (e) {
      setErroAcao((e as Error).message)
    }
  }

  async function desmapear(skuCodigo: string, produtoId: number, escopo: string) {
    setErroAcao(null)
    try {
      await apiDelete(
        `sku?acao=mapear&skuCodigo=${encodeURIComponent(skuCodigo)}&produtoId=${produtoId}&escopo=${escopo}`,
      )
      recarregar()
    } catch (e) {
      setErroAcao((e as Error).message)
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Base de PROD</h1>
          <p className="page-subtitle">
            Catálogo de itens do SAP e o mapa SKU → produto. É esse mapa que decide qual
            roteiro a demanda de um código vai seguir.
          </p>
        </div>
        <input
          className="input-field w-72"
          placeholder="buscar código ou descrição…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      <Erro mensagem={erro ?? erroAcao} />

      {carregando && !dados ? (
        <Carregando />
      ) : !dados ? (
        <div className="empty-state">Catálogo vazio — importe a planilha primeiro.</div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi rotulo="SKU no catálogo" valor={fmtInt(dados.total)} />
            <Kpi rotulo="Mapeamentos" valor={fmtInt(dados.mapeamentos.length)} />
            <Kpi
              rotulo="SKU sem roteiro na grade"
              valor={fmtInt(dados.pendencias.length)}
              tom={dados.pendencias.length > 0 ? 'alerta' : 'normal'}
              detalhe="demanda que não gera linha"
            />
            <Kpi
              rotulo="SKU em dois produtos"
              valor={fmtInt(dados.ambiguos.length)}
              tom={dados.ambiguos.length > 0 ? 'alerta' : 'normal'}
              detalhe="geram linha duplicada"
            />
          </div>

          {dados.pendencias.length > 0 && (
            <section className="panel border-amber-200 overflow-hidden">
              <header className="px-4 py-3 border-b border-amber-200 bg-amber-50 flex items-center gap-2">
                <AlertTriangle size={15} className="text-amber-700" />
                <h2 className="font-heading font-semibold text-sm text-amber-900">
                  SKU na grade que não geram demanda
                </h2>
              </header>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="th">SKU</th>
                    <th className="th">Bloco</th>
                    <th className="th text-right">Qtd na grade</th>
                    <th className="th">Motivo</th>
                    <th className="th">Mapear para</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.pendencias.map((p) => (
                    <tr key={`${p.sku_codigo}-${p.bloco}`} className="hover:bg-slate-50/60">
                      <td className="td data-code">{p.sku_codigo}</td>
                      <td className="td">
                        <span className="chip">{p.bloco}</span>
                      </td>
                      <td className="td-num">{fmtInt(p.quantidade)}</td>
                      <td className="td text-slate-600">{p.motivo}</td>
                      <td className="td">
                        <select
                          className="input-field w-56 py-1"
                          defaultValue=""
                          onChange={(e) => {
                            if (!e.target.value) return
                            mapear(
                              p.sku_codigo,
                              Number(e.target.value),
                              p.bloco === 'industrializacao' ? 'industrializacao' : 'producao',
                            )
                          }}
                        >
                          <option value="">escolher produto…</option>
                          {(roteiros?.produtos ?? []).map((pr) => (
                            <option key={pr.id} value={pr.id}>
                              {pr.nome}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {dados.ambiguos.length > 0 && (
            <section className="panel border-amber-200 px-4 py-3">
              <div className="flex items-start gap-2 text-sm text-amber-900">
                <Copy size={15} className="mt-0.5 shrink-0" />
                <p>
                  <strong>{dados.ambiguos.length} SKU mapeado(s) para mais de um produto.</strong>{' '}
                  Em modo fiel isso gera as linhas dos dois roteiros, como na planilha:{' '}
                  {dados.ambiguos
                    .map((a) => `${a.sku_codigo} (${a.produtos.join(' + ')})`)
                    .join(' · ')}
                  .
                </p>
              </div>
            </section>
          )}

          <section className="panel overflow-hidden">
            <header className="px-4 py-3 border-b border-slate-200">
              <h2 className="font-heading font-semibold text-sm">
                Catálogo {dados.itens.length < dados.total && `(${dados.itens.length} de ${dados.total})`}
              </h2>
            </header>
            <div className="overflow-auto max-h-[65vh]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="th">Código</th>
                    <th className="th">Descrição</th>
                    <th className="th">Grupo</th>
                    <th className="th">NCM</th>
                    <th className="th">Produto mapeado</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.itens.map((s) => (
                    <tr key={s.codigo} className="hover:bg-slate-50/60">
                      <td className="td data-code">{s.codigo}</td>
                      <td className="td max-w-md truncate" title={s.descricao}>
                        {s.descricao || <span className="text-slate-400">sem descrição</span>}
                      </td>
                      <td className="td text-slate-500 text-xs">{s.grupo_item ?? '—'}</td>
                      <td className="td data-code text-xs">{s.ncm ?? '—'}</td>
                      <td className="td">
                        <div className="flex flex-wrap gap-1">
                          {(mapaPorSku.get(s.codigo) ?? []).map((m) => (
                            <span
                              key={`${m.produto_id}-${m.escopo}`}
                              className={m.processos === 0 ? 'chip-warn' : 'chip'}
                              title={
                                `${m.escopo}${m.so_no_codigo_morto ? ' · só no Code.gs sobreposto' : ''}` +
                                (m.processos === 0 ? ' · produto sem roteiro' : '')
                              }
                            >
                              {m.produto}
                              <button
                                onClick={() => desmapear(s.codigo, m.produto_id, m.escopo)}
                                className="ml-1 hover:text-red-700"
                                title="Remover mapeamento"
                              >
                                <Trash2 size={10} />
                              </button>
                            </span>
                          ))}
                          {!mapaPorSku.has(s.codigo) && (
                            <span className="text-slate-400 text-xs">não mapeado</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
