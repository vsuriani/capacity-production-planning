export type TipoCenario = 'capacidade' | 'semanal' | 'mensal'
export type TipoLinha = 'defasagem' | 'industrializacao' | 'producao_montagem'
export type Bloco = 'producao' | 'industrializacao'
export type Papel = 'aditivo' | 'retrabalho' | 'ftr'

export const ROTULO_TIPO_LINHA: Record<TipoLinha, string> = {
  defasagem: 'Defasagem',
  industrializacao: 'Industrialização',
  producao_montagem: 'Produção / Montagem',
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
  demandas?: number
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
  sku_filho: string | null
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
