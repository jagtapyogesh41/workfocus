import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AdminAuthGuard, AdminPrincipal, CurrentAdmin, Roles } from '../common/auth';
import { generateToken } from '../common/tokens';
import { parse, uuid } from '../common/validation';
import { config } from '../config';
import { Db } from '../db/db.service';
import { ATTENDANCE_EVENT_TYPES, REASON_LABELS, DecisionReason } from '../domain/policy-engine';
import { Actor, AuditService } from '../services/audit.service';
import { DeviceService } from '../services/device.service';
import { IngestionService } from '../services/ingestion.service';
import { JobQueue } from '../services/job-queue';
import { ReconcileService } from '../services/reconcile.service';

const actorOf = (a: AdminPrincipal): Actor => ({ type: 'admin', id: a.adminId });
const appSchema = z.object({
  packageName: z.string().trim().regex(/^[a-zA-Z][\w]*(\.[a-zA-Z_][\w]*)+$/, 'Invalid Android package name'),
  label: z.string().trim().min(1).max(60),
});

@Controller('v1/admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditService,
    private readonly devices: DeviceService,
    private readonly ingestion: IngestionService,
    private readonly reconcile: ReconcileService,
    private readonly jobs: JobQueue,
  ) {}

  // ---------------------------------------------------------------- overview

  @Get('me')
  async me(@CurrentAdmin() a: AdminPrincipal) {
    const row = await this.db.one(
      `select a.id, a.email, a.full_name, a.role, c.id as company_id, c.name as company_name, c.join_code, c.timezone
       from admins a join companies c on c.id = a.company_id where a.id = $1`,
      [a.adminId],
    );
    return { ...row, simulatorEnabled: config.simulatorEnabled };
  }

  @Get('dashboard')
  async dashboard(@CurrentAdmin() a: AdminPrincipal) {
    const cid = a.companyId;
    const [employees, devices, events, sync, overrides, connectors, unread] = await Promise.all([
      this.db.one(
        `select count(*) filter (where status='approved')::int as approved,
                count(*) filter (where status='pending')::int as pending,
                count(*) filter (where status='approved' and shift_state='on_shift')::int as on_shift,
                count(*) filter (where status='approved' and shift_state='on_break')::int as on_break
         from employees where company_id = $1`,
        [cid],
      ),
      this.db.one(
        `select count(*) filter (where enrollment_status='enrolled')::int as enrolled,
                count(*) filter (where enrollment_status='enrolled' and applied_version is not distinct from desired_version)::int as in_sync,
                count(*) filter (where enrollment_status='enrolled' and desired_state='focus')::int as focus,
                count(*) filter (where enrollment_status='enrolled' and (last_seen_at is null or last_seen_at < now() - make_interval(mins => $2)))::int as stale
         from devices where company_id = $1`,
        [cid, config.deviceStaleMinutes],
      ),
      this.db.one(
        `select count(*)::int as total,
                count(*) filter (where employee_id is null)::int as unmapped,
                count(*) filter (where correction_status='corrected')::int as corrected,
                count(*) filter (where correction_status='voided')::int as voided,
                count(*) filter (where source_system='manual')::int as manual,
                percentile_cont(0.5) within group (order by extract(epoch from received_at - occurred_at)) as ingest_lag_p50_s
         from attendance_events where company_id = $1 and received_at > now() - interval '24 hours'`,
        [cid],
      ),
      this.db.one(
        `select count(*) filter (where status='applied')::int as applied,
                count(*) filter (where status='failed')::int as failed,
                count(*) filter (where status='pending')::int as pending,
                percentile_cont(0.5) within group (order by extract(epoch from applied_at - coalesce(trigger_received_at, requested_at))) filter (where status='applied') as p50_s,
                percentile_cont(0.95) within group (order by extract(epoch from applied_at - coalesce(trigger_received_at, requested_at))) filter (where status='applied') as p95_s
         from policy_sync_log where company_id = $1 and requested_at > now() - interval '24 hours'`,
        [cid],
      ),
      this.db.one(
        `select count(*) filter (where ended_at is null)::int as active,
                count(*) filter (where started_at > now() - interval '7 days')::int as last_7d,
                count(*) filter (where acknowledged_at is null)::int as unacknowledged
         from overrides where company_id = $1`,
        [cid],
      ),
      this.db.query(
        `select id, name, source_system, last_seen_at, last_seen_version, revoked_at from connectors where company_id = $1 order by created_at`,
        [cid],
      ),
      this.db.one(`select count(*)::int as n from notifications where company_id = $1 and read_at is null`, [cid]),
    ]);
    return {
      employees,
      devices,
      events24h: events,
      policySync24h: sync,
      overrides,
      connectors,
      jobs: await this.jobs.stats(),
      unreadNotifications: unread?.n ?? 0,
    };
  }

  // --------------------------------------------------------------- employees

  @Get('employees')
  async employees(@CurrentAdmin() a: AdminPrincipal, @Query('status') status?: string) {
    const rows = await this.db.query(
      `select e.id, e.full_name, e.phone, e.external_employee_id, e.status, e.shift_state, e.shift_started_at,
              e.last_event_at, e.created_at, e.decided_at,
              d.id as device_id, d.enrollment_status, d.model, d.desired_state, d.desired_reason, d.desired_version,
              d.applied_state, d.applied_version, d.last_sync_at, d.last_sync_error, d.last_seen_at,
              (d.enrollment_expires_at > now()) as enrollment_pending,
              o.id as override_id, o.started_at as override_started_at
       from employees e
       left join devices d on d.employee_id = e.id
       left join overrides o on o.employee_id = e.id and o.ended_at is null
       where e.company_id = $1 and ($2::text is null or e.status = $2)
       order by (e.status = 'pending') desc, e.full_name`,
      [a.companyId, status ?? null],
    );
    return rows.map((r) => ({
      ...r,
      desired_reason_label: r.desired_reason ? REASON_LABELS[r.desired_reason as DecisionReason] ?? r.desired_reason : null,
      in_sync: r.enrollment_status === 'enrolled' ? r.applied_version === r.desired_version : null,
    }));
  }

  @Post('employees/:id/approve')
  @HttpCode(200)
  @Roles('owner', 'hr')
  async approve(@CurrentAdmin() a: AdminPrincipal, @Param('id') id: string, @Body() body: unknown) {
    parse(uuid, id);
    const { externalEmployeeId } = parse(z.object({ externalEmployeeId: z.string().trim().min(1).max(100) }), body);
    const clash = await this.db.one(
      `select id, full_name from employees where company_id = $1 and external_employee_id = $2 and id <> $3`,
      [a.companyId, externalEmployeeId, id],
    );
    if (clash) throw new ConflictException(`Attendance ID ${externalEmployeeId} is already mapped to ${clash.full_name}`);
    const emp = await this.db.tx(async (q) => {
      const e = await q.one(
        `update employees set status = 'approved', external_employee_id = $3, decided_by = $4, decided_at = now()
         where id = $1 and company_id = $2 returning id, full_name`,
        [id, a.companyId, externalEmployeeId, a.adminId],
      );
      if (!e) throw new NotFoundException('Employee not found');
      // Backfill events that arrived before the mapping existed.
      const n = await q.query(
        `update attendance_events set employee_id = $1 where company_id = $2 and external_employee_id = $3 and employee_id is null returning id`,
        [id, a.companyId, externalEmployeeId],
      );
      await this.audit.record(
        { companyId: a.companyId, actor: actorOf(a), action: 'employee.approved', targetType: 'employee', targetId: id, details: { externalEmployeeId, backfilledEvents: n.length } },
        q,
      );
      return e;
    });
    await this.reconcile.reconcileEmployee(id, { actor: actorOf(a) });
    return emp;
  }

  @Post('employees/:id/reject')
  @HttpCode(200)
  @Roles('owner', 'hr')
  async reject(@CurrentAdmin() a: AdminPrincipal, @Param('id') id: string, @Body() body: unknown) {
    parse(uuid, id);
    const { reason } = parse(z.object({ reason: z.string().max(300).optional() }).default({}), body ?? {});
    const e = await this.db.one(
      `update employees set status = 'rejected', decided_by = $3, decided_at = now() where id = $1 and company_id = $2 and status = 'pending' returning id`,
      [id, a.companyId, a.adminId],
    );
    if (!e) throw new NotFoundException('Pending employee not found');
    await this.audit.record({ companyId: a.companyId, actor: actorOf(a), action: 'employee.rejected', targetType: 'employee', targetId: id, details: { reason } });
    return { ok: true };
  }

  @Post('employees/:id/deactivate')
  @HttpCode(200)
  @Roles('owner', 'hr')
  async deactivate(@CurrentAdmin() a: AdminPrincipal, @Param('id') id: string) {
    parse(uuid, id);
    const e = await this.db.one(
      `update employees set status = 'deactivated', decided_by = $3, decided_at = now() where id = $1 and company_id = $2 returning id`,
      [id, a.companyId, a.adminId],
    );
    if (!e) throw new NotFoundException('Employee not found');
    await this.audit.record({ companyId: a.companyId, actor: actorOf(a), action: 'employee.deactivated', targetType: 'employee', targetId: id });
    await this.reconcile.reconcileEmployee(id, { actor: actorOf(a) });
    return { ok: true };
  }

  @Patch('employees/:id')
  @Roles('owner', 'hr')
  async updateEmployee(@CurrentAdmin() a: AdminPrincipal, @Param('id') id: string, @Body() body: unknown) {
    parse(uuid, id);
    const input = parse(
      z.object({ fullName: z.string().trim().min(2).max(120).optional(), externalEmployeeId: z.string().trim().min(1).max(100).optional() }),
      body,
    );
    if (input.externalEmployeeId) {
      const clash = await this.db.one(
        `select full_name from employees where company_id = $1 and external_employee_id = $2 and id <> $3`,
        [a.companyId, input.externalEmployeeId, id],
      );
      if (clash) throw new ConflictException(`Attendance ID already mapped to ${clash.full_name}`);
    }
    const before = await this.db.one(`select full_name, external_employee_id from employees where id = $1 and company_id = $2`, [id, a.companyId]);
    if (!before) throw new NotFoundException('Employee not found');
    await this.db.tx(async (q) => {
      await q.query(
        `update employees set full_name = coalesce($3, full_name), external_employee_id = coalesce($4, external_employee_id) where id = $1 and company_id = $2`,
        [id, a.companyId, input.fullName ?? null, input.externalEmployeeId ?? null],
      );
      if (input.externalEmployeeId && input.externalEmployeeId !== before.external_employee_id) {
        // Re-associate history: detach old mapping, attach events for the new attendance ID.
        await q.query(`update attendance_events set employee_id = null where employee_id = $1 and external_employee_id <> $2`, [id, input.externalEmployeeId]);
        await q.query(`update attendance_events set employee_id = $1 where company_id = $2 and external_employee_id = $3`, [id, a.companyId, input.externalEmployeeId]);
      }
      await this.audit.record({ companyId: a.companyId, actor: actorOf(a), action: 'employee.updated', targetType: 'employee', targetId: id, details: { before, after: input } }, q);
    });
    await this.reconcile.reconcileEmployee(id, { actor: actorOf(a) });
    return { ok: true };
  }

  @Post('employees/:id/device/enrollment')
  @HttpCode(200)
  @Roles('owner', 'hr')
  issueEnrollment(@CurrentAdmin() a: AdminPrincipal, @Param('id') id: string) {
    parse(uuid, id);
    return this.devices.issueEnrollment(a.companyId, id, actorOf(a));
  }

  @Post('employees/:id/device/unenroll')
  @HttpCode(200)
  @Roles('owner', 'hr')
  async unenroll(@CurrentAdmin() a: AdminPrincipal, @Param('id') id: string) {
    parse(uuid, id);
    await this.devices.unenroll(a.companyId, id, actorOf(a));
    return { ok: true };
  }

  @Post('employees/:id/reconcile')
  @HttpCode(200)
  @Roles('owner', 'hr')
  async forceReconcile(@CurrentAdmin() a: AdminPrincipal, @Param('id') id: string) {
    parse(uuid, id);
    const own = await this.db.one(`select id from employees where id = $1 and company_id = $2`, [id, a.companyId]);
    if (!own) throw new NotFoundException();
    return this.reconcile.reconcileEmployee(id, { actor: actorOf(a) });
  }

  // ------------------------------------------------------------------ policy

  @Get('policy')
  async policy(@CurrentAdmin() a: AdminPrincipal) {
    return this.db.one(`select * from policies where company_id = $1`, [a.companyId]);
  }

  @Put('policy')
  @Roles('owner')
  async updatePolicy(@CurrentAdmin() a: AdminPrincipal, @Body() body: unknown) {
    const input = parse(
      z.object({
        restrictedApps: z.array(appSchema).max(100),
        alwaysAllowedApps: z.array(appSchema).max(50),
        breakMode: z.enum(['unrestricted', 'focus']),
        maxShiftHours: z.number().int().min(1).max(24),
      }),
      body,
    );
    const overlap = input.restrictedApps.filter((r) => input.alwaysAllowedApps.some((x) => x.packageName === r.packageName));
    if (overlap.length) throw new ConflictException(`Apps cannot be both restricted and always allowed: ${overlap.map((o) => o.label).join(', ')}`);

    const before = await this.db.one(`select * from policies where company_id = $1`, [a.companyId]);
    const updated = await this.db.tx(async (q) => {
      const p = await q.one(
        `update policies set restricted_apps = $2, always_allowed_apps = $3, break_mode = $4, max_shift_hours = $5,
           version = version + 1, updated_at = now(), updated_by = $6
         where company_id = $1 returning *`,
        [a.companyId, JSON.stringify(input.restrictedApps), JSON.stringify(input.alwaysAllowedApps), input.breakMode, input.maxShiftHours, a.adminId],
      );
      await this.audit.record(
        {
          companyId: a.companyId,
          actor: actorOf(a),
          action: 'policy.updated',
          targetType: 'policy',
          targetId: a.companyId,
          details: {
            version: p.version,
            before: { restrictedApps: before.restricted_apps, alwaysAllowedApps: before.always_allowed_apps, breakMode: before.break_mode, maxShiftHours: before.max_shift_hours },
            after: input,
          },
        },
        q,
      );
      // Re-push the new app lists to every enrolled device.
      const devs = await q.query(`select * from devices where company_id = $1 and enrollment_status = 'enrolled' for update`, [a.companyId]);
      for (const d of devs) {
        await this.reconcile.setDesired(q, d, { mode: d.desired_state, reason: d.desired_reason }, { triggerReceivedAt: new Date(), actor: actorOf(a), force: true });
      }
      return p;
    });
    // Break mode / max shift changes can alter decisions.
    const emps = await this.db.query<{ id: string }>(`select id from employees where company_id = $1 and status = 'approved'`, [a.companyId]);
    for (const e of emps) await this.jobs.enqueue('reconcile_employee', { employeeId: e.id }, { dedupeKey: `reconcile:${e.id}` });
    return updated;
  }

  // ------------------------------------------------------------------ events

  @Get('events')
  async events(@CurrentAdmin() a: AdminPrincipal, @Query('employeeId') employeeId?: string, @Query('limit') limit?: string) {
    const n = Math.min(Number(limit) || 100, 500);
    return this.db.query(
      `select ev.id, ev.source_system, ev.vendor_event_id, ev.external_employee_id, ev.employee_id, e.full_name,
              ev.event_type, ev.occurred_at, ev.received_at, ev.correction_status, ev.corrected_at, ev.terminal_id, ev.reason,
              ad.full_name as entered_by_name
       from attendance_events ev
       left join employees e on e.id = ev.employee_id
       left join admins ad on ad.id = ev.entered_by
       where ev.company_id = $1 and ($2::uuid is null or ev.employee_id = $2)
       order by ev.occurred_at desc limit $3`,
      [a.companyId, employeeId || null, n],
    );
  }

  /** Manual HR correction (e.g. missed clock-out). Reconciled immediately and audited. */
  @Post('events/manual')
  @Roles('owner', 'hr')
  async manualEvent(@CurrentAdmin() a: AdminPrincipal, @Body() body: unknown) {
    const input = parse(
      z.object({
        employeeId: uuid,
        eventType: z.enum(ATTENDANCE_EVENT_TYPES),
        occurredAt: z.string().datetime({ offset: true }),
        reason: z.string().trim().min(3).max(300),
      }),
      body,
    );
    const emp = await this.db.one(`select external_employee_id from employees where id = $1 and company_id = $2`, [input.employeeId, a.companyId]);
    if (!emp) throw new NotFoundException('Employee not found');
    if (!emp.external_employee_id) throw new ConflictException('Employee has no attendance ID mapping yet');
    const result = await this.ingestion.ingest(
      {
        companyId: a.companyId,
        sourceSystem: 'manual',
        actor: actorOf(a),
        enteredBy: a.adminId,
        reason: input.reason,
        reconcileInline: async (ids) => {
          for (const id of ids) await this.reconcile.reconcileEmployee(id, { actor: actorOf(a), triggerReceivedAt: new Date() });
        },
      },
      [{ event_id: `manual-${randomUUID()}`, employee_id: emp.external_employee_id, event_type: input.eventType, occurred_at: input.occurredAt, correction_status: 'original' }],
    );
    return result;
  }

  @Post('events/:id/void')
  @HttpCode(200)
  @Roles('owner', 'hr')
  async voidEvent(@CurrentAdmin() a: AdminPrincipal, @Param('id') id: string, @Body() body: unknown) {
    parse(uuid, id);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(300) }), body);
    const ev = await this.db.one(
      `update attendance_events set correction_status = 'voided', corrected_at = now(), reason = $3
       where id = $1 and company_id = $2 and correction_status <> 'voided' returning id, employee_id`,
      [id, a.companyId, reason],
    );
    if (!ev) throw new NotFoundException('Event not found or already voided');
    await this.audit.record({ companyId: a.companyId, actor: actorOf(a), action: 'attendance.voided', targetType: 'attendance_event', targetId: id, details: { reason } });
    if (ev.employee_id) await this.reconcile.reconcileEmployee(ev.employee_id, { actor: actorOf(a), triggerReceivedAt: new Date() });
    return { ok: true };
  }

  // --------------------------------------------------------------- overrides

  @Get('overrides')
  async overrides(@CurrentAdmin() a: AdminPrincipal) {
    return this.db.query(
      `select o.*, e.full_name, ad.full_name as acknowledged_by_name
       from overrides o join employees e on e.id = o.employee_id left join admins ad on ad.id = o.acknowledged_by
       where o.company_id = $1 order by o.started_at desc limit 200`,
      [a.companyId],
    );
  }

  @Post('overrides/:id/acknowledge')
  @HttpCode(200)
  @Roles('owner', 'hr')
  async acknowledge(@CurrentAdmin() a: AdminPrincipal, @Param('id') id: string, @Body() body: unknown) {
    parse(uuid, id);
    const { followUpNote } = parse(z.object({ followUpNote: z.string().trim().max(500).optional() }).default({}), body ?? {});
    const o = await this.db.one(
      `update overrides set acknowledged_by = $3, acknowledged_at = now(), follow_up_note = $4
       where id = $1 and company_id = $2 and acknowledged_at is null returning id`,
      [id, a.companyId, a.adminId, followUpNote ?? null],
    );
    if (!o) throw new NotFoundException('Override not found or already acknowledged');
    await this.audit.record({ companyId: a.companyId, actor: actorOf(a), action: 'override.acknowledged', targetType: 'override', targetId: id, details: { followUpNote } });
    return { ok: true };
  }

  // ----------------------------------------------------- notifications/audit

  @Get('notifications')
  async notifications(@CurrentAdmin() a: AdminPrincipal) {
    return this.db.query(
      `select n.*, e.full_name from notifications n left join employees e on e.id = n.employee_id
       where n.company_id = $1 order by n.created_at desc limit 100`,
      [a.companyId],
    );
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  async readAll(@CurrentAdmin() a: AdminPrincipal) {
    await this.db.query(`update notifications set read_at = now() where company_id = $1 and read_at is null`, [a.companyId]);
    return { ok: true };
  }

  @Get('audit')
  async auditLog(@CurrentAdmin() a: AdminPrincipal, @Query('limit') limit?: string) {
    const n = Math.min(Number(limit) || 200, 1000);
    return this.db.query(
      `select l.*, coalesce(ad.full_name, e.full_name, c.name) as actor_name
       from audit_log l
       left join admins ad on l.actor_type = 'admin' and ad.id::text = l.actor_id
       left join employees e on l.actor_type = 'employee' and e.id::text = l.actor_id
       left join connectors c on l.actor_type = 'connector' and c.id::text = l.actor_id
       where l.company_id = $1 order by l.created_at desc, l.id desc limit $2`,
      [a.companyId, n],
    );
  }

  // -------------------------------------------------------------- connectors

  @Get('connectors')
  async connectors(@CurrentAdmin() a: AdminPrincipal) {
    return this.db.query(
      `select id, name, source_system, key_prefix, last_seen_at, last_seen_version, revoked_at, created_at
       from connectors where company_id = $1 order by created_at`,
      [a.companyId],
    );
  }

  @Post('connectors')
  @Roles('owner')
  async createConnector(@CurrentAdmin() a: AdminPrincipal, @Body() body: unknown) {
    const input = parse(
      z.object({ name: z.string().trim().min(2).max(80), sourceSystem: z.string().trim().regex(/^[a-z0-9][a-z0-9_.-]{1,60}$/, 'lowercase letters, digits, . _ -') }),
      body,
    );
    if (['manual', 'simulator'].includes(input.sourceSystem)) throw new ConflictException('Reserved source system name');
    const exists = await this.db.one(`select id from connectors where company_id = $1 and source_system = $2`, [a.companyId, input.sourceSystem]);
    if (exists) throw new ConflictException('A connector for this source system already exists; rotate its key instead');
    const t = generateToken('sfc');
    const c = await this.db.one(
      `insert into connectors (company_id, name, source_system, key_prefix, key_hash) values ($1,$2,$3,$4,$5) returning id, name, source_system`,
      [a.companyId, input.name, input.sourceSystem, t.prefix, t.hash],
    );
    await this.audit.record({ companyId: a.companyId, actor: actorOf(a), action: 'connector.created', targetType: 'connector', targetId: c.id, details: input });
    return { ...c, apiKey: t.token, note: 'Store this key now; it will not be shown again.' };
  }

  @Post('connectors/:id/rotate')
  @HttpCode(200)
  @Roles('owner')
  async rotate(@CurrentAdmin() a: AdminPrincipal, @Param('id') id: string) {
    parse(uuid, id);
    const t = generateToken('sfc');
    const c = await this.db.one(
      `update connectors set key_prefix = $3, key_hash = $4, revoked_at = null where id = $1 and company_id = $2 returning id`,
      [id, a.companyId, t.prefix, t.hash],
    );
    if (!c) throw new NotFoundException();
    await this.audit.record({ companyId: a.companyId, actor: actorOf(a), action: 'connector.key_rotated', targetType: 'connector', targetId: id });
    return { id, apiKey: t.token, note: 'Store this key now; the previous key no longer works.' };
  }

  @Post('connectors/:id/revoke')
  @HttpCode(200)
  @Roles('owner')
  async revoke(@CurrentAdmin() a: AdminPrincipal, @Param('id') id: string) {
    parse(uuid, id);
    const c = await this.db.one(`update connectors set revoked_at = now() where id = $1 and company_id = $2 and revoked_at is null returning id`, [id, a.companyId]);
    if (!c) throw new NotFoundException();
    await this.audit.record({ companyId: a.companyId, actor: actorOf(a), action: 'connector.revoked', targetType: 'connector', targetId: id });
    return { ok: true };
  }

  // --------------------------------------------------------------- simulator

  /**
   * Development-only attendance terminal: pushes a punch through the exact same
   * ingestion + queue pipeline a real connector uses (source_system = "simulator").
   */
  @Post('simulator/punch')
  @HttpCode(200)
  @Roles('owner', 'hr')
  async simulatePunch(@CurrentAdmin() a: AdminPrincipal, @Body() body: unknown) {
    if (!config.simulatorEnabled) throw new ForbiddenException('Simulator disabled');
    const input = parse(
      z.object({
        externalEmployeeId: z.string().min(1),
        eventType: z.enum(ATTENDANCE_EVENT_TYPES),
        occurredAt: z.string().datetime({ offset: true }).optional(),
        vendorEventId: z.string().min(1).max(200).optional(),
      }),
      body,
    );
    return this.ingestion.ingest({ companyId: a.companyId, sourceSystem: 'simulator', actor: actorOf(a) }, [
      {
        event_id: input.vendorEventId ?? `sim-${randomUUID()}`,
        employee_id: input.externalEmployeeId,
        event_type: input.eventType,
        occurred_at: input.occurredAt ?? new Date().toISOString(),
        correction_status: 'original',
      },
    ]);
  }
}
