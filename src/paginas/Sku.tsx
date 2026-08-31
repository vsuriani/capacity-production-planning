import { useMemo, useState } from 'react'
import { AlertTriangle, Copy, Plus, Trash2 } from 'lucide-react'
import { apiDelete, apiPatch, apiPost } from '../lib/api'
import { useApi } from '../lib/hooks'
import { fmtInt } from '../lib/formato'
import { Carregando, CelulaTexto, Erro, Kpi } from '../components/comuns'

type Escopo = 'producao' | 'industrializacao'

type Dados = {
  itens: { codigo: string; descricao: string; grupo_item: string | null; ncm: string | null; ativo: boolean }[]
  total: number
  mapeamentos: {
    sku_codigo: string
    produto_id: number
    produto: string
    escopo: Escopo
    so_no_codigo_morto: boolean
    processos: number
  }[]
  pendencias: { sku_codigo: string; bloco: string; quantidade: string; motivo: string }[]
  ambiguos: { sku_codigo: string; escopo: string; produtos: string[] }[]
}

const ROTULO_ESCOPO: Record<Escopo, string> = {
  producao: 'Produção',
  industrializacao: 'Industrialização',
}

const NOVO_VAZIO = {
  codigo: '',
  descricao: '',
  grupoItem: '',
  ncm: '',
  produtoId: '',
  escopo: 'producao' as Escopo,
}

/**
 * Base de PROD: catálogo de SKU e o mapa SKU → produto que a explosão usa.
 *
 * É cadastro de verdade — o código se cria aqui e toda coluna é editável, inclusive o próprio
 * código (a rota renomeia repontando grade, demanda, mapa e produto filho). Remover só é
 * possível enquanto ninguém aponta para ele; o vínculo se desfaz pelos chips.
 */
export function Sku() {
  const [busca, setBusca] = useState('')
  const { dados, erro, carregando, recarregar } = useApi<Dados>(
    `sku${busca.trim() ? `?busca=${encodeURIComponent(busca.trim())}` : ''}`,
  )
  const { dados: roteiros } = useApi<{ produtos: { id: number; nome: string }[] }>('roteiros')
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)
  const [novo, setNovo] = useState(NOVO_VAZIO)

  const produtos = useMemo(() => roteiros?.produtos ?? [], [roteiros])

  const mapaPorSku = useMemo(() => {
    const mapa = new Map<string, Dados['mapeamentos']>()
    for (const m of dados?.mapeamentos ?? []) {
      if (!mapa.has(m.sku_codigo)) mapa.set(m.sku_codigo, [])
      mapa.get(m.sku_codigo)!.push(m)
    }
    return mapa
  }, [dados])

  async function agir(fn: () => Promise<unknown>) {
    setErroAcao(null)
    try {
      await fn()
      recarregar()
    } catch (e) {
      setErroAcao((e as Error).message)
    }
  }

  const salvar = (codigo: string, mudancas: Record<string, unknown>) =>
    agir(() => apiPatch(`sku?codigo=${encodeURIComponent(codigo)}`, mudancas))

  const mapear = (skuCodigo: string, produtoId: number, escopo: Escopo) =>
    agir(() => apiPost('sku?acao=mapear', { skuCodigo, produtoId, escopo }))

  const desmapear = (skuCodigo: string, produtoId: number, escopo: Escopo) =>
    agir(() =>
      apiDelete(
        `sku?acao=mapear&skuCodigo=${encodeURIComponent(skuCodigo)}&produtoId=${produtoId}&escopo=${escopo}`,
      ),
    )

  /** O formulário fica aberto e só o código é limpo — cadastrar item costuma vir em lote. */
  async function criar() {
    if (!novo.codigo.trim()) {
      setErroAcao('Dê um código ao item.')
      return
    }
    await agir(async () => {
      await apiPost('sku', {
        codigo: novo.codigo,
        descricao: novo.descricao,
        grupoItem: novo.grupoItem,
        ncm: novo.ncm,
        produtoId: novo.produtoId ? Number(novo.produtoId) : null,
        escopo: novo.escopo,
      })
      setNovo({ ...novo, codigo: '', descricao: '' })
    })
  }

  async function remover(codigo: string) {
    if (!confirm(`Remover o código ${codigo} do catálogo?`)) return
    await agir(() => apiDelete(`sku?codigo=${encodeURIComponent(codigo)}`))
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
        <div className="flex items-center gap-2">
          <input
            className="input-field w-72"
            placeholder="buscar código ou descrição…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <button
            className="btn-primary"
            onClick={() => {
              setErroAcao(null)
              setNovo(NOVO_VAZIO)
              setCriando(!criando)
            }}
          >
            <Plus size={15} /> Novo código
          </button>
        </div>
      </div>

      <Erro mensagem={erro ?? erroAcao} />

      {criando && (
        <section className="panel px-4 py-4 mb-5">
          <h2 className="font-heading font-semibold text-sm mb-1">Novo código</h2>
          <p className="text-xs text-slate-500 mb-3">
            Só o código é obrigatório — o resto pode ser preenchido depois, direto na tabela. Ele
            é a chave do catálogo e casa por igualdade exata com a grade do calendário, então é
            gravado sem espaços e em maiúsculas. Sem produto mapeado, a demanda do código não
            gera linha nenhuma.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="label-overline">Código</span>
              <input
                className="input-field w-40 data-code"
                placeholder="ex.: PROD-0199"
                value={novo.codigo}
                onChange={(e) => setNovo({ ...novo, codigo: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && criar()}
              />
            </label>

            <label className="block flex-1 min-w-64">
              <span className="label-overline">Descrição</span>
              <input
                className="input-field"
                placeholder="descrição do item no SAP"
                value={novo.descricao}
                onChange={(e) => setNovo({ ...novo, descricao: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && criar()}
              />
            </label>

            <label className="block">
              <span className="label-overline">Grupo</span>
              <input
                className="input-field w-40"
                placeholder="—"
                value={novo.grupoItem}
                onChange={(e) => setNovo({ ...novo, grupoItem: e.target.value })}
              />
            </label>

            <label className="block">
              <span className="label-overline">NCM</span>
              <input
                className="input-field w-32 data-code"
                placeholder="—"
                value={novo.ncm}
                onChange={(e) => setNovo({ ...novo, ncm: e.target.value })}
              />
            </label>

            <label className="block">
              <span className="label-overline">Produto mapeado</span>
              <select
                className="input-field w-56"
                value={novo.produtoId}
                onChange={(e) => setNovo({ ...novo, produtoId: e.target.value })}
              >
                <option value="">— nenhum —</option>
                {produtos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="label-overline">Escopo</span>
              <select
                className="input-field w-44"
                value={novo.escopo}
                onChange={(e) => setNovo({ ...novo, escopo: e.target.value as Escopo })}
              >
                <option value="producao">{ROTULO_ESCOPO.producao}</option>
                <option value="industrializacao">{ROTULO_ESCOPO.industrializacao}</option>
              </select>
            </label>

            <button className="btn-primary" onClick={criar}>
              Criar código
            </button>
            <button className="btn-ghost" onClick={() => setCriando(false)}>
              Fechar
            </button>
          </div>
        </section>
      )}

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
                          {produtos.map((pr) => (
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
                    <th className="th" />
                  </tr>
                </thead>
                <tbody>
                  {dados.itens.map((s) => (
                    <tr key={s.codigo} className="hover:bg-slate-50/60">
                      <td className="td p-0 min-w-36">
                        <CelulaTexto
                          valor={s.codigo}
                          className="data-code"
                          onConfirmar={(v) => v && salvar(s.codigo, { codigo: v })}
                        />
                      </td>
                      <td className="td p-0 min-w-80">
                        <CelulaTexto
                          valor={s.descricao}
                          placeholder="sem descrição"
                          onConfirmar={(v) => salvar(s.codigo, { descricao: v })}
                        />
                      </td>
                      <td className="td p-0 min-w-32">
                        <CelulaTexto
                          valor={s.grupo_item}
                          placeholder="—"
                          onConfirmar={(v) => salvar(s.codigo, { grupoItem: v })}
                        />
                      </td>
                      <td className="td p-0 min-w-28">
                        <CelulaTexto
                          valor={s.ncm}
                          placeholder="—"
                          className="data-code"
                          onConfirmar={(v) => salvar(s.codigo, { ncm: v })}
                        />
                      </td>
                      <td className="td">
                        <div className="flex flex-wrap items-center gap-1">
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
                          <select
                            className="cell-input w-28 text-left text-xs"
                            value=""
                            title="Mapear para um produto"
                            onChange={(e) => {
                              if (!e.target.value) return
                              const [id, escopo] = e.target.value.split('|')
                              mapear(s.codigo, Number(id), escopo as Escopo)
                            }}
                          >
                            <option value="">+ mapear…</option>
                            {(['producao', 'industrializacao'] as Escopo[]).map((escopo) => (
                              <optgroup key={escopo} label={ROTULO_ESCOPO[escopo]}>
                                {produtos.map((p) => (
                                  <option key={p.id} value={`${p.id}|${escopo}`}>
                                    {p.nome}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="td text-right">
                        <button
                          className="text-slate-400 hover:text-red-600"
                          onClick={() => remover(s.codigo)}
                          title="Remover do catálogo"
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
              As células salvam ao sair do campo (Enter confirma, Esc desfaz). Trocar o código
              renomeia o item e leva junto grade, lista de demanda, mapeamentos e os processos que
              o usam como produto filho. Remover só vale enquanto ninguém apontar para ele —
              desfaça os mapeamentos primeiro.
            </footer>
          </section>
        </div>
      )}
    </>
  )
}
