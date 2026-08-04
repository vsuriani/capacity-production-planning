/**
 * FUNÇÃO PRINCIPAL: PLOTAR PROJEÇÃO
 * Limpa toda a área de planejamento (até a Semana 4), remove bloqueios e distribui os dados.
 */
function plotarNaProjecao() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const abaProj = ss.getSheetByName('Projeção das linhas');
  const abaDem = ss.getSheetByName('Demandas Defasagem');

  // 1. LIMPEZA TOTAL DA ÁREA DE PLANEJAMENTO (Semanas 1 a 4)
  // O intervalo foi estendido até a coluna BY para garantir que a Semana 4 seja limpa.
  const intervaloTotal = abaProj.getRange("C9:BY29");
  intervaloTotal.clearContent(); // Apaga textos e números antigos
  intervaloTotal.setDataValidation(null); // Remove as listas suspensas que causam o erro

  // 2. CAPTURA DOS DADOS DA ABA DEMANDAS DEFASAGEM
  const dadosDemandas = abaDem.getDataRange().getValues();

  for (let i = 1; i < dadosDemandas.length; i++) {
    let tipoLinha = dadosDemandas[i][0];    // Coluna A (Tipo)
    let dataProcesso = dadosDemandas[i][1];  // Coluna B (Dia do Processo)
    let produto = dadosDemandas[i][3];       // Coluna D (Cód Sap)
    let processoNome = dadosDemandas[i][4];  // Coluna E (Processo)
    let qtd = dadosDemandas[i][5];           // Coluna F (Qtd Necessária)
    let tempo = Number(dadosDemandas[i][8]); // Coluna I (Tempo Estimado)

    if (!produto || !(dataProcesso instanceof Date)) continue;

    // 3. DEFINIÇÃO DO BLOCO DE DESTINO (Produção ou Industrialização)
    // Se o tipo for "Defasagem" ou "Produção / Montagem", vai para o bloco superior.
    let linhaInicio = (tipoLinha === "Produção / Montagem" || tipoLinha === "Defasagem") ? 9 : 20;
    let linhaFim = (tipoLinha === "Produção / Montagem" || tipoLinha === "Defasagem") ? 18 : 29;

    if (tipoLinha !== "Produção / Montagem" && tipoLinha !== "Industrialização" && tipoLinha !== "Defasagem") continue;

    // 4. VALIDAÇÃO DE CAPACIDADE E PLOTAGEM NAS 3 COLUNAS
    if (validarCapacidade(dataProcesso, tempo)) {
      let col = buscarColunaPorData(dataProcesso);
      if (col) {
        // Tenta encontrar uma linha vazia dentro do bloco correspondente
        for (let r = linhaInicio; r <= linhaFim; r++) {
          // Layout Novo: col = Cód Sap | col + 1 = Processo | col + 2 = Qtd
          if (abaProj.getRange(r, col).getValue() === "") {
            abaProj.getRange(r, col).setValue(produto);
            abaProj.getRange(r, col + 1).setValue(processoNome);
            abaProj.getRange(r, col + 2).setValue(qtd);
            break;
          }
        }
      }
    }
  }
  ss.toast("Projeção reiniciada e atualizada com sucesso!", "PCP");
}

/**
 * BUSCA A COLUNA PELA DATA (Linha 6 da Projeção)
 */
function buscarColunaPorData(dataAlvo) {
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Projeção das linhas');
  const datasLinha = aba.getRange(6, 1, 1, aba.getLastColumn()).getValues()[0];

  let dataAjustada = new Date(dataAlvo);
  // Se for Sábado (6) ou Domingo (0), antecipa para Sexta-feira
  if (dataAjustada.getDay() === 0) dataAjustada.setDate(dataAjustada.getDate() - 2);
  else if (dataAjustada.getDay() === 6) dataAjustada.setDate(dataAjustada.getDate() - 1);

  const tAlvo = dataAjustada.setHours(0,0,0,0);
  for (let c = 0; c < datasLinha.length; c++) {
    if (datasLinha[c] instanceof Date && new Date(datasLinha[c]).setHours(0,0,0,0) === tAlvo) {
      return c + 1;
    }
  }
  return null;
}

/**
 * VALIDAÇÃO DE CAPACIDADE (Operadores na célula B3)
 */
function validarCapacidade(dataProcesso, novoTempo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const abaProj = ss.getSheetByName('Projeção das linhas');
  const capMax = abaProj.getRange("B3").getValue() * 8.8; // Operadores x 8.8h

  const dados = ss.getSheetByName('Demandas Defasagem').getDataRange().getValues();
  let ocupado = 0;
  const tAlvo = new Date(dataProcesso).setHours(0,0,0,0);

  for (let i = 1; i < dados.length; i++) {
    if (dados[i][1] instanceof Date && new Date(dados[i][1]).setHours(0,0,0,0) === tAlvo) {
      ocupado += Number(dados[i][8]) || 0; // Coluna I (Tempo Estimado)
    }
  }
  return (ocupado + novoTempo) <= capMax;
}
