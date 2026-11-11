import { Inject, Injectable, Logger } from '@nestjs/common';
import { Db, Queryable } from '../db/db.service';
import {
  BreakMode,
  computeShiftState,
  decideMode,
  DecisionReason,
  DeviceMode,
  EngineEvent,
  ModeDecision,
  REASON_LABELS,
  ShiftComputation,
} from '../domain/policy-engine';
import { Actor, AuditService, NotificationService, PushService, SYSTEM } from './audit.service';
import { EMM_ADAPTER, EmmAdapter } from './emm.adapter';
import { JobQueue } from './job-queue';

export interface ReconcileResult {
  employeeId: string;
  shift: ShiftComputation;
  decision: ModeDecision;
  changed: boolean;
}

/**
 * Re-derives an employee's shift state from the full recent event history and
 * updates the device's *desired* policy. Applying it to the device happens
 * asynchronously (device_sync job) so EMM latency or outages never block ingestion.
 */
@Injectable()
export class ReconcileService {
  private readonly logger = new Logger('Reconcile');

  constructor(
    private readonly db: Db,
    private readonly jobs: JobQueue,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async reconcileEmployee(
    employeeId: string,
    opts: { triggerReceivedAt?: Date | null; actor?: Actor } = {},
  ): Promise<ReconcileResult | null> {
    const now = new Date();
    return this.db.tx(async (q) => {
      const emp = await q.one(
        `select e.*, p.break_mode, p.max_shift_hours from employees e
         join policies p on p.company_id = e.company_id
         where e.id = $1 for update of e`,
        [employeeId],
      );
      if (!emp) return null;

      // Look back far enough to see the start of any shift that could still be "open".
      const lookbackHours = Math.max(48, emp.max_shift_hours + 24);
      const rows = await q.query<{ id: string; event_type: EngineEvent['type']; occurred_at: Date }>(
        `select id, event_type, occurred_at from attendance_events
         where employee_id = $1 and correction_status <> 'voided'
           and occurred_at > now() - make_interval(hours => $2)`,
        [employeeId, lookbackHours],
      );
      const shift = computeShiftState(
        rows.map((r) => ({ id: r.id, type: r.event_type, occurredAt: r.occurred_at })),
        now,
      );

      let override = await q.one(`select * from overrides where employee_id = $1 and ended_at is null`, [employeeId]);
      if (override && shift.state === 'off_shift') {
        await q.query(`update overrides set ended_at = now(), end_reason = 'shift_ended' where id = $1`, [override.id]);
        await this.audit.record(
          { companyId: emp.company_id, actor: SYSTEM, action: 'override.ended', targetType: 'override', targetId: override.id, details: { endReason: 'shift_ended' } },
          q,
        );
        override = undefined;
      }

      await q.query(
        `update employees set shift_state = $2, shift_started_at = $3, last_event_at = $4, state_computed_at = now() where id = $1`,
        [employeeId, shift.state, shift.shiftStartedAt, shift.lastEventAt],
      );

      const device = await q.one(`select * from devices where employee_id = $1 for update`, [employeeId]);
      const decision = decideMode({
        employeeApproved: emp.status === 'approved',
        deviceEnrolled: device?.enrollment_status === 'enrolled',
        shift,
        overrideActive: !!override,
        breakMode: emp.break_mode as BreakMode,
        maxShiftHours: emp.max_shift_hours,
        now,
      });

      let changed = false;
      if (device && device.enrollment_status === 'enrolled') {
        changed = await this.setDesired(q, device, decision, {
          triggerReceivedAt: opts.triggerReceivedAt ?? null,
          actor: opts.actor ?? SYSTEM,
          employeeName: emp.full_name,
        });
      }
      return { employeeId, shift, decision, changed };
    });
  }

  /**
   * Update desired device state; bump version and enqueue a sync when the mode changes.
   * Returns true when the mode changed.
   */
  async setDesired(
    q: Queryable,
    device: { id: string; company_id: string; employee_id: string; desired_state: DeviceMode; desired_reason: string; desired_version: number },
    decision: ModeDecision,
    ctx: { triggerReceivedAt: Date | null; actor: Actor; employeeName?: string; force?: boolean },
  ): Promise<boolean> {
    const modeChanged = device.desired_state !== decision.mode;
    if (!modeChanged && !ctx.force) {
      if (device.desired_reason !== decision.reason) {
        await q.query(`update devices set desired_reason = $2 where id = $1`, [device.id, decision.reason]);
      }
      return false;
    }
    const version = device.desired_version + 1;
    await q.query(
      `update devices set desired_state = $2, desired_reason = $3, desired_version = $4 where id = $1`,
      [device.id, decision.mode, decision.reason, version],
    );
    await q.query(
      `insert into policy_sync_log (company_id, device_id, desired_version, mode, reason, trigger_received_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [device.company_id, device.id, version, decision.mode, decision.reason, ctx.triggerReceivedAt],
    );
    await this.jobs.enqueue('device_sync', { deviceId: device.id }, { dedupeKey: `sync:${device.id}`, q });
    if (modeChanged) {
      await this.audit.record(
        {
          companyId: device.company_id,
          actor: ctx.actor,
          action: 'device.desired_state_changed',
          targetType: 'device',
          targetId: device.id,
          details: { from: device.desired_state, to: decision.mode, reason: decision.reason, version },
        },
        q,
      );
      if (decision.reason === 'fail_safe_max_shift') {
        await this.notifications.notify(
          {
            companyId: device.company_id,
            kind: 'fail_safe',
            severity: 'warning',
            title: `Fail-safe released restrictions for ${ctx.employeeName ?? 'an employee'}`,
            body: 'Shift exceeded the configured maximum length without a clock-out. Check for a missing punch.',
            employeeId: device.employee_id,
          },
          q,
        );
      }
      this.logger.log(`device ${device.id.slice(0, 8)} desired -> ${decision.mode} (${REASON_LABELS[decision.reason as DecisionReason]})`);
    }
    return modeChanged;
  }
}

/** Pushes the desired policy to the EMM provider and records the applied state. */
@Injectable()
export class DeviceSyncService {
  constructor(
    private readonly db: Db,
    @Inject(EMM_ADAPTER) private readonly emm: EmmAdapter,
    private readonly push: PushService,
  ) {}

  async sync(deviceId: string): Promise<void> {
    const d = await this.db.one(
      `select d.*, p.restricted_apps, p.always_allowed_apps from devices d
       join policies p on p.company_id = d.company_id where d.id = $1`,
      [deviceId],
    );
    if (!d || d.enrollment_status !== 'enrolled' || !d.emm_device_id) return;
    if (d.applied_version === d.desired_version && d.applied_state === d.desired_state) return; // idempotent

    const version: number = d.desired_version;
    try {
      await this.emm.applyPolicy({
        emmDeviceId: d.emm_device_id,
        mode: d.desired_state,
        restrictedApps: d.restricted_apps,
        alwaysAllowedApps: d.always_allowed_apps,
        version,
      });
    } catch (err) {
      await this.db.query(`update devices set last_sync_error = $2 where id = $1`, [deviceId, String((err as Error).message)]);
      throw err;
    }
    await this.db.tx(async (q) => {
      await q.query(
        `update devices set applied_state = $2, applied_version = $3, last_sync_at = now(), last_sync_error = null where id = $1`,
        [deviceId, d.desired_state, version],
      );
      await q.query(
        `update policy_sync_log set status = 'applied', applied_at = now()
         where device_id = $1 and desired_version = $2 and status = 'pending'`,
        [deviceId, version],
      );
      await q.query(
        `update policy_sync_log set status = 'superseded'
         where device_id = $1 and desired_version < $2 and status = 'pending'`,
        [deviceId, version],
      );
    });
    await this.push.sendSyncHint(deviceId);
  }

  async markFailed(deviceId: string, error: string): Promise<void> {
    await this.db.query(
      `update policy_sync_log set status = 'failed', error = $2 where device_id = $1 and status = 'pending'`,
      [deviceId, error.slice(0, 1000)],
    );
  }
}
