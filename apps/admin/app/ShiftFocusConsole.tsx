'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

type Tab = 'overview' | 'employees' | 'policy' | 'events' | 'overrides' | 'connectors' | 'audit';
type RosterFilter = 'all' | 'on_shift' | 'on_break' | 'pending';

interface AppRef {
  packageName: string;
  label: string;
}

async function apiFetch(path: string, opts: { method?: string; token?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.message
      ? Array.isArray(data.message)
        ? data.message.join(', ')
        : typeof data.message === 'string'
          ? data.message
          : JSON.stringify(data)
      : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

const fmtTime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return (
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
    ' · ' +
    d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  );
};

const initials = (label: string) =>
  label
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

export default function ShiftFocusConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [simOpen, setSimOpen] = useState(true);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Login form state
  const [email, setEmail] = useState('owner@demo.local');
  const [password, setPassword] = useState('ShiftFocus#2026');
  const [loggingIn, setLoggingIn] = useState(false);

  // Data slices
  const [dashboard, setDashboard] = useState<any>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [policy, setPolicy] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [overrides, setOverrides] = useState<any[]>([]);
  const [connectors, setConnectors] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);

  // Overview filters
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Policy draft
  const [newPkg, setNewPkg] = useState('');
  const [newLabel, setNewLabel] = useState('');

  // Manual HR event form
  const [manualEmpId, setManualEmpId] = useState('');
  const [manualType, setManualType] = useState<'clock_in' | 'break_start' | 'break_end' | 'clock_out'>('clock_out');
  const [manualReason, setManualReason] = useState('Missed clock-out punch at shift end');

  // Connector form
  const [connName, setConnName] = useState('');
  const [connSource, setConnSource] = useState('');
  const [issuedKey, setIssuedKey] = useState<string | null>(null);

  // Approval inputs per pending employee
  const [extIdDrafts, setExtIdDrafts] = useState<Record<string, string>>({});

  // Simulator state (right-hand panel)
  const [simExtId, setSimExtId] = useState('101');
  const [deviceTokens, setDeviceTokens] = useState<Record<string, string>>({});
  const [phoneStatus, setPhoneStatus] = useState<any>(null);
  const [phoneAppNotice, setPhoneAppNotice] = useState<{ blocked: boolean; app: string; detail: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState<'family' | 'medical' | 'safety' | 'work_related' | 'other'>('family');
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regExtId, setRegExtId] = useState('');
  const [runningScenario, setRunningScenario] = useState<string | null>(null);

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setFlash({ kind, text });
    setTimeout(() => setFlash((prev) => (prev?.text === text ? null : prev)), 5000);
  }, []);

  const refreshAll = useCallback(
    async (authToken: string) => {
      try {
        const [meRes, dashRes, empRes, polRes, evRes, ovRes, connRes, audRes, noteRes] = await Promise.all([
          apiFetch('/v1/admin/me', { token: authToken }),
          apiFetch('/v1/admin/dashboard', { token: authToken }),
          apiFetch('/v1/admin/employees', { token: authToken }),
          apiFetch('/v1/admin/policy', { token: authToken }),
          apiFetch('/v1/admin/events?limit=80', { token: authToken }),
          apiFetch('/v1/admin/overrides', { token: authToken }),
          apiFetch('/v1/admin/connectors', { token: authToken }),
          apiFetch('/v1/admin/audit?limit=80', { token: authToken }),
          apiFetch('/v1/admin/notifications', { token: authToken }),
        ]);
        setMe(meRes);
        setDashboard(dashRes);
        setEmployees(empRes);
        setPolicy((prev: any) => prev ?? polRes);
        setEvents(evRes);
        setOverrides(ovRes);
        setConnectors(connRes);
        setAudit(audRes);
        setNotifications(noteRes);
      } catch (err: any) {
        notify('err', err.message);
      }
    },
    [notify],
  );

  const refreshPhone = useCallback(async (devToken?: string) => {
    if (!devToken) {
      setPhoneStatus(null);
      return;
    }
    try {
      const st = await apiFetch('/v1/device/status', { token: devToken });
      setPhoneStatus(st);
    } catch {
      setPhoneStatus(null);
    }
  }, []);

  const handleLogin = async (loginEmail = email, loginPassword = password) => {
    setLoggingIn(true);
    try {
      const res = await apiFetch('/v1/auth/login', {
        method: 'POST',
        body: { email: loginEmail, password: loginPassword },
      });
      setToken(res.token);
      setPolicy(null);
      await refreshAll(res.token);
      notify('ok', `Signed in as ${res.admin.fullName} (${res.admin.role})`);
    } catch (err: any) {
      notify('err', err.message);
    } finally {
      setLoggingIn(false);
    }
  };

  // Auto-login to demo owner on mount
  useEffect(() => {
    void handleLogin('owner@demo.local', 'ShiftFocus#2026');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll live status every 2.5s while logged in
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => {
      void refreshAll(token);
      const activeDevToken = deviceTokens[simExtId];
      if (activeDevToken) void refreshPhone(activeDevToken);
    }, 2500);
    return () => clearInterval(id);
  }, [token, simExtId, deviceTokens, refreshAll, refreshPhone]);

  useEffect(() => {
    setPhoneAppNotice(null);
    const activeDevToken = deviceTokens[simExtId];
    void refreshPhone(activeDevToken);
  }, [simExtId, deviceTokens, refreshPhone]);

  const selectedSimEmp = useMemo(
    () => employees.find((e) => e.external_employee_id === simExtId) ?? employees.find((e) => e.status === 'approved'),
    [employees, simExtId],
  );

  const filteredRoster = useMemo(() => {
    return employees.filter((e) => {
      if (rosterFilter === 'on_shift' && e.shift_state !== 'on_shift') return false;
      if (rosterFilter === 'on_break' && e.shift_state !== 'on_break') return false;
      if (rosterFilter === 'pending' && e.status !== 'pending') return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          e.full_name?.toLowerCase().includes(q) ||
          e.phone?.toLowerCase().includes(q) ||
          String(e.external_employee_id ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [employees, rosterFilter, searchQuery]);

  // Simulator: 1-click enroll/connect employee phone so the simulated Android screen can poll `/v1/device/status`
  const connectSimPhone = async (emp: any): Promise<string | null> => {
    if (!token || !emp) return null;
    try {
      const iss = await apiFetch(`/v1/admin/employees/${emp.id}/device/enrollment`, { method: 'POST', token });
      const enr = await apiFetch('/v1/device/enroll', {
        method: 'POST',
        body: { enrollmentToken: iss.enrollmentToken, model: 'Samsung Galaxy A15 (Managed)' },
      });
      const extKey = emp.external_employee_id ?? emp.id;
      setDeviceTokens((prev) => ({ ...prev, [extKey]: enr.deviceToken }));
      setTimeout(async () => {
        await refreshAll(token);
        await refreshPhone(enr.deviceToken);
      }, 400);
      notify('ok', `Enrolled & connected ${emp.full_name}'s Android handset`);
      return enr.deviceToken as string;
    } catch (err: any) {
      notify('err', err.message);
      return null;
    }
  };

  const sendSimPunch = async (
    eventType: 'clock_in' | 'break_start' | 'break_end' | 'clock_out',
    targetExtId = selectedSimEmp?.external_employee_id,
  ) => {
    if (!token || !targetExtId) return;
    try {
      await apiFetch('/v1/admin/simulator/punch', {
        method: 'POST',
        token,
        body: { externalEmployeeId: targetExtId, eventType },
      });
      setPhoneAppNotice(null);
      notify('ok', `Attendance punch recorded: #${targetExtId} → ${eventType}`);
      setTimeout(async () => {
        await refreshAll(token);
        const dt = deviceTokens[targetExtId];
        if (dt) await refreshPhone(dt);
      }, 500);
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const triggerPhoneOverride = async () => {
    const dt = selectedSimEmp ? deviceTokens[selectedSimEmp.external_employee_id] : undefined;
    if (!dt) return;
    try {
      const res = await apiFetch('/v1/device/override', {
        method: 'POST',
        token: dt,
        body: { reasonCategory: overrideReason, note: 'Triggered from worker handset' },
      });
      setPhoneStatus(res.status);
      setPhoneAppNotice(null);
      if (token) setTimeout(() => void refreshAll(token), 450);
      notify('ok', 'Emergency override activated immediately — all restrictions lifted');
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const endPhoneOverride = async () => {
    const dt = selectedSimEmp ? deviceTokens[selectedSimEmp.external_employee_id] : undefined;
    if (!dt) return;
    try {
      const st = await apiFetch('/v1/device/override/end', { method: 'POST', token: dt });
      setPhoneStatus(st);
      if (token) setTimeout(() => void refreshAll(token), 450);
      notify('ok', 'Emergency override ended by worker');
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  // Interactive walkthrough: runs a complete shift lifecycle in ~7 seconds so users can watch it live
  const runGuidedDemo = async () => {
    if (!token || !selectedSimEmp || runningScenario) return;
    const ext = selectedSimEmp.external_employee_id;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      setRunningScenario('Enrolling Android handset…');
      let dt = deviceTokens[ext];
      if (!dt) {
        dt = (await connectSimPhone(selectedSimEmp)) ?? '';
        await wait(900);
      }
      setRunningScenario('Step 1/4 · Worker clocks in at gate terminal…');
      await sendSimPunch('clock_in', ext);
      await wait(1600);
      setRunningScenario('Step 2/4 · Worker starts verified break (restrictions lift)…');
      await sendSimPunch('break_start', ext);
      await wait(1600);
      setRunningScenario('Step 3/4 · Break ends (Focus Mode resumes)…');
      await sendSimPunch('break_end', ext);
      await wait(1400);
      setRunningScenario(null);
      notify('ok', `Demo complete: ${selectedSimEmp.full_name} is now On Shift with Focus Policy active. Try tapping a blocked app on the phone!`);
    } catch {
      setRunningScenario(null);
    }
  };

  if (!token) {
    return (
      <main style={{ maxWidth: 1080, margin: '40px auto', padding: '0 20px 56px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 28,
            alignItems: 'start',
          }}
        >
          {/* Public Product Overview for Visitors & Search Engines */}
          <section style={{ paddingTop: 8 }}>
            <div className="brand-cluster" style={{ marginBottom: 16 }}>
              <span className="brand-mark">SF</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>ShiftFocus</div>
                <div className="brand-subtitle">Attendance-Linked Workplace Focus</div>
              </div>
            </div>

            <h1 style={{ fontSize: 30, lineHeight: 1.2, margin: '0 0 12px', fontWeight: 750, letterSpacing: '-0.02em' }}>
              Attendance-Linked Focus Controls for Industrial Workplaces
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 15, lineHeight: 1.6, margin: '0 0 20px' }}>
              ShiftFocus connects your biometric or HR attendance system directly to Android Enterprise focus policies.
              When a worker clocks in, distracting social and short-video apps pause automatically—and restore the
              moment they take a break or clock out.
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                gap: 12,
                marginBottom: 20,
              }}
            >
              <div className="panel panel-pad" style={{ padding: 14 }}>
                <h2 style={{ fontSize: 14, margin: '0 0 6px', fontWeight: 650 }}>Biometric &amp; HR Sync</h2>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  Triggers focus mode on <code>clock_in</code>, lifts on <code>break_start</code>, and restores on{' '}
                  <code>clock_out</code>.
                </p>
              </div>
              <div className="panel panel-pad" style={{ padding: 14 }}>
                <h2 style={{ fontSize: 14, margin: '0 0 6px', fontWeight: 650 }}>Essentials Always Open</h2>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  Phone calls, SMS, and WhatsApp stay accessible at all times, plus a 1-tap Emergency Override.
                </p>
              </div>
              <div className="panel panel-pad" style={{ padding: 14 }}>
                <h2 style={{ fontSize: 14, margin: '0 0 6px', fontWeight: 650 }}>Privacy-First Guardrails</h2>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  Zero message reading, zero call logs, and zero GPS tracking—only shift-window app visibility.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <a href="/features" className="btn btn-sm" style={{ textDecoration: 'none' }}>
                How ShiftFocus Works &amp; FAQ →
              </a>
              <a href="/worker" className="btn btn-sm" style={{ textDecoration: 'none' }}>
                📱 Employee Mobile App (/worker)
              </a>
            </div>
          </section>

          {/* Interactive Pilot Console Login Card */}
          <section className="panel panel-pad" style={{ maxWidth: 440, width: '100%', justifySelf: 'center' }}>
            <div className="brand-cluster" style={{ marginBottom: 14 }}>
              <span className="brand-mark">SF</span>
              <div>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 650 }}>ShiftFocus Pilot Console</h2>
                <div className="brand-subtitle">Live Interactive Admin &amp; Gate Simulator</div>
              </div>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginTop: 0, fontSize: 13.5 }}>
              Sign in with a role-scoped demo account to inspect live shift policies, EMM device synchronization, and the
              interactive terminal simulator.
            </p>
            {flash && <div className={`toast-bar ${flash.kind}`}>{flash.text}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                id="login-email-input"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Administrator email"
              />
              <input
                id="login-password-input"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
              />
              <button id="login-submit-btn" className="btn btn-primary" disabled={loggingIn} onClick={() => handleLogin()}>
                {loggingIn ? 'Signing in…' : 'Sign in to Console'}
              </button>
            </div>
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-hairline)' }}>
              <a
                href="/worker"
                className="btn btn-primary"
                style={{ width: '100%', textDecoration: 'none', marginBottom: 12 }}
              >
                📱 Open Employee Mobile App (/worker)
              </a>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 8 }}>OR SIGN IN AS DEMO ADMIN</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button id="demo-owner-btn" className="btn btn-sm" onClick={() => handleLogin('owner@demo.local', 'ShiftFocus#2026')}>
                  Plant Owner
                </button>
                <button id="demo-hr-btn" className="btn btn-sm" onClick={() => handleLogin('hr@demo.local', 'ShiftFocus#2026')}>
                  HR Manager
                </button>
                <button id="demo-viewer-btn" className="btn btn-sm" onClick={() => handleLogin('viewer@demo.local', 'ShiftFocus#2026')}>
                  Line Supervisor (Read-Only)
                </button>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <div>
      {/* STICKY COMMAND TOPBAR */}
      <header className="topbar">
        <div className="brand-cluster">
          <span className="brand-mark">SF</span>
          <div>
            <span className="brand-title">ShiftFocus</span>
            <span className="brand-subtitle" style={{ marginLeft: 10 }}>
              {me?.company_name ?? 'Demo Plant — Pune Unit 2'} · Join Code <code>{me?.join_code ?? 'DEMO-PLANT'}</code>
            </span>
          </div>
        </div>

        <div className="topbar-right">
          <a
            href="/worker"
            id="open-worker-mobile-app-link"
            className="btn btn-sm btn-primary"
            style={{ textDecoration: 'none' }}
          >
            📱 Employee Mobile App
          </a>

          <span className="pill pill-ok" title="PostgreSQL + Background Worker + Mock EMM online">
            <span className="pill-dot" /> System Online
          </span>

          <div className="segmented" role="group" aria-label="Switch demo administrator role">
            {(
              [
                ['owner', 'Owner', 'owner@demo.local'],
                ['hr', 'HR', 'hr@demo.local'],
                ['viewer', 'Viewer', 'viewer@demo.local'],
              ] as const
            ).map(([rKey, rLabel, rEmail]) => (
              <button
                key={rKey}
                id={`switch-role-${rKey}`}
                className={`seg-btn ${me?.role === rKey ? 'active' : ''}`}
                onClick={() => handleLogin(rEmail, 'ShiftFocus#2026')}
              >
                {rLabel}
              </button>
            ))}
          </div>

          <button
            id="toggle-simulator-btn"
            className="btn btn-sm"
            onClick={() => setSimOpen((v) => !v)}
          >
            {simOpen ? 'Hide Simulator' : 'Open Pilot Simulator'}
          </button>
        </div>
      </header>

      <div className={`workspace-shell ${simOpen ? '' : 'sim-collapsed'}`}>
        {/* LEFT NAVIGATION RAIL */}
        <aside className="nav-rail">
          <div>
            <div className="nav-section-label">Operations</div>
            <nav className="nav-list" aria-label="Primary navigation">
              {(
                [
                  ['overview', 'Shift Floor Overview', null, false],
                  [
                    'employees',
                    'Workers & Devices',
                    dashboard?.employees?.pending ? `${dashboard.employees.pending}` : `${employees.length}`,
                    Boolean(dashboard?.employees?.pending),
                  ],
                  ['policy', 'Focus Policy', `v${policy?.version ?? 1}`, false],
                  ['events', 'Attendance & HR Fixes', `${events.length}`, false],
                  [
                    'overrides',
                    'Emergency Overrides',
                    dashboard?.overrides?.unacknowledged ? `${dashboard.overrides.unacknowledged} new` : null,
                    Boolean(dashboard?.overrides?.unacknowledged),
                  ],
                ] as const
              ).map(([key, label, count, isWarn]) => (
                <button
                  key={key}
                  id={`nav-${key}`}
                  className={`nav-item ${tab === key ? 'active' : ''}`}
                  onClick={() => setTab(key)}
                >
                  <span className="nav-item-label">{label}</span>
                  {count && <span className={`nav-counter ${isWarn ? 'warn' : ''}`}>{count}</span>}
                </button>
              ))}
            </nav>
          </div>

          <div>
            <div className="nav-section-label">Infrastructure & Governance</div>
            <nav className="nav-list" aria-label="Governance navigation">
              {(
                [
                  ['connectors', 'Attendance Connectors', `${connectors.length}`, false],
                  [
                    'audit',
                    'Audit & Alerts',
                    dashboard?.unreadNotifications ? `${dashboard.unreadNotifications}` : null,
                    Boolean(dashboard?.unreadNotifications),
                  ],
                ] as const
              ).map(([key, label, count, isWarn]) => (
                <button
                  key={key}
                  id={`nav-${key}`}
                  className={`nav-item ${tab === key ? 'active' : ''}`}
                  onClick={() => setTab(key)}
                >
                  <span className="nav-item-label">{label}</span>
                  {count && <span className={`nav-counter ${isWarn ? 'warn' : ''}`}>{count}</span>}
                </button>
              ))}
            </nav>
          </div>

          <div className="panel panel-pad" style={{ marginTop: 'auto', fontSize: 12 }}>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{me?.full_name}</div>
            <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
              Signed in as <code>{me?.role}</code> · TZ <code>{me?.timezone ?? 'Asia/Kolkata'}</code>
            </div>
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border-hairline)', color: 'var(--text-muted)' }}>
              Fail-safe window: <strong style={{ color: 'var(--text-secondary)' }}>{policy?.max_shift_hours ?? 12}h max shift</strong>
            </div>
          </div>
        </aside>

        {/* CENTER STAGE */}
        <main className="main-stage">
          {flash && (
            <div className={`toast-bar ${flash.kind}`} role="status">
              <span>{flash.text}</span>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.75 }}
                onClick={() => setFlash(null)}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* TAB 1: OVERVIEW */}
          {tab === 'overview' && dashboard && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="page-header">
                <div>
                  <h1 className="page-title">Shift Floor & Policy Telemetry</h1>
                  <p className="page-desc">
                    Live attendance-linked focus state across enrolled Android handsets, EMM sync latency, and worker safety overrides.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    id="run-guided-demo-top-btn"
                    className="btn btn-primary"
                    disabled={Boolean(runningScenario)}
                    onClick={runGuidedDemo}
                  >
                    {runningScenario ? runningScenario : '▶ Run Guided Shift Demo'}
                  </button>
                </div>
              </div>

              {/* 4-CELL KPI STRIP */}
              <section className="kpi-strip" aria-label="Operational indicators">
                <div className="kpi-cell">
                  <div className="kpi-label">Active Shift Floor</div>
                  <div className="kpi-value">
                    {dashboard.employees.on_shift}
                    <span className="kpi-unit">on shift</span>
                  </div>
                  <div className="kpi-sub">
                    {dashboard.employees.on_break} on break · {dashboard.employees.approved} approved ({dashboard.employees.pending} pending)
                  </div>
                </div>

                <div className="kpi-cell">
                  <div className="kpi-label">EMM Device Fleet Sync</div>
                  <div className="kpi-value">
                    {dashboard.devices.in_sync}/{dashboard.devices.enrolled}
                    <span className="kpi-unit">in sync</span>
                  </div>
                  <div className="kpi-sub">
                    {dashboard.devices.focus} in Focus Mode · {dashboard.devices.stale} stale check-in
                  </div>
                </div>

                <div className="kpi-cell">
                  <div className="kpi-label">Event → Policy Delay (24h)</div>
                  <div className="kpi-value">
                    {dashboard.policySync24h.p50_s != null ? `${Number(dashboard.policySync24h.p50_s).toFixed(2)}s` : '0.25s'}
                    <span className="kpi-unit">median</span>
                  </div>
                  <div className="kpi-sub">
                    p95: {dashboard.policySync24h.p95_s != null ? `${Number(dashboard.policySync24h.p95_s).toFixed(2)}s` : '—'} ·{' '}
                    {dashboard.policySync24h.applied} syncs applied
                  </div>
                </div>

                <div className="kpi-cell">
                  <div className="kpi-label">Emergency Overrides</div>
                  <div className="kpi-value">
                    {dashboard.overrides.active}
                    <span className="kpi-unit">active</span>
                  </div>
                  <div className="kpi-sub">
                    {dashboard.overrides.last_7d} in 7d · {dashboard.overrides.unacknowledged} awaiting follow-up
                  </div>
                </div>
              </section>

              {/* LIVE ROSTER WITH INLINE CONTROLS */}
              <section className="panel">
                <div className="panel-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <h2 className="panel-title">Workforce Shift & Device Matrix</h2>
                    <div className="segmented">
                      {(
                        [
                          ['all', `All (${employees.length})`],
                          ['on_shift', `On Shift (${dashboard.employees.on_shift})`],
                          ['on_break', `On Break (${dashboard.employees.on_break})`],
                          ['pending', `Pending (${dashboard.employees.pending})`],
                        ] as const
                      ).map(([fKey, fLabel]) => (
                        <button
                          key={fKey}
                          id={`filter-roster-${fKey}`}
                          className={`seg-btn ${rosterFilter === fKey ? 'active' : ''}`}
                          onClick={() => setRosterFilter(fKey)}
                        >
                          {fLabel}
                        </button>
                      ))}
                    </div>
                  </div>

                  <input
                    id="roster-search-input"
                    className="input"
                    style={{ width: 220 }}
                    placeholder="Filter by name, phone, ID…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Worker</th>
                      <th>Att. ID</th>
                      <th>Shift State</th>
                      <th>Device & EMM Sync</th>
                      <th>Policy Reason</th>
                      <th style={{ textAlign: 'right' }}>Quick Pilot Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRoster.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{e.full_name}</div>
                          <div className="mono" style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{e.phone}</div>
                        </td>
                        <td>
                          <code>{e.external_employee_id ?? 'unmapped'}</code>
                        </td>
                        <td>
                          {e.status !== 'approved' ? (
                            <span className="pill pill-warn">
                              <span className="pill-dot" /> {e.status}
                            </span>
                          ) : e.shift_state === 'on_shift' ? (
                            <span className="pill pill-focus">
                              <span className="pill-dot" /> on_shift
                            </span>
                          ) : e.shift_state === 'on_break' ? (
                            <span className="pill pill-ok">
                              <span className="pill-dot" /> on_break
                            </span>
                          ) : (
                            <span className="pill pill-neutral">off_shift</span>
                          )}
                        </td>
                        <td>
                          {e.enrollment_status !== 'enrolled' ? (
                            <span className="pill pill-neutral">not enrolled</span>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className={`pill ${e.desired_state === 'focus' ? 'pill-focus' : 'pill-ok'}`}>
                                {e.desired_state} v{e.desired_version}
                              </span>
                              <span style={{ fontSize: 11.5, color: e.in_sync ? 'var(--status-ok)' : 'var(--status-warn)' }}>
                                {e.in_sync ? '✓ synced' : 'syncing…'}
                              </span>
                            </div>
                          )}
                        </td>
                        <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                          {e.override_id ? (
                            <span className="pill pill-warn">⚡ Emergency override active</span>
                          ) : (
                            e.desired_reason_label ?? '—'
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {e.status === 'pending' ? (
                            <button className="btn btn-sm btn-primary" onClick={() => setTab('employees')}>
                              Review & Approve →
                            </button>
                          ) : (
                            <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              {e.external_employee_id && (
                                <>
                                  {e.shift_state === 'off_shift' && (
                                    <button
                                      className="btn btn-sm btn-primary"
                                      onClick={() => {
                                        setSimExtId(e.external_employee_id);
                                        void sendSimPunch('clock_in', e.external_employee_id);
                                      }}
                                    >
                                      Clock In
                                    </button>
                                  )}
                                  {e.shift_state === 'on_shift' && (
                                    <>
                                      <button
                                        className="btn btn-sm"
                                        onClick={() => {
                                          setSimExtId(e.external_employee_id);
                                          void sendSimPunch('break_start', e.external_employee_id);
                                        }}
                                      >
                                        Start Break
                                      </button>
                                      <button
                                        className="btn btn-sm btn-danger"
                                        onClick={() => {
                                          setSimExtId(e.external_employee_id);
                                          void sendSimPunch('clock_out', e.external_employee_id);
                                        }}
                                      >
                                        Clock Out
                                      </button>
                                    </>
                                  )}
                                  {e.shift_state === 'on_break' && (
                                    <button
                                      className="btn btn-sm btn-primary"
                                      onClick={() => {
                                        setSimExtId(e.external_employee_id);
                                        void sendSimPunch('break_end', e.external_employee_id);
                                      }}
                                    >
                                      End Break
                                    </button>
                                  )}
                                  <button
                                    className="btn btn-sm"
                                    onClick={() => {
                                      setSimOpen(true);
                                      setSimExtId(e.external_employee_id);
                                      if (!deviceTokens[e.external_employee_id]) {
                                        void connectSimPhone(e);
                                      }
                                    }}
                                  >
                                    Phone View
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {/* BOTTOM 2-COLUMN: RECENT EVENTS + PRIVACY CONTRACT */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 18 }}>
                <section className="panel">
                  <div className="panel-header">
                    <h2 className="panel-title">Recent Attendance Stream</h2>
                    <button className="btn btn-sm" onClick={() => setTab('events')}>
                      View All / Manual HR Fix
                    </button>
                  </div>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Worker</th>
                        <th>Event</th>
                        <th>Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.slice(0, 5).map((ev) => (
                        <tr key={ev.id}>
                          <td className="mono" style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{fmtTime(ev.occurred_at)}</td>
                          <td style={{ fontWeight: 500 }}>{ev.full_name ?? `#${ev.external_employee_id}`}</td>
                          <td>
                            <span className={`pill ${ev.correction_status === 'voided' ? 'pill-danger' : 'pill-focus'}`}>
                              {ev.event_type}
                            </span>
                          </td>
                          <td className="mono" style={{ color: 'var(--text-muted)' }}>{ev.source_system}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                <section className="panel panel-pad">
                  <h2 className="panel-title" style={{ marginBottom: 10 }}>Worker Privacy & Safety Guardrails</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, color: 'var(--text-secondary)', fontSize: 13 }}>
                    <div>
                      <strong style={{ color: 'var(--text-primary)' }}>1. Zero Personal Content Collection:</strong> ShiftFocus never ingests biometric templates, face images, fingerprints, SMS/WhatsApp messages, photos, or browsing history.
                    </div>
                    <div>
                      <strong style={{ color: 'var(--text-primary)' }}>2. Connectivity ≠ Misconduct:</strong> Network connectivity or push delivery status is never treated as evidence of app use or used to rank/discipline workers.
                    </div>
                    <div>
                      <strong style={{ color: 'var(--text-primary)' }}>3. Immediate Emergency Override:</strong> Workers can lift restrictions in one tap without waiting for administrator approval; overrides are logged for post-event follow-up.
                    </div>
                    <div>
                      <strong style={{ color: 'var(--text-primary)' }}>4. Bounded Fail-Safe Release:</strong> Any shift open longer than {policy?.max_shift_hours ?? 12} hours without a clock-out automatically reverts to unrestricted mode.
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* TAB 2: EMPLOYEES & DEVICES */}
          {tab === 'employees' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="page-header">
                <div>
                  <h1 className="page-title">Workers & Enrolled Android Devices</h1>
                  <p className="page-desc">
                    Account approval (mapping the attendance terminal ID) and Android Enterprise / EMM device enrollment are managed separately.
                  </p>
                </div>
              </div>

              <section className="panel">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Worker</th>
                      <th>Approval Status</th>
                      <th>Attendance ID</th>
                      <th>Device Enrollment</th>
                      <th>Current Policy</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{e.full_name}</div>
                          <div className="mono" style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{e.phone}</div>
                        </td>
                        <td>
                          <span className={`pill ${e.status === 'approved' ? 'pill-ok' : e.status === 'pending' ? 'pill-warn' : 'pill-danger'}`}>
                            {e.status}
                          </span>
                        </td>
                        <td>
                          {e.status === 'pending' ? (
                            <input
                              className="input mono"
                              style={{ width: 115 }}
                              placeholder="e.g. 105"
                              value={extIdDrafts[e.id] ?? ''}
                              onChange={(ev) => setExtIdDrafts({ ...extIdDrafts, [e.id]: ev.target.value })}
                            />
                          ) : (
                            <code>{e.external_employee_id ?? '—'}</code>
                          )}
                        </td>
                        <td>
                          <span className={`pill ${e.enrollment_status === 'enrolled' ? 'pill-ok' : 'pill-neutral'}`}>
                            {e.enrollment_status ?? 'not enrolled'}
                          </span>
                          {e.model && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>{e.model}</div>}
                        </td>
                        <td>
                          <span className={`pill ${e.desired_state === 'focus' ? 'pill-focus' : 'pill-ok'}`}>
                            {e.desired_state}
                          </span>
                          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>{e.desired_reason_label}</div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {e.status === 'pending' && (
                              <>
                                <button
                                  className="btn btn-sm btn-primary"
                                  onClick={async () => {
                                    const ext = (extIdDrafts[e.id] || '').trim();
                                    if (!ext) return notify('err', 'Enter the attendance system ID (e.g. 105) before approving');
                                    try {
                                      await apiFetch(`/v1/admin/employees/${e.id}/approve`, {
                                        method: 'POST',
                                        token,
                                        body: { externalEmployeeId: ext },
                                      });
                                      await refreshAll(token);
                                      notify('ok', `Approved ${e.full_name} and mapped Attendance ID #${ext}`);
                                    } catch (err: any) {
                                      notify('err', err.message);
                                    }
                                  }}
                                >
                                  Approve & Map ID
                                </button>
                                <button
                                  className="btn btn-sm btn-danger"
                                  onClick={async () => {
                                    try {
                                      await apiFetch(`/v1/admin/employees/${e.id}/reject`, {
                                        method: 'POST',
                                        token,
                                        body: { reason: 'Not on pilot team roster' },
                                      });
                                      await refreshAll(token);
                                      notify('ok', `Rejected ${e.full_name}`);
                                    } catch (err: any) {
                                      notify('err', err.message);
                                    }
                                  }}
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {e.status === 'approved' && (
                              <>
                                <button
                                  className="btn btn-sm"
                                  onClick={() => {
                                    setSimOpen(true);
                                    if (e.external_employee_id) setSimExtId(e.external_employee_id);
                                    void connectSimPhone(e);
                                  }}
                                >
                                  {e.enrollment_status === 'enrolled' ? 'Re-enroll / Connect Sim' : 'Enroll Phone in Sim'}
                                </button>
                                {e.enrollment_status === 'enrolled' && (
                                  <button
                                    className="btn btn-sm btn-danger"
                                    onClick={async () => {
                                      try {
                                        await apiFetch(`/v1/admin/employees/${e.id}/device/unenroll`, { method: 'POST', token });
                                        await refreshAll(token);
                                        notify('ok', `Unenrolled ${e.full_name}'s device`);
                                      } catch (err: any) {
                                        notify('err', err.message);
                                      }
                                    }}
                                  >
                                    Unenroll
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          )}

          {/* TAB 3: FOCUS POLICY */}
          {tab === 'policy' && policy && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="page-header">
                <div>
                  <h1 className="page-title">Workplace Focus Policy (v{policy.version})</h1>
                  <p className="page-desc">
                    Configure which apps are restricted during active shifts, how verified breaks behave, and the fail-safe release window.
                  </p>
                </div>
              </div>

              <section className="panel panel-pad">
                <h2 className="panel-title" style={{ marginBottom: 8 }}>Always-Available Essentials (Protected Baseline)</h2>
                <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: 13 }}>
                  Ordinary phone calls, SMS, and WhatsApp remain available at all times during shifts so workers can be reached.
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(policy.always_allowed_apps as AppRef[]).map((a) => (
                    <span key={a.packageName} className="pill pill-ok" style={{ padding: '5px 10px', fontSize: 12.5 }}>
                      ✓ {a.label} <code style={{ opacity: 0.75 }}>({a.packageName})</code>
                    </span>
                  ))}
                </div>
              </section>

              <section className="panel panel-pad">
                <h2 className="panel-title" style={{ marginBottom: 8 }}>Restricted Social & Short-Video Apps During Shifts</h2>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                  {(policy.restricted_apps as AppRef[]).map((a) => (
                    <span key={a.packageName} className="pill pill-focus" style={{ padding: '5px 10px', fontSize: 12.5 }}>
                      ⊘ {a.label} <code style={{ opacity: 0.75 }}>({a.packageName})</code>
                      <button
                        style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 4 }}
                        onClick={() =>
                          setPolicy({
                            ...policy,
                            restricted_apps: (policy.restricted_apps as AppRef[]).filter((x) => x.packageName !== a.packageName),
                          })
                        }
                        title={`Remove ${a.label}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr auto', gap: 8, maxWidth: 660 }}>
                  <input
                    id="new-app-label-input"
                    className="input"
                    placeholder="App label (e.g. ShareChat)"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                  />
                  <input
                    id="new-app-pkg-input"
                    className="input mono"
                    placeholder="Package name (e.g. in.mohalla.sharechat)"
                    value={newPkg}
                    onChange={(e) => setNewPkg(e.target.value)}
                  />
                  <button
                    id="add-restricted-app-btn"
                    className="btn"
                    onClick={() => {
                      if (!newLabel.trim() || !newPkg.trim()) return;
                      setPolicy({
                        ...policy,
                        restricted_apps: [...policy.restricted_apps, { label: newLabel.trim(), packageName: newPkg.trim() }],
                      });
                      setNewLabel('');
                      setNewPkg('');
                    }}
                  >
                    + Add App
                  </button>
                </div>
              </section>

              <section className="panel panel-pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                <div>
                  <label style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>Break Policy</label>
                  <select
                    id="break-mode-select"
                    className="select"
                    value={policy.break_mode}
                    onChange={(e) => setPolicy({ ...policy, break_mode: e.target.value })}
                  >
                    <option value="unrestricted">Unrestricted during verified breaks (Recommended)</option>
                    <option value="focus">Keep focus restrictions active during breaks</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    Bounded Fail-Safe Max Shift Hours (1–24h)
                  </label>
                  <input
                    id="max-shift-hours-input"
                    type="number"
                    className="input"
                    min={1}
                    max={24}
                    value={policy.max_shift_hours}
                    onChange={(e) => setPolicy({ ...policy, max_shift_hours: Number(e.target.value) })}
                  />
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    Automatically releases Focus Mode if a clock-out event is missing after this duration.
                  </div>
                </div>
              </section>

              <div>
                <button
                  id="save-policy-btn"
                  className="btn btn-primary"
                  onClick={async () => {
                    try {
                      const updated = await apiFetch('/v1/admin/policy', {
                        method: 'PUT',
                        token,
                        body: {
                          restrictedApps: policy.restricted_apps,
                          alwaysAllowedApps: policy.always_allowed_apps,
                          breakMode: policy.break_mode,
                          maxShiftHours: Number(policy.max_shift_hours),
                        },
                      });
                      setPolicy(updated);
                      await refreshAll(token);
                      notify('ok', `Published Focus Policy v${updated.version} and queued EMM sync across enrolled devices`);
                    } catch (err: any) {
                      notify('err', err.message);
                    }
                  }}
                >
                  Save & Publish Policy (Owner only)
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: ATTENDANCE EVENTS & MANUAL HR CORRECTIONS */}
          {tab === 'events' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="page-header">
                <div>
                  <h1 className="page-title">Attendance Events & HR Corrections</h1>
                  <p className="page-desc">
                    Idempotent event stream (deduplicated by vendor event ID) with auditable HR manual corrections for missed punches.
                  </p>
                </div>
              </div>

              <section className="panel panel-pad">
                <h2 className="panel-title" style={{ marginBottom: 10 }}>Record Manual HR Correction (Missed Punch / Exception)</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 2fr auto', gap: 8 }}>
                  <select id="manual-emp-select" className="select" value={manualEmpId} onChange={(e) => setManualEmpId(e.target.value)}>
                    <option value="">Select worker…</option>
                    {employees
                      .filter((e) => e.status === 'approved' && e.external_employee_id)
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.full_name} (#{e.external_employee_id})
                        </option>
                      ))}
                  </select>
                  <select id="manual-type-select" className="select" value={manualType} onChange={(e) => setManualType(e.target.value as any)}>
                    <option value="clock_out">clock_out</option>
                    <option value="clock_in">clock_in</option>
                    <option value="break_start">break_start</option>
                    <option value="break_end">break_end</option>
                  </select>
                  <input
                    id="manual-reason-input"
                    className="input"
                    placeholder="Mandatory audit reason"
                    value={manualReason}
                    onChange={(e) => setManualReason(e.target.value)}
                  />
                  <button
                    id="submit-manual-event-btn"
                    className="btn btn-primary"
                    onClick={async () => {
                      if (!manualEmpId) return notify('err', 'Choose a worker first');
                      try {
                        await apiFetch('/v1/admin/events/manual', {
                          method: 'POST',
                          token,
                          body: {
                            employeeId: manualEmpId,
                            eventType: manualType,
                            occurredAt: new Date().toISOString(),
                            reason: manualReason,
                          },
                        });
                        await refreshAll(token);
                        notify('ok', 'Manual HR correction recorded and device policy reconciled');
                      } catch (err: any) {
                        notify('err', err.message);
                      }
                    }}
                  >
                    Record Correction
                  </button>
                </div>
              </section>

              <section className="panel">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Occurred At</th>
                      <th>Worker</th>
                      <th>Event Type</th>
                      <th>Source & Vendor ID</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev) => (
                      <tr key={ev.id}>
                        <td className="mono" style={{ fontSize: 12 }}>{fmtTime(ev.occurred_at)}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{ev.full_name ?? 'Unmapped worker'}</div>
                          <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>ID #{ev.external_employee_id}</div>
                        </td>
                        <td>
                          <span className="pill pill-focus">{ev.event_type}</span>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          <div>
                            <code>{ev.source_system}</code> · <code style={{ color: 'var(--text-muted)' }}>{ev.vendor_event_id}</code>
                          </div>
                          {ev.reason && <div style={{ color: 'var(--status-warn)', marginTop: 2 }}>Reason: {ev.reason}</div>}
                        </td>
                        <td>
                          <span className={`pill ${ev.correction_status === 'voided' ? 'pill-danger' : 'pill-ok'}`}>
                            {ev.correction_status}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {ev.correction_status !== 'voided' && (
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={async () => {
                                try {
                                  await apiFetch(`/v1/admin/events/${ev.id}/void`, {
                                    method: 'POST',
                                    token,
                                    body: { reason: 'Voided erroneous punch by administrator' },
                                  });
                                  await refreshAll(token);
                                  notify('ok', 'Attendance event voided and shift state re-computed');
                                } catch (err: any) {
                                  notify('err', err.message);
                                }
                              }}
                            >
                              Void Event
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          )}

          {/* TAB 5: EMERGENCY OVERRIDES */}
          {tab === 'overrides' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="page-header">
                <div>
                  <h1 className="page-title">Emergency Overrides & Follow-Up</h1>
                  <p className="page-desc">
                    Emergency overrides restore unrestricted phone access immediately without waiting for approval. Administrators log follow-up notes here.
                  </p>
                </div>
              </div>

              <section className="panel">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Worker</th>
                      <th>Started</th>
                      <th>Ended</th>
                      <th>Category & Note</th>
                      <th style={{ textAlign: 'right' }}>Follow-Up Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overrides.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ color: 'var(--text-muted)', padding: 24 }}>
                          No emergency overrides triggered yet. Use the simulated Android handset on the right to test an instant worker override.
                        </td>
                      </tr>
                    )}
                    {overrides.map((ov) => (
                      <tr key={ov.id}>
                        <td style={{ fontWeight: 600 }}>{ov.full_name}</td>
                        <td className="mono" style={{ fontSize: 12 }}>{fmtTime(ov.started_at)}</td>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {ov.ended_at ? `${fmtTime(ov.ended_at)} (${ov.end_reason})` : <span className="pill pill-warn">Active now</span>}
                        </td>
                        <td>
                          <span className="pill pill-neutral">{ov.reason_category ?? 'unspecified'}</span>
                          {ov.note && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{ov.note}</div>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {ov.acknowledged_at ? (
                            <div style={{ fontSize: 12 }}>
                              <span className="pill pill-ok">Acknowledged</span> by {ov.acknowledged_by_name}
                              {ov.follow_up_note && <div style={{ color: 'var(--text-muted)', marginTop: 3 }}>{ov.follow_up_note}</div>}
                            </div>
                          ) : (
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={async () => {
                                try {
                                  await apiFetch(`/v1/admin/overrides/${ov.id}/acknowledge`, {
                                    method: 'POST',
                                    token,
                                    body: { followUpNote: 'Checked in with worker; emergency resolved.' },
                                  });
                                  await refreshAll(token);
                                  notify('ok', 'Override acknowledged');
                                } catch (err: any) {
                                  notify('err', err.message);
                                }
                              }}
                            >
                              Acknowledge Follow-Up
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          )}

          {/* TAB 6: CONNECTORS */}
          {tab === 'connectors' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="page-header">
                <div>
                  <h1 className="page-title">Local Attendance Connectors</h1>
                  <p className="page-desc">
                    Manage outbound TLS connector credentials (`sfc_&lt;prefix&gt;_&lt;secret&gt;`) with rotation and revocation.
                  </p>
                </div>
              </div>

              {issuedKey && (
                <section className="panel panel-pad">
                  <div style={{ fontWeight: 600, color: 'var(--status-warn)' }}>New Connector API Key (save now — shown only once):</div>
                  <code style={{ display: 'block', marginTop: 8, padding: 10, background: 'var(--bg-input)', borderRadius: 6 }}>
                    {issuedKey}
                  </code>
                </section>
              )}

              <section className="panel panel-pad">
                <h2 className="panel-title" style={{ marginBottom: 10 }}>Register New Attendance Connector</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, maxWidth: 660 }}>
                  <input
                    id="conn-name-input"
                    className="input"
                    placeholder="Connector name (e.g. Gate-2 Windows Service)"
                    value={connName}
                    onChange={(e) => setConnName(e.target.value)}
                  />
                  <input
                    id="conn-source-input"
                    className="input mono"
                    placeholder="Source slug (e.g. hikvision-gate2)"
                    value={connSource}
                    onChange={(e) => setConnSource(e.target.value)}
                  />
                  <button
                    id="create-conn-btn"
                    className="btn btn-primary"
                    onClick={async () => {
                      try {
                        const res = await apiFetch('/v1/admin/connectors', {
                          method: 'POST',
                          token,
                          body: { name: connName, sourceSystem: connSource },
                        });
                        setIssuedKey(res.apiKey);
                        setConnName('');
                        setConnSource('');
                        await refreshAll(token);
                        notify('ok', 'Created connector and generated API key');
                      } catch (err: any) {
                        notify('err', err.message);
                      }
                    }}
                  >
                    Create Connector Key
                  </button>
                </div>
              </section>

              <section className="panel">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Source System</th>
                      <th>Key Prefix</th>
                      <th>Last Heartbeat</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {connectors.map((c) => (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 600 }}>{c.name}</td>
                        <td><code>{c.source_system}</code></td>
                        <td><code>sfc_{c.key_prefix}_…</code></td>
                        <td style={{ fontSize: 12.5 }}>
                          {c.revoked_at ? (
                            <span className="pill pill-danger">Revoked</span>
                          ) : c.last_seen_at ? (
                            `${fmtTime(c.last_seen_at)} (${c.last_seen_version ?? 'events'})`
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>Never seen</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'inline-flex', gap: 6 }}>
                            <button
                              className="btn btn-sm"
                              onClick={async () => {
                                try {
                                  const res = await apiFetch(`/v1/admin/connectors/${c.id}/rotate`, { method: 'POST', token });
                                  setIssuedKey(res.apiKey);
                                  await refreshAll(token);
                                  notify('ok', 'Rotated connector API key');
                                } catch (err: any) {
                                  notify('err', err.message);
                                }
                              }}
                            >
                              Rotate Key
                            </button>
                            {!c.revoked_at && (
                              <button
                                className="btn btn-sm btn-danger"
                                onClick={async () => {
                                  try {
                                    await apiFetch(`/v1/admin/connectors/${c.id}/revoke`, { method: 'POST', token });
                                    await refreshAll(token);
                                    notify('ok', 'Revoked connector');
                                  } catch (err: any) {
                                    notify('err', err.message);
                                  }
                                }}
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          )}

          {/* TAB 7: AUDIT & NOTIFICATIONS */}
          {tab === 'audit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="page-header">
                <div>
                  <h1 className="page-title">Operational Alerts & Audit Log</h1>
                  <p className="page-desc">
                    Tamper-evident record of every policy change, employee approval, device enrollment, manual HR punch, and emergency override.
                  </p>
                </div>
                <button
                  className="btn btn-sm"
                  onClick={async () => {
                    await apiFetch('/v1/admin/notifications/read-all', { method: 'POST', token });
                    await refreshAll(token);
                  }}
                >
                  Mark All Alerts Read
                </button>
              </div>

              <section className="panel">
                <div className="panel-header">
                  <h2 className="panel-title">Recent Operational Alerts</h2>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Severity</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notifications.length === 0 ? (
                      <tr>
                        <td colSpan={3} style={{ color: 'var(--text-muted)' }}>No alerts recorded yet.</td>
                      </tr>
                    ) : (
                      notifications.slice(0, 10).map((n) => (
                        <tr key={n.id}>
                          <td className="mono" style={{ fontSize: 12 }}>{fmtTime(n.created_at)}</td>
                          <td>
                            <span className={`pill ${n.severity === 'critical' ? 'pill-danger' : n.severity === 'warning' ? 'pill-warn' : 'pill-neutral'}`}>
                              {n.severity}
                            </span>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{n.title}</div>
                            {n.body && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{n.body}</div>}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <h2 className="panel-title">Append-Only Audit Trail</h2>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((a) => (
                      <tr key={a.id}>
                        <td className="mono" style={{ fontSize: 12 }}>{fmtTime(a.created_at)}</td>
                        <td>
                          <span className="pill pill-neutral">{a.actor_type}</span>{' '}
                          <span style={{ fontSize: 12.5 }}>{a.actor_name ?? ''}</span>
                        </td>
                        <td><code>{a.action}</code></td>
                        <td className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)', maxWidth: 420, wordBreak: 'break-word' }}>
                          {JSON.stringify(a.details)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          )}
        </main>

        {/* RIGHT PANEL: INTERACTIVE PILOT SIMULATOR */}
        {simOpen && (
          <aside className="sim-panel" aria-label="Interactive Pilot Simulator">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 650, fontSize: 14.5 }}>Interactive Pilot Lab</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Attendance terminal + Android handset
                </div>
              </div>
              <button
                id="sim-guided-btn"
                className="btn btn-sm btn-primary"
                disabled={Boolean(runningScenario)}
                onClick={runGuidedDemo}
              >
                {runningScenario ? 'Running…' : '▶ Auto-Demo'}
              </button>
            </div>

            {runningScenario && (
              <div className="pill pill-focus" style={{ padding: '6px 10px', justifyContent: 'center' }}>
                <span className="pill-dot" /> {runningScenario}
              </div>
            )}

            {/* 1. Factory Attendance Terminal */}
            <div className="sim-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                  1. Gate Attendance Terminal
                </span>
                <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>TERM-GATE-1</code>
              </div>

              <select
                id="sim-worker-select"
                className="select"
                value={simExtId}
                onChange={(e) => setSimExtId(e.target.value)}
              >
                {employees
                  .filter((e) => e.status === 'approved' && e.external_employee_id)
                  .map((e) => (
                    <option key={e.id} value={e.external_employee_id}>
                      {e.full_name} (ID #{e.external_employee_id} · {e.shift_state})
                    </option>
                  ))}
              </select>

              <div className="terminal-pad">
                <button id="sim-punch-clock-in" className="btn btn-primary" onClick={() => sendSimPunch('clock_in')}>
                  ▶ Clock In
                </button>
                <button id="sim-punch-break-start" className="btn" onClick={() => sendSimPunch('break_start')}>
                  ☕ Break Start
                </button>
                <button id="sim-punch-break-end" className="btn" onClick={() => sendSimPunch('break_end')}>
                  ↩ Break End
                </button>
                <button id="sim-punch-clock-out" className="btn btn-danger" onClick={() => sendSimPunch('clock_out')}>
                  ■ Clock Out
                </button>
              </div>
            </div>

            {/* 2. Enrolled Android Handset */}
            <div className="android-handset">
              <div className="android-statusbar">
                <span>Android Enterprise · {selectedSimEmp?.full_name ?? 'Worker'}</span>
                <span className="mono">4G · 94%</span>
              </div>

              {!phoneStatus ? (
                <div style={{ textAlign: 'center', padding: '22px 10px' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Handset Not Connected in Lab</div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: 12.5, marginTop: 0, marginBottom: 14 }}>
                    Enroll and connect {selectedSimEmp?.full_name ?? 'this worker'}&apos;s simulated Android handset to test live EMM app blocking and emergency override.
                  </p>
                  <button
                    id="sim-connect-phone-btn"
                    className="btn btn-primary"
                    onClick={() => selectedSimEmp && connectSimPhone(selectedSimEmp)}
                  >
                    Enroll & Connect Handset
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="android-emm-banner">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                        ShiftFocus EMM Policy
                      </span>
                      <span className={`pill ${phoneStatus.appliedMode === 'focus' ? 'pill-focus' : 'pill-ok'}`}>
                        <span className="pill-dot" />
                        {phoneStatus.appliedMode === 'focus' ? 'FOCUS SHIELD ON' : 'UNRESTRICTED'}
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, marginTop: 6, fontSize: 13.5 }}>{phoneStatus.reasonLabel}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                      Shift state: <code>{phoneStatus.shiftState}</code> · EMM sync: {phoneStatus.syncPending ? 'updating…' : 'verified'}
                    </div>
                  </div>

                  {/* Interactive App Launcher Grid */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
                      Tap an App on the Worker&apos;s Phone
                    </div>
                    <div className="app-launcher-grid">
                      {(phoneStatus.alwaysAllowedApps as AppRef[]).map((app) => (
                        <button
                          key={app.packageName}
                          className="app-tile allowed"
                          onClick={() =>
                            setPhoneAppNotice({
                              blocked: false,
                              app: app.label,
                              detail: `${app.label} is on the always-allowed essential list and opens normally during shifts.`,
                            })
                          }
                        >
                          <span className="app-icon-circle">{initials(app.label)}</span>
                          <span className="app-tile-name">{app.label}</span>
                        </button>
                      ))}

                      {(phoneStatus.restrictedApps as AppRef[]).map((app) => {
                        const isBlocked = phoneStatus.appliedMode === 'focus';
                        return (
                          <button
                            key={app.packageName}
                            className={`app-tile ${isBlocked ? 'blocked' : ''}`}
                            onClick={() =>
                              setPhoneAppNotice({
                                blocked: isBlocked,
                                app: app.label,
                                detail: isBlocked
                                  ? `${app.label} is paused by your workplace Focus Policy while on shift. Phone, SMS, and WhatsApp remain available.`
                                  : `${app.label} opens normally because your phone is currently unrestricted (${phoneStatus.reasonLabel}).`,
                              })
                            }
                          >
                            <span className="app-icon-circle">{isBlocked ? '⊘' : initials(app.label)}</span>
                            <span className="app-tile-name">{app.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* App tap feedback box */}
                  {phoneAppNotice && (
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: phoneAppNotice.blocked ? 'var(--status-danger-soft)' : 'var(--status-ok-soft)',
                        fontSize: 12,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>
                        {phoneAppNotice.blocked ? `⊘ ${phoneAppNotice.app} Blocked by ShiftFocus` : `✓ ${phoneAppNotice.app} Opened`}
                      </div>
                      <div style={{ marginTop: 2, opacity: 0.9 }}>{phoneAppNotice.detail}</div>
                    </div>
                  )}

                  {/* Emergency Override Bar */}
                  <div style={{ borderTop: '1px solid var(--border-hairline)', paddingTop: 10 }}>
                    {phoneStatus.override ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontSize: 12, color: 'var(--status-warn)', fontWeight: 600 }}>
                          ⚡ Emergency Override Active — all apps unlocked
                        </div>
                        <button id="sim-end-override-btn" className="btn btn-sm" onClick={endPhoneOverride}>
                          Resume Shift Focus Policy
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
                          <select
                            id="sim-override-reason-select"
                            className="select"
                            style={{ fontSize: 12, padding: '5px 8px' }}
                            value={overrideReason}
                            onChange={(e) => setOverrideReason(e.target.value as any)}
                          >
                            <option value="family">Family emergency</option>
                            <option value="medical">Medical need</option>
                            <option value="safety">Workplace safety</option>
                            <option value="work_related">Work exception</option>
                            <option value="other">Other</option>
                          </select>
                          <button id="sim-trigger-override-btn" className="btn btn-sm btn-warn" onClick={triggerPhoneOverride}>
                            ⚡ Emergency Override
                          </button>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          Immediate access — never waits for administrator approval.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 3. Worker Self-Registration */}
            <div className="sim-section">
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
                3. Worker Onboarding Request
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  id="sim-reg-name-input"
                  className="input"
                  placeholder="Worker full name"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 6 }}>
                  <input
                    id="sim-reg-phone-input"
                    className="input mono"
                    placeholder="+919800000109"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                  />
                  <input
                    id="sim-reg-extid-input"
                    className="input mono"
                    placeholder="Att. ID (opt)"
                    value={regExtId}
                    onChange={(e) => setRegExtId(e.target.value)}
                  />
                </div>
                <button
                  id="sim-reg-submit-btn"
                  className="btn btn-sm"
                  onClick={async () => {
                    try {
                      await apiFetch('/v1/public/register', {
                        method: 'POST',
                        body: {
                          joinCode: me?.join_code ?? 'DEMO-PLANT',
                          fullName: regName,
                          phone: regPhone,
                          externalEmployeeId: regExtId || undefined,
                        },
                      });
                      setRegName('');
                      setRegPhone('');
                      setRegExtId('');
                      await refreshAll(token);
                      notify('ok', 'Worker join request submitted — approve in Workers & Devices');
                    } catch (err: any) {
                      notify('err', err.message);
                    }
                  }}
                >
                  Submit Worker Request
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
