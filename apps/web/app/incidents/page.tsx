'use client';

import { useCallback, useEffect, useState } from 'react';
import type { IncidentState } from '@deviceops/contracts';

type IncidentItem = {
  id: string;
  runId: string | null;
  summary: string;
  state: IncidentState;
  assignedTeam: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function IncidentsPage() {
  const [items, setItems] = useState<IncidentItem[]>([]);
  const [message, setMessage] = useState('Loading incidents…');
  const [csrf, setCsrf] = useState('');
  const [role, setRole] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const loadIncidents = useCallback(async () => {
    setMessage('Loading incidents…');
    try {
      const incResponse = await fetch('/api/v1/incidents', { cache: 'no-store' });
      if (!incResponse.ok) throw new Error('Sign in to view incidents.');
      const data = await incResponse.json();
      setItems(data.incidents ?? []);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load incidents.');
    }
  }, []);

  useEffect(() => {
    void loadIncidents();
    const controller = new AbortController();
    void Promise.all([
      fetch('/api/v1/auth/me', { signal: controller.signal, cache: 'no-store' }),
      fetch('/api/v1/auth/csrf', { signal: controller.signal, cache: 'no-store' })
    ]).then(async ([meResponse, csrfResponse]) => {
      if (meResponse.ok) setRole((await meResponse.json()).user?.role ?? '');
      if (csrfResponse.ok) setCsrf((await csrfResponse.json()).csrfToken ?? '');
    }).catch(() => undefined);
    return () => controller.abort();
  }, [loadIncidents]);

  async function handleRetry(incidentId: string) {
    const cookieToken = document.cookie.split('; ').find((part) => part.startsWith('deviceops_csrf='));
    const token = cookieToken ? decodeURIComponent(cookieToken.slice('deviceops_csrf='.length)) : csrf;
    if (!token) {
      setMessage('Session expired or CSRF token missing. Refresh the page.');
      return;
    }
    setRetryingId(incidentId);
    setMessage(`Queuing retry for incident ${incidentId}…`);
    try {
      const response = await fetch(`/api/v1/incidents/${encodeURIComponent(incidentId)}/retry`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: window.location.origin,
          'x-csrf-token': token
        }
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Retry dispatch failed.');
      setMessage(`Incident ${incidentId} queued for retry.`);
      await loadIncidents();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Retry failed.');
    } finally {
      setRetryingId(null);
    }
  }

  if (message.includes('Sign in')) {
    return (
      <section className="auth-card">
        <div className="eyebrow">Enterprise AV Operations · Incidents</div>
        <h2>Sign in required</h2>
        <p className="muted">Please sign in to view notification delivery records. Operational investigations are in the Operations workspace.</p>
        <a href="/" style={{ display: 'inline-block', backgroundColor: 'var(--accent)', color: '#0f172a', padding: '10px 20px', borderRadius: '6px', fontWeight: '600', textDecoration: 'none', textAlign: 'center', marginTop: '14px' }}>
          Go to Sign In
        </a>
      </section>
    );
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="eyebrow">Legacy notification workflow</div>
          <h2>Notification delivery</h2>
        </div>
        <button type="button" onClick={() => loadIncidents()}>
          Refresh Incidents
        </button>
      </div>
      <p className="muted">
        These records track notification delivery through n8n. Delivery does not confirm device recovery. View investigations and recovery in the Operations workspace.
      </p>
      {message && <p className="notice">{message}</p>}
      <div className="stack">
        {items.map((item) => (
          <article className="panel" key={item.id}>
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Incident record</span>
                <h3>{item.summary}</h3>
              </div>
              <span className={`badge ${item.state}`}>{item.state.replaceAll('_', ' ').toUpperCase()}</span>
            </div>
            <p className="small muted">
              Assigned to {item.assignedTeam} · Updated {new Date(item.updatedAt).toLocaleString()}
              {item.runId ? (
                <>
                  {' '}
                  · Origin Run: <a href={`/runs/${item.runId}`}>{item.runId}</a>
                </>
              ) : null}
            </p>
            {item.lastError ? <p className="notice">{item.lastError}</p> : null}
            {['manager', 'admin', 'owner'].includes(role) && (item.state === 'dead_lettered' || item.state === 'retrying') ? (
              <div style={{ marginTop: '14px' }}>
                <button
                  type="button"
                  disabled={retryingId !== null || !csrf}
                  onClick={() => handleRetry(item.id)}
                >
                  {retryingId === item.id ? 'Retrying…' : 'Retry Dispatch'}
                </button>
              </div>
            ) : null}
          </article>
        ))}
        {!message && !items.length && <p className="muted">No incidents in this tenant.</p>}
      </div>
    </section>
  );
}
