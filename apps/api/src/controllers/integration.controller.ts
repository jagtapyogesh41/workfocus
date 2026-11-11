import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConnectorAuthGuard, ConnectorPrincipal, CurrentConnector, CurrentDevice, DeviceAuthGuard, DevicePrincipal } from '../common/auth';
import { parse } from '../common/validation';
import { config } from '../config';
import { Db } from '../db/db.service';
import { ATTENDANCE_EVENT_TYPES } from '../domain/policy-engine';
import { DeviceService, OVERRIDE_REASONS } from '../services/device.service';
import { IngestionService } from '../services/ingestion.service';

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

/** API used by the employee's Android / Mobile PWA client (enrollment, status, emergency override, and pilot pairing). */
@Controller('v1/device')
export class DeviceController {
  constructor(
    private readonly db: Db,
    private readonly devices: DeviceService,
    private readonly ingestion: IngestionService,
  ) {}

  @Post('enroll')
  @HttpCode(200)
  enroll(@Body() body: unknown) {
    const input = parse(z.object({ enrollmentToken: z.string().min(10), model: z.string().max(100).optional() }), body);
    return this.devices.enroll(input.enrollmentToken, input.model);
  }

  /**
   * Lists approved demo workers so an employee testing on their mobile phone at `/worker`
   * can pair with 1 tap without needing admin credentials. Enabled only when simulatorEnabled=true.
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
   * 1-tap mobile pairing for pilot testing: issues an enrollment token and enrolls the caller's mobile handset.
   */
  @Post('demo-pair')
  @HttpCode(200)
  async demoPair(@Body() body: unknown) {
    if (!config.simulatorEnabled) throw new ForbiddenException('Simulator disabled');
    const input = parse(
      z.object({
        employeeId: z.string().uuid().optional(),
        externalEmployeeId: z.string().min(1).max(100).optional(),
        model: z.string().max(100).optional(),
      }),
      body,
    );
    const emp = input.employeeId
      ? await this.db.one(`select id, company_id, full_name, external_employee_id from employees where id = $1 and status = 'approved'`, [input.employeeId])
      : await this.db.one(
          `select id, company_id, full_name, external_employee_id from employees where external_employee_id = $1 and status = 'approved' limit 1`,
          [input.externalEmployeeId ?? '101'],
        );
    if (!emp) throw new NotFoundException('Approved worker not found');
    const issued = await this.devices.issueEnrollment(emp.company_id, emp.id, { type: 'employee', id: emp.id });
    const enrolled = await this.devices.enroll(issued.enrollmentToken, input.model ?? 'Worker Mobile PWA');
    return {
      ...enrolled,
      employee: { id: emp.id, fullName: emp.full_name, externalEmployeeId: emp.external_employee_id },
    };
  }

  /**
   * Allows a paired mobile handset in pilot demo mode to simulate a gate terminal punch directly from the phone.
   */
  @Post('demo-punch')
  @HttpCode(200)
  @UseGuards(DeviceAuthGuard)
  async demoPunch(@CurrentDevice() d: DevicePrincipal, @Body() body: unknown) {
    if (!config.simulatorEnabled) throw new ForbiddenException('Simulator disabled');
    const { eventType } = parse(z.object({ eventType: z.enum(ATTENDANCE_EVENT_TYPES) }), body);
    const emp = await this.db.one(`select external_employee_id from employees where id = $1`, [d.employeeId]);
    if (!emp?.external_employee_id) throw new BadRequestException('Employee has no attendance ID');
    await this.ingestion.ingest(
      { companyId: d.companyId, sourceSystem: 'simulator', actor: { type: 'employee', id: d.employeeId } },
      [
        {
          event_id: `mob-${randomUUID()}`,
          employee_id: emp.external_employee_id,
          event_type: eventType,
          occurred_at: new Date().toISOString(),
          correction_status: 'original',
          terminal_id: 'MOBILE-SIM',
        },
      ],
    );
    // Allow worker queue a short beat or return current status immediately
    await new Promise((r) => setTimeout(r, 650));
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
