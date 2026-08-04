'use strict';

const path = require('path');
const express = require('express');

const { loadRoutes } = require('./api/_lib/routes');
const { esperarBanco, migrar } = require('./api/_lib/db');

const PORT = Number(process.env.PORT || 3000);
const DIST = path.join(__dirname, 'dist');

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

  app.listen(PORT, () => console.log(`[app] ouvindo em http://localhost:${PORT}`));
}

main().catch((erro) => {
  console.error('[app] falha ao subir', erro);
  process.exit(1);
});
