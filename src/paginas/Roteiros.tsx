import { Fragment, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { apiDelete, apiPatch, apiPost } from '../lib/api'
import { useApi } from '../lib/hooks'
import { ROTULO_TIPO_LINHA, type Processo, type TipoLinha } from '../lib/tipos'
import {
  Carregando, CelulaNumero, CelulaSelecao, CelulaTexto, Erro,
} from '../components/comuns'

type Dados = {
  produtos: { id: number; nome: string; ativo: boolean }[]
  processos: Processo[]
}

const ORDEM_TIPO: TipoLinha[] = ['defasagem', 'industrializacao', 'producao_montagem']
const OPCOES_TIPO = ORDEM_TIPO.map((t) => ({ valor: t, rotulo: ROTULO_TIPO_LINHA[t] }))

/** Jornada usada para converter Pç/hr em total do dia, como na planilha. */
const HORAS_DIA = 8

/** '' e texto inválido viram null — é como "sem valor cadastrado" chega na rota. */
const numeroOuNulo = (texto: string) => {
  const n = Number(texto.replace(',', '.'))
  return texto.trim() === '' || Number.isNaN(n) ? null : n
}

const NOVO_VAZIO = {
  produtoId: 0,
  tipoLinha: 'producao_montagem' as TipoLinha,
  nome: '',
  sequencia: '',
  leadtimeDias: '0',
  operadores: '',
  pcsHora: '',
}

/**
 * Processos e sequências (aba Base simplificada).
 *
 * É o roteiro que a explosão de demanda lê, e todo campo dele é editável aqui — inclusive o
 * produto, que move o processo de grupo. Total/dia é a única célula derivada: escrever nela
 * grava `Pç/hr = total ÷ 8`.
 */
export function Roteiros() {
  const { dados, erro, carregando, recarregar } = useApi<Dados>('roteiros')
  // Produto filho tem FK para o catálogo: escolha fechada, nunca texto livre.
  const { dados: catalogoSku } = useApi<{ itens: { codigo: string; descricao: string }[] }>('sku')
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')
  const [tipoFiltro, setTipoFiltro] = useState<TipoLinha | ''>('')
  const [criando, setCriando] = useState(false)
  const [novo, setNovo] = useState(NOVO_VAZIO)

  const opcoesProduto = useMemo(
    () => (dados?.produtos ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome })),
    [dados],
  )

  const opcoesSkuFilho = useMemo(
    () => [
      { valor: '', rotulo: '— nenhum —' },
      ...(catalogoSku?.itens ?? []).map((s) => ({
        valor: s.codigo,
        rotulo: s.descricao ? `${s.codigo} — ${s.descricao}` : s.codigo,
      })),
    ],
    [catalogoSku],
  )

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

  /** Próximo degrau da sequência daquele produto + tipo de linha, que é o padrão do formulário. */
  const proximaSequencia = useMemo(() => {
    const irmaos = (dados?.processos ?? []).filter(
      (p) => p.produto_id === novo.produtoId && p.tipo_linha === novo.tipoLinha,
    )
    return irmaos.reduce((maior, p) => Math.max(maior, p.sequencia ?? 0), 0) + 1
  }, [dados, novo.produtoId, novo.tipoLinha])

  async function agir(fn: () => Promise<unknown>) {
    setErroSalvar(null)
    try {
      await fn()
      recarregar()
    } catch (e) {
      setErroSalvar((e as Error).message)
    }
  }

  const salvar = (id: number, mudancas: Record<string, unknown>) =>
    agir(() => apiPatch(`roteiros?id=${id}`, mudancas))

  /**
   * Total/dia é derivado (Pç/hr × 8), mas editável pelo outro lado — é como a planilha digita
   * algumas linhas. Só grava quando o número realmente muda: sem isso, entrar e sair da célula
   * regravaria o arredondamento da exibição.
   */
  function salvarTotalDia(p: Processo, total: number) {
    const atual = p.pcs_hora === null ? null : Number(p.pcs_hora) * HORAS_DIA
    if (atual !== null && atual.toFixed(2) === total.toFixed(2)) return
    salvar(p.id, { pcsHora: total / HORAS_DIA })
  }

  function abrirCriacao() {
    setErroSalvar(null)
    setNovo({ ...NOVO_VAZIO, produtoId: dados?.produtos[0]?.id ?? 0 })
    setCriando(true)
  }

  async function criar() {
    if (!novo.produtoId || !novo.nome.trim()) {
      setErroSalvar('Escolha o produto e dê um nome ao processo.')
      return
    }
    await agir(async () => {
      await apiPost('roteiros', {
        produtoId: novo.produtoId,
        tipoLinha: novo.tipoLinha,
        nome: novo.nome.trim(),
        sequencia: Math.round(numeroOuNulo(novo.sequencia) ?? proximaSequencia),
        leadtimeDias: Math.round(numeroOuNulo(novo.leadtimeDias) ?? 0),
        operadores: numeroOuNulo(novo.operadores),
        pcsHora: numeroOuNulo(novo.pcsHora),
      })
      // Mantém produto e tipo: cadastrar uma sequência inteira é lançar um passo atrás do outro.
      setNovo({ ...novo, nome: '', sequencia: '' })
    })
  }

  async function remover(id: number, nome: string) {
    if (!confirm(`Remover o processo "${nome}"?`)) return
    await agir(() => apiDelete(`roteiros?id=${id}`))
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Processos e sequências</h1>
          <p className="page-subtitle">
            Equivale à aba Base simplificada. É o roteiro que a explosão de demanda usa — todo
            campo é editável, e a sequência é a ordem dos passos dentro do produto.
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
          <button className="btn-primary" onClick={() => (criando ? setCriando(false) : abrirCriacao())}>
            <Plus size={15} /> Novo processo
          </button>
        </div>
      </div>

      <Erro mensagem={erro ?? erroSalvar} />

      {criando && dados && (
        <section className="panel px-4 py-4 mb-5">
          <h2 className="font-heading font-semibold text-sm mb-1">Novo processo</h2>
          <p className="text-xs text-slate-500 mb-3">
            Produto, tipo de linha e nome são o mínimo; o resto pode ser preenchido depois, direto
            na tabela. A sequência já vem no próximo degrau do produto, e o formulário fica aberto
            para lançar o passo seguinte.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="label-overline">Produto</span>
              <select
                className="input-field w-56"
                value={novo.produtoId}
                onChange={(e) => setNovo({ ...novo, produtoId: Number(e.target.value) })}
              >
                {dados.produtos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="label-overline">Tipo de linha</span>
              <select
                className="input-field w-48"
                value={novo.tipoLinha}
                onChange={(e) => setNovo({ ...novo, tipoLinha: e.target.value as TipoLinha })}
              >
                {ORDEM_TIPO.map((t) => (
                  <option key={t} value={t}>
                    {ROTULO_TIPO_LINHA[t]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="label-overline">Processo</span>
              <input
                className="input-field w-64"
                placeholder="nome do processo"
                value={novo.nome}
                onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && criar()}
              />
            </label>

            <label className="block">
              <span className="label-overline">Seq.</span>
              <input
                className="input-field w-20 text-right"
                inputMode="numeric"
                placeholder={String(proximaSequencia)}
                value={novo.sequencia}
                onChange={(e) => setNovo({ ...novo, sequencia: e.target.value })}
              />
            </label>

            <label className="block">
              <span className="label-overline">Leadtime</span>
              <input
                className="input-field w-20 text-right"
                inputMode="numeric"
                value={novo.leadtimeDias}
                onChange={(e) => setNovo({ ...novo, leadtimeDias: e.target.value })}
              />
            </label>

            <label className="block">
              <span className="label-overline">Operadores</span>
              <input
                className="input-field w-24 text-right"
                inputMode="decimal"
                placeholder="—"
                value={novo.operadores}
                onChange={(e) => setNovo({ ...novo, operadores: e.target.value })}
              />
            </label>

            <label className="block">
              <span className="label-overline">Pç/hr</span>
              <input
                className="input-field w-24 text-right"
                inputMode="decimal"
                placeholder="—"
                value={novo.pcsHora}
                onChange={(e) => setNovo({ ...novo, pcsHora: e.target.value })}
              />
            </label>

            <button className="btn-primary" onClick={criar}>
              Criar processo
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
        <div className="empty-state">Nenhum roteiro — importe a planilha primeiro.</div>
      ) : (
        <div className="space-y-6">
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
                    <th className="th">Produto</th>
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
                    <Fragment key={produto}>
                      <tr className="bg-slate-50">
                        <td className="td font-semibold" colSpan={11}>
                          {produto}{' '}
                          <span className="text-slate-500 font-normal">
                            · {lista.length} processo(s)
                          </span>
                        </td>
                      </tr>
                      {lista.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/60">
                          <td className="td p-0 min-w-64">
                            <CelulaTexto
                              valor={p.nome}
                              className="pl-6"
                              onConfirmar={(v) => v && salvar(p.id, { nome: v })}
                            />
                          </td>
                          <td className="td p-0 min-w-44">
                            <CelulaSelecao
                              valor={String(p.produto_id)}
                              opcoes={opcoesProduto}
                              onConfirmar={(v) => salvar(p.id, { produtoId: Number(v) })}
                            />
                          </td>
                          <td className="td p-0 min-w-44">
                            <CelulaSelecao
                              valor={p.tipo_linha}
                              opcoes={OPCOES_TIPO}
                              onConfirmar={(v) => salvar(p.id, { tipoLinha: v })}
                            />
                          </td>
                          <td className="td-num p-0">
                            <CelulaNumero
                              valor={p.sequencia}
                              decimais={0}
                              onConfirmar={(v) => salvar(p.id, { sequencia: Math.round(v) })}
                            />
                          </td>
                          <td className="td-num p-0">
                            <CelulaNumero
                              valor={p.paralelismo === null ? null : Number(p.paralelismo)}
                              onConfirmar={(v) => salvar(p.id, { paralelismo: v })}
                            />
                          </td>
                          <td className="td-num p-0">
                            <CelulaNumero
                              valor={p.leadtime_dias}
                              decimais={0}
                              onConfirmar={(v) => salvar(p.id, { leadtimeDias: Math.round(v) })}
                            />
                          </td>
                          <td className="td-num p-0">
                            <CelulaNumero
                              valor={p.operadores === null ? null : Number(p.operadores)}
                              decimais={0}
                              onConfirmar={(v) => salvar(p.id, { operadores: v })}
                            />
                          </td>
                          <td className={`td-num p-0 ${p.sem_taxa ? 'bg-amber-50' : ''}`}>
                            <CelulaNumero
                              valor={p.pcs_hora === null ? null : Number(p.pcs_hora)}
                              onConfirmar={(v) => salvar(p.id, { pcsHora: v })}
                            />
                          </td>
                          <td className="td-num p-0" title="Pç/hr × 8 h — editar aqui grava o Pç/hr">
                            <CelulaNumero
                              valor={p.pcs_hora === null ? null : Number(p.pcs_hora) * HORAS_DIA}
                              onConfirmar={(v) => salvarTotalDia(p, v)}
                            />
                          </td>
                          <td className="td p-0 min-w-40">
                            <CelulaSelecao
                              valor={p.sku_filho ?? ''}
                              opcoes={opcoesSkuFilho}
                              className="data-code"
                              onConfirmar={(v) => salvar(p.id, { skuFilho: v || null })}
                            />
                          </td>
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
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="px-4 py-2 border-t border-slate-200 text-xs text-slate-500">
              As células salvam ao sair do campo (Enter confirma, Esc desfaz). Trocar o produto
              move o processo de grupo. Total/dia é Pç/hr × 8 h: escrever nele grava o Pç/hr
              equivalente. Célula de Pç/hr em âmbar = sem taxa cadastrada, o que zera o tempo
              estimado da demanda.
            </footer>
          </section>
        </div>
      )}
    </>
  )
}
