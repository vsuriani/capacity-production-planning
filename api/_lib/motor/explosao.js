'use strict';

const { corrigido, diagnostico } = require('./desvios');
const { diaDoProcesso, loteDaData } = require('./calendario');

/**
 * Explode a demanda do calendário nos processos que precisam acontecer antes.
 *
 * Porte de `calculoDefasagem()` + `calculoIndustrializacao()` do Código.gs, mas
 * dirigido pelas tabelas `sku_produto` e `processo` em vez dos arrays hardcoded.
 *
 * Duas passagens, como no original:
 *   bloco "producao"          -> processos de defasagem e de produção/montagem
 *   bloco "industrializacao"  -> processos de industrialização, filtrados por produto filho
 */

const TIPOS_DA_PRODUCAO = ['defasagem', 'producao_montagem'];

/**
 * @param {object} entrada
 * @param {{data: string, bloco: string, skuCodigo: string, quantidade: number}[]} entrada.slots
 * @param {Map<string, number[]>} entrada.mapaSku       `${sku}|${escopo}` -> produtoIds
 * @param {Map<number, object[]>} entrada.processosPorProduto
 * @param {Map<number, string>} entrada.nomesProduto
 * @param {Record<string, boolean>} [entrada.correcoes]
 * @param {Set<string>} [entrada.feriados]
 */
function explodirDemanda({
  slots,
  mapaSku,
  processosPorProduto,
  nomesProduto = new Map(),
  correcoes = {},
  feriados = new Set(),
}) {
  const estaCorrigido = corrigido(correcoes);
  const linhas = [];

  const semMapeamento = new Map(); // sku -> quantidade acumulada
  const roteiroVazio = new Map(); // `sku -> produto` -> quantidade
  const semTaxa = new Map(); // `sku · processo` -> ocorrências
  const ambiguos = new Map(); // sku -> nomes de produto

  for (const slot of slots) {
    const sku = String(slot.skuCodigo || '').trim();
    if (!sku) continue;

    const quantidade = Number(slot.quantidade || 0);
    const escopo = slot.bloco === 'industrializacao' ? 'industrializacao' : 'producao';
    const tiposAceitos = escopo === 'industrializacao' ? ['industrializacao'] : TIPOS_DA_PRODUCAO;

    let produtoIds = mapaSku.get(`${sku}|${escopo}`) ?? [];

    if (produtoIds.length === 0) {
      semMapeamento.set(sku, (semMapeamento.get(sku) ?? 0) + quantidade);
      continue;
    }

    if (produtoIds.length > 1) {
      ambiguos.set(sku, produtoIds.map((id) => nomesProduto.get(id) ?? `#${id}`));
      // Fiel: o loop original não tem break e gera as linhas de todos os grupos.
      if (estaCorrigido('sku-em-dois-grupos')) produtoIds = [produtoIds[0]];
    }

    for (const produtoId of produtoIds) {
      const doProduto = processosPorProduto.get(produtoId) ?? [];
      let processos = doProduto.filter((p) => tiposAceitos.includes(p.tipoLinha));

      // A industrialização só roda para o processo cujo "Produto Filho" é o próprio SKU.
      if (escopo === 'industrializacao') {
        processos = processos.filter((p) => String(p.skuFilho || '').trim() === sku);
      }

      if (processos.length === 0) {
        const chave = `${sku} → ${nomesProduto.get(produtoId) ?? `#${produtoId}`}`;
        roteiroVazio.set(chave, (roteiroVazio.get(chave) ?? 0) + quantidade);
        continue;
      }

      for (const processo of processos) {
        const pcsHora = Number(processo.pcsHora ?? 0);

        let tempoHoras;
        if (pcsHora > 0) {
          tempoHoras = quantidade / pcsHora;
        } else {
          const chave = `${sku} · ${processo.nome}`;
          semTaxa.set(chave, (semTaxa.get(chave) ?? 0) + 1);
          // Fiel: qtd/0 = Infinity, que a planilha mostra como célula vazia.
          tempoHoras = estaCorrigido('tempo-sem-guarda') ? null : Infinity;
        }

        linhas.push({
          tipoLinha: processo.tipoLinha,
          diaProcesso: diaDoProcesso(slot.data, processo.leadtimeDias, correcoes, feriados),
          diaProducao: slot.data,
          skuCodigo: sku,
          processoId: processo.id,
          processoNome: processo.nome,
          quantidade,
          operadores: processo.operadores,
          pcsHora: pcsHora > 0 ? pcsHora : null,
          tempoHoras,
          lote: loteDaData(slot.data),
          sequencia: processo.sequencia,
        });
      }
    }
  }

  // --- diagnósticos --------------------------------------------------------

  const diagnosticos = [];

  if ((semMapeamento.size || roteiroVazio.size) && !estaCorrigido('sku-sem-roteiro-silencioso')) {
    const itens = [
      ...[...semMapeamento].map(([sku, qtd]) => ({
        sku,
        motivo: 'sem mapeamento SKU → produto',
        quantidade: qtd,
      })),
      ...[...roteiroVazio].map(([chave, qtd]) => ({
        sku: chave,
        motivo: 'produto mapeado sem processos do tipo esperado',
        quantidade: qtd,
      })),
    ];
    const total = itens.reduce((s, i) => s + i.quantidade, 0);
    diagnosticos.push(
      diagnostico(
        'sku-sem-roteiro-silencioso',
        `${itens.length} item(ns) não geraram linha de demanda — ${total} peças ignoradas.`,
        { itens },
      ),
    );
  }

  if (ambiguos.size && !estaCorrigido('sku-em-dois-grupos')) {
    diagnosticos.push(
      diagnostico(
        'sku-em-dois-grupos',
        `${ambiguos.size} SKU mapeado(s) para mais de um produto — as linhas saem duplicadas.`,
        { itens: [...ambiguos].map(([sku, produtos]) => ({ sku, produtos })) },
      ),
    );
  }

  if (semTaxa.size && !estaCorrigido('tempo-sem-guarda')) {
    diagnosticos.push(
      diagnostico(
        'tempo-sem-guarda',
        `${semTaxa.size} processo(s) sem Pç/Hr — o tempo estimado sai como infinito.`,
        { itens: [...semTaxa].map(([chave, vezes]) => ({ processo: chave, ocorrencias: vezes })) },
      ),
    );
  }

  if (!estaCorrigido('leadtime-caso-a-caso')) {
    diagnosticos.push(
      diagnostico(
        'leadtime-caso-a-caso',
        'As datas de processo vieram das regras caso-a-caso da planilha, não de dias úteis.',
      ),
    );
  }

  return { linhas, diagnosticos };
}

module.exports = { explodirDemanda, TIPOS_DA_PRODUCAO };
