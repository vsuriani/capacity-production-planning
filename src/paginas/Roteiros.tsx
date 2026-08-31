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
 *
 * O produto também se cadastra aqui. Ele é a unidade de roteiro e um cadastro global (nenhum
 * cenário o copia), então criar um basta para ele já valer em todo processo.
 */
export function Roteiros() {
  const { dados, erro, carregando, recarregar } = useApi<Dados>('roteiros')
  // Produto filho tem FK para o catálogo: escolha fechada, nunca texto livre. Os `mapeamentos`
  // vêm de brinde na mesma resposta e são o que deixa o aviso de exclusão dizer quantos SKU
  // perdem o vínculo, sem um request a mais.
  const { dados: catalogoSku, recarregar: recarregarSku } = useApi<{
    itens: { codigo: string; descricao: string }[]
    mapeamentos: { produto_id: number }[]
  }>('sku')
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')
  const [tipoFiltro, setTipoFiltro] = useState<TipoLinha | ''>('')
  const [criando, setCriando] = useState(false)
  const [novo, setNovo] = useState(NOVO_VAZIO)
  const [criandoProduto, setCriandoProduto] = useState(false)
  const [novoProduto, setNovoProduto] = useState('')

  const opcoesProduto = useMemo(
    () => (dados?.produtos ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome })),
    [dados],
  )

  /** Escolha fechada: produto filho tem FK para o catálogo, nunca é texto livre. */
  const opcoesSkuFilho = useMemo(
    () =>
      (catalogoSku?.itens ?? []).map((s) => ({
        valor: s.codigo,
        rotulo: s.descricao ? `${s.codigo} — ${s.descricao}` : s.codigo,
      })),
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
          p.skus_filho.some((f) => f.toLowerCase().includes(termo))),
    )
  }, [dados, filtro, tipoFiltro])

  /**
   * Um grupo por produto, em ordem de nome — inclusive o produto que ainda não tem processo
   * nenhum. É assim que um produto recém-cadastrado aparece, e que os que já estavam órfãos
   * param de ficar invisíveis.
   *
   * O grupo vazio some quando há filtro por tipo de linha: esse filtro é sobre processos, e um
   * produto sem processo não é resposta para "só defasagem". O filtro por texto ele respeita,
   * casando pelo próprio nome.
   *
   * O grupo carrega o `id` do produto porque o cabeçalho agora é cadastro — renomeia e remove.
   * `id` nulo é o caso defensivo de um nome que só aparece em processo: sem id, o cabeçalho
   * mostra o nome sem os controles em vez de chutar em qual produto mexer.
   */
  const porProduto = useMemo(() => {
    const termo = filtro.trim().toLowerCase()
    const mapa = new Map<string, { id: number | null; processos: Processo[] }>()

    for (const p of dados?.produtos ?? []) mapa.set(p.nome, { id: p.id, processos: [] })
    for (const p of visiveis) {
      if (!mapa.has(p.produto)) mapa.set(p.produto, { id: p.produto_id, processos: [] })
      mapa.get(p.produto)!.processos.push(p)
    }

    for (const [nome, grupo] of mapa) {
      if (!grupo.processos.length) {
        if (tipoFiltro || (termo && !nome.toLowerCase().includes(termo))) mapa.delete(nome)
        continue
      }
      grupo.processos.sort(
        (a, b) =>
          ORDEM_TIPO.indexOf(a.tipo_linha) - ORDEM_TIPO.indexOf(b.tipo_linha) ||
          (a.sequencia ?? 99) - (b.sequencia ?? 99),
      )
    }
    return mapa
  }, [dados, visiveis, filtro, tipoFiltro])

  const semRoteiro = useMemo(
    () => [...porProduto.values()].filter((g) => g.processos.length === 0).length,
    [porProduto],
  )

  /** Quantos SKU perdem o vínculo se o produto sair — o número que o confirm precisa dizer. */
  const mapeamentosPorProduto = useMemo(() => {
    const conta = new Map<number, number>()
    for (const m of catalogoSku?.mapeamentos ?? []) {
      conta.set(m.produto_id, (conta.get(m.produto_id) ?? 0) + 1)
    }
    return conta
  }, [catalogoSku])

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

  /** `produtoId` vem preenchido quando o lançamento parte do grupo de um produto sem roteiro. */
  function abrirCriacao(produtoId?: number) {
    setErroSalvar(null)
    setCriandoProduto(false)
    setNovo({ ...NOVO_VAZIO, produtoId: produtoId ?? dados?.produtos[0]?.id ?? 0 })
    setCriando(true)
  }

  function abrirCriacaoProduto() {
    setErroSalvar(null)
    setNovoProduto('')
    setCriando(false)
    setCriandoProduto(true)
  }

  /**
   * O formulário fica aberto e o campo limpo depois de gravar — cadastrar produto costuma vir
   * em lote. O produto novo aparece na tabela como grupo vazio, com o atalho para o 1º passo.
   */
  async function criarProduto() {
    const nome = novoProduto.trim()
    if (!nome) {
      setErroSalvar('Dê um nome ao produto.')
      return
    }
    await agir(async () => {
      await apiPost('roteiros?acao=produto', { nome })
      setNovoProduto('')
    })
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

  const renomearProduto = (id: number, nome: string) =>
    agir(() => apiPatch(`roteiros?acao=produto&id=${id}`, { nome }))

  // Um chip por SKU, anexado e desanexado um a um — mesmo gesto do mapa SKU→produto na Base
  // de PROD. A rota faz ON CONFLICT DO NOTHING, então reanexar o mesmo código não é erro.
  const anexarFilho = (processoId: number, skuCodigo: string) =>
    agir(() => apiPost('roteiros?acao=filho', { processoId, skuCodigo }))

  const desanexarFilho = (processoId: number, skuCodigo: string) =>
    agir(() =>
      apiDelete(
        `roteiros?acao=filho&processoId=${processoId}&skuCodigo=${encodeURIComponent(skuCodigo)}`,
      ),
    )

  /**
   * Remover produto é a única ação destrutiva em cascata da tela: as FKs de processo,
   * sku_produto e produto_alias são `ON DELETE CASCADE`, então o roteiro inteiro e os
   * mapeamentos de SKU vão junto.
   *
   * As contagens saem do que já está carregado, só para escrever o aviso. Quem barra de
   * verdade é a rota, que recusa com 409 sem o `cascata=1` — se a tela estiver com dado
   * velho, a mensagem dela cai na barra de erro pelo `agir`.
   */
  async function removerProduto(id: number, nome: string, processos: number) {
    const mapeamentos = mapeamentosPorProduto.get(id) ?? 0
    const junto = [
      processos > 0 && `${processos} processo(s) do roteiro`,
      mapeamentos > 0 && `${mapeamentos} mapeamento(s) de SKU`,
    ].filter(Boolean)

    const aviso = junto.length
      ? `Remover o produto "${nome}"?\n\nIsso apaga também ${junto.join(' e ')}. Não dá para desfazer.`
      : `Remover o produto "${nome}"?`
    if (!confirm(aviso)) return

    await agir(async () => {
      await apiDelete(`roteiros?acao=produto&id=${id}${junto.length ? '&cascata=1' : ''}`)
      // O mapa SKU→produto mudou junto: sem isto o aviso do próximo produto sai com o número velho.
      recarregarSku()
    })
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
          <button
            className="btn-ghost"
            onClick={() => (criandoProduto ? setCriandoProduto(false) : abrirCriacaoProduto())}
          >
            <Plus size={15} /> Novo produto
          </button>
          <button className="btn-primary" onClick={() => (criando ? setCriando(false) : abrirCriacao())}>
            <Plus size={15} /> Novo processo
          </button>
        </div>
      </div>

      <Erro mensagem={erro ?? erroSalvar} />

      {criandoProduto && (
        <section className="panel px-4 py-4 mb-5">
          <h2 className="font-heading font-semibold text-sm mb-1">Novo produto</h2>
          <p className="text-xs text-slate-500 mb-3">
            Produto é a unidade de roteiro e um cadastro <strong>global</strong>: nenhum cenário o
            copia, todos apontam para ele. Nasce sem processo e aparece na tabela como grupo vazio
            — é de lá que se lança o primeiro passo. O nome é a chave, então não repete.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block flex-1 min-w-64">
              <span className="label-overline">Nome do produto</span>
              <input
                className="input-field"
                placeholder="ex.: Smart Trac Ultra Gen 3"
                value={novoProduto}
                onChange={(e) => setNovoProduto(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && criarProduto()}
              />
            </label>

            <button className="btn-primary" onClick={criarProduto}>
              Criar produto
            </button>
            <button className="btn-ghost" onClick={() => setCriandoProduto(false)}>
              Fechar
            </button>
          </div>
        </section>
      )}

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
                {visiveis.length} processo(s) em {porProduto.size - semRoteiro} produto(s)
                {semRoteiro > 0 && (
                  <span className="text-slate-500 font-normal"> · {semRoteiro} sem roteiro</span>
                )}
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
                  {[...porProduto.entries()].map(([produto, grupo]) => (
                    <Fragment key={produto}>
                      <tr className="bg-slate-50">
                        <td className="td font-semibold" colSpan={10}>
                          <div className="flex items-center gap-1">
                            {/* `.cell-input` é w-full: sem o wrapper de largura fixa ele
                                esticaria a linha inteira do grupo. */}
                            {grupo.id === null ? (
                              <span className="px-2">{produto}</span>
                            ) : (
                              <span className="w-72 shrink-0">
                                <CelulaTexto
                                  valor={produto}
                                  className="font-semibold"
                                  onConfirmar={(v) => v && renomearProduto(grupo.id!, v)}
                                />
                              </span>
                            )}
                            {grupo.processos.length > 0 ? (
                              <span className="text-slate-500 font-normal">
                                · {grupo.processos.length} processo(s)
                              </span>
                            ) : (
                              <>
                                <span className="chip-warn ml-1">sem roteiro</span>
                                <button
                                  className="ml-3 font-normal text-primary-700 hover:underline"
                                  onClick={() => abrirCriacao(grupo.id ?? undefined)}
                                >
                                  lançar o primeiro processo
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="td text-right">
                          {grupo.id !== null && (
                            <button
                              className="text-slate-400 hover:text-red-600"
                              onClick={() =>
                                removerProduto(grupo.id!, produto, grupo.processos.length)
                              }
                              title="Remover produto — leva o roteiro e os mapeamentos junto"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                      {grupo.processos.map((p) => (
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
                          <td className="td min-w-56">
                            <div className="flex flex-wrap items-center gap-1">
                              {p.skus_filho.map((sku) => (
                                <span key={sku} className="chip data-code">
                                  {sku}
                                  <button
                                    onClick={() => desanexarFilho(p.id, sku)}
                                    className="ml-1 hover:text-red-700"
                                    title="Desanexar produto filho"
                                  >
                                    <Trash2 size={10} />
                                  </button>
                                </span>
                              ))}
                              <select
                                className="cell-input w-28 text-left text-xs"
                                value=""
                                title="Anexar um produto filho"
                                onChange={(e) => {
                                  if (!e.target.value) return
                                  anexarFilho(p.id, e.target.value)
                                }}
                              >
                                <option value="">+ anexar…</option>
                                {opcoesSkuFilho.map((o) => (
                                  <option key={o.valor} value={o.valor}>
                                    {o.rotulo}
                                  </option>
                                ))}
                              </select>
                            </div>
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
              estimado da demanda. O <strong>nome do produto</strong> se edita no cabeçalho do
              grupo; a lixeira dele remove o produto <strong>com o roteiro e os mapeamentos de
              SKU junto</strong>, e isso não se desfaz. Produto filho aceita{' '}
              <strong>mais de um SKU</strong>: cada chip é um código que este processo produz, e é
              o que faz a industrialização daquele código rodar aqui.
            </footer>
          </section>
        </div>
      )}
    </>
  )
}
