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

// 3101 e não 3001: a porta padrão já é usada por outro projeto interno na máquina de dev.
// Este arquivo é só de desenvolvimento. Em produção roda `server.cjs`, e quem autentica é
// o gateway da Vibe (header X-Auth-Email). Se alguém apontar isto para produção, para.
if (process.env.NODE_ENV === 'production') {
  console.error('[dev] dev-server-pglite não roda em produção — use server.cjs');
  process.exit(1);
}

// Sem gateway no local, `api/_lib/auth.js` cai no DEV_FAKE_EMAIL. Sem ele, TODA rota
// responde 401 e as telas mostram "Não autenticado" — então damos um padrão e avisamos.
if (!process.env.DEV_FAKE_EMAIL) {
  process.env.DEV_FAKE_EMAIL = 'dev@tractian.com';
}

const PORTA = Number(process.env.API_PORT || 3101);
const RAIZ = path.join(__dirname, '..');
const DADOS = path.join(RAIZ, '.cache', 'pgdata');

/**
 * O datadir do pglite não sobrevive a um kill forçado nem a ser apagado com o servidor
 * de pé — e aí `_pg_initdb` aborta no boot seguinte, derrubando TODAS as telas de uma vez.
 * Em dev isso não vale um diagnóstico manual: recria e segue, avisando.
 */
async function abrirBanco(PGlite) {
  try {
    const db = new PGlite(DADOS);
    await db.waitReady;
    return db;
  } catch (erro) {
    console.warn(`[dev] banco local ilegível (${erro.message.slice(0, 80)}) — recriando`);
    fs.rmSync(DADOS, { recursive: true, force: true });
    const db = new PGlite(DADOS);
    await db.waitReady;
    console.warn('[dev] banco recriado vazio. Rode: python scripts/importar_planilha.py');
    return db;
  }
}

async function main() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = await abrirBanco(PGlite);

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
  // `recarregar`: o handler é relido a cada request, então editar uma rota vale sem reiniciar
  // este processo — que é justamente o que não se pode matar à força (o datadir do PGlite não
  // sobrevive). Só as dependências ficam em cache, inclusive a troca do banco feita acima.
  const rotas = loadRoutes(app, { recarregar: true });

  app.listen(PORTA, () => {
    console.log(`[dev] autenticado como ${process.env.DEV_FAKE_EMAIL} (sem gateway no local)`);
    console.log(`[dev] Postgres em WASM: ${DADOS}`);
    console.log(`[dev] ${rotas.length} rotas: ${rotas.join(', ')}`);
    console.log(`[dev] API em http://localhost:${PORTA}`);
  });
}

main().catch((erro) => {
  console.error('[dev] falha ao subir', erro);
  process.exit(1);
});
