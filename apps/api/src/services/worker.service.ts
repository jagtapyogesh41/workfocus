import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { config } from '../config';
import { Db } from '../db/db.service';
import { NotificationService } from './audit.service';
import { JobQueue, JobRow } from './job-queue';
import { DeviceSyncService, ReconcileService } from './reconcile.service';

/**
 * In-process background worker: drains the job queue and runs a periodic sweep.
 * Can be disabled (WORKER_ENABLED=false) to run workers as a separate process later.
 */
@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Worker');
  private pollTimer?: NodeJS.Timeout;
  private sweepTimer?: NodeJS.Timeout;
  private draining = false;
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly jobs: JobQueue,
    private readonly reconcile: ReconcileService,
    private readonly deviceSync: DeviceSyncService,
    private readonly notifications: NotificationService,
  ) {}

  onApplicationBootstrap(): void {
    if (!config.worker.enabled) return;
    this.pollTimer = setInterval(() => void this.drain(), config.worker.pollMs);
    this.sweepTimer = setInterval(() => void this.sweep(), config.worker.sweepMs);
    void this.sweep();
    this.logger.log(`started (poll ${config.worker.pollMs}ms, sweep ${config.worker.sweepMs}ms)`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearInterval(this.sweepTimer);
    while (this.draining) await new Promise((r) => setTimeout(r, 25));
  }

  /** Process all ready jobs. Exposed for tests. */
  async drain(): Promise<number> {
    if (this.draining) return 0;
    this.draining = true;
    let processed = 0;
    try {
      while (!this.stopped) {
        const job = await this.jobs.claim();
        if (!job) break;
        await this.run(job);
        processed++;
      }
    } catch (err) {
      this.logger.error(`drain failed: ${(err as Error).message}`);
    } finally {
      this.draining = false;
    }
    return processed;
  }

  private async run(job: JobRow): Promise<void> {
    try {
      switch (job.kind) {
        case 'reconcile_employee':
          await this.reconcile.reconcileEmployee(job.payload.employeeId, {
            triggerReceivedAt: job.payload.triggerReceivedAt ? new Date(job.payload.triggerReceivedAt) : null,
          });
          break;
        case 'device_sync':
          await this.deviceSync.sync(job.payload.deviceId);
          break;
        default:
          throw new Error(`Unknown job kind ${job.kind}`);
      }
      await this.jobs.complete(job.id);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      const dead = await this.jobs.fail(job, message);
      this.logger.warn(`job ${job.id} ${job.kind} failed (attempt ${job.attempts}): ${message}${dead ? ' — dead-lettered' : ''}`);
      if (dead && job.kind === 'device_sync') {
        await this.deviceSync.markFailed(job.payload.deviceId, message);
        const d = await this.db.one(
          `select d.company_id, d.employee_id, e.full_name from devices d join employees e on e.id = d.employee_id where d.id = $1`,
          [job.payload.deviceId],
        );
        if (d) {
          await this.notifications.notify({
            companyId: d.company_id,
            kind: 'sync_failed',
            severity: 'critical',
            title: `Policy sync failed for ${d.full_name}'s device`,
            body: `Device-management provider error after ${job.attempts} attempts: ${message}`,
            employeeId: d.employee_id,
          });
        }
      }
    }
  }

  /**
   * Periodic safety sweep:
   *  - recover stale running jobs
   *  - re-evaluate everyone on shift (time-based fail-safe)
   *  - re-queue devices whose applied policy is behind desired
   */
  async sweep(): Promise<void> {
    try {
      await this.jobs.releaseStale();
      const onShift = await this.db.query<{ id: string }>(
        `select id from employees where status = 'approved' and shift_state <> 'off_shift'`,
      );
      for (const e of onShift) {
        await this.jobs.enqueue('reconcile_employee', { employeeId: e.id }, { dedupeKey: `reconcile:${e.id}` });
      }
      const behind = await this.db.query<{ id: string }>(
        `select d.id from devices d
         where d.enrollment_status = 'enrolled'
           and (d.applied_version is distinct from d.desired_version)
           and not exists (select 1 from jobs j where j.dedupe_key = 'sync:' || d.id::text and j.status in ('queued','running'))
           and not exists (select 1 from jobs j where j.kind = 'device_sync' and j.payload->>'deviceId' = d.id::text
                             and j.status = 'dead' and j.updated_at > now() - interval '10 minutes')`,
      );
      for (const d of behind) {
        await this.jobs.enqueue('device_sync', { deviceId: d.id }, { dedupeKey: `sync:${d.id}` });
      }
    } catch (err) {
      this.logger.error(`sweep failed: ${(err as Error).message}`);
    }
  }
}
