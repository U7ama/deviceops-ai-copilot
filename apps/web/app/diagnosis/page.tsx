'use client';
import { NativeSelect } from '@/components/ui/native-select';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { useToast } from '../components/Toast';
import { WorkspaceLayout } from '../components/WorkspaceLayout';

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

export default function DiagnosisPage() {
  const { showToast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [csrf, setCsrf] = useState('');
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
    }).catch(() => undefined).finally(() => setAuthLoading(false));
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

  async function createRun(event: FormEvent) {
    event.preventDefault();
    const selected = devices.find((device) => device.id === selectedDeviceId);
    if (!csrf) {
      const err = 'Refresh the session before creating a run.';
      setMessage(err);
      showToast('error', err);
      return;
    }
    if (!selected) {
      const err = 'Select a device before creating a run.';
      setMessage(err);
      showToast('error', err);
      return;
    }
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
      const msg = 'Run queued. Open the timeline to watch durable events and citations.';
      setMessage(msg);
      showToast('success', msg);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Run failed';
      setMessage(errMsg);
      showToast('error', errMsg);
    } finally {
      setBusy(false);
    }
  }

  if (authLoading) {
    return <section className="panel ops-empty" aria-busy="true" style={{ maxWidth: 420, margin: '48px auto', textAlign: 'center' }}>Connecting to workspace…</section>;
  }

  if (!user) {
    return <section className="auth-card">
      <div className="eyebrow">Enterprise Infrastructure Operations · DeviceOps</div>
      <h2>Sign in to DeviceOps</h2>
      <p className="muted">Sign in to access tenant-scoped diagnostics, cited manual retrieval, and policy-constrained device operations.</p>
      <Link className="ops-link-button" href="/">Go to sign in</Link>
    </section>;
  }

  async function logout() {
    try {
      const response = await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: {
          origin: window.location.origin,
          'x-csrf-token': csrf
        }
      });
      if (!response.ok) {
        throw new Error('Sign out request failed.');
      }
      setUser(null);
      setCsrf('');
      setDevices([]);
      setSelectedDeviceId('');
      setMessage('Signed out.');
      showToast('success', 'Signed out of DeviceOps.');
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Sign out failed.';
      setMessage(errMsg);
      showToast('error', errMsg);
    }
  }

  return (
    <WorkspaceLayout currentPath="/diagnosis" user={user}>
        <div className="page-grid">
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="eyebrow">{user.tenantName} · {user.role}</div>
            </div>
            <h2>Technician Diagnosis Workspace</h2>
            <p className="muted">Every run is tenant-scoped, retrieved from permitted manual evidence, and constrained by a server-owned tool and approval policy.</p>
            <form onSubmit={createRun} className="panel stack">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">New Run</span>
                  <h3>Ask About a Device</h3>
                </div>
                <span className="badge">{user.demoMode ? 'staging environment' : 'enterprise tenant'}</span>
              </div>
              <label>Question or Observed Symptom<Textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={5} required /></label>
              <div className="context-grid"><div><span className="label">Room</span><strong>{devices.find((device) => device.id === selectedDeviceId)?.room.name ?? 'Select a device'}</strong></div><div><span className="label">Device</span><NativeSelect aria-label="Device" value={selectedDeviceId} onChange={(event) => setSelectedDeviceId(event.target.value)} required><option value="" disabled>Select a device</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.model}</option>)}</NativeSelect></div></div>
              <Button disabled={busy || !selectedDeviceId} type="submit">{busy ? 'Queueing…' : 'Queue diagnosis'}</Button>
              {runId && <Link className="run-link" href={`/runs/${runId}`}>Open run timeline →</Link>}
            </form>
            {message && <p className="notice">{message}</p>}
          </section>
          <aside className="panel status-card">
            {(() => { const selected = devices.find((device) => device.id === selectedDeviceId); const status = selected?.status; return <>
            <div className="panel-heading"><div><span className="eyebrow">Read-Only Tool</span><h3>Device Snapshot</h3></div><span className={status?.online === true ? 'status online' : status?.online === false ? 'status offline' : 'status muted'}>● {status?.online === true ? 'online' : status?.online === false ? 'offline' : 'unknown'}</span></div>
            <dl>
              <div><dt>Power</dt><dd>{String(status?.powerState ?? 'not observed')}</dd></div>
              <div><dt>Input</dt><dd>{String(status?.input ?? 'not available')}</dd></div>
              <div><dt>Observed</dt><dd>{status?.observedAt ? new Date(String(status.observedAt)).toLocaleString() : 'not observed'}</dd></div>
            </dl>
            <p className="small muted">Simulated device snapshot (lab environment), isolated by tenant. Open Operations for monitored observations, source provenance, and recovery verification.</p>
            </>; })()}
          </aside>
        </div>
    </WorkspaceLayout>
  );
}
