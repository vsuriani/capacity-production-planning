/**
 * Verificação das rotas /api sem Docker: sobe o Express real, com o pool do pg
 * substituído por um Postgres em WASM já carregado com o payload da planilha.
 *
 * Pré-requisito: python scripts/importar_planilha.py --dump --dry-run
 * Uso: node scripts/verificar_api.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const require = createRequire(import.meta.url)
const raiz = path.join(import.meta.dirname, '..')

let falhas = 0
const ok = (msg) => console.log(`  ok    ${msg}`)
const falha = (msg) => {
  falhas++
  console.log(`  FALHA ${msg}`)
}
const conferir = (rotulo, real, esperado) =>
  real === esperado ? ok(`${rotulo}: ${real}`) : falha(`${rotulo}: ${real}, esperava ${esperado}`)

// ---------------------------------------------------------------- banco WASM

const db = new PGlite()
for (const arq of readdirSync(path.join(raiz, 'api', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(path.join(raiz, 'api', 'migrations', arq), 'utf8'))
}

// Substitui o módulo de banco antes de qualquer handler ser carregado.
const dbPath = require.resolve(path.join(raiz, 'api', '_lib', 'db.js'))
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    query: (sql, params) => db.query(sql, params),
    transacao: async (fn) => fn(db), // pglite é single-connection; sem BEGIN aninhado
    getPool: () => db,
    esperarBanco: async () => {},
    migrar: async () => {},
  },
}

const { aplicarPayload } = require(path.join(raiz, 'api', '_handlers', 'importacao.js'))
const payload = JSON.parse(readFileSync(path.join(raiz, '.cache', 'payload-importacao.json'), 'utf8'))
await aplicarPayload(db, payload, 'vsuriani@tractian.com')

// ---------------------------------------------------------------- servidor

const express = require(path.join(raiz, 'api', 'node_modules', 'express'))
const { loadRoutes } = require(path.join(raiz, 'api', '_lib', 'routes.js'))

const app = express()
app.use('/api', express.json({ limit: '15mb' }))
const rotas = loadRoutes(app)
const servidor = app.listen(0)
const base = `http://localhost:${servidor.address().port}`

const H = { 'X-Auth-Email': 'vsuriani@tractian.com', 'Content-Type': 'application/json' }
const pedir = async (metodo, rota, corpo) => {
  const r = await fetch(`${base}/api/${rota}`, {
    method: metodo,
    headers: H,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  const tipo = r.headers.get('content-type') || ''
  const dados = tipo.includes('json') ? await r.json() : await r.text()
  if (!r.ok) throw new Error(`${metodo} ${rota} -> ${r.status} ${JSON.stringify(dados).slice(0, 300)}`)
  return dados
}

console.log(`\nrotas carregadas: ${rotas.join(', ')}`)

try {
  // ------------------------------------------------------------ cenários
  console.log('\ncenários')
  const { cenarios } = await pedir('GET', 'cenarios')
  conferir('cenários importados', cenarios.length, 23)

  const semanal = cenarios.find((c) => c.tipo === 'semanal' && c.mes === 12)
  const detalhe = await pedir('GET', `cenarios?id=${semanal.id}`)
  ok(`semanal: ${detalhe.periodos.length} períodos, ${detalhe.resultados.length} resultados`)

  const comResultado = detalhe.resultados.filter((r) => r.operadores !== null)
  ok(`períodos calculados: ${comResultado.length}`)

  // A planilha dá 9.659084967320263 aqui. O app fica abaixo porque "Ima na Base" foi escondido
  // (`dispositivo.ativo = false`, migration 005) e saiu da soma junto com a tela: o termo dele
  // valia 1 min/pç × 4000 pç = 4000 min, e 4000 / 60 / (5 dias × 7,5 h) / 0,85 = 2,0915032679…,
  // exatamente a diferença. O resto do período segue reproduzindo a planilha.
  const semana45 = detalhe.resultados.find((r) => r.periodo === 'Week 45')
  if (semana45 && Math.abs(semana45.operadoresFracionario - 7.567581699346405) < 1e-9) {
    ok(`Week 45 reproduz a planilha menos os ocultos: ${semana45.operadoresFracionario}`)
  } else {
    falha(`Week 45: ${semana45?.operadoresFracionario}, esperava 7.567581699346405`)
  }

  const ids = detalhe.diagnosticos.map((d) => d.id).sort()
  ok(`diagnósticos do semanal: ${ids.join(', ')}`)
  if (!ids.includes('pares-desalinhados')) falha('esperava pares-desalinhados no semanal')

  // Com o escopo mensal, os 3 termos que apontam para outra coluna ficaram nos cenários
  // dos meses onde essas colunas caem — não necessariamente neste.
  const comCruzado = []
  for (const c of cenarios.filter((x) => x.tipo === 'semanal')) {
    const d = await pedir('GET', `cenarios?id=${c.id}`)
    if (d.diagnosticos.some((x) => x.id === 'par-outro-periodo')) comCruzado.push(c.nome)
  }
  if (comCruzado.length) ok(`par-outro-periodo aparece em: ${comCruzado.join(', ')}`)
  else falha('esperava par-outro-periodo em algum cenário semanal')

  // ------------------------------------------------------------ capacidade
  console.log('\ncenário de capacidade')
  const capacidade = cenarios.find((c) => c.tipo === 'capacidade')
  const cap = await pedir('GET', `cenarios?id=${capacidade.id}`)
  conferir('dispositivos com métrica', cap.metricas.length, 11)

  const stuEx = cap.metricas.find((m) => m.dispositivo === 'Smart Trac Ultra Ex')
  if (stuEx && Math.abs(stuEx.parcial - 11.76) < 1e-9 && Math.abs(stuEx.real - 13.83529411764706) < 1e-9) {
    ok(`Smart Trac Ultra Ex: parcial ${stuEx.parcial}, real ${stuEx.real}`)
  } else {
    falha(`métrica do Smart Trac Ultra Ex: ${JSON.stringify(stuEx)}`)
  }

  // ------------------------------------------------------------ correções
  console.log('\ncorreções por cenário')
  const antes = (await pedir('GET', `cenarios?id=${semanal.id}`)).resultados.find(
    (r) => r.periodo === 'Week 45',
  )
  await pedir('PATCH', `cenarios?id=${semanal.id}`, { correcoes: { 'pares-desalinhados': true } })
  const depois = (await pedir('GET', `cenarios?id=${semanal.id}`)).resultados.find(
    (r) => r.periodo === 'Week 45',
  )
  if (antes.operadoresFracionario !== depois.operadoresFracionario) {
    ok(`ligar a correção mudou Week 45: ${antes.operadores} -> ${depois.operadores}`)
  } else {
    falha('ligar pares-desalinhados não mudou o resultado')
  }

  try {
    await pedir('PATCH', `cenarios?id=${semanal.id}`, { correcoes: { 'nao-existe': true } })
    falha('correção inválida deveria dar 400')
  } catch {
    ok('correção com id inválido é rejeitada')
  }
  await pedir('PATCH', `cenarios?id=${semanal.id}`, { correcoes: {} })

  // ------------------------------------------------------------ duplicar e comparar
  console.log('\nduplicar e comparar')
  const { id: copiaId } = await pedir('POST', `cenarios?duplicarDe=${semanal.id}`, {
    nome: 'Semanal — teste corrigido',
    correcoes: { 'pares-desalinhados': true, 'dispositivos-fora-da-soma': true },
  })
  const copia = await pedir('GET', `cenarios?id=${copiaId}`)
  conferir('a cópia manteve os períodos', copia.periodos.length, detalhe.periodos.length)
  conferir('a cópia manteve os termos', copia.termos.length, detalhe.termos.length)

  const { comparacao } = await pedir('GET', `cenarios?comparar=${semanal.id},${copiaId}`)
  conferir('comparação com 2 cenários', comparacao.length, 2)
  const difs = comparacao[0].resultados.filter(
    (r, i) => r.operadores !== comparacao[1].resultados[i].operadores,
  )
  ok(`períodos que divergem entre fiel e corrigido: ${difs.length}`)
  if (!difs.length) falha('a comparação deveria mostrar divergência')

  // ------------------------------------------------------------ roteiros e SKU
  console.log('\nroteiros e SKU')
  const roteiros = await pedir('GET', 'roteiros')
  conferir('processos', roteiros.processos.length, 87)
  ok(`produtos: ${roteiros.produtos.length}, sem roteiro: ${roteiros.produtosSemRoteiro.length}`)
  conferir('aliases', roteiros.aliases.length, 1)

  // Cadastro de produto pela própria tela de Processos e sequências.
  const novoProduto = await pedir('POST', 'roteiros?acao=produto', { nome: '  Produto Teste  ' })
  conferir('produto criado com o nome aparado', novoProduto.nome, 'Produto Teste')
  const comProduto = await pedir('GET', 'roteiros')
  conferir('entra no cadastro', comProduto.produtos.length, roteiros.produtos.length + 1)
  if (comProduto.processos.every((p) => p.produto_id !== novoProduto.id)) {
    ok('e nasce sem processo — a tela mostra como grupo vazio')
  } else {
    falha('produto novo não deveria nascer com processo')
  }
  try {
    await pedir('POST', 'roteiros?acao=produto', { nome: 'Produto Teste' })
    falha('nome repetido deveria dar 409')
  } catch {
    ok('nome repetido é rejeitado')
  }
  try {
    await pedir('POST', 'roteiros?acao=produto', { nome: '   ' })
    falha('nome vazio deveria dar 400')
  } catch {
    ok('nome vazio é rejeitado')
  }
  // O processo criado nele prova o encadeamento produto novo -> roteiro.
  const { id: processoNovo } = await pedir('POST', 'roteiros', {
    produtoId: novoProduto.id,
    tipoLinha: 'producao_montagem',
    nome: 'Montagem Produto Teste',
    sequencia: 1,
  })
  const comProcesso = await pedir('GET', 'roteiros')
  conferir(
    'processo atrelado ao produto novo',
    comProcesso.processos.filter((p) => p.produto_id === novoProduto.id).length,
    1,
  )

  // --- produtos filhos (migration 007) --------------------------------------
  // A coluna virou tabela: o processo aceita 1 ou mais SKU, e a industrialização casa por
  // pertencimento à lista.
  const doProcesso = () =>
    pedir('GET', 'roteiros').then(
      (r) => r.processos.find((p) => p.id === processoNovo).skus_filho,
    )
  conferir('processo nasce sem filho', (await doProcesso()).length, 0)

  await pedir('POST', 'roteiros?acao=filho', { processoId: processoNovo, skuCodigo: 'PROD-0114' })
  await pedir('POST', 'roteiros?acao=filho', { processoId: processoNovo, skuCodigo: 'PROD-0113' })
  conferir('dois filhos anexados', (await doProcesso()).join(','), 'PROD-0113,PROD-0114')

  // A PK é o par: reanexar o mesmo código não duplica nem dá erro.
  await pedir('POST', 'roteiros?acao=filho', { processoId: processoNovo, skuCodigo: 'PROD-0114' })
  conferir('reanexar o mesmo SKU não duplica', (await doProcesso()).length, 2)

  try {
    await pedir('POST', 'roteiros?acao=filho', { processoId: processoNovo, skuCodigo: 'NAO-EXISTE' })
    falha('SKU fora da Base de PROD deveria dar 400')
  } catch {
    ok('SKU fora do catálogo é rejeitado')
  }

  await pedir(
    'DELETE',
    `roteiros?acao=filho&processoId=${processoNovo}&skuCodigo=PROD-0114`,
  )
  conferir('desanexar tira só o escolhido', (await doProcesso()).join(','), 'PROD-0113')

  // Um SKU que é produto filho não pode ser removido do catálogo enquanto o vínculo existir:
  // é a FK de processo_sku_filho, e o guarda de sku.js tem de enxergá-la.
  try {
    await pedir('DELETE', 'sku?codigo=PROD-0113')
    falha('remover SKU que é produto filho deveria dar 409')
  } catch (e) {
    if (String(e.message).includes('produto filho')) ok('SKU usado como produto filho é protegido')
    else falha(`409 esperado por produto filho, veio: ${e.message}`)
  }

  await pedir(
    'DELETE',
    `roteiros?acao=filho&processoId=${processoNovo}&skuCodigo=PROD-0113`,
  )
  conferir('processo volta a zero filhos', (await doProcesso()).length, 0)

  // --- renomear o produto ---------------------------------------------------
  // Nada aponta para produto por texto (as três FKs são por id), então renomear é só um UPDATE:
  // o processo tem de continuar atrelado, agora exibindo o nome novo.
  await pedir('PATCH', `roteiros?acao=produto&id=${novoProduto.id}`, { nome: ' Produto Renomeado ' })
  const produtoRenomeado = await pedir('GET', 'roteiros')
  conferir(
    'renomear apara e grava',
    produtoRenomeado.produtos.find((p) => p.id === novoProduto.id)?.nome,
    'Produto Renomeado',
  )
  conferir('não cria produto novo', produtoRenomeado.produtos.length, comProduto.produtos.length)
  conferir(
    'o processo segue no produto renomeado',
    produtoRenomeado.processos.find((p) => p.id === processoNovo)?.produto,
    'Produto Renomeado',
  )
  try {
    // Colidir com um nome que já existe (o primeiro da lista, que não é este produto).
    const outro = produtoRenomeado.produtos.find((p) => p.id !== novoProduto.id).nome
    await pedir('PATCH', `roteiros?acao=produto&id=${novoProduto.id}`, { nome: outro })
    falha('renomear para nome ocupado deveria dar 409')
  } catch {
    ok('renomear para nome ocupado é rejeitado')
  }
  try {
    await pedir('PATCH', `roteiros?acao=produto&id=${novoProduto.id}`, { nome: '   ' })
    falha('renomear para vazio deveria dar 400')
  } catch {
    ok('renomear para vazio é rejeitado')
  }

  // --- excluir o produto ----------------------------------------------------
  // As FKs são ON DELETE CASCADE, então sem o flag a rota tem de recusar: apagar em silêncio o
  // roteiro inteiro é exatamente o acidente que o 409 existe para evitar.
  try {
    await pedir('DELETE', `roteiros?acao=produto&id=${novoProduto.id}`)
    falha('excluir produto com roteiro deveria dar 409 sem cascata')
  } catch {
    ok('excluir produto em uso é recusado sem cascata=1')
  }
  const aindaLa = await pedir('GET', 'roteiros')
  conferir('e nada foi apagado', aindaLa.produtos.length, comProduto.produtos.length)
  conferir('nem o processo', aindaLa.processos.length, comProcesso.processos.length)

  // Com o flag, o produto sai e leva o roteiro junto — é também a limpeza do fixture.
  const removido = await pedir('DELETE', `roteiros?acao=produto&id=${novoProduto.id}&cascata=1`)
  conferir('a cascata reporta o processo removido', removido.removidos.processo, 1)
  const semProduto = await pedir('GET', 'roteiros')
  conferir('produto sai do cadastro', semProduto.produtos.length, roteiros.produtos.length)
  conferir('e o processo vai junto', semProduto.processos.length, roteiros.processos.length)

  const sku = await pedir('GET', 'sku')
  conferir('total de SKU', sku.total, 199)
  ok(`pendências na grade: ${sku.pendencias.map((p) => p.sku_codigo).join(', ')}`)
  conferir('SKU ambíguos', sku.ambiguos.length, 3)

  // ------------------------------------------------------------ cadastro de SKU
  // Ciclo completo do cadastro novo, terminando com o catálogo de volta em 199.
  //
  // Mapeia para um produto do próprio catálogo, e não para o fixture acima: aquele já foi
  // apagado em cascata na verificação de exclusão.
  console.log('\ncadastro da Base de PROD')
  const produtoParaMapear = roteiros.produtos[0].id
  await pedir('POST', 'sku', {
    codigo: ' prod-teste ',
    descricao: 'Item de teste',
    grupoItem: 'TESTE',
    ncm: '1234.56',
    produtoId: produtoParaMapear,
  })
  const comNovo = await pedir('GET', 'sku?busca=PROD-TESTE')
  const item = comNovo.itens.find((i) => i.codigo === 'PROD-TESTE')
  if (item) ok('código novo gravado sem espaços e em maiúsculas')
  else falha(`código novo não apareceu: ${JSON.stringify(comNovo.itens)}`)
  conferir('mapeamento criado junto', comNovo.mapeamentos.filter((m) => m.sku_codigo === 'PROD-TESTE').length, 1)

  try {
    await pedir('POST', 'sku', { codigo: 'PROD-TESTE' })
    falha('código repetido devia dar 409')
  } catch {
    ok('código repetido é rejeitado')
  }

  // Sem COALESCE: grupo e NCM podem voltar a vazio de propósito.
  await pedir('PATCH', 'sku?codigo=PROD-TESTE', { grupoItem: '', ncm: '', descricao: 'Item renomeado' })
  const limpo = (await pedir('GET', 'sku?busca=PROD-TESTE')).itens[0]
  if (limpo.grupo_item === null && limpo.ncm === null && limpo.descricao === 'Item renomeado') {
    ok('PATCH limpa grupo/NCM e grava a descrição')
  } else {
    falha(`PATCH deixou ${JSON.stringify(limpo)}`)
  }

  // Renomear repõe a chave nas tabelas que a guardam como texto solto.
  await pedir('PATCH', 'sku?codigo=PROD-TESTE', { codigo: 'PROD-TESTE-2' })
  const renomeado = await pedir('GET', 'sku?busca=PROD-TESTE')
  conferir('renomear não duplica', renomeado.itens.length, 1)
  conferir(
    'mapeamento acompanha o código renomeado',
    renomeado.mapeamentos.filter((m) => m.sku_codigo === 'PROD-TESTE-2').length,
    1,
  )

  try {
    await pedir('DELETE', 'sku?codigo=PROD-TESTE-2')
    falha('remover código mapeado devia dar 409')
  } catch {
    ok('código em uso não é removido')
  }

  await pedir(
    'DELETE',
    `sku?acao=mapear&skuCodigo=PROD-TESTE-2&produtoId=${produtoParaMapear}&escopo=producao`,
  )
  await pedir('DELETE', 'sku?codigo=PROD-TESTE-2')
  conferir('catálogo volta ao tamanho original', (await pedir('GET', 'sku')).total, 199)

  // ------------------------------------------------------------ calendário -> demanda
  console.log('\ncalendário e geração de demanda')
  const mensal = cenarios.find((c) => c.tipo === 'mensal' && c.mes === 7 && c.ano === 2026)
  const proj = await pedir('GET', `projecao?cenario=${mensal.id}`)
  conferir('slots na grade', proj.slots.length, 27)
  conferir('semanas geradas', proj.semanas.length, 5)

  const gerado = await pedir('POST', `projecao?cenario=${mensal.id}&acao=gerar`)
  ok(`linhas geradas: ${gerado.geradas} (tempo infinito: ${gerado.tempoInfinito})`)
  const semRoteiro = gerado.diagnosticos.find((d) => d.id === 'sku-sem-roteiro-silencioso')
  if (semRoteiro) {
    ok(`SKU que não geraram demanda: ${semRoteiro.itens.length}`)
  } else {
    falha('esperava o diagnóstico de SKU sem roteiro na geração')
  }

  const { demandas, total } = await pedir('GET', `demandas?cenario=${mensal.id}`)
  ok(`lista de demanda: ${total} linhas`)

  // marcar como feito
  await pedir('PATCH', `demandas?id=${demandas[0].id}`, { feito: true })
  const depoisFeito = await pedir('GET', `demandas?cenario=${mensal.id}&feito=true`)
  conferir('linhas marcadas como feitas', depoisFeito.demandas.length, 1)
  if (depoisFeito.demandas[0].feito_por !== 'vsuriani@tractian.com') {
    falha(`feito_por não registrado: ${depoisFeito.demandas[0].feito_por}`)
  } else {
    ok('feito_por registrado')
  }

  // Linha manual com o tipo Retrabalho (migration 008). O enum é o que barra tipo inválido,
  // então provar que 'retrabalho' entra e que a lista o devolve é provar a migration inteira.
  const { id: manual } = await pedir('POST', 'demandas', {
    cenarioId: mensal.id,
    tipoLinha: 'producao_montagem',
    diaProcesso: '2026-07-08',
    diaProducao: '2026-07-08',
    skuCodigo: 'PROD-0114',
    processoNome: 'Retrabalho manual',
    quantidade: 12,
  })
  await pedir('PATCH', `demandas?id=${manual}`, { tipoLinha: 'retrabalho' })
  const comRetrabalho = await pedir('GET', `demandas?cenario=${mensal.id}&tipo=retrabalho`)
  conferir('linha manual aceita o tipo Retrabalho', comRetrabalho.demandas.length, 1)
  conferir('e o filtro por tipo a encontra', comRetrabalho.demandas[0].processo_nome, 'Retrabalho manual')
  await pedir('DELETE', `demandas?id=${manual}`)

  const csv = await pedir('GET', `demandas?cenario=${mensal.id}&formato=csv`)
  if (typeof csv === 'string' && csv.includes('Tipo da Linha') && csv.split('\r\n').length > 1) {
    ok(`CSV gerado com ${csv.split('\r\n').length - 1} linhas`)
  } else {
    falha('CSV inválido')
  }

  // ------------------------------------------------------------ Planejado × Realizado
  //
  // A tela só enxerga o que a Simulação alocou, então o `preencher` é o pré-requisito: sem
  // dia_ideal, a listagem sai vazia por definição.
  console.log('\nPlanejado × Realizado')
  await pedir('POST', `simulacao?cenario=${mensal.id}&acao=preencher`)
  const real0 = await pedir('GET', `realizado?cenario=${mensal.id}`)
  conferir('lista o que a Simulação alocou', real0.linhas.length, total)
  conferir('e nada apontado ainda', real0.indicadores.apontadas, 0)
  // A fixture é de julho/2026, logo todo o plano já venceu: o pace parte de 0, não de "—".
  // O null só aparece quando nada venceu ainda, e é o que a divisão por zero seria.
  conferir('todo o plano da fixture já venceu', real0.indicadores.planejadoAteHoje, real0.indicadores.planejado)
  conferir('e o pace parte de zero', real0.indicadores.aderencia, 0)

  // O indicador é só montagem: tem de ser MENOS que o total de linhas alocadas.
  const montagem = real0.linhas.filter((l) => l.tipo_linha === 'producao_montagem')
  conferir('o indicador conta só montagem', real0.indicadores.linhas, montagem.length)
  if (montagem.length < real0.linhas.length) ok(`e ignora as outras ${real0.linhas.length - montagem.length} linhas`)
  else falha('esperava linhas fora da montagem para provar o recorte')

  // total: copia o planejado, marca feito e aparece na Lista de demanda como concluída.
  const alvo = montagem[0]
  await pedir('PATCH', `realizado?id=${alvo.id}`, { status: 'total' })
  const depoisTotal = await pedir('GET', `realizado?cenario=${mensal.id}`)
  const linhaTotal = depoisTotal.linhas.find((l) => l.id === alvo.id)
  conferir('total copia a quantidade planejada', Number(linhaTotal.quantidade_realizada), Number(alvo.quantidade))
  const naLista = await pedir('GET', `demandas?cenario=${mensal.id}&feito=true`)
  if (naLista.demandas.some((l) => l.id === alvo.id)) ok('e marca o check na Lista de demanda')
  else falha('apontar total deveria marcar feito')

  // parcial: exige número, e o número tem de caber no planejado.
  const outro = montagem[1]
  try {
    await pedir('PATCH', `realizado?id=${outro.id}`, {
      status: 'parcial',
      quantidadeRealizada: Number(outro.quantidade) + 1,
    })
    falha('parcial acima do planejado deveria dar 400')
  } catch {
    ok('parcial acima do planejado é rejeitado')
  }
  await pedir('PATCH', `realizado?id=${outro.id}`, { status: 'parcial', quantidadeRealizada: 5 })

  // cancelado zera, e a linha NÃO conta como feita.
  const terceiro = montagem[2]
  await pedir('PATCH', `realizado?id=${terceiro.id}`, { status: 'cancelado' })

  const comApontamentos = await pedir('GET', `realizado?cenario=${mensal.id}`)
  const i = comApontamentos.indicadores
  conferir('cancelado zera o realizado', Number(comApontamentos.linhas.find((l) => l.id === terceiro.id).quantidade_realizada), 0)
  conferir('três linhas apontadas', i.apontadas, 3)
  conferir('uma cancelada', i.canceladas, 1)
  conferir('realizado soma total + parcial', i.realizado, Number(alvo.quantidade) + 5)
  if (i.planejado > i.realizado) ok(`planejado ${i.planejado} pç × realizado ${i.realizado} pç`)
  else falha('planejado deveria ser maior que o realizado aqui')

  // Linha manual criada aqui nasce ALOCADA — senão sumiria da própria tela.
  const { id: manualReal } = await pedir('POST', `realizado?cenario=${mensal.id}`, {
    tipoLinha: 'producao_montagem',
    diaProcesso: '2026-07-08',
    diaProducao: '2026-07-08',
    skuCodigo: 'PROD-0114',
    processoNome: 'Montagem extra',
    quantidade: 30,
  })
  const comManual = await pedir('GET', `realizado?cenario=${mensal.id}`)
  const nova = comManual.linhas.find((l) => l.id === manualReal)
  if (nova && nova.dia_ideal === '2026-07-08') ok('linha manual nasce alocada e aparece na tela')
  else falha(`linha manual não veio alocada: ${JSON.stringify(nova)}`)

  // Demanda gerada não se apaga por aqui.
  try {
    await pedir('DELETE', `realizado?id=${alvo.id}`)
    falha('remover linha gerada deveria dar 409')
  } catch {
    ok('linha gerada não é removível aqui')
  }
  await pedir('DELETE', `realizado?id=${manualReal}`)

  // O log guarda tudo que passou por esta aba, inclusive da linha que já não existe.
  const comLog = await pedir('GET', `realizado?cenario=${mensal.id}`)
  // 3 apontamentos + 1 criação + 1 remoção. O parcial recusado com 400 não deixa rastro, e é
  // isso mesmo: o log é de mudanças, não de tentativas.
  const acoes = comLog.log.map((e) => e.acao)
  conferir('eventos registrados', comLog.log.length, 5)
  if (acoes.includes('apontou') && acoes.includes('criou-linha') && acoes.includes('removeu-linha')) {
    ok(`log com as três ações: ${[...new Set(acoes)].join(', ')}`)
  } else {
    falha(`log incompleto: ${acoes.join(', ')}`)
  }
  const eventoDaRemocao = comLog.log.find((e) => e.acao === 'removeu-linha')
  if (eventoDaRemocao.processo_nome === 'Montagem extra') ok('o evento sobrevive à exclusão da linha')
  else falha(`contexto perdido no log: ${JSON.stringify(eventoDaRemocao)}`)

  // Deixa o cenário como estava, para os blocos seguintes não herdarem apontamento.
  for (const l of [alvo, outro, terceiro]) {
    await pedir('PATCH', `realizado?id=${l.id}`, { status: 'pendente' })
  }
  await pedir('POST', `simulacao?cenario=${mensal.id}&acao=esvaziar`)

  // ------------------------------------------------------------ alocação
  console.log('\nalocação de operadores')
  const calc = await pedir('POST', `alocacao?cenario=${mensal.id}&acao=calcular`)
  ok(`alocações gravadas: ${calc.gravadas} (dias sem data: ${calc.diasSemData})`)
  // O heat map força `alocacao-dia-anterior` (única exceção ao "fiel por padrão", ver AGENTS §4),
  // então o diagnóstico dele NÃO deve aparecer — e nenhum dia pode sair sem data.
  const diagAloc = calc.diagnosticos.map((d) => d.id)
  if (diagAloc.includes('alocacao-dia-anterior')) falha('o heat map deveria rodar já corrigido')
  else ok(`diagnósticos da alocação: ${diagAloc.join(', ')}`)
  conferir('nenhum dia sem data', calc.diasSemData, 0)

  const heat = await pedir('GET', `alocacao?cenario=${mensal.id}`)
  ok(`heat map: ${heat.dias.length} dias × ${heat.qtdOperadores} operadores, jornada ${heat.jornadaLiquida} h`)
  if (heat.dias.length === 0) falha('heat map vazio')

  // ------------------------------------------------------------ resumo do Início
  //
  // O Início mostra os mesmos indicadores da aba Planejado × Realizado, e os dois têm de sair
  // da MESMA função (`_lib/apontamento.js`). Comparar as duas respostas é o que prova isso.
  console.log('\nresumo do Início')
  const resumo = await pedir('GET', 'resumo')
  ok(`cenários no resumo: ${resumo.cenarios.map((c) => c.tipo).join(', ')}`)
  if (resumo.cenarioDaExecucao) ok(`execução escopada em: ${resumo.cenarioDaExecucao.nome}`)
  else falha('esperava um cenário mensal para a execução')

  // O escopo é o ponto: o mensal EM USO é o do mês corrente, e a demanda das fixtures está em
  // julho. Antes o Início somava `demanda_processo` inteira e traria essas 67 linhas de um
  // cenário que não está em uso — é essa a soma indevida que este caso trava.
  const execucaoId = resumo.cenarioDaExecucao.id
  const doCenario = await pedir('GET', `demandas?cenario=${execucaoId}`)
  conferir('a demanda do Início é a do cenário em uso', resumo.demanda.total, doCenario.total)
  const deJulho = await pedir('GET', `demandas?cenario=${mensal.id}`)
  if (mensal.id !== execucaoId && deJulho.total > 0 && resumo.demanda.total !== deJulho.total) {
    ok(`e ignora as ${deJulho.total} linhas do cenário de julho, que não está em uso`)
  } else {
    falha('o resumo deveria escopar a demanda no cenário em uso')
  }

  // Dá dado de verdade ao cenário em uso — sem isso os números abaixo seriam 0 == 0, que não
  // prova nada. Uma linha de montagem de 120 peças, posicionada e apontada pela metade.
  const { id: linhaResumo } = await pedir('POST', `realizado?cenario=${execucaoId}`, {
    tipoLinha: 'producao_montagem',
    diaProcesso: '2026-09-01',
    diaProducao: '2026-09-01',
    skuCodigo: 'PROD-0114',
    processoNome: 'Montagem do resumo',
    quantidade: 120,
  })
  await pedir('PATCH', `realizado?id=${linhaResumo}`, {
    status: 'parcial',
    quantidadeRealizada: 30,
  })

  const comDado = await pedir('GET', 'resumo')
  const daAba = await pedir('GET', `realizado?cenario=${execucaoId}`)
  conferir('o Início vê o planejado', comDado.indicadores.planejado, 120)
  conferir('e o realizado parcial', comDado.indicadores.realizado, 30)
  conferir('o pace é realizado ÷ vencido', comDado.indicadores.aderencia, 30 / 120)
  conferir(
    'e bate com a aba, número por número',
    JSON.stringify(comDado.indicadores),
    JSON.stringify(daAba.indicadores),
  )
  conferir('a linha nasce alocada, fora do pool', comDado.simulacao.noPool, 0)

  await pedir('DELETE', `realizado?id=${linhaResumo}`)
  const semDado = await pedir('GET', 'resumo')
  conferir('removida, o indicador volta a zero', semDado.indicadores.linhas, 0)

  // ------------------------------------------------------------ parâmetros e desvios
  console.log('\nparâmetros e catálogo de desvios')
  const params = await pedir('GET', 'parametros')
  conferir('parâmetros', params.parametros.length, 5)

  await pedir('POST', 'parametros?feriado=1', { data: '2026-07-09', descricao: 'Teste' })
  const comFeriado = await pedir('GET', 'parametros')
  conferir('feriados', comFeriado.feriados.length, 1)

  const { desvios } = await pedir('GET', 'desvios')
  conferir('desvios catalogados', desvios.length, 13)

  // ------------------------------------------------------------ ações de correção
  console.log('\nações de alinhamento')
  const alinhado = await pedir('POST', 'planejamento?acao=alinhar-termos', { cenarioId: copiaId })
  ok(`termos alinhados: ${alinhado.alinhados}`)
  const incluidos = await pedir('POST', 'planejamento?acao=incluir-faltantes', { cenarioId: copiaId })
  ok(`termos incluídos: ${incluidos.incluidos}`)

  const depoisAcoes = await pedir('GET', `cenarios?id=${copiaId}`)
  const aindaDesalinhados = depoisAcoes.termos.filter(
    (t) => t.meta_dispositivo_id !== t.qtd_dispositivo_id || t.qtd_periodo !== null,
  )
  conferir('termos desalinhados após alinhar', aindaDesalinhados.length, 0)

  // ------------------------------------------------------------ criar cenário
  console.log('')
  console.log('criar cenário do zero (semeado das bases)')
  const { id: novoId } = await pedir('POST', 'cenarios', {
    tipo: 'semanal',
    mes: 11,
    ano: 2026,
    nome: 'Novembro/2026 (teste)',
  })
  const criado = await pedir('GET', `cenarios?id=${novoId}`)

  conferir('períodos criados', criado.periodos.length, 5)
  conferir(
    'rótulos são Semana 1..5',
    criado.periodos.map((p) => p.periodo).join(','),
    'Semana 1,Semana 2,Semana 3,Semana 4,Semana 5',
  )
  // Novembro/2026: as 5 semanas da grade caem todas com 5 dias úteis.
  const diasUteis = criado.periodos.map((p) => Number(p.dias_uteis))
  if (diasUteis.every((d) => d === 5)) ok(`dias úteis contados: ${diasUteis.join(', ')}`)
  else falha(`dias úteis inesperados: ${diasUteis.join(', ')}`)

  if (criado.metas.length > 0) ok(`tempos por dispositivo herdados: ${criado.metas.length}`)
  else falha('o cenário novo deveria herdar as metas do cenário mais recente do tipo')

  const desalinhadosNovo = criado.termos.filter(
    (t) => t.meta_dispositivo_id !== t.qtd_dispositivo_id || t.qtd_periodo !== null,
  )
  conferir('termos desalinhados no cenário novo', desalinhadosNovo.length, 0)
  if (criado.termos.length === criado.metas.length * 5) {
    ok(`termos criados: ${criado.termos.length} (1 por dispositivo × 5 semanas)`)
  } else {
    falha(`termos: ${criado.termos.length}, esperava ${criado.metas.length * 5}`)
  }

  // Os cadastros globais NÃO são copiados — continuam únicos.
  const roteirosDepois = await pedir('GET', 'roteiros')
  conferir('processos seguem globais', roteirosDepois.processos.length, 87)
  const skuDepois = await pedir('GET', 'sku')
  conferir('SKU seguem globais', skuDepois.total, 199)

  // Mensal nasce com o calendário do mês.
  const { id: mensalId } = await pedir('POST', 'cenarios', { tipo: 'mensal', mes: 11, ano: 2026 })
  const projNova = await pedir('GET', `projecao?cenario=${mensalId}`)
  if (projNova.projecao?.mes === 11 && projNova.semanas.length === 5) {
    ok('cenário mensal novo já vem com o calendário do mês')
  } else {
    falha(`calendário do cenário novo: ${JSON.stringify(projNova.projecao)}`)
  }

  // Variantes do mesmo mês SÃO permitidas — é assim que se compara fiel x corrigido.
  // O índice único vale só para a baseline importada.
  const { id: variante } = await pedir('POST', 'cenarios', {
    tipo: 'semanal',
    mes: 11,
    ano: 2026,
    nome: 'Novembro/2026 (variante)',
  })
  ok(`variante do mesmo mês permitida: id ${variante}`)

  const doMes = (await pedir('GET', 'cenarios?tipo=semanal')).cenarios.filter(
    (c) => c.mes === 11 && c.ano === 2026,
  )
  conferir('cenários para Novembro/2026', doMes.length, 2)
  conferir('baselines importadas nesse mês', doMes.filter((c) => c.importado).length, 0)
} catch (erro) {
  falha(erro.message)
}

servidor.close()
await db.close()

console.log(falhas === 0 ? '\nAPI verificada.\n' : `\n${falhas} falha(s).\n`)
process.exitCode = falhas === 0 ? 0 : 1
