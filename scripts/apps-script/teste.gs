function gerarRelatorioDefasagem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const abaOrigem = ss.getSheetByName("Planejamento Macro");
  const abaBase = ss.getSheetByName("Base simplificada - Geral");
  const abaDestino = ss.getSheetByName("Demandas Defasagem");

  const JORNADA_TRABALHO = 7.5;

  if (!abaOrigem || !abaBase || !abaDestino) {
    SpreadsheetApp.getUi().alert("Erro: Verifique os nomes das abas.");
    return;
  }

  // 1. Identificar o Mês e Ano de Referência (Lendo da célula D1)
  const mesTexto = abaOrigem.getRange("D1").getValue().toString().trim();
  const mesesMap = {
    "Janeiro": 0, "Fevereiro": 1, "Março": 2, "Abril": 3, "Maio": 4, "Junho": 5,
    "Julho": 6, "Agosto": 7, "Setembro": 8, "Outubro": 9, "Novembro": 10, "Dezembro": 11
  };

  const anoAtual = new Date().getFullYear();
  const mesIndex = mesesMap[mesTexto];

  if (mesIndex === undefined) {
    SpreadsheetApp.getUi().alert("Mês inválido na célula D1. Use: Março, Abril, etc.");
    return;
  }

  // 2. Criar lista de todos os dias úteis do mês
  let calendarioUtil = [];
  let dataBusca = new Date(anoAtual, mesIndex, 1);
  while (dataBusca.getMonth() === mesIndex) {
    let diaSemana = dataBusca.getDay();
    if (diaSemana !== 0 && diaSemana !== 6) { // Pula Domingo (0) e Sábado (6)
      calendarioUtil.push(new Date(dataBusca));
    }
    dataBusca.setDate(dataBusca.getDate() + 1);
  }

  // 3. Limpeza da aba destino
  const lastRowDest = abaDestino.getLastRow();
  if (lastRowDest > 1) {
    abaDestino.getRange(2, 1, lastRowDest, 10).clearContent();
  }

  // 4. Carregamento de dados
  const dadosBase = abaBase.getRange("A2:I" + abaBase.getLastRow()).getValues();
  const dadosPlan = abaOrigem.getRange("D1:I" + abaOrigem.getLastRow()).getValues();
  let matrizFinal = [];
  let ponteiroDiaUtil = 0;

  // 5. Processamento das demandas
  for (let i = 1; i < dadosPlan.length; i++) {
    let produtoNome = dadosPlan[i][0];
    if (!produtoNome || ["Dias Uteis", "Operadores Linha", "Production"].includes(produtoNome)) continue;

    for (let col = 1; col <= 5; col++) {
      let qtdNecessaria = dadosPlan[i][col];

      if (typeof qtdNecessaria === 'number' && qtdNecessaria > 0) {

        // Ordenação: Defasagem/Industrialização primeiro, Montar Completo por último
        let processos = dadosBase.filter(l => l[1] === produtoNome).sort((a, b) => {
          return a[3].toLowerCase().includes("montar completo") ? 1 : -1;
        });

        processos.forEach(proc => {
          let pchr = proc[8];
          let numOps = proc[7] || 1;
          let horasNecessarias = pchr > 0 ? (qtdNecessaria / pchr) : 0;
          let capacidadeDia = numOps * JORNADA_TRABALHO;

          // Calcula quantos dias úteis esse processo vai consumir
          let diasConsumidos = Math.ceil(horasNecessarias / capacidadeDia);

          // Pega a data no calendário (respeitando o limite do mês)
          let dataProducao = calendarioUtil[ponteiroDiaUtil] || calendarioUtil[calendarioUtil.length - 1];

          matrizFinal.push([
            proc[0],             // A: Tipo da Linha
            "Semana " + col,     // B: Semana
            dataProducao,        // C: Dia da Produção
            produtoNome,         // D: Produto
            proc[3],             // E: Processo
            qtdNecessaria,       // F: Qtd
            numOps,              // G: Operadores
            pchr,                // H: Pç/Hr
            horasNecessarias,    // I: Tempo Total
            ""                   // J: Lote
          ]);

          // Avança o ponteiro para o próximo processo não encavalar no mesmo dia
          ponteiroDiaUtil = (ponteiroDiaUtil + diasConsumidos) % calendarioUtil.length;
        });
      }
    }
  }

  // 6. Escrita Única (Evita o looping)
  if (matrizFinal.length > 0) {
    abaDestino.getRange(2, 1, matrizFinal.length, 10).setValues(matrizFinal);
    SpreadsheetApp.getUi().alert("Relatório Gerado para " + mesTexto + " em dias úteis!");
  }
}
