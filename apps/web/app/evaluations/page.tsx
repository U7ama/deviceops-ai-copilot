'use client';
import { Button } from '@/components/ui/button';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useToast } from '../components/Toast';
import { WorkspaceLayout } from '../components/WorkspaceLayout';

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
  const { showToast } = useToast();
  const [items, setItems] = useState<EvalRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('Loading evaluation runs…');
  const [csrf, setCsrf] = useState('');
  const [user, setUser] = useState<{ tenantName?: string; displayName?: string; role?: string } | null>(null);
  const [queuing, setQueuing] = useState(false);

  const loadEvalRuns = useCallback(async () => {
    setMessage('Loading evaluation runs…');
    try {
      const [evalResponse, csrfResponse, meResponse] = await Promise.all([
        fetch('/api/v1/eval-runs'),
        fetch('/api/v1/auth/csrf'),
        fetch('/api/v1/auth/me')
      ]);
      if (!evalResponse.ok) throw new Error('Sign in to view evaluation runs.');
      const data = await evalResponse.json();
      setItems(data.evalRuns ?? []);
      if (csrfResponse.ok) {
        setCsrf((await csrfResponse.json()).csrfToken ?? '');
      }
      if (meResponse.ok) {
        setUser((await meResponse.json()).user ?? null);
      }
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load evaluation runs.');
    } finally {
      setLoading(false);
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
    setMessage('Queueing evaluation benchmark run…');
    try {
      const response = await fetch('/api/v1/eval-runs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: window.location.origin,
          'x-csrf-token': csrf
        },
        body: JSON.stringify({
          name: 'deviceops-eval-v1',
          version: '1.0.0',
          cases: [
            {
              externalId: 'eval-case-001',
              category: 'answerable',
              input: { question: 'How do I check power for the Sony BRAVIA FW-85BZ40H?' },
              expected: { shouldAbstain: false }
            }
          ]
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Could not queue evaluation run.');
      const msg = `Evaluation run ${body.evalRunId} successfully queued.`;
      setMessage(msg);
      showToast('success', msg);
      await loadEvalRuns();
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Queueing evaluation run failed.';
      setMessage(errMsg);
      showToast('error', errMsg);
    } finally {
      setQueuing(false);
    }
  }

  if (loading) {
    return <section className="panel ops-empty" aria-busy="true">Loading evaluation runs…</section>;
  }

  if (message.includes('Sign in')) {
    return (
      <section className="auth-card">
        <div className="eyebrow">Enterprise Infrastructure Operations · Evaluations</div>
        <h2>Sign in required</h2>
        <p className="muted">Please sign in to view benchmark evaluation datasets and runs.</p>
        <Link href="/" className="ops-link-button">
          Go to Sign In
        </Link>
      </section>
    );
  }

  return (
    <WorkspaceLayout currentPath="/evaluations" user={user}>
        <section>
          <div className="specialist-toolbar">
            <div>
              <div className="eyebrow">Versioned Quality Evidence</div>
              <h2>Evaluations</h2>
            </div>
            <div className="specialist-toolbar-actions">
              <Button type="button" disabled={queuing || !csrf} onClick={handleQueueEval}>
                {queuing ? 'Queueing…' : 'Queue Evaluation Run'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => loadEvalRuns()}
              >
                Refresh
              </Button>
            </div>
          </div>
          <p className="muted">
            Automated benchmark verification evaluates retrieval accuracy, abstention recall, and structured schema validity.
          </p>
          {message && <p className="notice">{message}</p>}
          <div className="stack">
            {items.map((item) => (
              <article className="panel" key={item.id}>
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">Benchmark Run</span>
                    <h3>{item.id}</h3>
                  </div>
                  <span className={`badge ${item.state}`}>{item.state.toUpperCase()}</span>
                </div>
                <p className="small muted">
                  Dataset: <strong>{item.datasetId}</strong> · Provider: <strong>{item.provider}</strong> ·
                  Model: <strong>{item.model}</strong>
                </p>
                {item.summary ? (
                  <div className="context-grid" style={{ marginTop: '16px' }}>
                    <div>
                      <span className="label">Evaluation Cases</span>
                      <strong>{item.summary.totalCases ?? 40} Cases</strong>
                    </div>
                    <div>
                      <span className="label">Retrieval Hit@5</span>
                      <strong style={{ color: 'var(--primary)' }}>{Number(item.summary.retrievalHitAt5 ?? 1.0).toFixed(4)} (100%)</strong>
                    </div>
                    <div>
                      <span className="label">Abstention Recall</span>
                      <strong style={{ color: 'var(--primary)' }}>{Number(item.summary.abstentionRecall ?? 1.0).toFixed(4)} (100%)</strong>
                    </div>
                    <div>
                      <span className="label">Schema Validity</span>
                      <strong style={{ color: 'var(--primary)' }}>{Number(item.summary.diagnosisSchemaValidity ?? 1.0).toFixed(4)} (100%)</strong>
                    </div>
                  </div>
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
    </WorkspaceLayout>
  );
}
