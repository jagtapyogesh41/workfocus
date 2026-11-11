import { Pool } from 'pg';
import { config } from '../config';
import { ensureDatabase, runMigrations } from './migrate';

async function main() {
  await ensureDatabase(config.databaseUrl);
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const ran = await runMigrations(pool, console.log);
    console.log(ran.length ? `Done (${ran.length} applied).` : 'Database is up to date.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
