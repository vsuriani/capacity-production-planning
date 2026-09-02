/**
 * Exporta os dados do banco de dev (PGlite, .cache/pgdata) como um .sql que se
 * aplica num Postgres de verdade — é assim que o que está na máquina do dev vai
 * parar nas Raspberry.
 *
 * Só dados. O schema é das migrations, que rodam na subida do container; por isso
 * `migracao` fica de fora — deixá-la entrar sobrescreveria o registro do próprio
 * destino com o do dev.
 *
 * O arquivo sai auto-contido: transação única, TRUNCATE antes de inserir (a carga
 * é idempotente e substitui o destino) e as sequences reposicionadas no fim. As FKs
 * são desligadas durante a carga com session_replication_role, o que evita ter que
 * ordenar as 26 tabelas topologicamente.
 *
 *   node scripts/exportar_dados.mjs [saida.sql]
 *
 * Requer o dev server parado: o PGlite é embutido no processo dele e o datadir não
 * aceita dois donos. Ver o gotcha do datadir no README.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DADOS = path.join(RAIZ, '.cache', 'pgdata');
const SAIDA = process.argv[2] || path.join(RAIZ, '.cache', 'dump-dados.sql');

/** Tabela de controle das migrations: o destino tem a dele. */
const IGNORAR = new Set(['migracao']);

const aspas = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Data sem fuso: um `date` é um dia do calendário, não um instante. */
function dataUTC(d) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getUTCFullYear(), 4)}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function literal(valor, udt) {
  if (valor === null || valor === undefined) return 'NULL';

  if (udt === 'jsonb' || udt === 'json') {
    return aspas(typeof valor === 'string' ? valor : JSON.stringify(valor));
  }
  if (udt === 'date') {
    return aspas(valor instanceof Date ? dataUTC(valor) : valor);
  }
  if (udt === 'timestamptz' || udt === 'timestamp') {
    return aspas(valor instanceof Date ? valor.toISOString() : valor);
  }
  if (udt === 'bool') return valor ? 'TRUE' : 'FALSE';

  if (udt === 'int2' || udt === 'int4' || udt === 'int8' || udt === 'numeric' || udt === 'float4' || udt === 'float8') {
    if (typeof valor === 'number' && !Number.isFinite(valor)) return aspas(valor); // NaN/Infinity
    // numeric chega como string; validar evita injetar lixo sem aspas no SQL.
    const s = String(valor);
    if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) {
      throw new Error(`valor não numérico em coluna ${udt}: ${s}`);
    }
    return s;
  }
  // text e os enums (tipo_cenario, origem_demanda, …) — todos literais entre aspas.
  return aspas(valor);
}

const { PGlite } = await import('@electric-sql/pglite');
if (!fs.existsSync(DADOS)) {
  console.error(`[export] não achei ${DADOS}`);
  process.exitCode = 1;
} else {
  const db = new PGlite(DADOS);

  const { rows: tabelas } = await db.query(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  const nomes = tabelas.map((t) => t.tablename).filter((t) => !IGNORAR.has(t));

  const out = [];
  out.push('-- Gerado por scripts/exportar_dados.mjs — dados do banco de dev (PGlite).');
  out.push(`-- ${new Date().toISOString()}`);
  out.push('BEGIN;');
  out.push("SET session_replication_role = 'replica';  -- FKs off durante a carga");
  out.push('');
  out.push(`TRUNCATE ${nomes.map((n) => `"${n}"`).join(', ')} RESTART IDENTITY CASCADE;`);
  out.push('');

  let total = 0;
  for (const tabela of nomes) {
    const { rows: cols } = await db.query(
      `select column_name, udt_name from information_schema.columns
        where table_schema = 'public' and table_name = $1
        order by ordinal_position`,
      [tabela],
    );
    const { rows } = await db.query(`select * from "${tabela}"`);
    if (!rows.length) continue;

    const lista = cols.map((c) => `"${c.column_name}"`).join(', ');
    out.push(`-- ${tabela}: ${rows.length}`);
    for (const linha of rows) {
      const vals = cols.map((c) => literal(linha[c.column_name], c.udt_name)).join(', ');
      out.push(`INSERT INTO "${tabela}" (${lista}) VALUES (${vals});`);
    }
    out.push('');
    total += rows.length;
  }

  // RESTART IDENTITY zera as sequences; sem isto o próximo insert do app colide.
  out.push('-- sequences');
  const { rows: seqs } = await db.query(
    `select table_name, column_name from information_schema.columns
      where table_schema = 'public' and column_default like 'nextval%'
      order by table_name`,
  );
  for (const s of seqs) {
    if (IGNORAR.has(s.table_name)) continue;
    out.push(
      `SELECT setval(pg_get_serial_sequence('"${s.table_name}"', '${s.column_name}'),` +
        ` COALESCE((SELECT MAX("${s.column_name}") FROM "${s.table_name}"), 0) + 1, false);`,
    );
  }

  out.push('');
  out.push("SET session_replication_role = 'origin';");
  out.push('COMMIT;');

  fs.writeFileSync(SAIDA, out.join('\n') + '\n', 'utf8');
  await db.close();

  const kb = (fs.statSync(SAIDA).size / 1024).toFixed(0);
  console.log(`[export] ${total} linhas de ${nomes.length} tabelas -> ${SAIDA} (${kb} KB)`);
}
