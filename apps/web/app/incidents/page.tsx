'use client';

import { useCallback, useEffect, useState } from 'react';

type IncidentItem = {
  id: string;
  runId: string | null;
  summary: string;
  state: 'queued' | 'dispatched' | 'delivered' | 'failed';
  assignedTeam: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function IncidentsPage() {
  const [items, setItems] = useState<IncidentItem[]>([]);
  const [message, setMessage] = useState('Loading incidents…');
  const [csrf, setCsrf] = useState('');
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const loadIncidents = useCallback(async () => {
    setMessage('Loading incidents…');
    try {
      const [incResponse, csrfResponse] = await Promise.all([
        fetch('/api/v1/incidents'),
        fetch('/api/v1/auth/csrf')
      ]);
      if (!incResponse.ok) throw new Error('Sign in to view incidents.');
      const data = await incResponse.json();
      setItems(data.incidents ?? []);
      if (csrfResponse.ok) {
        setCsrf((await csrfResponse.json()).csrfToken ?? '');
      }
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load incidents.');
    }
  }, []);

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  async function handleRetry(incidentId: string) {
    if (!csrf) {
      setMessage('Session expired or CSRF token missing. Refresh the page.');
      return;
    }
    setRetryingId(incidentId);
    setMessage(`Queuing retry for incident ${incidentId}…`);
    try {
      const response = await fetch(`/api/v1/incidents/${incidentId}/retry`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: window.location.origin,
          'x-csrf-token': csrf
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

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="eyebrow">Transactional incident state</div>
          <h2>Incidents</h2>
        </div>
        <button type="button" onClick={() => loadIncidents()}>
          Refresh Incidents
        </button>
      </div>
      <p className="muted">
        n8n is an external router only. Incident status and idempotency remain in the core database.
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
              <span className={`badge ${item.state}`}>{item.state.toUpperCase()}</span>
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
            {item.state === 'failed' || item.state === 'queued' ? (
              <div style={{ marginTop: '14px' }}>
                <button
                  type="button"
                  disabled={retryingId === item.id || !csrf}
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
