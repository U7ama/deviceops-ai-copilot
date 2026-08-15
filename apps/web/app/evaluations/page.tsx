'use client';

import { useCallback, useEffect, useState } from 'react';

type EvalRun = {
  id: string;
  datasetId: string;
  provider: string;
  model: string;
  state: string;
  config: Record<string, any>;
  summary: Record<string, any> | null;
  createdAt: string;
};

export default function EvaluationsPage() {
  const [items, setItems] = useState<EvalRun[]>([]);
  const [message, setMessage] = useState('Loading evaluation runs…');
  const [csrf, setCsrf] = useState('');
  const [queuing, setQueuing] = useState(false);

  const loadEvalRuns = useCallback(async () => {
    setMessage('Loading evaluation runs…');
    try {
      const [evalResponse, csrfResponse] = await Promise.all([
        fetch('/api/v1/eval-runs'),
        fetch('/api/v1/auth/csrf')
      ]);
      if (!evalResponse.ok) throw new Error('Sign in to view evaluation runs.');
      const data = await evalResponse.json();
      setItems(data.evalRuns ?? []);
      if (csrfResponse.ok) {
        setCsrf((await csrfResponse.json()).csrfToken ?? '');
      }
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load evaluation runs.');
    }
  }, []);

  useEffect(() => {
    void loadEvalRuns();
  }, [loadEvalRuns]);

  async function handleQueueEval() {
    if (!csrf) {
      setMessage('Session expired or CSRF token missing. Please refresh.');
      return;
    }
    setQueuing(true);
    setMessage('Queueing synthetic evaluation benchmark run…');
    try {
      const response = await fetch('/api/v1/eval-runs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: window.location.origin,
          'x-csrf-token': csrf
        },
        body: JSON.stringify({
          datasetId: 'deviceops-synthetic-v1'
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Could not queue evaluation run.');
      setMessage(`Evaluation run ${body.evalRunId} successfully queued.`);
      await loadEvalRuns();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Queueing evaluation run failed.');
    } finally {
      setQueuing(false);
    }
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="eyebrow">Versioned quality evidence</div>
          <h2>Evaluations</h2>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" disabled={queuing || !csrf} onClick={handleQueueEval}>
            {queuing ? 'Queueing…' : 'Queue Evaluation Run'}
          </button>
          <button
            type="button"
            style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--text)' }}
            onClick={() => loadEvalRuns()}
          >
            Refresh
          </button>
        </div>
      </div>
      <p className="muted">
        Offline mock verification is available from the core repository. API-created runs are queued and
        record provider/model/config before execution.
      </p>
      {message && <p className="notice">{message}</p>}
      <div className="stack">
        {items.map((item) => (
          <article className="panel" key={item.id}>
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Benchmark run</span>
                <h3>{item.id}</h3>
              </div>
              <span className={`badge ${item.state}`}>{item.state.toUpperCase()}</span>
            </div>
            <p className="small muted">
              Dataset: <strong>{item.datasetId}</strong> · Provider: <strong>{item.provider}</strong> ·
              Model: <strong>{item.model}</strong>
            </p>
            {item.summary ? (
              <pre>{JSON.stringify(item.summary, null, 2)}</pre>
            ) : (
              <p className="small muted">Evaluation run is queued / awaiting worker execution.</p>
            )}
          </article>
        ))}
        {!message && !items.length && (
          <p className="muted">No evaluation runs recorded for this tenant.</p>
        )}
      </div>
    </section>
  );
}
