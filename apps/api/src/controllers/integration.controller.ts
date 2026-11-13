import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConnectorAuthGuard, ConnectorPrincipal, CurrentConnector, CurrentDevice, DeviceAuthGuard, DevicePrincipal, signDeviceToken } from '../common/auth';
import { parse } from '../common/validation';
import { config } from '../config';
import { Db } from '../db/db.service';
import { ATTENDANCE_EVENT_TYPES } from '../domain/policy-engine';
import { DeviceService, OVERRIDE_REASONS } from '../services/device.service';
import { IngestionService } from '../services/ingestion.service';
import { DeviceSyncService, ReconcileService } from '../services/reconcile.service';

/** API used by the client-side attendance connector (outbound HTTPS from the client's network). */
@Controller('v1/connector')
@UseGuards(ConnectorAuthGuard)
export class ConnectorController {
  constructor(
    private readonly db: Db,
    private readonly ingestion: IngestionService,
  ) {}

  private async seen(c: ConnectorPrincipal, version?: string) {
    await this.db.query(`update connectors set last_seen_at = now(), last_seen_version = coalesce($2, last_seen_version) where id = $1`, [
      c.connectorId,
      version ?? null,
    ]);
  }

  @Post('heartbeat')
  @HttpCode(200)
  async heartbeat(@CurrentConnector() c: ConnectorPrincipal, @Body() body: any) {
    await this.seen(c, typeof body?.version === 'string' ? body.version.slice(0, 40) : undefined);
    return { ok: true, serverTime: new Date().toISOString() };
  }

  @Post('events')
  @HttpCode(200)
  async events(@CurrentConnector() c: ConnectorPrincipal, @Body() body: unknown) {
    const { events } = parse(z.object({ events: z.array(z.unknown()).min(1).max(500) }), body);
    await this.seen(c);
    const { valid, rejected } = this.ingestion.splitValid(events);
    return this.ingestion.ingest({ companyId: c.companyId, sourceSystem: c.sourceSystem, actor: { type: 'connector', id: c.connectorId } }, valid, rejected);
  }

  /** Scheduled-export fallback (non-real-time pilots). Send `Content-Type: text/csv`. */
  @Post('events.csv')
  @HttpCode(200)
  async eventsCsv(@CurrentConnector() c: ConnectorPrincipal, @Req() req: { body: unknown }) {
    if (typeof req.body !== 'string') throw new BadRequestException('Send the CSV with Content-Type: text/csv');
    const rows = this.ingestion.parseCsv(req.body);
    if (!rows.length) throw new BadRequestException('CSV contained no rows');
    if (rows.length > 5000) throw new BadRequestException('Max 5000 rows per upload');
    await this.seen(c);
    const { valid, rejected } = this.ingestion.splitValid(rows);
    return this.ingestion.ingest({ companyId: c.companyId, sourceSystem: c.sourceSystem, actor: { type: 'connector', id: c.connectorId } }, valid, rejected);
  }
}

/** API used by the employee's Android / Mobile PWA client (enrollment, phone login, status, and emergency override). */
@Controller('v1/device')
export class DeviceController {
  constructor(
    private readonly db: Db,
    private readonly devices: DeviceService,
    private readonly ingestion: IngestionService,
    private readonly reconcile: ReconcileService,
    private readonly deviceSync: DeviceSyncService,
  ) {}

  @Post('enroll')
  @HttpCode(200)
  enroll(@Body() body: unknown) {
    const input = parse(z.object({ enrollmentToken: z.string().min(10), model: z.string().max(100).optional() }), body);
    return this.devices.enroll(input.enrollmentToken, input.model);
  }

  /**
   * Employee sign-in using their registered mobile phone number (matches full E.164 or last 10 digits).
   * Prevents employees from seeing or selecting other workers' names from a public list.
   */
  @Post('login-phone')
  @HttpCode(200)
  async loginByPhone(@Body() body: unknown) {
    const input = parse(
      z.object({
        phone: z.string().min(6).max(30),
        joinCode: z.string().max(40).optional(),
        model: z.string().max(100).optional(),
      }),
      body,
    );
    const digits = input.phone.replace(/\D/g, '');
    if (digits.length < 10) {
      throw new BadRequestException('Please enter a valid 10-digit mobile number');
    }
    const last10 = digits.slice(-10);
    const joinCode = input.joinCode?.trim() ? input.joinCode.trim().toUpperCase() : null;

    const emp = await this.db.one(
      `select e.id, e.company_id, e.full_name, e.phone, e.external_employee_id, e.status
       from employees e
       join companies c on c.id = e.company_id
       where regexp_replace(e.phone, '\\D', '', 'g') like '%' || $1
         and ($2::text is null or upper(c.join_code) = $2)
       order by (e.status = 'approved') desc, e.created_at desc
       limit 1`,
      [last10, joinCode],
    );
    if (!emp) {
      throw new NotFoundException('Mobile number not registered. Use "New Worker" tab to request access first.');
    }
    if (emp.status !== 'approved') {
      throw new ForbiddenException(`Your registration (${emp.full_name}) is ${emp.status}. Please ask HR to approve your account.`);
    }
    const existingDev = await this.db.one<{ id: string; enrollment_status: string }>(
      `select id, enrollment_status from devices where employee_id = $1`,
      [emp.id],
    );
    let deviceId: string;
    if (existingDev && existingDev.enrollment_status === 'enrolled') {
      deviceId = existingDev.id;
      if (input.model) {
        await this.db.query(`update devices set model = $2, last_seen_at = now() where id = $1`, [deviceId, input.model]);
      }
      await this.reconcile.reconcileEmployee(emp.id);
    } else {
      const issued = await this.devices.issueEnrollment(emp.company_id, emp.id, { type: 'employee', id: emp.id });
      const enrolled = await this.devices.enroll(issued.enrollmentToken, input.model ?? 'Employee Mobile Handset');
      deviceId = enrolled.deviceId;
    }
    await this.deviceSync.sync(deviceId).catch(() => undefined);
    const jwtDeviceToken = signDeviceToken({ deviceId, employeeId: emp.id, companyId: emp.company_id });
    return {
      deviceToken: jwtDeviceToken,
      deviceId,
      employee: {
        id: emp.id,
        fullName: emp.full_name,
        phone: emp.phone,
        externalEmployeeId: emp.external_employee_id,
      },
      status: await this.devices.status(deviceId),
    };
  }

  /**
   * Lists approved demo workers (used only by internal simulator tests).
   */
  @Get('demo-workers')
  async demoWorkers() {
    if (!config.simulatorEnabled) throw new ForbiddenException('Simulator disabled');
    const rows = await this.db.query(
      `select e.id, e.full_name, e.phone, e.external_employee_id, e.shift_state, c.name as company_name, c.join_code
       from employees e join companies c on c.id = e.company_id
       where e.status = 'approved' and e.external_employee_id is not null
       order by e.external_employee_id`,
    );
    return { workers: rows };
  }

  /**
   * Mobile pairing by employeeId / externalEmployeeId / phone.
   */
  @Post('demo-pair')
  @HttpCode(200)
  async demoPair(@Body() body: unknown) {
    if (!config.simulatorEnabled) throw new ForbiddenException('Simulator disabled');
    const input = parse(
      z.object({
        employeeId: z.string().uuid().optional(),
        externalEmployeeId: z.string().min(1).max(100).optional(),
        phone: z.string().min(6).max(30).optional(),
        model: z.string().max(100).optional(),
      }),
      body,
    );
    if (input.phone) {
      return this.loginByPhone({ phone: input.phone, model: input.model });
    }
    const emp = input.employeeId
      ? await this.db.one(`select id, company_id, full_name, external_employee_id from employees where id = $1 and status = 'approved'`, [input.employeeId])
      : await this.db.one(
          `select id, company_id, full_name, external_employee_id from employees where external_employee_id = $1 and status = 'approved' limit 1`,
          [input.externalEmployeeId ?? '101'],
        );
    if (!emp) throw new NotFoundException('Approved worker not found');
    const issued = await this.devices.issueEnrollment(emp.company_id, emp.id, { type: 'employee', id: emp.id });
    const enrolled = await this.devices.enroll(issued.enrollmentToken, input.model ?? 'Worker Mobile PWA');
    await this.deviceSync.sync(enrolled.deviceId).catch(() => undefined);
    return {
      ...enrolled,
      employee: { id: emp.id, fullName: emp.full_name, externalEmployeeId: emp.external_employee_id },
      status: await this.devices.status(enrolled.deviceId),
    };
  }

  /**
   * Allows a paired mobile handset to record a shift punch (`clock_in`, `break_start`, `break_end`, `clock_out`)
   * with immediate synchronous reconciliation and device sync so both dashboard and phone update instantaneously.
   */
  @Post('demo-punch')
  @HttpCode(200)
  @UseGuards(DeviceAuthGuard)
  async demoPunch(@CurrentDevice() d: DevicePrincipal, @Body() body: unknown) {
    if (!config.simulatorEnabled) throw new ForbiddenException('Simulator disabled');
    const { eventType } = parse(z.object({ eventType: z.enum(ATTENDANCE_EVENT_TYPES) }), body);
    const emp = await this.db.one(`select external_employee_id from employees where id = $1`, [d.employeeId]);
    if (!emp?.external_employee_id) throw new BadRequestException('Employee has no attendance ID');
    const now = new Date();
    await this.ingestion.ingest(
      {
        companyId: d.companyId,
        sourceSystem: 'simulator',
        actor: { type: 'employee', id: d.employeeId },
        reconcileInline: async (ids) => {
          for (const id of ids) {
            await this.reconcile.reconcileEmployee(id, { actor: { type: 'employee', id: d.employeeId }, triggerReceivedAt: now });
          }
        },
      },
      [
        {
          event_id: `mob-${randomUUID()}`,
          employee_id: emp.external_employee_id,
          event_type: eventType,
          occurred_at: now.toISOString(),
          correction_status: 'original',
          terminal_id: 'MOBILE-APP',
        },
      ],
    );
    await this.deviceSync.sync(d.deviceId).catch(() => undefined);
    return this.devices.status(d.deviceId);
  }

  @Get('status')
  @UseGuards(DeviceAuthGuard)
  status(@CurrentDevice() d: DevicePrincipal) {
    return this.devices.status(d.deviceId);
  }

  @Post('override')
  @HttpCode(200)
  @UseGuards(DeviceAuthGuard)
  override(@CurrentDevice() d: DevicePrincipal, @Body() body: unknown) {
    const input = parse(
      z.object({ reasonCategory: z.enum(OVERRIDE_REASONS).optional(), note: z.string().max(500).optional() }).default({}),
      body ?? {},
    );
    return this.devices.startOverride(d.deviceId, d.employeeId, d.companyId, input);
  }

  @Post('override/end')
  @HttpCode(200)
  @UseGuards(DeviceAuthGuard)
  endOverride(@CurrentDevice() d: DevicePrincipal) {
    return this.devices.endOverride(d.deviceId, d.employeeId, d.companyId);
  }
}
