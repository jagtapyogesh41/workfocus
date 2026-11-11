import { Injectable } from '@nestjs/common';
import { Db, Queryable } from '../db/db.service';

export type JobKind = 'reconcile_employee' | 'device_sync';

export interface JobRow {
  id: string;
  kind: JobKind;
  payload: any;
  attempts: number;
  max_attempts: number;
}

/**
 * PostgreSQL-backed job queue (per PRODUCT_PLAN.md §5: start simple, add a
 * managed queue only when volume justifies it). Uses SKIP LOCKED so several
 * API instances can safely share the work.
 */
@Injectable()
export class JobQueue {
  constructor(private readonly db: Db) {}

  /** Enqueue a job. With a dedupe key, at most one *queued* job per key exists (first payload wins). */
  async enqueue(
    kind: JobKind,
    payload: Record<string, unknown>,
    opts: { dedupeKey?: string; runAt?: Date; q?: Queryable } = {},
  ): Promise<void> {
    const q = opts.q ?? this.db;
    await q.query(
      `insert into jobs (kind, payload, dedupe_key, run_at) values ($1, $2, $3, coalesce($4, now()))
       on conflict (dedupe_key) where status = 'queued' do nothing`,
      [kind, JSON.stringify(payload), opts.dedupeKey ?? null, opts.runAt ?? null],
    );
  }

  async claim(): Promise<JobRow | undefined> {
    return this.db.one<JobRow>(
      `update jobs set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
       where id = (
         select id from jobs where status = 'queued' and run_at <= now()
         order by run_at, id for update skip locked limit 1
       )
       returning id, kind, payload, attempts, max_attempts`,
    );
  }

  async complete(id: string): Promise<void> {
    await this.db.query(`update jobs set status = 'done', locked_at = null, updated_at = now() where id = $1`, [id]);
  }

  /** Returns true when the job has exhausted retries and was dead-lettered. */
  async fail(job: JobRow, error: string): Promise<boolean> {
    const dead = job.attempts >= job.max_attempts;
    const backoffSec = Math.min(60, 2 ** job.attempts);
    await this.db.query(
      `update jobs set status = $2, last_error = $3, locked_at = null, updated_at = now(),
         run_at = now() + make_interval(secs => $4)
       where id = $1`,
      [job.id, dead ? 'dead' : 'queued', error.slice(0, 2000), backoffSec],
    );
    return dead;
  }

  /** Recover jobs whose worker crashed mid-flight. */
  async releaseStale(olderThanSeconds = 300): Promise<number> {
    const rows = await this.db.query(
      `update jobs set status = 'queued', locked_at = null, updated_at = now()
       where status = 'running' and locked_at < now() - make_interval(secs => $1)
       returning id`,
      [olderThanSeconds],
    );
    return rows.length;
  }

  async stats(): Promise<{ queued: number; running: number; dead: number }> {
    const r = await this.db.one(
      `select count(*) filter (where status='queued')::int as queued,
              count(*) filter (where status='running')::int as running,
              count(*) filter (where status='dead')::int as dead
       from jobs`,
    );
    return r as { queued: number; running: number; dead: number };
  }
}
