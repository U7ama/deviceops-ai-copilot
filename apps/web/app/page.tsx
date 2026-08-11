'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const ROOM_ID = '20000000-0000-4000-8000-000000000001';
const DEVICE_ID = '30000000-0000-4000-8000-000000000001';

type User = {
  email: string;
  displayName: string;
  tenantName: string;
  role: string;
  demoMode: boolean;
};

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [csrf, setCsrf] = useState('');
  const [email, setEmail] = useState('tech@alpha.test');
  const [password, setPassword] = useState('');
  const [question, setQuestion] = useState('The wall display is offline after a power interruption. What should I check?');
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
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
    fetch(`/api/v1/devices/${DEVICE_ID}/status?roomId=${ROOM_ID}`)
      .then(async (response) => response.ok ? setStatus((await response.json()).status) : undefined)
      .catch(() => undefined);
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
    if (!csrf) return setMessage('Refresh the session before creating a run.');
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
        body: JSON.stringify({ roomId: ROOM_ID, deviceId: DEVICE_ID, question, mediaIds: [] })
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
      <div className="eyebrow">Synthetic AV Lab · local reference environment</div>
      <h2>Sign in to DeviceOps</h2>
      <p className="muted">Use a seeded account to exercise tenant isolation, citations, and approval policy. This demo contains no real device control.</p>
      <form onSubmit={login} className="stack">
        <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required /></label>
        <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>
        <button disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      {message && <p className="notice">{message}</p>}
      <p className="small muted">Local seed accounts are documented in the README and must never be reused outside this synthetic environment.</p>
    </section>;
  }

  return <div className="page-grid">
    <section>
      <div className="eyebrow">{user.tenantName} · {user.role}</div>
      <h2>Technician diagnosis workspace</h2>
      <p className="muted">Every run is tenant-scoped, retrieved from permitted manual evidence, and constrained by a server-owned tool and approval policy.</p>
      <form onSubmit={createRun} className="panel stack">
        <div className="panel-heading"><div><span className="eyebrow">New run</span><h3>Ask about a device</h3></div><span className="badge">mock provider</span></div>
        <label>Question or observed symptom<textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={5} required /></label>
        <div className="context-grid"><div><span className="label">Room</span><strong>Conference Room 101</strong></div><div><span className="label">Device</span><strong>Main Wall Display · ProView-85</strong></div></div>
        <button disabled={busy} type="submit">{busy ? 'Queueing…' : 'Queue diagnosis'}</button>
        {runId && <a className="run-link" href={`/runs/${runId}`}>Open run timeline →</a>}
      </form>
      {message && <p className="notice">{message}</p>}
    </section>
    <aside className="panel status-card">
      <div className="panel-heading"><div><span className="eyebrow">Read-only tool</span><h3>Live status</h3></div><span className={status?.online === false ? 'status offline' : 'status online'}>● {status?.online === false ? 'offline' : 'online'}</span></div>
      <dl>
        <div><dt>Power</dt><dd>{String(status?.powerState ?? 'loading')}</dd></div>
        <div><dt>Input</dt><dd>{String(status?.input ?? 'not available')}</dd></div>
        <div><dt>Observed</dt><dd>{status?.observedAt ? new Date(String(status.observedAt)).toLocaleString() : 'loading'}</dd></div>
      </dl>
      <p className="small muted">Telemetry is simulated. The model cannot change this state.</p>
    </aside>
  </div>;
}
