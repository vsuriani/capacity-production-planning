export type TipoCenario = 'capacidade' | 'semanal' | 'mensal'
/**
 * `retrabalho` existe só na Lista de demanda: o cadastro de Processos e sequências oferece os
 * três primeiros, e por isso a explosão nunca gera uma linha desse tipo. Ver migration 008.
 */
export type TipoLinha = 'defasagem' | 'industrializacao' | 'producao_montagem' | 'retrabalho'
export type Bloco = 'producao' | 'industrializacao'
export type Papel = 'aditivo' | 'retrabalho' | 'ftr'

export const ROTULO_TIPO_LINHA: Record<TipoLinha, string> = {
  defasagem: 'Defasagem',
  industrializacao: 'Industrialização',
  producao_montagem: 'Produção / Montagem',
  retrabalho: 'Retrabalho',
}

export type Correcoes = Record<string, boolean>

export type Cenario = {
  id: number
  nome: string
  tipo: TipoCenario
  mes: number | null
  ano: number | null
  oficial: boolean
  correcoes: Correcoes
  observacao: string
  criado_por: string
  criado_em: string
  periodos?: number
  /** Linhas em `cenario_demanda`: quantidade por dispositivo × período (cenário semanal). */
  demandas?: number
  /** Linhas em `demanda_processo`: a Lista de demanda explodida (cenário mensal). */
  linhas_demanda?: number
  /** Soma de `tempo_horas` da Lista de demanda. Null quando o cenário não tem lista. */
  carga_horas?: string | null
}

export type Desvio = {
  id: string
  titulo: string
  aba: string
  planilha: string
  correcao: string
  impacto: string
}

export type Diagnostico = Desvio & {
  detalhe: string
  periodos?: string[]
  itens?: Record<string, unknown>[]
  manual?: number
  calculado?: number
}

export type Dispositivo = { id: number; nome: string; ordem: number }

export type Periodo = { periodo: string; ordem: number; dias_uteis: string | number }

export type Resultado = {
  periodo: string
  ordem: number
  diasUteis: number
  minutosTotais: number
  horasTotais: number
  horasPorOperador: number
  operadoresFracionario: number | null
  operadores: number | null
  operadoresCalculado: number | null
  erro: string | null
}

export type Metrica = {
  dispositivoId: number
  dispositivo: string
  componentes: { rotulo: string; papel: Papel; valor: number }[]
  parcial: number
  real: number | null
}

export type DetalheCenario = {
  cenario: Cenario
  parametros: {
    jornadaHoras: number
    pausaHoras: number
    coefEficiencia: number
    coefExcedente: number
    minutosPorHora: number
  }
  dispositivos: Dispositivo[]
  periodos: Periodo[]
  metas: { dispositivo_id: number; meta_min_peca: string }[]
  demandas: { dispositivo_id: number; periodo: string; quantidade: string }[]
  termos: {
    periodo: string
    meta_dispositivo_id: number
    qtd_dispositivo_id: number
    qtd_periodo: string | null
    ordem: number
  }[]
  componentes: {
    id: number
    dispositivo_id: number
    ordem: number
    rotulo: string
    papel: Papel
    valor: string
  }[]
  resultados: Resultado[]
  metricas: Metrica[]
  diagnosticos: Diagnostico[]
}

// ---------------------------------------------------------------- Dimensionamento Global

export type MesGlobal = {
  periodo: string
  ano: number
  mes: number
  ordem: number
  /** Null enquanto ninguém digitou — a tela não preenche do calendário sozinha. */
  diasUteis: number | null
}

/**
 * Uma célula da grade. `forecast` é o que veio de fora; `ajuste` é o que o PCP digitou por cima
 * (null = não mexeu); `efetiva` é a que entra na conta.
 */
export type QuantidadeGlobal = {
  dispositivoId: number
  periodo: string
  ano: number
  mes: number
  forecast: number
  ajuste: number | null
  efetiva: number
}

/**
 * A abertura da linha do dispositivo: um PROD do forecast, mês a mês, somado sobre os Country.
 * Sempre o forecast puro — o ajuste é do dispositivo inteiro e não se distribui entre models.
 */
export type ModelGlobal = {
  dispositivoId: number
  model: string
  produto: string | null
  porMes: { periodo: string; quantidade: number }[]
}

export type MetricaGlobal = {
  dispositivoId: number
  dispositivo: string
  componentes: { id: number; rotulo: string; papel: Papel; valor: number }[]
  parcial: number
  real: number | null
}

/** A resposta de `GET /api/dimensionamento`. Sem cenário: a tela é uma simulação só. */
export type Grade = {
  parametros: DetalheCenario['parametros']
  meses: MesGlobal[]
  modelsSemDispositivo: { model: string; produto: string; quantidade: number }[]
  dispositivos: { id: number; nome: string }[]
  metricas: MetricaGlobal[]
  quantidades: QuantidadeGlobal[]
  models: ModelGlobal[]
  resultados: Resultado[]
}

export type Processo = {
  id: number
  produto_id: number
  produto: string
  tipo_linha: TipoLinha
  nome: string
  sequencia: number | null
  paralelismo: string | null
  leadtime_dias: number
  operadores: string | null
  pcs_hora: string | null
  /** SKU que o processo produz. Filtra a industrialização; vazio = nunca roda nela. */
  skus_filho: string[]
  origem_total_dia: 'taxa' | 'total'
  sem_taxa: boolean
}

export type Demanda = {
  id: number
  tipo_linha: TipoLinha
  dia_processo: string
  dia_producao: string
  sku_codigo: string
  processo_id: number | null
  processo_nome: string
  /** Dia escolhido na Simulação ideal. Null = ainda no pool, por posicionar. */
  dia_ideal?: string | null
  quantidade: string
  operadores: string | null
  pcs_hora: string | null
  tempo_horas: string | null
  lote: string
  feito: boolean
  feito_por: string | null
  feito_em: string | null
  origem: 'gerado' | 'manual'
}

export type SlotProjecao = {
  id: number
  data: string
  bloco: Bloco
  ordem: number
  sku_codigo: string
  quantidade: string
  descricao: string | null
}
