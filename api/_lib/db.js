'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL não definida');
    pool = new Pool({ connectionString, max: 10 });
    pool.on('error', (erro) => console.error('[db] erro no pool', erro));
  }
  return pool;
}

async function query(sql, params) {
  return getPool().query(sql, params);
}

/** Uma transação; devolve o que o callback retornar. */
async function transacao(fn) {
  const cliente = await getPool().connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    await cliente.query('ROLLBACK');
    throw erro;
  } finally {
    cliente.release();
  }
}

/**
 * O app pode subir antes do banco (gotcha 4 da Vibe) — tenta conectar com backoff
 * antes de aplicar as migrations.
 */
async function esperarBanco({ tentativas = 30, intervaloMs = 2000 } = {}) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      await query('SELECT 1');
      return;
    } catch (erro) {
      if (i === tentativas) throw erro;
      console.log(`[db] aguardando o banco (${i}/${tentativas})…`);
      await new Promise((r) => setTimeout(r, intervaloMs));
    }
  }
}

/** Aplica os .sql de api/migrations em ordem, uma vez cada. */
async function migrar() {
  await query(`
    CREATE TABLE IF NOT EXISTS migracao (
      nome     text PRIMARY KEY,
      aplicada timestamptz NOT NULL DEFAULT now()
    )
  `);

  const arquivos = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await query('SELECT nome FROM migracao');
  const aplicadas = new Set(rows.map((r) => r.nome));

  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, arquivo), 'utf8');
    await transacao(async (cliente) => {
      await cliente.query(sql);
      await cliente.query('INSERT INTO migracao (nome) VALUES ($1)', [arquivo]);
    });
    console.log(`[db] migration aplicada: ${arquivo}`);
  }
}

module.exports = { getPool, query, transacao, esperarBanco, migrar };
