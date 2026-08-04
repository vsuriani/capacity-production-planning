'use strict';

/**
 * Composição da métrica de tempo-padrão por dispositivo (aba 🚧 Dimensionamento Global).
 *
 *   parcial = Σ(componentes aditivos) + retrabalho × (1 − FTR)
 *   real    = parcial / coefEficiencia
 *
 * O FTR (first-time-right) faz o retrabalho pesar só sobre a fração que reprova: com
 * FTR 0,95 apenas 5% do tempo de retrabalho entra na conta.
 *
 * A quantidade de componentes varia por dispositivo (3 a 5 na planilha) e os rótulos são
 * livres — "- Defasagem STU EX", "- Montagem SRU Gen1", "- Bateria STU EX Gen2",
 * "- Garra OEE Trac". Por isso o que classifica é o `papel`, não o nome.
 *
 * @param {{rotulo: string, papel: 'aditivo'|'retrabalho'|'ftr', valor: number}[]} componentes
 * @param {number} coefEficiencia
 */
function metricaDoDispositivo(componentes, coefEficiencia) {
  let aditivos = 0;
  let retrabalho = 0;
  let ftr = 0;

  for (const c of componentes) {
    const valor = Number(c.valor ?? 0);
    if (c.papel === 'aditivo') aditivos += valor;
    else if (c.papel === 'retrabalho') retrabalho += valor;
    else if (c.papel === 'ftr') ftr = valor;
    else throw new Error(`papel de componente desconhecido: ${c.papel}`);
  }

  const parcial = aditivos + retrabalho * (1 - ftr);
  const real = coefEficiencia > 0 ? parcial / coefEficiencia : null;

  return { parcial, real, aditivos, retrabalho, ftr };
}

module.exports = { metricaDoDispositivo };
