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
  conferir('cenários importados', cenarios.length, 3)

  const semanal = cenarios.find((c) => c.tipo === 'semanal')
  const detalhe = await pedir('GET', `cenarios?id=${semanal.id}`)
  ok(`semanal: ${detalhe.periodos.length} períodos, ${detalhe.resultados.length} resultados`)

  const comResultado = detalhe.resultados.filter((r) => r.operadores !== null)
  ok(`períodos calculados: ${comResultado.length}`)

  const semana45 = detalhe.resultados.find((r) => r.periodo === 'Week 45')
  if (semana45 && Math.abs(semana45.operadoresFracionario - 9.659084967320263) < 1e-9) {
    ok(`Week 45 reproduz a planilha: ${semana45.operadoresFracionario}`)
  } else {
    falha(`Week 45: ${semana45?.operadoresFracionario}, esperava 9.659084967320263`)
  }

  const ids = detalhe.diagnosticos.map((d) => d.id).sort()
  ok(`diagnósticos do semanal: ${ids.join(', ')}`)
  if (!ids.includes('pares-desalinhados')) falha('esperava pares-desalinhados no semanal')
  if (!ids.includes('par-outro-periodo')) falha('esperava par-outro-periodo no semanal')

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

  const sku = await pedir('GET', 'sku')
  conferir('total de SKU', sku.total, 199)
  ok(`pendências na grade: ${sku.pendencias.map((p) => p.sku_codigo).join(', ')}`)
  conferir('SKU ambíguos', sku.ambiguos.length, 3)

  // ------------------------------------------------------------ calendário -> demanda
  console.log('\ncalendário e geração de demanda')
  const mensal = cenarios.find((c) => c.tipo === 'mensal')
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

  const csv = await pedir('GET', `demandas?cenario=${mensal.id}&formato=csv`)
  if (typeof csv === 'string' && csv.includes('Tipo da Linha') && csv.split('\r\n').length > 1) {
    ok(`CSV gerado com ${csv.split('\r\n').length - 1} linhas`)
  } else {
    falha('CSV inválido')
  }

  // ------------------------------------------------------------ alocação
  console.log('\nalocação de operadores')
  const calc = await pedir('POST', `alocacao?cenario=${mensal.id}&acao=calcular`)
  ok(`alocações gravadas: ${calc.gravadas} (dias sem data: ${calc.diasSemData})`)
  const diagAloc = calc.diagnosticos.map((d) => d.id)
  if (!diagAloc.includes('alocacao-dia-anterior')) falha('esperava o diagnóstico do dia anterior')
  else ok(`diagnósticos da alocação: ${diagAloc.join(', ')}`)

  const heat = await pedir('GET', `alocacao?cenario=${mensal.id}`)
  ok(`heat map: ${heat.dias.length} dias × ${heat.qtdOperadores} operadores, jornada ${heat.jornadaLiquida} h`)
  if (heat.dias.length === 0) falha('heat map vazio')

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
} catch (erro) {
  falha(erro.message)
}

servidor.close()
await db.close()

console.log(falhas === 0 ? '\nAPI verificada.\n' : `\n${falhas} falha(s).\n`)
process.exitCode = falhas === 0 ? 0 : 1
