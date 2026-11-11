/**
 * End-to-end test against a real PostgreSQL database.
 * Uses TEST_DATABASE_URL (default: postgres://postgres@localhost:5432/shiftfocus_test), which is wiped.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/shiftfocus_test';
process.env.WORKER_ENABLED = 'false';
process.env.EMM_MOCK_LATENCY_MS = '0';
process.env.AUTO_MIGRATE = 'true';

let app: INestApplication;
let base: string;
let drain: () => Promise<number>;
let adminToken: string;
let connectorKey: string;

async function api(method: string, path: string, opts: { token?: string; body?: unknown; csv?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.csv !== undefined) {
    headers['content-type'] = 'text/csv';
    body = opts.csv;
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(base + path, { method, headers, body });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

before(async () => {
  const { Pool } = await import('pg');
  const { ensureDatabase, runMigrations } = await import('./db/migrate');
  const { seed, DEMO } = await import('./db/seed');
  await ensureDatabase(process.env.DATABASE_URL!);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await runMigrations(pool);
  await seed(pool, { reset: true });
  await pool.end();
  connectorKey = DEMO.connectorKey;

  const { createApp } = await import('./main');
  const { WorkerService } = await import('./services/worker.service');
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  base = `http://127.0.0.1:${addr.port}`;
  const worker = app.get(WorkerService);
  drain = () => worker.drain();

  const login = await api('POST', '/v1/auth/login', { body: { email: DEMO.owner.email, password: DEMO.owner.password } });
  assert.equal(login.status, 200);
  adminToken = login.body.token;
});

after(async () => {
  await app?.close();
});

async function employeeByExt(ext: string) {
  const list = await api('GET', '/v1/admin/employees', { token: adminToken });
  return list.body.find((e: any) => e.external_employee_id === ext);
}

async function enrollPhone(ext: string): Promise<string> {
  const emp = await employeeByExt(ext);
  const iss = await api('POST', `/v1/admin/employees/${emp.id}/device/enrollment`, { token: adminToken });
  assert.equal(iss.status, 200);
  const en = await api('POST', '/v1/device/enroll', { body: { enrollmentToken: iss.body.enrollmentToken, model: 'Test Phone' } });
  assert.equal(en.status, 200, JSON.stringify(en.body));
  await drain();
  return en.body.deviceToken;
}

test('rejects unauthenticated access', async () => {
  assert.equal((await api('GET', '/v1/admin/employees')).status, 401);
  assert.equal((await api('POST', '/v1/connector/events', { token: 'sfc_nope_nope', body: { events: [] } })).status, 401);
  assert.equal((await api('GET', '/v1/device/status', { token: 'garbage' })).status, 401);
});

test('clock-in restricts the device; duplicates are idempotent; clock-out releases', async () => {
  const deviceToken = await enrollPhone('101');
  let status = await api('GET', '/v1/device/status', { token: deviceToken });
  assert.equal(status.body.appliedMode, 'unrestricted');

  const ev = { event_id: 'v-1001', employee_id: '101', event_type: 'clock_in', occurred_at: minutesAgo(5) };
  const r1 = await api('POST', '/v1/connector/events', { token: connectorKey, body: { events: [ev] } });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.counts.accepted, 1);
  await drain();
  status = await api('GET', '/v1/device/status', { token: deviceToken });
  assert.equal(status.body.shiftState, 'on_shift');
  assert.equal(status.body.appliedMode, 'focus');
  assert.equal(status.body.syncPending, false);

  const r2 = await api('POST', '/v1/connector/events', { token: connectorKey, body: { events: [ev] } });
  assert.equal(r2.body.counts.duplicate, 1);

  await api('POST', '/v1/connector/events', {
    token: connectorKey,
    body: { events: [{ event_id: 'v-1002', employee_id: '101', event_type: 'clock_out', occurred_at: minutesAgo(1) }] },
  });
  await drain();
  status = await api('GET', '/v1/device/status', { token: deviceToken });
  assert.equal(status.body.shiftState, 'off_shift');
  assert.equal(status.body.appliedMode, 'unrestricted');
});

test('emergency override releases immediately, notifies admin, and ends at clock-out', async () => {
  const deviceToken = await enrollPhone('102');
  await api('POST', '/v1/connector/events', {
    token: connectorKey,
    body: { events: [{ event_id: 'v-2001', employee_id: '102', event_type: 'clock_in', occurred_at: minutesAgo(30) }] },
  });
  await drain();
  assert.equal((await api('GET', '/v1/device/status', { token: deviceToken })).body.appliedMode, 'focus');

  const ov = await api('POST', '/v1/device/override', { token: deviceToken, body: { reasonCategory: 'family' } });
  assert.equal(ov.status, 200);
  assert.equal(ov.body.status.desiredMode, 'unrestricted');
  assert.equal(ov.body.status.reason, 'emergency_override');
  await drain();
  assert.equal((await api('GET', '/v1/device/status', { token: deviceToken })).body.appliedMode, 'unrestricted');

  const notes = await api('GET', '/v1/admin/notifications', { token: adminToken });
  assert.ok(notes.body.some((n: any) => n.kind === 'override'));

  await api('POST', '/v1/connector/events', {
    token: connectorKey,
    body: { events: [{ event_id: 'v-2002', employee_id: '102', event_type: 'clock_out', occurred_at: minutesAgo(0) }] },
  });
  await drain();
  const overrides = await api('GET', '/v1/admin/overrides', { token: adminToken });
  const mine = overrides.body.find((o: any) => o.full_name === 'Ravi Kumar');
  assert.equal(mine.end_reason, 'shift_ended');
  const ack = await api('POST', `/v1/admin/overrides/${mine.id}/acknowledge`, { token: adminToken, body: { followUpNote: 'Called back, all ok' } });
  assert.equal(ack.status, 200);
});

test('vendor correction voids a wrong clock-in and HR manual clock-out is audited', async () => {
  const deviceToken = await enrollPhone('103');
  await api('POST', '/v1/connector/events', {
    token: connectorKey,
    body: { events: [{ event_id: 'v-3001', employee_id: '103', event_type: 'clock_in', occurred_at: minutesAgo(10) }] },
  });
  await drain();
  assert.equal((await api('GET', '/v1/device/status', { token: deviceToken })).body.appliedMode, 'focus');

  const voided = await api('POST', '/v1/connector/events', {
    token: connectorKey,
    body: { events: [{ event_id: 'v-3001', employee_id: '103', event_type: 'clock_in', occurred_at: minutesAgo(10), correction_status: 'voided' }] },
  });
  assert.equal(voided.body.counts.voided, 1);
  await drain();
  assert.equal((await api('GET', '/v1/device/status', { token: deviceToken })).body.appliedMode, 'unrestricted');

  // New shift, then HR enters a missed clock-out.
  await api('POST', '/v1/connector/events', {
    token: connectorKey,
    body: { events: [{ event_id: 'v-3002', employee_id: '103', event_type: 'clock_in', occurred_at: minutesAgo(8) }] },
  });
  await drain();
  const emp = await employeeByExt('103');
  const manual = await api('POST', '/v1/admin/events/manual', {
    token: adminToken,
    body: { employeeId: emp.id, eventType: 'clock_out', occurredAt: minutesAgo(1), reason: 'Terminal offline at shift end' },
  });
  assert.equal(manual.status, 201, JSON.stringify(manual.body));
  await drain();
  assert.equal((await api('GET', '/v1/device/status', { token: deviceToken })).body.appliedMode, 'unrestricted');
  const audit = await api('GET', '/v1/admin/audit', { token: adminToken });
  assert.ok(audit.body.some((l: any) => l.action === 'attendance.manual_event'));
});

test('fail-safe releases a shift that exceeded max length without clock-out', async () => {
  const deviceToken = await enrollPhone('104');
  await api('POST', '/v1/connector/events', {
    token: connectorKey,
    body: { events: [{ event_id: 'v-4001', employee_id: '104', event_type: 'clock_in', occurred_at: minutesAgo(13 * 60) }] },
  });
  await drain();
  const s = await api('GET', '/v1/device/status', { token: deviceToken });
  assert.equal(s.body.shiftState, 'on_shift');
  assert.equal(s.body.reason, 'fail_safe_max_shift');
  assert.equal(s.body.appliedMode, 'unrestricted');
});

test('unmapped events are kept and backfilled on approval; CSV fallback and validation work', async () => {
  const csv = `event_id,employee_id,event_type,occurred_at\nc-1,999,clock_in,${minutesAgo(3)}\nc-2,999,teleport,${minutesAgo(2)}\n`;
  const r = await api('POST', '/v1/connector/events.csv', { token: connectorKey, csv });
  assert.equal(r.status, 200);
  assert.equal(r.body.counts.accepted_unmapped, 1);
  assert.equal(r.body.counts.rejected, 1);

  const reg = await api('POST', '/v1/public/register', { body: { joinCode: 'demo-plant', fullName: 'New Worker', phone: '+91 98000 00999' } });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const appr = await api('POST', `/v1/admin/employees/${reg.body.id}/approve`, { token: adminToken, body: { externalEmployeeId: '999' } });
  assert.equal(appr.status, 200);
  const emp = await employeeByExt('999');
  assert.equal(emp.shift_state, 'on_shift');
});

test('role checks: viewer cannot change policy; policy change re-syncs devices', async () => {
  const { DEMO } = await import('./db/seed');
  const v = await api('POST', '/v1/auth/login', { body: { email: DEMO.viewer.email, password: DEMO.viewer.password } });
  const pol = await api('GET', '/v1/admin/policy', { token: adminToken });
  const body = {
    restrictedApps: [...pol.body.restricted_apps, { packageName: 'com.zhiliaoapp.musically', label: 'TikTok' }],
    alwaysAllowedApps: pol.body.always_allowed_apps,
    breakMode: 'focus',
    maxShiftHours: 12,
  };
  assert.equal((await api('PUT', '/v1/admin/policy', { token: v.body.token, body })).status, 403);
  const up = await api('PUT', '/v1/admin/policy', { token: adminToken, body });
  assert.equal(up.status, 200);
  assert.equal(up.body.version, pol.body.version + 1);
  await drain();
  const dash = await api('GET', '/v1/admin/dashboard', { token: adminToken });
  assert.equal(dash.status, 200);
  assert.equal(dash.body.devices.in_sync, dash.body.devices.enrolled);
});
