function dimensionamentoDeOperadores() {
  // ----------------- Declaração das planilhas ---------------------------------//

  const planilha = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/1UWobn-ss5IY4cvG89hYrttCcXB_qc07PmbHsf8r7LNM/edit?gid=270748109#gid=270748109');
  const relatorio = planilha.getSheetByName('Demandas Defasagem');
  const relatorioOperadores = planilha.getSheetByName('Dimensionamento de Operadores');

  var qtdOperadores = dadosLinha().qtdOperadoes
  var ultimaLinha = relatorio.getLastRow();

  // ----------------- Pegando informações das planilhas ---------------------------------//

  let diaDoProcesso = relatorio.getRange(2, 2, ultimaLinha, 1).getValues();
  let prod = relatorio.getRange(2, 4, ultimaLinha, 1).getValues();
  let operadores = relatorio.getRange(2, 7, ultimaLinha, 1).getValues();
  let processo = relatorio.getRange(2, 5, ultimaLinha, 1).getValues();
  let tempo = relatorio.getRange(2, 9, ultimaLinha, 1).getValues();
  let check = relatorio.getRange(2, 11, ultimaLinha, 1).getValues();

  let tempoPorOperador = []
  let diaUnico = []
  let tempoTotaldoDia = []

  //---------------- Setando a Página "DIMENSIONMENTO DE OPERADORES" ---------------------//

  var ultimaLinhaRelatorio = relatorioOperadores.getLastRow();
  var ultimaColunaRelatorio = relatorioOperadores.getLastColumn();
  var limpeza = relatorioOperadores.getRange(1, 1, ultimaLinhaRelatorio,ultimaColunaRelatorio)
  limpeza.clearContent()

  for (var i = 1; i <= qtdOperadores; i++) {
    var titleDay = "Dias"
    var title = "Operador " + ([i])

    relatorioOperadores.getRange(1, 1, 1, 1).setValue(titleDay)
    relatorioOperadores.getRange(1, 1 + i, 1, 1).setValue(title)

    tempoPorOperador.push(0)

  }

  //----------------- Preenchendo a demanda por dia dos operadores -------------------------------------------//

  for (var i = 0; i < diaDoProcesso.length; i++) {

    Logger.log("---------------------------------------------------------------------")
    Logger.log("Check : " + check[i])
    Logger.log("dia do Processo: " + diaDoProcesso[i] + " | Processo: " + processo[i] + " | PROD: " + prod[i]);
    Logger.log("operadores: " + operadores[i] + "| tempo estimado: " + tempo[i]);

    var count = 0;
    var ultimaLinha = relatorio.getLastRow();

    var diaAtual = new Date(diaDoProcesso[i]);
    var diaAnterior = i > 0 ? new Date(diaDoProcesso[i - 1]) : null;





    // ----------------- Check se é outro dia e, caso for, preenche as informações passadas -------------------- //

    if (!diaAnterior || diaAtual.getDate() != diaAnterior.getDate()) {

      diaUnico.push(diaAnterior)
      var ultimaLinha = relatorioOperadores.getLastRow() + 1;
      relatorioOperadores.getRange(ultimaLinha, 1, 1, 1).setValue(diaAnterior)

      for (var a = 0; a < tempoPorOperador.length; a++) {
        relatorioOperadores.getRange(ultimaLinha, a + 2, 1, 1).setValue(tempoPorOperador[a])
      }
      Logger.log("Tempo total do dia anterior: \n" + [tempoPorOperador])
      tempoPorOperador.fill(0);
      Logger.log("entrou na limpeza do vetores")
    }
    // ----------------- Caso o Processo já esteja realizado, desconsidera da conta ----------------------------//

    if (check[i] == "true") {
      Logger.log("Está feito. Logo, não atribui tempo a operadores")
      continue;
    }

    // --------------- Priorizando os operadoes sem tempo atribuido -----------------------//

    for (var j = 0; j < operadores[i]; j++) {
      for (var k = 0; k < tempoPorOperador.length; k++) {

        if (count == operadores[i]) {
          continue;
        }
        else if (tempoPorOperador[k] == 0) {
          tempoPorOperador[k] = Number(tempo[i])
          count = count + 1;
        }
      }
    }

    // --------------- Após todos os operadores ter tempo, entrar nessa condição -----------------------//

    for (var j = 0; j < operadores[i]; j++) {
      for (var k = 0; k < tempoPorOperador.length; k++) {

        if (count == operadores[i]) {
          continue;
        }

        else if (tempo[i] > 7 && tempoPorOperador[k] < 1) {
          tempoPorOperador[k] = Number(tempo[i]) + Number(tempoPorOperador[k])
          count = count + 1;
          Logger.log(tempoPorOperador[k])
        }

        else if (tempo[i] > 7 && tempoPorOperador[k] > 3) {
          continue
        }

        else if ((tempoPorOperador[k] < 7.5) && (count < operadores[i])) {

          count = count + 1;

          var sum = Number(tempoPorOperador[k]) + Number(tempo[i])
          tempoPorOperador[k] = sum
          Logger.log(count)
          Logger.log(tempoPorOperador[k])
        }
      }
    }

    // --------------- Após todos os operadores ter tempo, entrar nessa condição -----------------------//

    for (var j = 0; j < operadores[i]; j++) {
      for (var a = 0; a < 2; a++) {
        for (var k = 0; k < tempoPorOperador.length; k++) {

          if (count == operadores[i]) {
            continue;
          }
          else if (tempoPorOperador[k] > 8 && a == 0) {
            continue
          }
          else if (count < operadores[i]) {
            count = count + 1;
            var sum = Number(tempoPorOperador[k]) + Number(tempo[i])
            tempoPorOperador[k] = sum
          }
        }
      }
    }
    Logger.log(tempoPorOperador)
  }

}

function analiseDemanda() {

  const planilha = SpreadsheetApp.openByUrl('https://docs.google.com/spreadsheets/d/1UWobn-ss5IY4cvG89hYrttCcXB_qc07PmbHsf8r7LNM/edit?gid=270748109#gid=270748109');
  const relatorio = planilha.getSheetByName('Demandas Defasagem');


  var ultimaLinha = relatorio.getLastRow();

  let diaDoProcesso = relatorio.getRange(2, 2, ultimaLinha, 1).getValues();
  let operadores = relatorio.getRange(2, 7, ultimaLinha, 1).getValues();
  let processo = relatorio.getRange(2, 5, ultimaLinha, 1).getValues();
  let tempo = relatorio.getRange(2, 9, ultimaLinha, 1).getValues();

  for (var i = 0; i < diaDoProcesso.length; i++) {

    Logger.log(diaDoProcesso[i])

    var diaAtual = new Date(diaDoProcesso[i]);
    var diaAnterior = i > 0 ? new Date(diaDoProcesso[i - 1]) : null;

    if (!diaAnterior || diaAtual.getDate() !== diaAnterior.getDate()) {

    }

    else if (diaAtual == diaAnterior) {


    }





  }
}
