import { BadRequestException, Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ConnectorAuthGuard, ConnectorPrincipal, CurrentConnector, CurrentDevice, DeviceAuthGuard, DevicePrincipal } from '../common/auth';
import { parse } from '../common/validation';
import { Db } from '../db/db.service';
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

/** API used by the employee's Android client (status, emergency override). */
@Controller('v1/device')
export class DeviceController {
  constructor(private readonly devices: DeviceService) {}

  @Post('enroll')
  @HttpCode(200)
  enroll(@Body() body: unknown) {
    const input = parse(z.object({ enrollmentToken: z.string().min(10), model: z.string().max(100).optional() }), body);
    return this.devices.enroll(input.enrollmentToken, input.model);
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
