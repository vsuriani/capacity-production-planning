'use strict';

/**
 * Dev server SEM Docker: as rotas /api reais, com o pool do pg trocado por um Postgres
 * em WASM persistido em .cache/pgdata.
 *
 * Só para desenvolvimento local. Em produção o app usa `server.cjs` + `postgres:16`, e
 * este arquivo nem vai para a imagem (o Dockerfile copia `api/` mas roda `server.cjs`).
 *
 * A troca é feita por require.cache, então NENHUM código de produção tem caminho
 * condicional para o modo dev.
 *
 * Uso:  npm run dev:api
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

const PORTA = Number(process.env.API_PORT || 3001);
const RAIZ = path.join(__dirname, '..');
const DADOS = path.join(RAIZ, '.cache', 'pgdata');

async function main() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(DADOS);
  await db.waitReady;

  // Substitui api/_lib/db.js antes de qualquer handler ser carregado.
  const caminhoDb = require.resolve('./_lib/db.js');
  require.cache[caminhoDb] = {
    id: caminhoDb,
    filename: caminhoDb,
    loaded: true,
    exports: {
      query: (sql, params) => db.query(sql, params),
      // pglite é single-connection: sem BEGIN aninhado, o callback recebe o próprio db.
      transacao: async (fn) => fn(db),
      getPool: () => db,
      esperarBanco: async () => {},
      migrar: async () => {},
    },
  };

  // Migrations idempotentes (a tabela de controle vive no próprio arquivo persistido).
  await db.exec(`CREATE TABLE IF NOT EXISTS migracao (
    nome text PRIMARY KEY, aplicada timestamptz NOT NULL DEFAULT now())`);
  const dirMigrations = path.join(RAIZ, 'api', 'migrations');
  const { rows } = await db.query('SELECT nome FROM migracao');
  const aplicadas = new Set(rows.map((r) => r.nome));
  for (const arquivo of fs.readdirSync(dirMigrations).filter((f) => f.endsWith('.sql')).sort()) {
    if (aplicadas.has(arquivo)) continue;
    await db.exec(fs.readFileSync(path.join(dirMigrations, arquivo), 'utf8'));
    await db.query('INSERT INTO migracao (nome) VALUES ($1)', [arquivo]);
    console.log(`[dev] migration aplicada: ${arquivo}`);
  }

  const { loadRoutes } = require('./_lib/routes.js');
  const app = express();
  app.use('/api', express.json({ limit: '15mb' }));
  const rotas = loadRoutes(app);

  app.listen(PORTA, () => {
    console.log(`[dev] Postgres em WASM: ${DADOS}`);
    console.log(`[dev] ${rotas.length} rotas: ${rotas.join(', ')}`);
    console.log(`[dev] API em http://localhost:${PORTA}`);
  });
}

main().catch((erro) => {
  console.error('[dev] falha ao subir', erro);
  process.exit(1);
});
