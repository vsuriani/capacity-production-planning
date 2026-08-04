'use strict';

/**
 * Dev local: só as rotas /api (o Vite serve o frontend em :5173 e faz proxy para cá).
 * Usa as MESMAS rotas file-based do server.cjs.
 */
const express = require('express');
const { loadRoutes } = require('./_lib/routes');
const { esperarBanco, migrar } = require('./_lib/db');

const PORT = Number(process.env.API_PORT || 3001);

async function main() {
  const app = express();
  app.use('/api', express.json({ limit: '15mb' }));

  const rotas = loadRoutes(app);
  console.log(`[api dev] ${rotas.length} rotas: ${rotas.join(', ')}`);

  await esperarBanco();
  await migrar();

  app.listen(PORT, () => console.log(`[api dev] http://localhost:${PORT}`));
}

main().catch((erro) => {
  console.error('[api dev] falha ao subir', erro);
  process.exit(1);
});
