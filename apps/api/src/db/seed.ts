/**
 * Demo seed data for local development and pilot demos.
 *   npm run db:seed            # create demo tenant if missing
 *   npm run db:seed -- --reset # wipe ALL data first
 */
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { config } from '../config';
import { sha256 } from '../common/tokens';
import { ensureDatabase, runMigrations } from './migrate';

export const DEMO = {
  joinCode: 'DEMO-PLANT',
  owner: { email: 'owner@demo.local', password: 'ShiftFocus#2026', name: 'Priya Deshmukh (Plant Owner)' },
  hr: { email: 'hr@demo.local', password: 'ShiftFocus#2026', name: 'Rahul Shinde (HR)' },
  viewer: { email: 'viewer@demo.local', password: 'ShiftFocus#2026', name: 'Line Supervisor (read-only)' },
  /** Fixed dev-only connector key so the CLI simulator works out of the box. */
  connectorKey: process.env.SEED_CONNECTOR_KEY ?? 'sfc_devkey0001_local-development-only-connector-key',
};

export const DEFAULT_RESTRICTED = [
  { packageName: 'com.instagram.android', label: 'Instagram' },
  { packageName: 'com.google.android.youtube', label: 'YouTube' },
  { packageName: 'com.facebook.katana', label: 'Facebook' },
  { packageName: 'com.snapchat.android', label: 'Snapchat' },
  { packageName: 'in.mohalla.video', label: 'Moj' },
  { packageName: 'com.eterno.shortvideos', label: 'Josh' },
];
export const DEFAULT_ALLOWED = [
  { packageName: 'com.google.android.dialer', label: 'Phone' },
  { packageName: 'com.google.android.apps.messaging', label: 'Messages (SMS)' },
  { packageName: 'com.whatsapp', label: 'WhatsApp' },
];

export async function seed(pool: Pool, opts: { reset?: boolean } = {}): Promise<void> {
  const q = (sql: string, p?: unknown[]) => pool.query(sql, p as any[]);
  if (opts.reset) {
    await q(`truncate companies, jobs, audit_log restart identity cascade`);
  }
  const exists = await q(`select id from companies where join_code = $1`, [DEMO.joinCode]);
  if (exists.rowCount) {
    console.log('Demo tenant already exists (use --reset to recreate).');
    return;
  }
  const company = (await q(`insert into companies (name, join_code, timezone) values ('Demo Plant — Pune Unit 2', $1, 'Asia/Kolkata') returning id`, [DEMO.joinCode])).rows[0];
  const hash = await bcrypt.hash(DEMO.owner.password, 10);
  const owner = (await q(`insert into admins (company_id, email, full_name, password_hash, role) values ($1,$2,$3,$4,'owner') returning id`, [company.id, DEMO.owner.email, DEMO.owner.name, hash])).rows[0];
  await q(`insert into admins (company_id, email, full_name, password_hash, role) values ($1,$2,$3,$4,'hr')`, [company.id, DEMO.hr.email, DEMO.hr.name, hash]);
  await q(`insert into admins (company_id, email, full_name, password_hash, role) values ($1,$2,$3,$4,'viewer')`, [company.id, DEMO.viewer.email, DEMO.viewer.name, hash]);
  await q(
    `insert into policies (company_id, restricted_apps, always_allowed_apps, break_mode, max_shift_hours, updated_by) values ($1,$2,$3,'unrestricted',12,$4)`,
    [company.id, JSON.stringify(DEFAULT_RESTRICTED), JSON.stringify(DEFAULT_ALLOWED), owner.id],
  );
  const prefix = DEMO.connectorKey.split('_')[1];
  await q(
    `insert into connectors (company_id, name, source_system, key_prefix, key_hash) values ($1, 'Plant attendance server (dev)', 'demo-attendance', $2, $3)`,
    [company.id, prefix, sha256(DEMO.connectorKey)],
  );

  const people = [
    ['Asha Patil', '+919800000101', '101', 'approved', true],
    ['Ravi Kumar', '+919800000102', '102', 'approved', true],
    ['Sunita Jadhav', '+919800000103', '103', 'approved', true],
    ['Imran Shaikh', '+919800000104', '104', 'approved', false],
    ['Vikram More', '+919800000105', null, 'pending', false],
  ] as const;
  for (const [name, phone, ext, status, enrolled] of people) {
    const e = (await q(
      `insert into employees (company_id, full_name, phone, external_employee_id, status, decided_by, decided_at)
       values ($1,$2,$3,$4,$5,$6, case when $5 = 'approved' then now() else null end) returning id`,
      [company.id, name, phone, ext, status, status === 'approved' ? owner.id : null],
    )).rows[0];
    if (enrolled) {
      // Device token is random/unknown: use "Re-enroll phone" in the simulator to get a fresh one.
      const d = (await q(
        `insert into devices (company_id, employee_id, enrollment_status, emm_device_id, model, enrolled_at, device_token_prefix, device_token_hash,
           desired_state, desired_reason, desired_version, applied_state, applied_version, last_sync_at, last_seen_at)
         values ($1,$2,'enrolled',$3,'Samsung Galaxy A15',now(),$4,$5,'unrestricted','off_shift',1,'unrestricted',1,now(),now()) returning id`,
        [company.id, e.id, `mock-seed-${ext}`, `seed${ext}`, sha256(`seed-${ext}-${Math.random()}`)],
      )).rows[0];
      void d;
    }
  }
  await q(`insert into audit_log (company_id, actor_type, action, details) values ($1, 'system', 'seed.created', '{}')`, [company.id]);
  console.log(`
Seeded demo tenant "${DEMO.joinCode}".
  Owner login : ${DEMO.owner.email} / ${DEMO.owner.password}
  HR login    : ${DEMO.hr.email} / ${DEMO.hr.password}
  Viewer login: ${DEMO.viewer.email} / ${DEMO.viewer.password}
  Connector key (dev only): ${DEMO.connectorKey}
`);
}

if (require.main === module) {
  (async () => {
    await ensureDatabase(config.databaseUrl);
    const pool = new Pool({ connectionString: config.databaseUrl });
    try {
      await runMigrations(pool, console.log);
      await seed(pool, { reset: process.argv.includes('--reset') });
    } finally {
      await pool.end();
    }
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
