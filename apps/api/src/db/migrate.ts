import { Client, Pool } from 'pg';
import { migrations } from './migrations';

/** Creates the target database if it does not exist (development convenience). */
export async function ensureDatabase(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!dbName) return;
  url.pathname = '/postgres';
  const client = new Client({ connectionString: url.toString() });
  try {
    await client.connect();
    const exists = await client.query('select 1 from pg_database where datname = $1', [dbName]);
    if (exists.rowCount === 0) {
      await client.query(`create database "${dbName.replace(/"/g, '""')}"`);
    }
  } catch {
    // Managed databases often disallow connecting to "postgres"; assume the DB exists.
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function runMigrations(pool: Pool, log: (msg: string) => void = () => undefined): Promise<string[]> {
  await pool.query(
    'create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())',
  );
  const applied = new Set(
    (await pool.query<{ id: string }>('select id from schema_migrations')).rows.map((r) => r.id),
  );
  const ran: string[] = [];
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(m.sql);
      await client.query('insert into schema_migrations (id) values ($1)', [m.id]);
      await client.query('COMMIT');
      ran.push(m.id);
      log(`Applied migration ${m.id}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  return ran;
}
