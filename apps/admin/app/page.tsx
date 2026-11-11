'use client';

import React, { useCallback, useEffect, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

type Tab = 'overview' | 'employees' | 'policy' | 'events' | 'overrides' | 'connectors' | 'audit';

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
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' · ' + d.toLocaleDateString();
};

export default function ShiftFocusConsole() {
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('overview');
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
  const [overrideReason, setOverrideReason] = useState<'family' | 'medical' | 'safety' | 'work_related' | 'other'>('family');
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regExtId, setRegExtId] = useState('');

  const notify = (kind: 'ok' | 'err', text: string) => {
    setFlash({ kind, text });
    setTimeout(() => setFlash((prev) => (prev?.text === text ? null : prev)), 5000);
  };

  const refreshAll = useCallback(async (authToken: string) => {
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
  }, []);

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

  // Auto-login to demo owner on mount for smooth pilot inspection
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
    const activeDevToken = deviceTokens[simExtId];
    void refreshPhone(activeDevToken);
  }, [simExtId, deviceTokens, refreshPhone]);

  const selectedSimEmp = employees.find((e) => e.external_employee_id === simExtId) ?? employees.find((e) => e.status === 'approved');

  // Simulator: 1-click enroll/connect employee phone so the simulated Android screen can poll `/v1/device/status`
  const connectSimPhone = async (emp: any) => {
    if (!token || !emp) return;
    try {
      const iss = await apiFetch(`/v1/admin/employees/${emp.id}/device/enrollment`, { method: 'POST', token });
      const enr = await apiFetch('/v1/device/enroll', {
        method: 'POST',
        body: { enrollmentToken: iss.enrollmentToken, model: 'Samsung Galaxy A15 (Pilot Sim)' },
      });
      const extKey = emp.external_employee_id ?? emp.id;
      setDeviceTokens((prev) => ({ ...prev, [extKey]: enr.deviceToken }));
      setTimeout(async () => {
        await refreshAll(token);
        await refreshPhone(enr.deviceToken);
      }, 450);
      notify('ok', `Enrolled & connected ${emp.full_name}'s simulated Android handset`);
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  const sendSimPunch = async (eventType: 'clock_in' | 'break_start' | 'break_end' | 'clock_out') => {
    if (!token || !selectedSimEmp?.external_employee_id) return;
    try {
      await apiFetch('/v1/admin/simulator/punch', {
        method: 'POST',
        token,
        body: { externalEmployeeId: selectedSimEmp.external_employee_id, eventType },
      });
      notify('ok', `Terminal punch: ${selectedSimEmp.full_name} → ${eventType}`);
      setTimeout(async () => {
        await refreshAll(token);
        const dt = deviceTokens[selectedSimEmp.external_employee_id];
        if (dt) await refreshPhone(dt);
      }, 600);
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
      if (token) setTimeout(() => void refreshAll(token), 500);
      notify('ok', 'Emergency override activated immediately (admin notified)');
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
      if (token) setTimeout(() => void refreshAll(token), 500);
      notify('ok', 'Emergency override ended by worker');
    } catch (err: any) {
      notify('err', err.message);
    }
  };

  if (!token) {
    return (
      <div style={{ maxWidth: 440, margin: '80px auto', padding: 24 }} className="card">
        <div className="brand" style={{ marginBottom: 8 }}>
          <span className="brand-dot" />
          <span>ShiftFocus Pilot Console</span>
        </div>
        <p style={{ color: 'var(--muted)', marginTop: 0 }}>
          Attendance-linked focus controls for industrial workplaces. Sign in with a demo account:
        </p>
        {flash && (
          <div style={{ padding: 10, borderRadius: 8, marginBottom: 12, background: 'rgba(239,68,68,0.18)', color: '#fecaca' }}>
            {flash.text}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
          <button className="btn btn-primary" disabled={loggingIn} onClick={() => handleLogin()}>
            {loggingIn ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => handleLogin('owner@demo.local', 'ShiftFocus#2026')}>Demo Owner</button>
          <button className="btn" onClick={() => handleLogin('hr@demo.local', 'ShiftFocus#2026')}>Demo HR</button>
          <button className="btn" onClick={() => handleLogin('viewer@demo.local', 'ShiftFocus#2026')}>Demo Supervisor (Viewer)</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {/* LEFT SIDEBAR */}
      <aside className="sidebar">
        <div>
          <div className="brand">
            <span className="brand-dot" />
            <span>ShiftFocus</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
            {me?.company_name ?? 'Demo Plant'} · Code <code>{me?.join_code ?? 'DEMO-PLANT'}</code>
          </div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {([
            ['overview', 'Overview & Metrics', null],
            ['employees', 'Employees & Devices', dashboard?.employees?.pending ? `${dashboard.employees.pending} pending` : null],
            ['policy', 'Focus Policy', `v${policy?.version ?? 1}`],
            ['events', 'Attendance & HR Fixes', null],
            ['overrides', 'Emergency Overrides', dashboard?.overrides?.unacknowledged ? `${dashboard.overrides.unacknowledged} new` : null],
            ['connectors', 'Attendance Connectors', null],
            ['audit', 'Audit & Notices', dashboard?.unreadNotifications ? `${dashboard.unreadNotifications}` : null],
          ] as const).map(([key, label, pill]) => (
            <button
              key={key}
              className={`nav-btn ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
            >
              <span>{label}</span>
              {pill && <span className="badge badge-amber">{pill}</span>}
            </button>
          ))}
        </nav>

        <div className="card" style={{ marginTop: 'auto', padding: 12, fontSize: 12.5 }}>
          <div style={{ fontWeight: 600 }}>{me?.full_name}</div>
          <div style={{ color: 'var(--muted)', marginBottom: 8 }}>
            Role: <span className="badge badge-gray">{me?.role}</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={() => handleLogin('owner@demo.local', 'ShiftFocus#2026')}>
              Owner
            </button>
            <button className="btn" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={() => handleLogin('hr@demo.local', 'ShiftFocus#2026')}>
              HR
            </button>
            <button className="btn" style={{ fontSize: 11.5, padding: '4px 8px' }} onClick={() => handleLogin('viewer@demo.local', 'ShiftFocus#2026')}>
              Viewer
            </button>
          </div>
        </div>
      </aside>

      {/* CENTER MAIN AREA */}
      <main className="main-area">
        {flash && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              marginBottom: 16,
              background: flash.kind === 'ok' ? 'rgba(16,185,129,0.16)' : 'rgba(239,68,68,0.18)',
              border: `1px solid ${flash.kind === 'ok' ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.45)'}`,
              color: flash.kind === 'ok' ? '#a7f3d0' : '#fecaca',
            }}
          >
            {flash.text}
          </div>
        )}

        {/* TAB 1: OVERVIEW */}
        {tab === 'overview' && dashboard && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22 }}>Pilot Operational Overview</h1>
              <p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>
                Real-time attendance state, EMM policy synchronization latency, and safety guardrails.
              </p>
            </div>

            <div className="grid-4">
              <div className="card">
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>ACTIVE SHIFT WORKERS</div>
                <div className="stat-value">
                  {dashboard.employees.on_shift} <span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 400 }}>on shift</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
                  {dashboard.employees.on_break} on break · {dashboard.employees.approved} approved ({dashboard.employees.pending} pending)
                </div>
              </div>

              <div className="card">
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>ENROLLED ANDROID DEVICES</div>
                <div className="stat-value">
                  {dashboard.devices.in_sync}/{dashboard.devices.enrolled}{' '}
                  <span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 400 }}>in sync</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
                  {dashboard.devices.focus} in Focus Mode · {dashboard.devices.stale} stale check-in
                </div>
              </div>

              <div className="card">
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>EVENT-TO-POLICY LATENCY (24H)</div>
                <div className="stat-value">
                  {dashboard.policySync24h.p50_s != null ? `${Number(dashboard.policySync24h.p50_s).toFixed(2)}s` : '—'}{' '}
                  <span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 400 }}>p50</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
                  p95: {dashboard.policySync24h.p95_s != null ? `${Number(dashboard.policySync24h.p95_s).toFixed(2)}s` : '—'} · {dashboard.policySync24h.applied} syncs applied
                </div>
              </div>

              <div className="card">
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>EMERGENCY OVERRIDES</div>
                <div className="stat-value">
                  {dashboard.overrides.active}{' '}
                  <span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 400 }}>active now</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
                  {dashboard.overrides.last_7d} in 7d · {dashboard.overrides.unacknowledged} awaiting follow-up
                </div>
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Live Shift & Device Matrix</h3>
              <table>
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Attendance ID</th>
                    <th>Shift State</th>
                    <th>Desired Policy</th>
                    <th>EMM Applied</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{e.full_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{e.phone}</div>
                      </td>
                      <td>
                        <code>{e.external_employee_id ?? 'unmapped'}</code>
                      </td>
                      <td>
                        {e.status !== 'approved' ? (
                          <span className="badge badge-amber">{e.status}</span>
                        ) : e.shift_state === 'on_shift' ? (
                          <span className="badge badge-focus">on_shift</span>
                        ) : e.shift_state === 'on_break' ? (
                          <span className="badge badge-green">on_break</span>
                        ) : (
                          <span className="badge badge-gray">off_shift</span>
                        )}
                      </td>
                      <td>
                        {e.desired_state === 'focus' ? (
                          <span className="badge badge-focus">focus v{e.desired_version}</span>
                        ) : (
                          <span className="badge badge-green">unrestricted v{e.desired_version ?? 0}</span>
                        )}
                      </td>
                      <td>
                        {e.enrollment_status !== 'enrolled' ? (
                          <span className="badge badge-gray">{e.enrollment_status ?? 'not enrolled'}</span>
                        ) : e.in_sync ? (
                          <span className="badge badge-green">{e.applied_state} v{e.applied_version} ✓</span>
                        ) : (
                          <span className="badge badge-amber">syncing…</span>
                        )}
                      </td>
                      <td style={{ color: 'var(--muted)', fontSize: 13 }}>{e.desired_reason_label ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card" style={{ borderColor: 'rgba(59,130,246,0.35)' }}>
              <h3 style={{ marginTop: 0 }}>Privacy & Pilot Guardrails (Enforced by Architecture)</h3>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)' }}>
                <li>No biometric templates, face images, fingerprints, message contents, or browsing history are stored.</li>
                <li>Network connectivity is never used to infer app use or misconduct.</li>
                <li>Phone calls, SMS, and WhatsApp remain available at all times; Emergency Override takes effect immediately without waiting for admin approval.</li>
                <li>Bounded fail-safe releases focus mode automatically if a shift exceeds {policy?.max_shift_hours ?? 12} hours without a clock-out punch.</li>
              </ul>
            </div>
          </div>
        )}

        {/* TAB 2: EMPLOYEES & DEVICES */}
        {tab === 'employees' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22 }}>Employees & Enrolled Devices</h1>
              <p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>
                Account verification and Android Enterprise / EMM device enrollment are separate steps.
              </p>
            </div>

            <div className="card">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Status</th>
                    <th>Attendance ID</th>
                    <th>Device Enrollment</th>
                    <th>Policy State</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{e.full_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{e.phone}</div>
                      </td>
                      <td>
                        <span className={`badge ${e.status === 'approved' ? 'badge-green' : e.status === 'pending' ? 'badge-amber' : 'badge-red'}`}>
                          {e.status}
                        </span>
                      </td>
                      <td>
                        {e.status === 'pending' ? (
                          <input
                            className="input"
                            style={{ width: 110 }}
                            placeholder="e.g. 105"
                            value={extIdDrafts[e.id] ?? ''}
                            onChange={(ev) => setExtIdDrafts({ ...extIdDrafts, [e.id]: ev.target.value })}
                          />
                        ) : (
                          <code>{e.external_employee_id ?? '—'}</code>
                        )}
                      </td>
                      <td>
                        <div>
                          <span className={`badge ${e.enrollment_status === 'enrolled' ? 'badge-green' : 'badge-gray'}`}>
                            {e.enrollment_status ?? 'none'}
                          </span>
                        </div>
                        {e.model && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>{e.model}</div>}
                      </td>
                      <td>
                        <div>{e.desired_state === 'focus' ? <span className="badge badge-focus">focus</span> : <span className="badge badge-green">unrestricted</span>}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>{e.desired_reason_label}</div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {e.status === 'pending' && (
                            <>
                              <button
                                className="btn btn-primary"
                                onClick={async () => {
                                  const ext = (extIdDrafts[e.id] || '').trim();
                                  if (!ext) return notify('err', 'Enter the attendance system ID before approving');
                                  try {
                                    await apiFetch(`/v1/admin/employees/${e.id}/approve`, {
                                      method: 'POST',
                                      token,
                                      body: { externalEmployeeId: ext },
                                    });
                                    await refreshAll(token);
                                    notify('ok', `Approved ${e.full_name} (Attendance ID ${ext})`);
                                  } catch (err: any) {
                                    notify('err', err.message);
                                  }
                                }}
                              >
                                Approve
                              </button>
                              <button
                                className="btn btn-danger"
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
                                className="btn"
                                onClick={() => {
                                  if (e.external_employee_id) setSimExtId(e.external_employee_id);
                                  void connectSimPhone(e);
                                }}
                              >
                                {e.enrollment_status === 'enrolled' ? 'Re-enroll in Simulator' : 'Enroll Phone in Simulator'}
                              </button>
                              {e.enrollment_status === 'enrolled' && (
                                <button
                                  className="btn btn-danger"
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
            </div>
          </div>
        )}

        {/* TAB 3: FOCUS POLICY */}
        {tab === 'policy' && policy && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22 }}>Workplace Focus Policy (v{policy.version})</h1>
              <p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>
                Explicitly disclosed list of restricted apps during shifts, break behavior, and bounded fail-safe window.
              </p>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Always-Available Essentials (Protected)</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(policy.always_allowed_apps as AppRef[]).map((a) => (
                  <span key={a.packageName} className="badge badge-green" style={{ padding: '5px 10px', fontSize: 12.5 }}>
                    ✓ {a.label} <code style={{ opacity: 0.75 }}>({a.packageName})</code>
                  </span>
                ))}
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Restricted During Active Shift</h3>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                {(policy.restricted_apps as AppRef[]).map((a) => (
                  <span key={a.packageName} className="badge badge-focus" style={{ padding: '5px 10px', fontSize: 12.5 }}>
                    ⊘ {a.label} <code style={{ opacity: 0.75 }}>({a.packageName})</code>
                    <button
                      style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', marginLeft: 4 }}
                      onClick={() =>
                        setPolicy({
                          ...policy,
                          restricted_apps: (policy.restricted_apps as AppRef[]).filter((x) => x.packageName !== a.packageName),
                        })
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, maxWidth: 640 }}>
                <input
                  className="input"
                  placeholder="App label (e.g. ShareChat)"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Android package (e.g. in.mohalla.sharechat)"
                  value={newPkg}
                  onChange={(e) => setNewPkg(e.target.value)}
                />
                <button
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
            </div>

            <div className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>Break Policy</label>
                <select
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
                  type="number"
                  className="input"
                  min={1}
                  max={24}
                  value={policy.max_shift_hours}
                  onChange={(e) => setPolicy({ ...policy, max_shift_hours: Number(e.target.value) })}
                />
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  Automatically lifts restrictions if a clock-out punch is missing after this duration.
                </div>
              </div>
            </div>

            <div>
              <button
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
                    notify('ok', `Saved Focus Policy v${updated.version} and queued sync for enrolled devices`);
                  } catch (err: any) {
                    notify('err', err.message);
                  }
                }}
              >
                Save & Push Policy (Owner only)
              </button>
            </div>
          </div>
        )}

        {/* TAB 4: ATTENDANCE EVENTS & MANUAL HR CORRECTIONS */}
        {tab === 'events' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22 }}>Attendance Events & HR Corrections</h1>
              <p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>
                Normalized punch stream with idempotency by vendor event ID and auditable manual HR corrections.
              </p>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Enter Manual HR Correction (e.g. Missed Clock-Out)</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 2fr auto', gap: 8 }}>
                <select className="select" value={manualEmpId} onChange={(e) => setManualEmpId(e.target.value)}>
                  <option value="">Select employee…</option>
                  {employees
                    .filter((e) => e.status === 'approved' && e.external_employee_id)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name} (#{e.external_employee_id})
                      </option>
                    ))}
                </select>
                <select className="select" value={manualType} onChange={(e) => setManualType(e.target.value as any)}>
                  <option value="clock_out">clock_out</option>
                  <option value="clock_in">clock_in</option>
                  <option value="break_start">break_start</option>
                  <option value="break_end">break_end</option>
                </select>
                <input
                  className="input"
                  placeholder="Mandatory audit reason"
                  value={manualReason}
                  onChange={(e) => setManualReason(e.target.value)}
                />
                <button
                  className="btn btn-primary"
                  onClick={async () => {
                    if (!manualEmpId) return notify('err', 'Choose an employee');
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
                      notify('ok', 'Manual HR event recorded and employee policy reconciled');
                    } catch (err: any) {
                      notify('err', err.message);
                    }
                  }}
                >
                  Record HR Correction
                </button>
              </div>
            </div>

            <div className="card">
              <table>
                <thead>
                  <tr>
                    <th>Occurred</th>
                    <th>Employee</th>
                    <th>Event Type</th>
                    <th>Source / Event ID</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id}>
                      <td style={{ fontSize: 12.5 }}>{fmtTime(ev.occurred_at)}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{ev.full_name ?? 'Unmapped worker'}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>ID #{ev.external_employee_id}</div>
                      </td>
                      <td>
                        <span className="badge badge-focus">{ev.event_type}</span>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        <div>{ev.source_system}</div>
                        <code style={{ color: 'var(--muted)' }}>{ev.vendor_event_id}</code>
                        {ev.reason && <div style={{ color: '#fcd34d' }}>Reason: {ev.reason}</div>}
                      </td>
                      <td>
                        <span className={`badge ${ev.correction_status === 'voided' ? 'badge-red' : 'badge-green'}`}>
                          {ev.correction_status}
                        </span>
                      </td>
                      <td>
                        {ev.correction_status !== 'voided' && (
                          <button
                            className="btn btn-danger"
                            style={{ padding: '4px 8px', fontSize: 12 }}
                            onClick={async () => {
                              try {
                                await apiFetch(`/v1/admin/events/${ev.id}/void`, {
                                  method: 'POST',
                                  token,
                                  body: { reason: 'Voided erroneous punch by admin' },
                                });
                                await refreshAll(token);
                                notify('ok', 'Event voided and shift state re-computed');
                              } catch (err: any) {
                                notify('err', err.message);
                              }
                            }}
                          >
                            Void
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: EMERGENCY OVERRIDES */}
        {tab === 'overrides' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22 }}>Emergency Overrides & Follow-Up</h1>
              <p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>
                Workers never wait for approval to use emergency override. Administrators review and acknowledge events afterwards.
              </p>
            </div>

            <div className="card">
              <table>
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Started</th>
                    <th>Ended</th>
                    <th>Reason</th>
                    <th>Admin Follow-up</th>
                  </tr>
                </thead>
                <tbody>
                  {overrides.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ color: 'var(--muted)' }}>
                        No emergency overrides triggered yet. Use the simulated Android handset on the right while a worker is on shift.
                      </td>
                    </tr>
                  )}
                  {overrides.map((ov) => (
                    <tr key={ov.id}>
                      <td style={{ fontWeight: 600 }}>{ov.full_name}</td>
                      <td style={{ fontSize: 12.5 }}>{fmtTime(ov.started_at)}</td>
                      <td style={{ fontSize: 12.5 }}>
                        {ov.ended_at ? `${fmtTime(ov.ended_at)} (${ov.end_reason})` : <span className="badge badge-amber">Active</span>}
                      </td>
                      <td>
                        <span className="badge badge-gray">{ov.reason_category ?? 'unspecified'}</span>
                        {ov.note && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{ov.note}</div>}
                      </td>
                      <td>
                        {ov.acknowledged_at ? (
                          <div style={{ fontSize: 12.5 }}>
                            <span className="badge badge-green">Acknowledged</span> by {ov.acknowledged_by_name}
                            {ov.follow_up_note && <div style={{ color: 'var(--muted)', marginTop: 3 }}>{ov.follow_up_note}</div>}
                          </div>
                        ) : (
                          <button
                            className="btn btn-primary"
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
            </div>
          </div>
        )}

        {/* TAB 6: CONNECTORS */}
        {tab === 'connectors' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22 }}>Local Attendance Connectors</h1>
              <p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>
                Per-client outbound TLS connector credentials with rotation and revocation.
              </p>
            </div>

            {issuedKey && (
              <div className="card" style={{ borderColor: 'var(--warning)' }}>
                <div style={{ fontWeight: 700, color: '#fcd34d' }}>New Connector API Key (shown once):</div>
                <code style={{ display: 'block', marginTop: 6, padding: 8, background: '#090d16', borderRadius: 6 }}>
                  {issuedKey}
                </code>
              </div>
            )}

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Register Attendance Connector</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, maxWidth: 640 }}>
                <input
                  className="input"
                  placeholder="Connector name (e.g. Gate-2 Windows Service)"
                  value={connName}
                  onChange={(e) => setConnName(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Source slug (e.g. hikvision-gate2)"
                  value={connSource}
                  onChange={(e) => setConnSource(e.target.value)}
                />
                <button
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
                  Create Key
                </button>
              </div>
            </div>

            <div className="card">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Source System</th>
                    <th>Key Prefix</th>
                    <th>Last Heartbeat</th>
                    <th>Actions</th>
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
                          <span className="badge badge-red">Revoked</span>
                        ) : c.last_seen_at ? (
                          `${fmtTime(c.last_seen_at)} (${c.last_seen_version ?? 'events'})`
                        ) : (
                          'Never seen'
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn"
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
                              className="btn btn-danger"
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
            </div>
          </div>
        )}

        {/* TAB 7: AUDIT & NOTIFICATIONS */}
        {tab === 'audit' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h1 style={{ margin: 0, fontSize: 22 }}>Notifications & Tamper-Evident Audit Log</h1>
                <p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>
                  Every policy edit, approval, manual punch, and override is recorded with actor and timestamp.
                </p>
              </div>
              <button
                className="btn"
                onClick={async () => {
                  await apiFetch('/v1/admin/notifications/read-all', { method: 'POST', token });
                  await refreshAll(token);
                }}
              >
                Mark Notifications Read
              </button>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Recent Alerts</h3>
              {notifications.length === 0 ? (
                <div style={{ color: 'var(--muted)' }}>No alerts yet.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Severity</th>
                      <th>Alert</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notifications.slice(0, 10).map((n) => (
                      <tr key={n.id}>
                        <td style={{ fontSize: 12.5 }}>{fmtTime(n.created_at)}</td>
                        <td>
                          <span className={`badge ${n.severity === 'critical' ? 'badge-red' : n.severity === 'warning' ? 'badge-amber' : 'badge-gray'}`}>
                            {n.severity}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{n.title}</div>
                          {n.body && <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{n.body}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>Audit Trail</h3>
              <table>
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
                      <td style={{ fontSize: 12.5 }}>{fmtTime(a.created_at)}</td>
                      <td>
                        <span className="badge badge-gray">{a.actor_type}</span>{' '}
                        <span style={{ fontSize: 12.5 }}>{a.actor_name ?? ''}</span>
                      </td>
                      <td><code>{a.action}</code></td>
                      <td style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 420, wordBreak: 'break-word' }}>
                        <code>{JSON.stringify(a.details)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* RIGHT SIDEBAR: LIVE PILOT SIMULATOR (ATTENDANCE TERMINAL + WORKER ANDROID HANDSET) */}
      <aside className="sim-sidebar">
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Interactive Pilot Simulator</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Test end-to-end attendance punches, EMM policy sync, and immediate worker emergency override.
          </div>
        </div>

        {/* 1. Attendance Terminal Simulator */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>1. Factory Attendance Terminal</div>
          <select
            className="select"
            value={simExtId}
            onChange={(e) => setSimExtId(e.target.value)}
            style={{ marginBottom: 10 }}
          >
            {employees
              .filter((e) => e.status === 'approved' && e.external_employee_id)
              .map((e) => (
                <option key={e.id} value={e.external_employee_id}>
                  {e.full_name} (ID #{e.external_employee_id} · {e.shift_state})
                </option>
              ))}
          </select>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <button className="btn btn-primary" onClick={() => sendSimPunch('clock_in')}>
              ▶ Clock In
            </button>
            <button className="btn" onClick={() => sendSimPunch('break_start')}>
              ☕ Break Start
            </button>
            <button className="btn" onClick={() => sendSimPunch('break_end')}>
              ↩ Break End
            </button>
            <button className="btn btn-danger" onClick={() => sendSimPunch('clock_out')}>
              ■ Clock Out
            </button>
          </div>
        </div>

        {/* 2. Enrolled Android Handset Simulator */}
        <div className="phone-frame">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Android Client · {selectedSimEmp?.full_name ?? 'Worker'}</span>
            <span className={`badge ${phoneStatus?.appliedMode === 'focus' ? 'badge-focus' : 'badge-green'}`}>
              {phoneStatus ? (phoneStatus.appliedMode === 'focus' ? 'FOCUS ACTIVE' : 'UNRESTRICTED') : 'NOT CONNECTED'}
            </span>
          </div>

          {!phoneStatus ? (
            <div style={{ textAlign: 'center', padding: '18px 8px' }}>
              <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 0 }}>
                Connect {selectedSimEmp?.full_name ?? 'this worker'}&apos;s simulated handset to inspect live EMM policy state and test emergency override.
              </p>
              <button className="btn btn-primary" onClick={() => selectedSimEmp && connectSimPhone(selectedSimEmp)}>
                Connect Simulated Handset
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ padding: 10, borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>SHIFT & POLICY STATUS</div>
                <div style={{ fontWeight: 600, marginTop: 2 }}>{phoneStatus.reasonLabel}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                  Shift: <code>{phoneStatus.shiftState}</code> · Sync: {phoneStatus.syncPending ? 'pending…' : 'up to date'}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>ALWAYS AVAILABLE</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(phoneStatus.alwaysAllowedApps as AppRef[]).map((a) => (
                    <span key={a.packageName} className="badge badge-green">✓ {a.label}</span>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 4 }}>
                  {phoneStatus.appliedMode === 'focus' ? 'BLOCKED DURING SHIFT' : 'WORKPLACE FOCUS LIST (CURRENTLY UNBLOCKED)'}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(phoneStatus.restrictedApps as AppRef[]).map((a) => (
                    <span
                      key={a.packageName}
                      className={`badge ${phoneStatus.appliedMode === 'focus' ? 'badge-red' : 'badge-gray'}`}
                    >
                      {phoneStatus.appliedMode === 'focus' ? '🔒' : '○'} {a.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Emergency Override Control */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 2 }}>
                {phoneStatus.override ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 12, color: '#fcd34d', fontWeight: 600 }}>
                      ⚡ Emergency Override Active — all apps unlocked
                    </div>
                    <button className="btn" onClick={endPhoneOverride}>
                      Resume Shift Focus Policy
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select
                        className="select"
                        style={{ fontSize: 12 }}
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value as any)}
                      >
                        <option value="family">Family emergency</option>
                        <option value="medical">Medical need</option>
                        <option value="safety">Workplace safety</option>
                        <option value="work_related">Work exception</option>
                        <option value="other">Other</option>
                      </select>
                      <button className="btn btn-warning" style={{ whiteSpace: 'nowrap' }} onClick={triggerPhoneOverride}>
                        ⚡ Emergency Override
                      </button>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      Restores full access immediately without waiting for admin approval.
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 3. Employee Self-Registration Simulator */}
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>3. Simulate Worker Join Request</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              className="input"
              placeholder="Worker full name"
              value={regName}
              onChange={(e) => setRegName(e.target.value)}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 6 }}>
              <input
                className="input"
                placeholder="+919800000109"
                value={regPhone}
                onChange={(e) => setRegPhone(e.target.value)}
              />
              <input
                className="input"
                placeholder="Att. ID (opt)"
                value={regExtId}
                onChange={(e) => setRegExtId(e.target.value)}
              />
            </div>
            <button
              className="btn"
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
                  notify('ok', 'Worker access request submitted (approve in Employees tab)');
                } catch (err: any) {
                  notify('err', err.message);
                }
              }}
            >
              Submit Join Request
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
