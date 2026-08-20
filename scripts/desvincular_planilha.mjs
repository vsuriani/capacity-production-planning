/**
 * Migração: troca os cenários importados da planilha por cenários que o app cria e mantém.
 *
 * O que muda de verdade: o cenário importado carrega os rótulos da planilha (`Week 1..4`, sem a
 * 5ª semana da grade) e o `arredondado_manual` — o headcount digitado à mão, que a planilha exibe
 * no lugar da conta. O cenário próprio nasce com Semana 1..5, dias úteis contados do calendário,
 * termos alinhados e nenhum número digitado: o headcount passa a ser sempre o ROUNDUP do cálculo.
 *
 * Tudo por HTTP, nas rotas que já existem — o datadir do pglite fica travado pelo dev server.
 *
 * Uso:
 *   node scripts/desvincular_planilha.mjs --mes 8 --ano 2026            # cria o par próprio
 *   node scripts/desvincular_planilha.mjs --mes 8 --ano 2026 --conferir # compara os dois lados
 *   node scripts/desvincular_planilha.mjs --apagar-importados           # só depois de conferir
 *   node scripts/desvincular_planilha.mjs ... --api http://localhost:3101
 *
 * Rollback: `python scripts/importar_planilha.py --dump` recria os importados a partir do dump
 * local, sem precisar de credencial do Google.
 */

const args = process.argv.slice(2)
const opcao = (nome, padrao = null) => {
  const i = args.indexOf(`--${nome}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : padrao
}
const tem = (nome) => args.includes(`--${nome}`)

const API = opcao('api', 'http://localhost:3101').replace(/\/$/, '')
const EMAIL = opcao('email', 'vsuriani@tractian.com')
const MES = Number(opcao('mes', 0))
const ANO = Number(opcao('ano', 0))

const ok = (msg) => console.log(`  ok    ${msg}`)
const info = (msg) => console.log(`  ·     ${msg}`)
const titulo = (msg) => console.log(`\n${msg}`)

async function pedir(metodo, rota, corpo) {
  const r = await fetch(`${API}/api/${rota}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'X-Auth-Email': EMAIL },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  })
  const texto = await r.text()
  if (!r.ok) throw new Error(`${metodo} ${rota} -> ${r.status} ${texto.slice(0, 300)}`)
  return texto ? JSON.parse(texto) : null
}

/** `Week 3` / `Semana 3` / `Julho` -> 3. Null quando o rótulo não tem número. */
const numeroDoPeriodo = (rotulo) => {
  const m = String(rotulo).match(/(\d+)/)
  return m ? Number(m[1]) : null
}

/**
 * Lista os cenários com o `importado` preenchido. A rota só passou a devolver esse campo agora;
 * enquanto a API rodando for a anterior, cai no detalhe de cada cenário.
 */
async function listar() {
  const { cenarios } = await pedir('GET', 'cenarios')
  if (cenarios.every((c) => c.importado !== undefined)) return cenarios
  return Promise.all(
    cenarios.map(async (c) =>
      c.importado !== undefined
        ? c
        : { ...c, importado: (await pedir('GET', `cenarios?id=${c.id}`)).cenario.importado },
    ),
  )
}
const doMes = (cenarios, tipo, importado) =>
  cenarios.filter(
    (c) => c.tipo === tipo && c.mes === MES && c.ano === ANO && Boolean(c.importado) === importado,
  )

// ---------------------------------------------------------------- fase 1: criar

async function criarProprios() {
  const cenarios = await listar()

  const semanalOrigem = doMes(cenarios, 'semanal', true)[0]
  const mensalOrigem = doMes(cenarios, 'mensal', true)[0]
  if (!semanalOrigem && !mensalOrigem) {
    throw new Error(`nenhum cenário importado para ${MES}/${ANO} — nada a migrar`)
  }
  if (doMes(cenarios, 'semanal', false).length || doMes(cenarios, 'mensal', false).length) {
    throw new Error(`já existe cenário próprio para ${MES}/${ANO} — apague antes de recriar`)
  }

  // ---- semanal: metas + demanda, mapeando o número da semana
  titulo(`semanal ${MES}/${ANO}`)
  const origem = await pedir('GET', `cenarios?id=${semanalOrigem.id}`)
  info(`origem: ${origem.cenario.nome} (id ${origem.cenario.id}), períodos ${origem.periodos.map((p) => p.periodo).join(', ')}`)

  const { id: semanalId } = await pedir('POST', 'cenarios', {
    tipo: 'semanal',
    mes: MES,
    ano: ANO,
    observacao: 'Criado pelo app — substitui o cenário importado da planilha',
  })
  const novo = await pedir('GET', `cenarios?id=${semanalId}`)
  ok(`cenário próprio criado: id ${semanalId}, períodos ${novo.periodos.map((p) => p.periodo).join(', ')}`)

  // Rótulos diferentes dos dois lados ("Week 3" x "Semana 3"): casa pelo número da semana.
  const periodoPorNumero = new Map(novo.periodos.map((p) => [numeroDoPeriodo(p.periodo), p.periodo]))
  const demandas = []
  const semDestino = new Set()
  for (const d of origem.demandas) {
    const destino = periodoPorNumero.get(numeroDoPeriodo(d.periodo))
    if (!destino) {
      semDestino.add(d.periodo)
      continue
    }
    demandas.push({
      dispositivoId: d.dispositivo_id,
      periodo: destino,
      quantidade: Number(d.quantidade),
    })
  }

  const metas = origem.metas.map((m) => ({
    dispositivoId: m.dispositivo_id,
    valor: Number(m.meta_min_peca),
  }))

  await pedir('PATCH', 'planejamento', { cenarioId: semanalId, metas, demandas })
  ok(`${metas.length} metas e ${demandas.length} demandas copiadas`)
  if (semDestino.size) info(`períodos da origem sem destino: ${[...semDestino].join(', ')}`)

  const naoCopiados = novo.periodos.filter(
    (p) => !origem.periodos.some((o) => numeroDoPeriodo(o.periodo) === numeroDoPeriodo(p.periodo)),
  )
  if (naoCopiados.length) {
    info(`períodos novos, sem demanda na planilha: ${naoCopiados.map((p) => p.periodo).join(', ')}`)
  }

  await pedir('PATCH', `cenarios?id=${semanalId}`, { oficial: true })
  ok('marcado como oficial')

  // ---- mensal: portador do calendário, da demanda gerada e da alocação
  titulo(`mensal ${MES}/${ANO}`)
  let mensalId = null
  if (!mensalOrigem) {
    info('sem cenário mensal importado neste mês — nada a migrar')
  } else {
    const proj = await pedir('GET', `projecao?cenario=${mensalOrigem.id}`)
    info(`origem: ${mensalOrigem.nome} (id ${mensalOrigem.id}), ${proj.slots.length} slots`)

    const criado = await pedir('POST', 'cenarios', {
      tipo: 'mensal',
      mes: MES,
      ano: ANO,
      observacao: 'Criado pelo app — substitui o cenário importado da planilha',
    })
    mensalId = criado.id
    ok(`cenário próprio criado: id ${mensalId}`)

    await pedir('PATCH', `projecao?cenario=${mensalId}`, {
      mes: MES,
      ano: ANO,
      qtdOperadores: proj.projecao?.qtd_operadores ?? 8,
      slots: proj.slots.map((s) => ({
        data: s.data,
        bloco: s.bloco,
        ordem: s.ordem,
        skuCodigo: s.sku_codigo,
        quantidade: Number(s.quantidade),
      })),
    })
    const projNova = await pedir('GET', `projecao?cenario=${mensalId}`)
    ok(`grade copiada: ${projNova.slots.length} slots, ${projNova.semanas.length} semanas`)

    const gerado = await pedir('POST', `projecao?cenario=${mensalId}&acao=gerar`)
    ok(`demanda regerada: ${gerado.geradas} linha(s)`)

    const calc = await pedir('POST', `alocacao?cenario=${mensalId}&acao=calcular`)
    ok(`alocação recalculada: ${calc.gravadas} registro(s)`)
  }

  titulo('pronto')
  info('confira com --conferir antes de apagar os importados')
  return { semanalId, mensalId }
}

// ---------------------------------------------------------------- fase 2: conferir

async function resumoSemanal(id) {
  const d = await pedir('GET', `cenarios?id=${id}`)
  return {
    nome: d.cenario.nome,
    importado: Boolean(d.cenario.importado),
    periodos: d.periodos.map((p) => p.periodo),
    diasUteis: d.periodos.map((p) => Number(p.dias_uteis)),
    demanda: d.demandas.reduce((s, x) => s + Number(x.quantidade), 0),
    linhas: d.resultados.map((r) => ({
      periodo: r.periodo,
      horas: r.horasTotais,
      calculado: r.operadoresCalculado,
      exibido: r.operadores,
    })),
    diagnosticos: d.diagnosticos.map((x) => x.id),
  }
}

async function resumoMensal(id) {
  const proj = await pedir('GET', `projecao?cenario=${id}`)
  const dem = await pedir('GET', `demandas?cenario=${id}`)
  const aloc = await pedir('GET', `alocacao?cenario=${id}`)
  return {
    slots: proj.slots.length,
    demandas: dem.total,
    feitas: dem.demandas.filter((x) => x.feito).length,
    diasAlocados: aloc.dias.length,
  }
}

async function conferir() {
  const cenarios = await listar()

  titulo(`semanal ${MES}/${ANO} — importado × próprio`)
  const impS = doMes(cenarios, 'semanal', true)[0]
  const proS = doMes(cenarios, 'semanal', false)[0]
  if (!proS) throw new Error('não existe cenário semanal próprio — rode sem --conferir primeiro')

  for (const [rotulo, id] of [
    ['importado', impS?.id],
    ['próprio  ', proS.id],
  ]) {
    if (!id) {
      console.log(`  ${rotulo}: —`)
      continue
    }
    const r = await resumoSemanal(id)
    console.log(`  ${rotulo}: ${r.nome} (id ${id})`)
    console.log(`            períodos    ${r.periodos.join(', ')}`)
    console.log(`            dias úteis  ${r.diasUteis.join(', ')}`)
    console.log(`            demanda     ${r.demanda}`)
    for (const l of r.linhas) {
      console.log(
        `            ${l.periodo.padEnd(9)} ${String(l.horas.toFixed(2)).padStart(8)} h` +
          `  calculado ${String(l.calculado ?? '—').padStart(2)}` +
          `  exibido ${String(l.exibido ?? '—').padStart(2)}`,
      )
    }
    console.log(`            diagnósticos ${r.diagnosticos.join(', ') || '—'}`)
  }

  titulo(`mensal ${MES}/${ANO} — importado × próprio`)
  const impM = doMes(cenarios, 'mensal', true)[0]
  const proM = doMes(cenarios, 'mensal', false)[0]
  for (const [rotulo, id] of [
    ['importado', impM?.id],
    ['próprio  ', proM?.id],
  ]) {
    if (!id) {
      console.log(`  ${rotulo}: —`)
      continue
    }
    const r = await resumoMensal(id)
    console.log(
      `  ${rotulo}: id ${id} · ${r.slots} slots · ${r.demandas} linhas de demanda ` +
        `(${r.feitas} feitas) · ${r.diasAlocados} dias alocados`,
    )
  }
}

// ---------------------------------------------------------------- fase 3: apagar

async function apagarImportados() {
  const cenarios = await listar()
  const importados = cenarios.filter((c) => c.importado)
  if (!importados.length) {
    info('nenhum cenário importado no banco — nada a apagar')
    return
  }

  // Trava: não apaga enquanto o mês em uso não tiver o par próprio de pé.
  const mesAlvo = MES && ANO ? { mes: MES, ano: ANO } : null
  if (mesAlvo) {
    for (const tipo of ['semanal', 'mensal']) {
      const proprio = doMes(cenarios, tipo, false)[0]
      const importado = doMes(cenarios, tipo, true)[0]
      if (importado && !proprio) {
        throw new Error(
          `${tipo} ${MES}/${ANO} ainda não tem cenário próprio — rode a migração antes de apagar`,
        )
      }
    }
  }

  titulo(`apagando ${importados.length} cenário(s) importado(s)`)
  for (const c of importados) {
    await pedir('DELETE', `cenarios?id=${c.id}`)
    ok(`${c.tipo.padEnd(11)} ${c.nome} (id ${c.id})`)
  }

  const sobraram = (await listar()).filter((c) => c.importado)
  if (sobraram.length) throw new Error(`sobraram ${sobraram.length} importados`)
  titulo('banco sem cenário importado')
  info('rollback: python scripts/importar_planilha.py --dump')
}

// ---------------------------------------------------------------- main

try {
  if (tem('apagar-importados')) {
    await apagarImportados()
  } else if (tem('conferir')) {
    if (!MES || !ANO) throw new Error('--mes e --ano são obrigatórios')
    await conferir()
  } else {
    if (!MES || !ANO) throw new Error('--mes e --ano são obrigatórios')
    await criarProprios()
  }
} catch (erro) {
  console.error(`\nFALHA: ${erro.message}`)
  process.exitCode = 1
}
