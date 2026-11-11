import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../config';

/** Minimal query surface shared by the pool and transaction clients. */
export interface Queryable {
  query<T extends QueryResultRow = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
}

export function wrap(runner: Pool | PoolClient): Queryable {
  return {
    query: async (sql: string, params?: unknown[]) => (await runner.query(sql, params as any[])).rows,
    one: async (sql: string, params?: unknown[]) => (await runner.query(sql, params as any[])).rows[0],
  };
}

@Injectable()
export class Db implements Queryable, OnModuleDestroy {
  readonly pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  private readonly base = wrap(this.pool);

  query<T extends QueryResultRow = any>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.base.query<T>(sql, params);
  }

  one<T extends QueryResultRow = any>(sql: string, params?: unknown[]): Promise<T | undefined> {
    return this.base.one<T>(sql, params);
  }

  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(wrap(client));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
