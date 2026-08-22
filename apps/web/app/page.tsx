'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

type User = {
  email: string;
  displayName: string;
  tenantName: string;
  role: string;
  demoMode: boolean;
};
type Device = {
  id: string;
  roomId: string;
  name: string;
  manufacturer: string;
  model: string;
  room: { id: string; name: string; location: string };
  status: { online: boolean; powerState: string; input: string | null; observedAt: string } | null;
};

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [csrf, setCsrf] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [question, setQuestion] = useState('The wall display is offline after a power interruption. What should I check?');
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [runId, setRunId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/v1/auth/me').then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      setUser(body.user);
      const csrfResponse = await fetch('/api/v1/auth/csrf');
      if (csrfResponse.ok) setCsrf((await csrfResponse.json()).csrfToken);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!user) return;
    fetch('/api/v1/devices')
      .then(async (response) => {
        if (!response.ok) throw new Error('Devices could not be loaded for this tenant.');
        const body = await response.json() as { devices: Device[] };
        setDevices(body.devices);
        setSelectedDeviceId((current) => current || body.devices[0]?.id || '');
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Devices could not be loaded.'));
  }, [user]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: window.location.origin },
        body: JSON.stringify({ email, password, client: 'web' })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Login failed');
      setUser(body.user);
      setCsrf(body.csrfToken);
      setPassword('');
      setMessage('Authenticated. Device status is server-authorized.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function createRun(event: FormEvent) {
    event.preventDefault();
    const selected = devices.find((device) => device.id === selectedDeviceId);
    if (!csrf) return setMessage('Refresh the session before creating a run.');
    if (!selected) return setMessage('Select a device before creating a run.');
    setBusy(true);
    setMessage('Queueing a bounded diagnosis run…');
    try {
      const response = await fetch('/api/v1/runs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: window.location.origin,
          'x-csrf-token': csrf,
          'idempotency-key': crypto.randomUUID()
        },
        body: JSON.stringify({ roomId: selected.roomId, deviceId: selected.id, question, mediaIds: [] })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Run could not be queued');
      setRunId(body.runId);
      setMessage('Run queued. Open the timeline to watch durable events and citations.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Run failed');
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
      return <section className="auth-card">
      <div className="eyebrow">Enterprise AV Operations · DeviceOps Copilot</div>
      <h2>Sign in to DeviceOps</h2>
      <p className="muted">Sign in to access tenant-scoped diagnostics, cited manual retrieval, and policy-constrained device operations.</p>
      <form onSubmit={login} className="stack">
        <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required /></label>
        <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>
        <button disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      {message && <p className="notice">{message}</p>}
    </section>;
  }

  async function logout() {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        origin: window.location.origin,
        'x-csrf-token': csrf
      }
    }).catch(() => undefined);
    setUser(null);
    setCsrf('');
    setDevices([]);
    setSelectedDeviceId('');
    setMessage('Signed out.');
  }

  return <div className="page-grid">
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="eyebrow">{user.tenantName} · {user.role}</div>
        <button
          type="button"
          onClick={logout}
          style={{ background: 'transparent', border: '1px solid var(--line)', padding: '6px 12px', fontSize: '12px' }}
        >
          Sign out
        </button>
      </div>
      <h2>Technician diagnosis workspace</h2>
      <p className="muted">Every run is tenant-scoped, retrieved from permitted manual evidence, and constrained by a server-owned tool and approval policy.</p>
      <form onSubmit={createRun} className="panel stack">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">New run</span>
            <h3>Ask about a device</h3>
          </div>
          <span className="badge">{user.demoMode ? 'staging environment' : 'enterprise tenant'}</span>
        </div>
        <label>Question or observed symptom<textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={5} required /></label>
        <div className="context-grid"><div><span className="label">Room</span><strong>{devices.find((device) => device.id === selectedDeviceId)?.room.name ?? 'Select a device'}</strong></div><div><span className="label">Device</span><select aria-label="Device" value={selectedDeviceId} onChange={(event) => setSelectedDeviceId(event.target.value)} required><option value="" disabled>Select a device</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.model}</option>)}</select></div></div>
        <button disabled={busy || !selectedDeviceId} type="submit">{busy ? 'Queueing…' : 'Queue diagnosis'}</button>
        {runId && <a className="run-link" href={`/runs/${runId}`}>Open run timeline →</a>}
      </form>
      {message && <p className="notice">{message}</p>}
    </section>
    <aside className="panel status-card">
      {(() => { const selected = devices.find((device) => device.id === selectedDeviceId); const status = selected?.status; return <>
      <div className="panel-heading"><div><span className="eyebrow">Read-only tool</span><h3>Live status</h3></div><span className={status?.online === false ? 'status offline' : 'status online'}>● {status?.online === false ? 'offline' : 'online'}</span></div>
      <dl>
        <div><dt>Power</dt><dd>{String(status?.powerState ?? 'loading')}</dd></div>
        <div><dt>Input</dt><dd>{String(status?.input ?? 'not available')}</dd></div>
        <div><dt>Observed</dt><dd>{status?.observedAt ? new Date(String(status.observedAt)).toLocaleString() : 'loading'}</dd></div>
      </dl>
      <p className="small muted">Telemetry is isolated and server-authorized. The model cannot mutate unapproved state.</p>
      </>; })()}
    </aside>
  </div>;
}
