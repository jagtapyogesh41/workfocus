import { ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { config } from '../config';
import { Db } from '../db/db.service';
import { REASON_LABELS, DecisionReason } from '../domain/policy-engine';
import { generateToken, parseToken, safeEqualHex, sha256 } from '../common/tokens';
import { Actor, AuditService, NotificationService } from './audit.service';
import { EMM_ADAPTER, EmmAdapter } from './emm.adapter';
import { JobQueue } from './job-queue';
import { ReconcileService } from './reconcile.service';

export const OVERRIDE_REASONS = ['medical', 'family', 'safety', 'work_related', 'other'] as const;
export type OverrideReason = (typeof OVERRIDE_REASONS)[number];

/** Device lifecycle: enrollment, status for the phone client, and emergency override. */
@Injectable()
export class DeviceService {
  constructor(
    private readonly db: Db,
    private readonly reconcile: ReconcileService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly jobs: JobQueue,
    @Inject(EMM_ADAPTER) private readonly emm: EmmAdapter,
  ) {}

  /**
   * Issue a one-time enrollment token (rendered as a QR code in a real EMM flow).
   * Re-issuing for an enrolled device is the "replace phone" path: the old device token stops working on enroll.
   */
  async issueEnrollment(companyId: string, employeeId: string, actor: Actor) {
    const emp = await this.db.one(`select id, status, full_name from employees where id = $1 and company_id = $2`, [employeeId, companyId]);
    if (!emp) throw new NotFoundException('Employee not found');
    if (emp.status !== 'approved') throw new ConflictException('Approve the employee before enrolling a device');
    const t = generateToken('sfe');
    const expiresAt = new Date(Date.now() + config.enrollmentTokenTtlHours * 3_600_000);
    await this.db.query(
      `insert into devices (company_id, employee_id, enrollment_token_prefix, enrollment_token_hash, enrollment_expires_at)
       values ($1, $2, $3, $4, $5)
       on conflict (employee_id) do update set enrollment_token_prefix = excluded.enrollment_token_prefix,
         enrollment_token_hash = excluded.enrollment_token_hash, enrollment_expires_at = excluded.enrollment_expires_at`,
      [companyId, employeeId, t.prefix, t.hash, expiresAt],
    );
    await this.audit.record({ companyId, actor, action: 'device.enrollment_issued', targetType: 'employee', targetId: employeeId });
    return { enrollmentToken: t.token, expiresAt };
  }

  async enroll(enrollmentToken: string, model: string | undefined) {
    const parsed = parseToken(enrollmentToken, 'sfe');
    if (!parsed) throw new UnauthorizedException('Malformed enrollment token');
    const d = await this.db.one(
      `select d.*, e.status as employee_status from devices d join employees e on e.id = d.employee_id
       where d.enrollment_token_prefix = $1`,
      [parsed.prefix],
    );
    if (!d || !d.enrollment_token_hash || !safeEqualHex(d.enrollment_token_hash, sha256(enrollmentToken))) {
      throw new UnauthorizedException('Invalid enrollment token');
    }
    if (d.enrollment_expires_at < new Date()) throw new UnauthorizedException('Enrollment token expired');
    if (d.employee_status !== 'approved') throw new UnauthorizedException('Employee is not approved');

    const { emmDeviceId } = d.emm_device_id && d.enrollment_status === 'enrolled'
      ? { emmDeviceId: d.emm_device_id as string }
      : await this.emm.enrollDevice({ deviceId: d.id, model });
    const deviceToken = generateToken('sfd');
    await this.db.query(
      `update devices set enrollment_status = 'enrolled', enrolled_at = now(), emm_device_id = $2, model = $3,
         device_token_prefix = $4, device_token_hash = $5,
         enrollment_token_prefix = null, enrollment_token_hash = null, enrollment_expires_at = null,
         applied_state = null, applied_version = null, last_seen_at = now()
       where id = $1`,
      [d.id, emmDeviceId, model ?? null, deviceToken.prefix, deviceToken.hash],
    );
    await this.audit.record({
      companyId: d.company_id,
      actor: { type: 'employee', id: d.employee_id },
      action: 'device.enrolled',
      targetType: 'device',
      targetId: d.id,
      details: { model: model ?? null, emmDeviceId },
    });
    // Force a fresh policy push to the (possibly new) handset.
    await this.db.tx(async (q) => {
      const dev = await q.one(`select * from devices where id = $1 for update`, [d.id]);
      await this.reconcile.setDesired(q, dev, { mode: dev.desired_state, reason: dev.desired_reason }, {
        triggerReceivedAt: null,
        actor: { type: 'employee', id: d.employee_id },
        force: true,
      });
    });
    await this.reconcile.reconcileEmployee(d.employee_id);
    return { deviceToken: deviceToken.token, deviceId: d.id };
  }

  async unenroll(companyId: string, employeeId: string, actor: Actor) {
    const d = await this.db.one(`select * from devices where employee_id = $1 and company_id = $2`, [employeeId, companyId]);
    if (!d) throw new NotFoundException('No device for employee');
    if (d.emm_device_id) await this.emm.unenrollDevice(d.emm_device_id);
    await this.db.query(
      `update devices set enrollment_status = 'unenrolled', device_token_prefix = null, device_token_hash = null,
         desired_state = 'unrestricted', desired_reason = 'not_enrolled', applied_state = null, applied_version = null
       where id = $1`,
      [d.id],
    );
    await this.audit.record({ companyId, actor, action: 'device.unenrolled', targetType: 'device', targetId: d.id });
  }

  /** Status as seen by the phone. Doubles as a check-in: lagging policy is re-queued (reconcile on reconnect). */
  async status(deviceId: string) {
    const d = await this.db.one(
      `select d.*, e.full_name, e.shift_state, e.shift_started_at, c.name as company_name,
              p.restricted_apps, p.always_allowed_apps, p.break_mode, p.max_shift_hours
       from devices d join employees e on e.id = d.employee_id
       join companies c on c.id = d.company_id join policies p on p.company_id = d.company_id
       where d.id = $1`,
      [deviceId],
    );
    if (!d) throw new NotFoundException();
    await this.db.query(`update devices set last_seen_at = now() where id = $1`, [deviceId]);
    if (d.applied_version !== d.desired_version) {
      await this.jobs.enqueue('device_sync', { deviceId }, { dedupeKey: `sync:${deviceId}` });
    }
    const override = await this.db.one(
      `select id, started_at, reason_category from overrides where employee_id = $1 and ended_at is null`,
      [d.employee_id],
    );
    return {
      employee: { fullName: d.full_name },
      company: { name: d.company_name },
      shiftState: d.shift_state,
      shiftStartedAt: d.shift_started_at,
      appliedMode: d.applied_state ?? 'unrestricted',
      desiredMode: d.desired_state,
      reason: d.desired_reason,
      reasonLabel: REASON_LABELS[d.desired_reason as DecisionReason] ?? d.desired_reason,
      syncPending: d.applied_version !== d.desired_version,
      lastSyncAt: d.last_sync_at,
      override: override ?? null,
      restrictedApps: d.restricted_apps,
      alwaysAllowedApps: d.always_allowed_apps,
      policy: { breakMode: d.break_mode, maxShiftHours: d.max_shift_hours },
      appRelease: {
        versionCode: config.workerApp.versionCode,
        versionName: config.workerApp.versionName,
        apkUrl: config.workerApp.apkUrl,
      },
    };
  }

  /**
   * Emergency override: never waits for an administrator. Records the event,
   * notifies admins, and immediately sets the device to unrestricted.
   */
  async startOverride(deviceId: string, employeeId: string, companyId: string, input: { reasonCategory?: OverrideReason; note?: string }) {
    const actor: Actor = { type: 'employee', id: employeeId };
    const created = await this.db.tx(async (q) => {
      const existing = await q.one(`select * from overrides where employee_id = $1 and ended_at is null`, [employeeId]);
      if (existing) return { override: existing, isNew: false };
      const emp = await q.one(`select full_name from employees where id = $1`, [employeeId]);
      const ov = await q.one(
        `insert into overrides (company_id, employee_id, reason_category, note) values ($1,$2,$3,$4) returning *`,
        [companyId, employeeId, input.reasonCategory ?? null, input.note ?? null],
      );
      await this.audit.record(
        { companyId, actor, action: 'override.started', targetType: 'override', targetId: ov.id, details: { reasonCategory: input.reasonCategory ?? null } },
        q,
      );
      await this.notifications.notify(
        {
          companyId,
          kind: 'override',
          severity: 'warning',
          title: `Emergency override used by ${emp?.full_name ?? 'an employee'}`,
          body: `Reason: ${input.reasonCategory ?? 'not given'}. Restrictions were released immediately; please follow up.`,
          employeeId,
        },
        q,
      );
      return { override: ov, isNew: true };
    });
    await this.reconcile.reconcileEmployee(employeeId, { actor, triggerReceivedAt: new Date(created.override.started_at) });
    return { override: created.override, status: await this.status(deviceId) };
  }

  async endOverride(deviceId: string, employeeId: string, companyId: string) {
    const ov = await this.db.one(
      `update overrides set ended_at = now(), end_reason = 'ended_by_employee' where employee_id = $1 and ended_at is null returning id`,
      [employeeId],
    );
    if (ov) {
      await this.audit.record({ companyId, actor: { type: 'employee', id: employeeId }, action: 'override.ended', targetType: 'override', targetId: ov.id, details: { endReason: 'ended_by_employee' } });
      await this.reconcile.reconcileEmployee(employeeId, { actor: { type: 'employee', id: employeeId }, triggerReceivedAt: new Date() });
    }
    return this.status(deviceId);
  }
}
