import 'reflect-metadata';
import { INestApplication, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import { Pool } from 'pg';
import { AppModule } from './app.module';
import { assertProductionSafe, config, pgPoolConfig } from './config';
import { ensureDatabase, runMigrations } from './db/migrate';
import { seed } from './db/seed';

export async function createApp(): Promise<INestApplication> {
  assertProductionSafe();
  if (config.autoMigrate) {
    await ensureDatabase(config.databaseUrl);
    const pool = new Pool(pgPoolConfig(config.databaseUrl));
    try {
      await runMigrations(pool, (m) => new Logger('Migrations').log(m));
      if (config.autoSeed) {
        await seed(pool);
      }
    } finally {
      await pool.end();
    }
  }
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ['log', 'warn', 'error'] });
  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }));
  const origins = config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((s) => s.trim());
  app.enableCors({ origin: origins, credentials: false });
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() {
  const app = await createApp();
  await app.listen(config.port);
  new Logger('ShiftFocus').log(
    `API listening on http://localhost:${config.port} (simulator ${config.simulatorEnabled ? 'on' : 'off'}, autoSeed ${config.autoSeed ? 'on' : 'off'})`,
  );
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
