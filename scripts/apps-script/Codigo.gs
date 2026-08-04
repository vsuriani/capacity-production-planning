// ATENCAO: este arquivo (Código.gs no editor) redefine as MESMAS funcoes de Code.gs.
// No Apps Script todos os .gs compartilham o mesmo escopo global — a ultima definicao
// carregada vence. Ver docs/planilha-dimensionamento-de-linha.md, secao "Apps Script".
// Versao MAIS ANTIGA e REDUZIDA: 8 grupos de produto em vez de 14.

function dadosBaseProcesso() {

  const planilha = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/1UWobn-ss5IY4cvG89hYrttCcXB_qc07PmbHsf8r7LNM/edit?gid=270748109#gid=270748109');
  const aba = planilha.getSheetByName('Base simplificada');

  var ultimaLinha = aba.getLastRow();

  let tipoLinha = aba.getRange(2, 1, ultimaLinha, 1).getValues()
  let produto = aba.getRange(2, 2, ultimaLinha, 1).getValues()
  let produtoFilho = aba.getRange(2, 3, ultimaLinha, 1).getValues()
  let processo = aba.getRange(2, 4, ultimaLinha, 1).getValues()
  let operadorPorProcesso = aba.getRange(2, 8, ultimaLinha, 1).getValues()
  let pcHora = aba.getRange(2, 9, ultimaLinha, 1).getValues()
  let totalDia = aba.getRange(2, 10, ultimaLinha, 1).getValues()
  let sequenciaMontagem = aba.getRange(2, 5, ultimaLinha, 1).getValues()
  let paralelismo = aba.getRange(2, 6, ultimaLinha, 1).getValues()
  let diasProduzindo = aba.getRange(2, 7, ultimaLinha, 1).getValues()


  return { tipoLinha, produto, processo, operadorPorProcesso, pcHora, totalDia, sequenciaMontagem, paralelismo, diasProduzindo, produtoFilho }

}
function dadosLinha() {
  const planilha = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/1UWobn-ss5IY4cvG89hYrttCcXB_qc07PmbHsf8r7LNM/edit?gid=270748109#gid=270748109');
  const aba = planilha.getSheetByName('Projeção das linhas');

  let diaDeProducao = []
  let demandaProducao = []
  let demandaIndustrializacao = []
  var qtdOperadoes = aba.getRange(3, 2, 1, 1).getValue();

  for (var i = 0; i < 5; i++) {
    for (var j = 0; j < 6; j++) {

      var a = 3 + 13 * i
      var dia = aba.getRange(6, a + j * 2, 1, 1).getValue()
      var produto = aba.getRange(9, a + j * 2, 10, 2).getValues()
      var industrializacao = aba.getRange(20, a + j * 2, 10, 2).getValues()


      diaDeProducao.push(dia)
      demandaProducao.push(produto)
      demandaIndustrializacao.push(industrializacao)
    }
  }

  return { diaDeProducao, demandaIndustrializacao, demandaProducao, qtdOperadoes }

}


function processoEnergy() {

  let defasagem = []
  let industrializacao = []
  let montagem = []

  var linha = dadosBaseProcesso().tipoLinha
  var produto = dadosBaseProcesso().produto
  var processo = dadosBaseProcesso().processo
  var operadores = dadosBaseProcesso().operadorPorProcesso
  var pecas = dadosBaseProcesso().pcHora
  var sequencia = dadosBaseProcesso().sequenciaMontagem
  var paralelo = dadosBaseProcesso().paralelismo
  var diaNecessario = dadosBaseProcesso().diasProduzindo
  var filho = dadosBaseProcesso().produtoFilho

  for (var i = 0; i < linha.length; i++) {

    if (produto[i] == "Energy Trac" && linha[i] == "Defasagem") {

      defasagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])

    }
    else if (produto[i] == "Energy Trac" && linha[i] == "Industrialização") {

      industrializacao.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


    else if (produto[i] == "Energy Trac" && linha[i] == "Produção / Montagem") {

      montagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


  }

  return { defasagem, industrializacao, montagem }

}
function processoGatewayPro() {

  let defasagem = []
  let industrializacao = []
  let montagem = []

  var linha = dadosBaseProcesso().tipoLinha
  var produto = dadosBaseProcesso().produto
  var processo = dadosBaseProcesso().processo
  var operadores = dadosBaseProcesso().operadorPorProcesso
  var pecas = dadosBaseProcesso().pcHora
  var sequencia = dadosBaseProcesso().sequenciaMontagem
  var paralelo = dadosBaseProcesso().paralelismo
  var diaNecessario = dadosBaseProcesso().diasProduzindo
  var filho = dadosBaseProcesso().produtoFilho


  for (var i = 0; i < linha.length; i++) {

    if (produto[i] == "Gateway Pro" && linha[i] == "Defasagem") {

      defasagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }
    else if (produto[i] == "Gateway Pro" && linha[i] == "Industrialização") {

      industrializacao.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


    else if (produto[i] == "Gateway Pro" && linha[i] == "Produção / Montagem") {

      montagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


  }

  return { defasagem, industrializacao, montagem }

}
function processoGatewayUltra() {

  let defasagem = []
  let industrializacao = []
  let montagem = []

  var linha = dadosBaseProcesso().tipoLinha
  var produto = dadosBaseProcesso().produto
  var processo = dadosBaseProcesso().processo
  var operadores = dadosBaseProcesso().operadorPorProcesso
  var pecas = dadosBaseProcesso().pcHora
  var sequencia = dadosBaseProcesso().sequenciaMontagem
  var paralelo = dadosBaseProcesso().paralelismo
  var diaNecessario = dadosBaseProcesso().diasProduzindo
  var filho = dadosBaseProcesso().produtoFilho

  for (var i = 0; i < linha.length; i++) {

    if (produto[i] == "Smart Receiver Ultra" && linha[i] == "Defasagem") {

      defasagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }
    else if (produto[i] == "Smart Receiver Ultra" && linha[i] == "Industrialização") {

      industrializacao.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


    else if (produto[i] == "Smart Receiver Ultra" && linha[i] == "Produção / Montagem") {

      montagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


  }

  return { defasagem, industrializacao, montagem }

}
function processoSmartTracPro() {

  let defasagem = []
  let industrializacao = []
  let montagem = []

  var linha = dadosBaseProcesso().tipoLinha
  var produto = dadosBaseProcesso().produto
  var processo = dadosBaseProcesso().processo
  var operadores = dadosBaseProcesso().operadorPorProcesso
  var pecas = dadosBaseProcesso().pcHora
  var sequencia = dadosBaseProcesso().sequenciaMontagem
  var paralelo = dadosBaseProcesso().paralelismo
  var diaNecessario = dadosBaseProcesso().diasProduzindo
  var filho = dadosBaseProcesso().produtoFilho


  for (var i = 0; i < linha.length; i++) {

    if (produto[i] == "Smart Trac Pro" && linha[i] == "Defasagem") {

      defasagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }
    else if (produto[i] == "Smart Trac Pro" && linha[i] == "Industrialização") {

      industrializacao.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


    else if (produto[i] == "Smart Trac Pro" && linha[i] == "Produção / Montagem") {

      montagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


  }

  return { defasagem, industrializacao, montagem }

}
function processoSmartTracUltra() {

  let defasagem = []
  let industrializacao = []
  let montagem = []

  var linha = dadosBaseProcesso().tipoLinha
  var produto = dadosBaseProcesso().produto
  var processo = dadosBaseProcesso().processo
  var operadores = dadosBaseProcesso().operadorPorProcesso
  var pecas = dadosBaseProcesso().pcHora
  var sequencia = dadosBaseProcesso().sequenciaMontagem
  var paralelo = dadosBaseProcesso().paralelismo
  var diaNecessario = dadosBaseProcesso().diasProduzindo
  var filho = dadosBaseProcesso().produtoFilho


  for (var i = 0; i < linha.length; i++) {

    if (produto[i] == "Smart Trac Ultra" && linha[i] == "Defasagem") {

      defasagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }
    else if (produto[i] == "Smart Trac Ultra" && linha[i] == "Industrialização") {

      industrializacao.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


    else if (produto[i] == "Smart Trac Ultra" && linha[i] == "Produção / Montagem") {

      montagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


  }

  return { defasagem, industrializacao, montagem }

}
function processoSmartTracUltraGen2() {

  let defasagem = []
  let industrializacao = []
  let montagem = []

  var linha = dadosBaseProcesso().tipoLinha
  var produto = dadosBaseProcesso().produto
  var processo = dadosBaseProcesso().processo
  var operadores = dadosBaseProcesso().operadorPorProcesso
  var pecas = dadosBaseProcesso().pcHora
  var sequencia = dadosBaseProcesso().sequenciaMontagem
  var paralelo = dadosBaseProcesso().paralelismo
  var diaNecessario = dadosBaseProcesso().diasProduzindo
  var filho = dadosBaseProcesso().produtoFilho


  for (var i = 0; i < linha.length; i++) {

    if (produto[i] == "Smart Trac Ultra Gen 2" && linha[i] == "Defasagem") {

      defasagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }
    else if (produto[i] == "Smart Trac Ultra Gen 2" && linha[i] == "Industrialização") {

      industrializacao.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


    else if (produto[i] == "Smart Trac Ultra Gen 2" && linha[i] == "Produção / Montagem") {

      montagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


  }

  return { defasagem, industrializacao, montagem }

}
function processoSmartTracUltraEx() {

  let defasagem = []
  let industrializacao = []
  let montagem = []

  var linha = dadosBaseProcesso().tipoLinha
  var produto = dadosBaseProcesso().produto
  var processo = dadosBaseProcesso().processo
  var operadores = dadosBaseProcesso().operadorPorProcesso
  var pecas = dadosBaseProcesso().pcHora
  var sequencia = dadosBaseProcesso().sequenciaMontagem
  var paralelo = dadosBaseProcesso().paralelismo
  var diaNecessario = dadosBaseProcesso().diasProduzindo
  var filho = dadosBaseProcesso().produtoFilho


  for (var i = 0; i < linha.length; i++) {

    if (produto[i] == "Smart Trac Ultra Ex" && linha[i] == "Defasagem") {

      defasagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }
    else if (produto[i] == "Smart Trac Ultra Ex" && linha[i] == "Industrialização") {

      industrializacao.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


    else if (produto[i] == "Smart Trac Ultra Ex" && linha[i] == "Produção / Montagem") {

      montagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


  }
  return { defasagem, industrializacao, montagem }


}
function processoUniTrac() {

  let defasagem = []
  let industrializacao = []
  let montagem = []

  var linha = dadosBaseProcesso().tipoLinha
  var produto = dadosBaseProcesso().produto
  var processo = dadosBaseProcesso().processo
  var operadores = dadosBaseProcesso().operadorPorProcesso
  var pecas = dadosBaseProcesso().pcHora
  var sequencia = dadosBaseProcesso().sequenciaMontagem
  var paralelo = dadosBaseProcesso().paralelismo
  var diaNecessario = dadosBaseProcesso().diasProduzindo
  var filho = dadosBaseProcesso().produtoFilho

  for (var i = 0; i < linha.length; i++) {

    if (produto[i] == "Uni Trac" && linha[i] == "Defasagem") {

      defasagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }
    else if (produto[i] == "Uni Trac" && linha[i] == "Industrialização") {

      industrializacao.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


    else if (produto[i] == "Uni Trac" && linha[i] == "Produção / Montagem") {

      montagem.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }


  }

  return { defasagem, industrializacao, montagem }

}
function processoBaterias() {

  let industrializacao = []


  var linha = dadosBaseProcesso().tipoLinha
  var produto = dadosBaseProcesso().produto
  var processo = dadosBaseProcesso().processo
  var operadores = dadosBaseProcesso().operadorPorProcesso
  var pecas = dadosBaseProcesso().pcHora
  var sequencia = dadosBaseProcesso().sequenciaMontagem
  var paralelo = dadosBaseProcesso().paralelismo
  var diaNecessario = dadosBaseProcesso().diasProduzindo
  var filho = dadosBaseProcesso().produtoFilho

  for (var i = 0; i < linha.length; i++) {


    if (produto[i] == "Baterias" && linha[i] == "Industrialização") {

      industrializacao.push(processo[i], operadores[i], pecas[i], sequencia[i], paralelo[i], diaNecessario[i], linha[i], filho[i])
    }

    else {
      continue;
    }
  }

  return {industrializacao}

}





function dataLote(data) {

  var dataFormatada = Utilities.formatDate(data, Session.getScriptTimeZone(), "yyyyMMdd");
  return "#" + dataFormatada.substring(0, 4) + dataFormatada.substring(4, 6) + dataFormatada.substring(6, 8);
}
function diaSemana(data) {

  var dataInput = new Date(data);
  var diaSemana = dataInput.getDay();

  if (diaSemana == 6) {
    dataInput.setDate(dataInput.getDate() - 1);
  }
  else if (diaSemana == 0) {
    dataInput.setDate(dataInput.getDate() - 2);
  }


  return dataInput;
}
function diaDefasagem(data1, leadTime) {

  var dataProducao = new Date(data1)
  var novaData = new Date()
  var testeDiaDefasagem = new Date(data1)

  if (dataProducao.getDay() == 1 && leadTime == 2) {

    // var testeDiaDefasagem = new Date()
    testeDiaDefasagem.setDate(dataProducao.getDate() - leadTime)
    Logger.log(dataProducao)
    Logger.log(testeDiaDefasagem)
    novaData = diaSemana(testeDiaDefasagem)

  }

  else if (dataProducao.getDay() == 2 && leadTime == 2) {

    //var testeDiaDefasagem = new Date()
    testeDiaDefasagem.setDate(dataProducao.getDate() - (leadTime - 1))
    novaData = diaSemana(testeDiaDefasagem)

  }

  else if ((dataProducao.getDay() == 1 || dataProducao.getDay() == 2) && leadTime >= 3) {

    //var testeDiaDefasagem = new Date()
    testeDiaDefasagem.setDate(dataProducao.getDate() - (leadTime + 1))
    novaData = diaSemana(testeDiaDefasagem)

  }
  else if (leadTime == 1) {
    //var testeDiaDefasagem = new Date()
    testeDiaDefasagem.setDate(dataProducao.getDate())
    novaData = diaSemana(testeDiaDefasagem)

  }
  else if (dataProducao.getDay() == 3 && leadTime == 5) {

    //var testeDiaDefasagem = new Date()
    testeDiaDefasagem.setDate(dataProducao.getDate() - (leadTime + 1))
    novaData = diaSemana(testeDiaDefasagem)

  }
  else if (dataProducao.getDay() == 3 && (leadTime == 3 || leadTime == 2)) {

    //var testeDiaDefasagem = new Date()
    testeDiaDefasagem.setDate(dataProducao.getDate() - (leadTime - 1))
    novaData = diaSemana(testeDiaDefasagem)

  }
  else if (dataProducao.getDay() >= 4 && leadTime < 4) {

    //var testeDiaDefasagem = new Date()
    testeDiaDefasagem.setDate(dataProducao.getDate() - (leadTime - 1))
    novaData = diaSemana(testeDiaDefasagem)

  }

  else {
    //var testeDiaDefasagem = new Date()
    testeDiaDefasagem.setDate(dataProducao.getDate() - leadTime)
    novaData = diaSemana(testeDiaDefasagem)

  }
  return novaData;
}

function calculoDefasagem() {

  const planilha = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/1UWobn-ss5IY4cvG89hYrttCcXB_qc07PmbHsf8r7LNM/edit?gid=270748109#gid=270748109');
  const relatorio = planilha.getSheetByName('Demandas Defasagem');


  // ------------- Informações de demanda de produção ----------//
  var diaProducao = dadosLinha().diaDeProducao
  var demadandaProducao = dadosLinha().demandaProducao

  let gatewayProProd = ["PROD-0020", "PROD-0032"];
  let gatewayUltraProd = ["PROD-0048", "PROD-0050", "PROD-0071"]
  let smartTracProProd = ["PROD-0062", "PROI-0062", "PROD-0063"]
  let smartTracUltraProd = ["PROD-0091", "PROI-0110", "PROD-0110", "PROI-0109", "PROD-0109"]
  let smartTrcUltraExProd = ["PROD-0046", "PROD-0051", "PROD-0113", "PROD-0114"]
  let energyTracProd = ["PROD-0084", "PROD-0083", "PROD-0087"]
  let uniTracProd = ["PROD-0078", "PROD-0079", "PROD-0080", "PROD-0081", "PROD-0082", "PROI-0071"]
  let smartTracUltraGen2Prod = ["PROD-0140","PROD-0152"];

  let prodProdutos = [gatewayProProd, gatewayUltraProd, smartTracProProd, smartTracUltraProd, smartTrcUltraExProd, energyTracProd, uniTracProd, smartTracUltraGen2Prod]
  let funcaoProduto = [processoGatewayPro(), processoGatewayUltra(), processoSmartTracPro(), processoSmartTracUltra(), processoSmartTracUltraEx(), processoEnergy(), processoUniTrac(), processoSmartTracUltraGen2()]

  //-------------- Cruzando inforamação por produto ------------//

  let relatorioDefasagem = []
  let relatorioIndustrializacao = []
  let relatorioMontagem = []

  // -------------- Rodando com dados da "DEMANDA DE PRODUÇÃO" ------------------//

  for (var i = 0; i < diaProducao.length; i++) {
    for (var j = 0; j < 10; j++) {

      // ---------- Se não houver Produção, continuar o código ----------//
      if (demadandaProducao[i][j][0] == "") {
        continue;
      }

      // ---------- Se Produção for Produção, executar ------------------------//

      for (var x = 0; x < prodProdutos.length; x++) {
        for (var y = 0; y < prodProdutos[x].length; y++) {
          //Logger.log(prodProdutos[x][y])

          if (demadandaProducao[i][j][0] == prodProdutos[x][y]) {

            var lote = dataLote(diaProducao[i])
            let qtd = demadandaProducao[i][j][1]
            let def = funcaoProduto[x].defasagem
            let indus = funcaoProduto[x].industrializacao
            let montagem = funcaoProduto[x].montagem

            let multDef = def.length / 8  // para varrer o tamanho do vetor e saber quantas variaveis tem (8 pq são 8 informações)
            let multMontagem = montagem.length / 8

            //Logger.log(diaProducao[i])
            //Logger.log(multDef)

            for (var b = 0; b < multDef; b++) {
              var processo = def[8 * b][0]
              var operadores = def[1 + 8 * b][0]
              var pcHr = def[2 + 8 * b][0]
              var tempoEstimado = qtd / def[2 + 8 * b][0]
              var leadTimeRegressivo = def[5 + 8 * b][0]
              var tipoDaLinha = def[6 + 8 * b][0]

              var diaParaRealizarDefasagem = diaDefasagem(diaProducao[i], leadTimeRegressivo)

              relatorioDefasagem.push(diaProducao[i], demadandaProducao[i][j][0], processo, qtd, operadores, pcHr, tempoEstimado, lote, diaParaRealizarDefasagem, tipoDaLinha)

            }
            for (var b = 0; b < multMontagem; b++) {

              var processo = montagem[8 * b][0]
              var operadores = montagem[1 + 8 * b][0]
              var pcHr = montagem[2 + 8 * b][0]
              var tempoEstimado = qtd / montagem[2 + 8 * b][0]
              var leadTimeRegressivo = montagem[5 + 8 * b][0]
              var tipoDaLinha = montagem[6 + 8 * b][0]

              var diaParaRealizarMontagem = diaDefasagem(diaProducao[i], leadTimeRegressivo)

              relatorioMontagem.push(diaProducao[i], demadandaProducao[i][j][0], processo, qtd, operadores, pcHr, tempoEstimado, lote, diaParaRealizarMontagem, tipoDaLinha)
            }
          }
        }
      }
    }
  }
  //Logger.log(relatorioDefasagem)
  //Logger.log(relatorioIndustrializacao)

  return { relatorioDefasagem, relatorioIndustrializacao, relatorioMontagem }

}
function calculoIndustrializacao() {


  const planilha = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/1UWobn-ss5IY4cvG89hYrttCcXB_qc07PmbHsf8r7LNM/edit?gid=270748109#gid=270748109');

  // ------------- Informações de demanda de produção ----------//

  var diaIndustrializacao = dadosLinha().diaDeProducao
  var demandaIndustrializacao = dadosLinha().demandaIndustrializacao


  let smartTracProProd = ["PROA-0002", "ITCS-0009"]
  let smartTracUltraProd = ["ENCG-0011", "ENCG-0006", "PROA-0007", "PROD-0109", "PROD-0110", "PROI-0069","PROD-0132","ENCG-0026"]
  let smartTrcUltraExProd = ["PROD-0046", "PROD-0051", "ITCS-0002", "PROD-0113", "PROD-0114","ENCG-0017","ENCG-0018"]
  let energyTracProd = ["PROA-0013", "ITCS-0001"]
  let uniTracProd = ["PROD-0079", "PROD-0080", "PROD-0081", "PROD-0082", "PROD-0078"]
  let baterias = ["ITCS-0002","ITCS-0012","ITCS-0014","ITCS-0015"]


  let prodProdutos = [smartTracProProd, smartTracUltraProd, smartTrcUltraExProd, energyTracProd, uniTracProd, baterias]
  let funcaoProduto = [processoSmartTracPro(), processoSmartTracUltra(), processoSmartTracUltraEx(), processoEnergy(), processoUniTrac(),processoBaterias()]

  //-------------- Cruzando inforamação por produto ------------//

  let relatorioIndustrializacao = []

  // -------------- Rodando com dados da "DEMANDA DE PRODUÇÃO" ------------------//

  for (var i = 0; i < diaIndustrializacao.length; i++) {
    for (var j = 0; j < 10; j++) {

      // ---------- Se não houver Produção, continuar o código ----------//
      if (demandaIndustrializacao[i][j][0] == "") {
        continue;
      }

      // ---------- Se Produção for Produção, executar ------------------------//

      for (var x = 0; x < prodProdutos.length; x++) {
        for (var y = 0; y < prodProdutos[x].length; y++) {
          //Logger.log(prodProdutos[x][y])

          if (demandaIndustrializacao[i][j][0] == prodProdutos[x][y]) {

            var lote = dataLote(diaIndustrializacao[i])
            let qtd = demandaIndustrializacao[i][j][1]
            let indus = funcaoProduto[x].industrializacao

            let multIndus = indus.length / 8
            Logger.log(demandaIndustrializacao[i][j][0])
            Logger.log(diaIndustrializacao[i])
            //Logger.log(indus)


            for (var b = 0; b < multIndus; b++) {

              var processo = indus[8 * b][0]
              var operadores = indus[1 + 8 * b][0]
              var tempoEstimado = qtd / indus[2 + 8 * b][0]
              var leadTimeRegressivo = indus[5 + 8 * b][0]
              var tipoDaLinha = indus[6 + 8 * b][0]
              var pcHr = indus[2 + 8 * b][0]
              var filho = indus[7 + 8 * b][0]
              //Logger.log("O filho é: " + filho)

              if (filho != prodProdutos[x][y]) {
                continue;
              }

              else if (filho == prodProdutos[x][y]) {
                var diaParaRealizarIndustrializacao = diaDefasagem(diaIndustrializacao[i], leadTimeRegressivo)

                relatorioIndustrializacao.push(diaIndustrializacao[i], demandaIndustrializacao[i][j][0], processo, qtd, operadores, pcHr, tempoEstimado, lote, diaParaRealizarIndustrializacao, tipoDaLinha)

              }


            }
          }
        }
      }
    }
  }

  Logger.log(relatorioIndustrializacao)

  return { relatorioIndustrializacao }

}


function ploteRelatorio() {

  const planilha = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/1UWobn-ss5IY4cvG89hYrttCcXB_qc07PmbHsf8r7LNM/edit?gid=270748109#gid=270748109');
  const relatorio = planilha.getSheetByName('Demandas Defasagem');

  let relatorios = [calculoDefasagem().relatorioDefasagem, calculoDefasagem().relatorioIndustrializacao, calculoDefasagem().relatorioMontagem, calculoIndustrializacao().relatorioIndustrializacao]

  var ultimaLinha = relatorio.getLastRow()
  var limpeza = relatorio.getRange(2, 1, ultimaLinha, 10)
  limpeza.clearContent()

  for (var a = 0; a < relatorios.length; a++) {


    var multRelatorio = relatorios[a].length / 10


    Logger.log(relatorios[a])


    for (var i = 0; i < multRelatorio; i++) {
      var linhaEscrever = relatorio.getLastRow() + 1

      var diaDeProducao = relatorios[a][10 * i]
      var prod = relatorios[a][1 + 10 * i]
      var processo = relatorios[a][2 + 10 * i]
      var quantidade = relatorios[a][3 + 10 * i]
      var operadores = relatorios[a][4 + 10 * i]
      var pchr = relatorios[a][5 + 10 * i]
      var tempo = relatorios[a][6 + 10 * i]
      var lote = relatorios[a][7 + 10 * i]
      var diaProcesso = relatorios[a][8 + 10 * i]
      var linha = relatorios[a][9 + 10 * i]


      relatorio.getRange(linhaEscrever, 1, 1, 1).setValue(linha)
      relatorio.getRange(linhaEscrever, 2, 1, 1).setValue(diaProcesso)
      relatorio.getRange(linhaEscrever, 3, 1, 1).setValue(diaDeProducao);
      relatorio.getRange(linhaEscrever, 4, 1, 1).setValue(prod);
      relatorio.getRange(linhaEscrever, 5, 1, 1).setValue(processo);
      relatorio.getRange(linhaEscrever, 6, 1, 1).setValue(quantidade);
      relatorio.getRange(linhaEscrever, 7, 1, 1).setValue(operadores);
      relatorio.getRange(linhaEscrever, 8, 1, 1).setValue(pchr);
      relatorio.getRange(linhaEscrever, 9, 1, 1).setValue(tempo);
      relatorio.getRange(linhaEscrever, 10, 1, 1).setValue(lote);

    }
  }


}
