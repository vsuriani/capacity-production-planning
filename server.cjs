'use strict';

const path = require('path');
const express = require('express');

const { loadRoutes } = require('./api/_lib/routes');
const { esperarBanco, migrar } = require('./api/_lib/db');
const { configurado } = require('./api/_lib/sheets');

const PORT = Number(process.env.PORT || 3000);
const DIST = path.join(__dirname, 'dist');

// Sync dos tempos da planilha "Análises Best Laps".
const SYNC_HORAS = Number(process.env.TEMPOS_SYNC_HORAS || 24);
const SYNC_ATRASO_MS = 5 * 60 * 1000;

/**
 * Arma o sync periódico — e só arma quando há planilha E credencial.
 *
 * Sem as duas variáveis o app sobe exatamente como subia antes: é o que mantém o dev local, e
 * qualquer ambiente sem secret, funcionando sem nenhum caminho condicional dentro das rotas.
 *
 * A primeira execução espera 5 min para não competir com as migrations e o primeiro tráfego do
 * boot. Falha nunca derruba o processo: `executarSync` grava o erro em `tempo_sync` e devolve
 * `{ok: false}`. Planilha fora do ar não pode tirar o planejamento do ar.
 */
function agendarSyncDeTempos() {
  if (!process.env.TEMPOS_SHEET_ID || !configurado()) {
    console.log('[tempos] sync desarmado (falta TEMPOS_SHEET_ID ou GOOGLE_SA_JSON)');
    return;
  }

  const { executarSync } = require('./api/_handlers/tempos');

  const rodar = async () => {
    try {
      const r = await executarSync({ origem: 'agendado' });
      if (r.ok) {
        console.log(`[tempos] sync ok: ${r.linhas} linhas, ${r.alteracoes.length} alteração(ões)`);
      } else {
        console.error(`[tempos] sync falhou: ${r.erro}`);
      }
    } catch (erro) {
      console.error('[tempos] sync lançou', erro);
    }
  };

  setTimeout(rodar, SYNC_ATRASO_MS).unref();
  setInterval(rodar, SYNC_HORAS * 60 * 60 * 1000).unref();
  console.log(`[tempos] sync a cada ${SYNC_HORAS}h, primeira leitura em 5min`);
}

async function main() {
  const app = express();

  app.use('/api', express.json({ limit: '15mb' }));

  const rotas = loadRoutes(app);
  console.log(`[api] ${rotas.length} rotas: ${rotas.join(', ')}`);

  app.use(express.static(DIST, { index: false }));

  // Fallback SPA para tudo que não é /api.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST, 'index.html'));
  });

  await esperarBanco();
  await migrar();

  agendarSyncDeTempos();

  app.listen(PORT, () => console.log(`[app] ouvindo em http://localhost:${PORT}`));
}

main().catch((erro) => {
  console.error('[app] falha ao subir', erro);
  process.exit(1);
});
