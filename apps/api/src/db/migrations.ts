/**
 * Ordered SQL migrations. Each migration runs once, inside a transaction.
 * Never edit an applied migration; add a new one instead.
 */
export const migrations: { id: string; sql: string }[] = [
  {
    id: '001_init',
    sql: /* sql */ `
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);

create table admins (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  password_hash text not null,
  role text not null check (role in ('owner', 'hr', 'viewer')),
  created_at timestamptz not null default now()
);

create table connectors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  source_system text not null,
  key_prefix text not null unique,
  key_hash text not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  last_seen_version text,
  created_at timestamptz not null default now(),
  unique (company_id, source_system)
);

create table policies (
  company_id uuid primary key references companies(id) on delete cascade,
  restricted_apps jsonb not null default '[]'::jsonb,
  always_allowed_apps jsonb not null default '[]'::jsonb,
  break_mode text not null default 'unrestricted' check (break_mode in ('unrestricted', 'focus')),
  max_shift_hours int not null default 14 check (max_shift_hours between 1 and 24),
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references admins(id) on delete set null
);

create table employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  full_name text not null,
  phone text not null,
  external_employee_id text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'deactivated')),
  decided_by uuid references admins(id) on delete set null,
  decided_at timestamptz,
  shift_state text not null default 'off_shift' check (shift_state in ('off_shift', 'on_shift', 'on_break')),
  shift_started_at timestamptz,
  last_event_at timestamptz,
  state_computed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, phone),
  unique (company_id, external_employee_id)
);

create table devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null unique references employees(id) on delete cascade,
  enrollment_status text not null default 'pending' check (enrollment_status in ('pending', 'enrolled', 'unenrolled')),
  enrollment_token_prefix text unique,
  enrollment_token_hash text,
  enrollment_expires_at timestamptz,
  device_token_prefix text unique,
  device_token_hash text,
  emm_device_id text,
  model text,
  enrolled_at timestamptz,
  desired_state text not null default 'unrestricted' check (desired_state in ('focus', 'unrestricted')),
  desired_reason text not null default 'not_enrolled',
  desired_version int not null default 0,
  applied_state text check (applied_state in ('focus', 'unrestricted')),
  applied_version int,
  last_sync_at timestamptz,
  last_sync_error text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table attendance_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  source_system text not null,
  vendor_event_id text not null,
  external_employee_id text not null,
  employee_id uuid references employees(id) on delete set null,
  event_type text not null check (event_type in ('clock_in', 'break_start', 'break_end', 'clock_out')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  correction_status text not null default 'original' check (correction_status in ('original', 'corrected', 'voided')),
  corrected_at timestamptz,
  terminal_id text,
  entered_by uuid references admins(id) on delete set null,
  reason text,
  raw jsonb,
  unique (company_id, source_system, vendor_event_id)
);
create index attendance_events_employee_time on attendance_events (employee_id, occurred_at);
create index attendance_events_company_received on attendance_events (company_id, received_at desc);

create table overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  reason_category text check (reason_category in ('medical', 'family', 'safety', 'work_related', 'other')),
  note text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text,
  acknowledged_by uuid references admins(id) on delete set null,
  acknowledged_at timestamptz,
  follow_up_note text
);
create unique index overrides_one_active on overrides (employee_id) where ended_at is null;

create table policy_sync_log (
  id bigserial primary key,
  company_id uuid not null references companies(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  desired_version int not null,
  mode text not null,
  reason text not null,
  trigger_received_at timestamptz,
  requested_at timestamptz not null default now(),
  applied_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'applied', 'superseded', 'failed')),
  error text
);
create index policy_sync_log_company_time on policy_sync_log (company_id, requested_at desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title text not null,
  body text,
  employee_id uuid references employees(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table audit_log (
  id bigserial primary key,
  company_id uuid references companies(id) on delete cascade,
  actor_type text not null check (actor_type in ('admin', 'employee', 'connector', 'system')),
  actor_id text,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_company_time on audit_log (company_id, created_at desc);

create table jobs (
  id bigserial primary key,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'dead')),
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 6,
  last_error text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_ready on jobs (run_at, id) where status = 'queued';
create unique index jobs_dedupe on jobs (dedupe_key) where status = 'queued';
`,
  },
];
