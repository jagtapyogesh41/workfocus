'use client';

import React, { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'shiftfocus_worker_device_token';

interface AppRef {
  packageName: string;
  label: string;
}

async function apiFetch(path: string, opts: { method?: string; token?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, {
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

const initials = (label: string) =>
  label
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

export default function WorkerMobileApp() {
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [demoWorkers, setDemoWorkers] = useState<any[]>([]);
  const [pairMode, setPairMode] = useState<'quick' | 'token' | 'register'>('quick');
  const [enrollmentToken, setEnrollmentToken] = useState('');
  const [regJoinCode, setRegJoinCode] = useState('DEMO-PLANT');
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regExtId, setRegExtId] = useState('');
  const [overrideReason, setOverrideReason] = useState<'family' | 'medical' | 'safety' | 'work_related' | 'other'>('family');
  const [appTapNotice, setAppTapNotice] = useState<{ blocked: boolean; app: string; detail: string } | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [busy, setBusy] = useState(false);

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setFlash({ kind, text });
    setTimeout(() => setFlash((prev) => (prev?.text === text ? null : prev)), 5000);
  }, []);

  // Register Service Worker + capture PWA install prompt
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Load saved device token or URL ?token=sfe_... on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (urlToken && urlToken.startsWith('sfe_')) {
      setPairMode('token');
      setEnrollmentToken(urlToken);
      void enrollWithToken(urlToken);
    } else if (saved) {
      setDeviceToken(saved);
    }
    void apiFetch('/v1/device/demo-workers')
      .then((res) => setDemoWorkers(res.workers ?? []))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshStatus = useCallback(async (tok: string) => {
    try {
      const st = await apiFetch('/v1/device/status', { token: tok });
      setStatus(st);
    } catch {
      // Token revoked or invalid
      window.localStorage.removeItem(STORAGE_KEY);
      setDeviceToken(null);
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!deviceToken) return;
    void refreshStatus(deviceToken);
    const id = setInterval(() => void refreshStatus(deviceToken), 2000);
    return () => clearInterval(id);
  }, [deviceToken, refreshStatus]);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => undefined);
      setDeferredPrompt(null);
    } else {
      setShowInstallHelp((v) => !v);
    }
  };

  const handleUpdateApp = async () => {
    setBusy(true);
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          regs.map(async (r) => {
            await r.update().catch(() => undefined);
            r.waiting?.postMessage({ type: 'SKIP_WAITING' });
          }),
        );
      }
      if ('caches' in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map((k) => window.caches.delete(k)));
      }
      if (deviceToken) {
        await refreshStatus(deviceToken);
      }
      notify('ok', 'App updated to latest version! Reloading…');
      setTimeout(() => window.location.reload(), 600);
    } finally {
      setBusy(false);
    }
  };

  const quickPairWorker = async (extId: string) => {
    setBusy(true);
    try {
      const res = await apiFetch('/v1/device/demo-pair', {
        method: 'POST',
        body: { externalEmployeeId: extId, model: 'Employee Mobile PWA' },
      });
      window.localStorage.setItem(STORAGE_KEY, res.deviceToken);
      setDeviceToken(res.deviceToken);
      await refreshStatus(res.deviceToken);
      notify('ok', `Paired phone as ${res.employee.fullName} (#${res.employee.externalEmployeeId})`);
    } catch (err: any) {
      notify('err', err.message);
    } finally {
      setBusy(false);
    }
  };

  const enrollWithToken = async (tok = enrollmentToken) => {
    setBusy(true);
    try {
      const res = await apiFetch('/v1/device/enroll', {
        method: 'POST',
        body: { enrollmentToken: tok.trim(), model: 'Employee Mobile Handset' },
      });
      window.localStorage.setItem(STORAGE_KEY, res.deviceToken);
      setDeviceToken(res.deviceToken);
      await refreshStatus(res.deviceToken);
      notify('ok', 'Device enrolled and paired with ShiftFocus');
    } catch (err: any) {
      notify('err', err.message);
    } finally {
      setBusy(false);
    }
  };

  const sendMobilePunch = async (eventType: 'clock_in' | 'break_start' | 'break_end' | 'clock_out') => {
    if (!deviceToken) return;
    setBusy(true);
    try {
      const st = await apiFetch('/v1/device/demo-punch', {
        method: 'POST',
        token: deviceToken,
        body: { eventType },
      });
      setStatus(st);
      setAppTapNotice(null);
      notify('ok', `Attendance event sent: ${eventType}`);
    } catch (err: any) {
      notify('err', err.message);
    } finally {
      setBusy(false);
    }
  };

  const triggerOverride = async () => {
    if (!deviceToken) return;
    setBusy(true);
    try {
      const res = await apiFetch('/v1/device/override', {
        method: 'POST',
        token: deviceToken,
        body: { reasonCategory: overrideReason, note: 'Activated from employee mobile app' },
      });
      setStatus(res.status);
      setAppTapNotice(null);
      notify('ok', 'Emergency override activated immediately — all restrictions lifted');
    } catch (err: any) {
      notify('err', err.message);
    } finally {
      setBusy(false);
    }
  };

  const endOverride = async () => {
    if (!deviceToken) return;
    setBusy(true);
    try {
      const st = await apiFetch('/v1/device/override/end', {
        method: 'POST',
        token: deviceToken,
      });
      setStatus(st);
      notify('ok', 'Resumed shift focus policy');
    } catch (err: any) {
      notify('err', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', minHeight: '100vh', padding: '14px 14px 36px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Mobile App Top Bar */}
      <header className="panel panel-pad" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div className="brand-cluster">
          <span className="brand-mark">SF</span>
          <div>
            <div style={{ fontWeight: 650, fontSize: 14.5 }}>ShiftFocus Worker App</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              {status ? `${status.employee?.fullName} · ${status.company?.name}` : 'Employee Mobile Client'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button id="pwa-update-btn" className="btn btn-sm" disabled={busy} onClick={handleUpdateApp} title="Check for app updates and refresh policy">
            🔄 Update App
          </button>
          <button id="pwa-install-btn" className="btn btn-sm btn-primary" onClick={handleInstallClick}>
            📲 Install
          </button>
          <a href="/" className="btn btn-sm" style={{ textDecoration: 'none' }}>
            Admin
          </a>
        </div>
      </header>

      {/* Upgrade Banner: Real Android App Blocker APK for Phones that only have Web PWA installed */}
      <section
        className="panel panel-pad"
        style={{
          border: '1px solid var(--status-focus)',
          background: 'var(--status-focus-soft)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>
            🛡️ Enable Real App Blocking on Android (v{status?.appRelease?.versionName ?? '1.1.0'})
          </div>
          <a
            href={status?.appRelease?.apkUrl ?? '/shiftfocus-worker.apk'}
            download="ShiftFocus-Worker.apk"
            className="btn btn-sm btn-primary"
            style={{ textDecoration: 'none' }}
          >
            ⬇️ Download / Update Android APK
          </a>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
          Web browsers cannot block other apps by themselves. Install or update the{' '}
          <strong>ShiftFocus Android Companion APK</strong> and turn on <strong>Usage Access</strong> +{' '}
          <strong>Display Over Other Apps</strong> so restricted apps (Instagram, YouTube, etc.) are actually blocked when you clock in.
        </div>
      </section>

      {/* Install instructions banner when tapped on browsers without automatic prompt */}
      {showInstallHelp && (
        <section className="panel panel-pad" style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
          <div style={{ fontWeight: 650, color: 'var(--text-primary)', marginBottom: 6 }}>
            How to Install ShiftFocus on Your Phone Home Screen:
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              <strong>Android (Chrome):</strong> Tap the browser menu <strong>⋮</strong> (top-right) and tap <strong>&ldquo;Install app&rdquo;</strong> or <strong>&ldquo;Add to Home screen&rdquo;</strong>.
            </li>
            <li style={{ marginTop: 4 }}>
              <strong>iPhone (Safari):</strong> Tap the <strong>Share</strong> button at the bottom and tap <strong>&ldquo;Add to Home Screen&rdquo;</strong>.
            </li>
          </ul>
        </section>
      )}

      {flash && (
        <div className={`toast-bar ${flash.kind}`} role="status" style={{ marginBottom: 0 }}>
          <span>{flash.text}</span>
        </div>
      )}

      {/* UNPAIRED STATE: 1-TAP WORKER LOGIN / TOKEN PAIRING / REGISTRATION */}
      {!deviceToken || !status ? (
        <main style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section className="panel panel-pad">
            <h1 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 650 }}>Connect Your Mobile Phone</h1>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)' }}>
              Select a pilot worker below for 1-tap pairing, or use an enrollment token from HR.
            </p>

            <div className="segmented" style={{ width: '100%', marginBottom: 14 }}>
              <button
                className={`seg-btn ${pairMode === 'quick' ? 'active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setPairMode('quick')}
              >
                1-Tap Pilot Worker
              </button>
              <button
                className={`seg-btn ${pairMode === 'token' ? 'active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setPairMode('token')}
              >
                Enrollment Code
              </button>
              <button
                className={`seg-btn ${pairMode === 'register' ? 'active' : ''}`}
                style={{ flex: 1 }}
                onClick={() => setPairMode('register')}
              >
                New Worker
              </button>
            </div>

            {pairMode === 'quick' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {demoWorkers.map((w) => (
                  <button
                    key={w.id}
                    className="btn"
                    disabled={busy}
                    style={{ justifyContent: 'space-between', padding: '11px 14px' }}
                    onClick={() => quickPairWorker(w.external_employee_id)}
                  >
                    <span style={{ textAlign: 'left' }}>
                      <strong style={{ display: 'block', fontSize: 14 }}>{w.full_name}</strong>
                      <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        Attendance ID #{w.external_employee_id} · {w.phone}
                      </span>
                    </span>
                    <span className={`pill ${w.shift_state === 'on_shift' ? 'pill-focus' : 'pill-ok'}`}>
                      {w.shift_state} →
                    </span>
                  </button>
                ))}
              </div>
            )}

            {pairMode === 'token' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  className="input mono"
                  placeholder="Paste sfe_... enrollment token"
                  value={enrollmentToken}
                  onChange={(e) => setEnrollmentToken(e.target.value)}
                />
                <button className="btn btn-primary" disabled={busy || !enrollmentToken.trim()} onClick={() => enrollWithToken()}>
                  Enroll & Pair Phone
                </button>
              </div>
            )}

            {pairMode === 'register' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  className="input mono"
                  placeholder="Company Join Code (DEMO-PLANT)"
                  value={regJoinCode}
                  onChange={(e) => setRegJoinCode(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Your full name"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                />
                <input
                  className="input mono"
                  placeholder="Phone (+919800000109)"
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                />
                <input
                  className="input mono"
                  placeholder="Attendance Badge ID (optional, e.g. 109)"
                  value={regExtId}
                  onChange={(e) => setRegExtId(e.target.value)}
                />
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await apiFetch('/v1/public/register', {
                        method: 'POST',
                        body: {
                          joinCode: regJoinCode,
                          fullName: regName,
                          phone: regPhone,
                          externalEmployeeId: regExtId || undefined,
                        },
                      });
                      setRegName('');
                      setRegPhone('');
                      setRegExtId('');
                      notify('ok', 'Request sent! Once HR approves your request in the Admin Console, you can pair your phone.');
                    } catch (err: any) {
                      notify('err', err.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Request Workplace Access
                </button>
              </div>
            )}
          </section>
        </main>
      ) : (
        /* PAIRED WORKER PHONE VIEW */
        <main style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Live Shift & Policy Banner */}
          <section className="panel panel-pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Current Device Mode
              </span>
              <span className={`pill ${status.appliedMode === 'focus' ? 'pill-focus' : 'pill-ok'}`}>
                <span className="pill-dot" />
                {status.appliedMode === 'focus' ? 'FOCUS SHIELD ACTIVE' : 'UNRESTRICTED'}
              </span>
            </div>

            <h1 style={{ margin: '8px 0 4px', fontSize: 19, fontWeight: 650 }}>{status.reasonLabel}</h1>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
              Shift status: <code>{status.shiftState}</code> · Fail-safe window: {status.policy?.maxShiftHours ?? 12}h max
            </div>

            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid var(--border-hairline)' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Signed in as <strong style={{ color: 'var(--text-primary)' }}>{status.employee?.fullName}</strong>
              </span>
              <button
                className="btn btn-sm"
                onClick={() => {
                  window.localStorage.removeItem(STORAGE_KEY);
                  setDeviceToken(null);
                  setStatus(null);
                }}
              >
                Switch Worker
              </button>
            </div>
          </section>

          {/* Interactive App Drawer on Phone */}
          <section className="panel panel-pad">
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
              Your Phone Apps (Tap to Test Access)
            </div>
            <div className="app-launcher-grid">
              {(status.alwaysAllowedApps as AppRef[]).map((app) => (
                <button
                  key={app.packageName}
                  className="app-tile allowed"
                  onClick={() =>
                    setAppTapNotice({
                      blocked: false,
                      app: app.label,
                      detail: `${app.label} is an essential communication app and is always available during shifts.`,
                    })
                  }
                >
                  <span className="app-icon-circle">{initials(app.label)}</span>
                  <span className="app-tile-name">{app.label}</span>
                </button>
              ))}

              {(status.restrictedApps as AppRef[]).map((app) => {
                const isBlocked = status.appliedMode === 'focus';
                return (
                  <button
                    key={app.packageName}
                    className={`app-tile ${isBlocked ? 'blocked' : ''}`}
                    onClick={() =>
                      setAppTapNotice({
                        blocked: isBlocked,
                        app: app.label,
                        detail: isBlocked
                          ? `${app.label} is paused while you are on shift. Phone, SMS, and WhatsApp remain available, or use Emergency Override below.`
                          : `${app.label} opens normally right now (${status.reasonLabel}).`,
                      })
                    }
                  >
                    <span className="app-icon-circle">{isBlocked ? '⊘' : initials(app.label)}</span>
                    <span className="app-tile-name">{app.label}</span>
                  </button>
                );
              })}
            </div>

            {appTapNotice && (
              <div
                style={{
                  marginTop: 10,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: appTapNotice.blocked ? 'var(--status-danger-soft)' : 'var(--status-ok-soft)',
                  fontSize: 12.5,
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  {appTapNotice.blocked ? `⊘ ${appTapNotice.app} Paused During Shift` : `✓ ${appTapNotice.app} Opened`}
                </div>
                <div style={{ marginTop: 2 }}>{appTapNotice.detail}</div>
              </div>
            )}
          </section>

          {/* Emergency Override Card */}
          <section className="panel panel-pad">
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
              Worker Safety & Emergency Override
            </div>
            {status.override ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 13, color: 'var(--status-warn)', fontWeight: 600 }}>
                  ⚡ Emergency Override is Active — all apps are unlocked.
                </div>
                <button className="btn btn-primary" disabled={busy} onClick={endOverride}>
                  Resume Shift Focus Policy
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  Need immediate access to all apps? Emergency Override unlocks your phone immediately without waiting for admin approval.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                  <select
                    className="select"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value as any)}
                  >
                    <option value="family">Family emergency</option>
                    <option value="medical">Medical need</option>
                    <option value="safety">Workplace safety</option>
                    <option value="work_related">Work exception</option>
                    <option value="other">Other</option>
                  </select>
                  <button className="btn btn-warn" disabled={busy} onClick={triggerOverride}>
                    ⚡ Emergency Override
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Self-Test Attendance Punch Bar on Phone */}
          <section className="panel panel-pad">
            <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
              Pilot Test: Simulate Gate Punch from Phone
            </div>
            <div className="terminal-pad">
              <button className="btn btn-primary" disabled={busy} onClick={() => sendMobilePunch('clock_in')}>
                ▶ Clock In
              </button>
              <button className="btn" disabled={busy} onClick={() => sendMobilePunch('break_start')}>
                ☕ Break Start
              </button>
              <button className="btn" disabled={busy} onClick={() => sendMobilePunch('break_end')}>
                ↩ Break End
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => sendMobilePunch('clock_out')}>
                ■ Clock Out
              </button>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
