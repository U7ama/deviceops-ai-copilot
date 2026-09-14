'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useToast } from '../components/Toast';
import { AppSidebar } from '../components/AppSidebar';

type ApprovalItem = {
  id: string;
  runId: string;
  state: 'pending' | 'approved' | 'rejected' | 'expired';
  expiresAt: string;
  proposalHash: string;
  proposal: {
    summary: string;
    steps?: Array<{ instruction: string; category?: string }>;
  };
};

export default function ApprovalsPage() {
  const { showToast } = useToast();
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('Loading approvals…');
  const [csrf, setCsrf] = useState('');
  const [role, setRole] = useState('');
  const [user, setUser] = useState<{ tenantName?: string; displayName?: string; role?: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadApprovals = useCallback(async (): Promise<boolean> => {
    setMessage('Loading approvals…');
    try {
      const [appResponse, meResponse, csrfResponse] = await Promise.all([
        fetch('/api/v1/approvals'),
        fetch('/api/v1/auth/me'),
        fetch('/api/v1/auth/csrf')
      ]);
      if (!appResponse.ok) throw new Error('Sign in to view approvals.');
      const data = await appResponse.json();
      setItems(data.approvals ?? []);
      if (meResponse.ok) {
        const me = await meResponse.json();
        setRole(me.user?.role ?? '');
        setUser(me.user ?? null);
      }
      if (csrfResponse.ok) {
        setCsrf((await csrfResponse.json()).csrfToken ?? '');
      }
      setMessage('');
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load approvals.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  async function handleDecision(
    approvalId: string,
    proposalHash: string,
    decision: 'approved' | 'rejected'
  ) {
    if (!csrf) {
      const err = 'Session expired or CSRF token unavailable. Please refresh.';
      setMessage(err);
      showToast('error', err);
      return;
    }
    setBusyId(approvalId);
    setMessage(`Submitting ${decision} decision…`);
    try {
      const response = await fetch(`/api/v1/approvals/${approvalId}/decision`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: window.location.origin,
          'x-csrf-token': csrf
        },
        body: JSON.stringify({
          decision,
          reason: `${decision === 'approved' ? 'Approved' : 'Rejected'} via manager approval workspace`,
          proposalHash
        })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? `Decision could not be processed.`);
      const decMsg = decision === 'approved'
        ? `Proposal approved. Incident ${body.incidentId ?? 'created'} routed to on-call dispatch.`
        : 'Proposal rejected. State updated.';
      setMessage(decMsg);
      showToast(decision === 'approved' ? 'success' : 'error', decMsg);
      await loadApprovals();
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Decision submission failed.';
      setMessage(errMsg);
      showToast('error', errMsg);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <section className="panel ops-empty" aria-busy="true">Loading approvals…</section>;
  }

  if (!role && message.includes('Sign in')) {
    return (
      <section className="auth-card">
        <div className="eyebrow">Enterprise Infrastructure Operations · Approvals</div>
        <h2>Sign in required</h2>
        <p className="muted">Please sign in with a manager or operator account to view pending approvals.</p>
        <Link href="/" style={{ display: 'inline-block', backgroundColor: 'var(--accent)', color: '#0f172a', padding: '10px 20px', borderRadius: '6px', fontWeight: '600', textDecoration: 'none', textAlign: 'center', marginTop: '14px' }}>
          Go to Sign In
        </Link>
      </section>
    );
  }

  return (
    <div className="ops ops-workspace">
      <AppSidebar currentPath="/approvals" user={user} />
      <div className="ops-content">
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="eyebrow">Server Policy Queue</div>
              <h2>Approvals</h2>
            </div>
            <button
              type="button"
              onClick={async () => {
                const ok = await loadApprovals();
                if (ok) {
                  showToast('success', 'Approval queue refreshed.');
                } else {
                  showToast('error', 'Could not refresh approval queue.');
                }
              }}
            >
              Refresh Queue
            </button>
          </div>
          <p className="muted">
            Only manager/admin sessions can approve, and the requester can never approve their own proposal.
          </p>
          {message && <p className="notice">{message}</p>}
          <div className="stack">
            {items.map((item) => {
              const isPending = item.state === 'pending';
              const canDecide = isPending && role !== 'technician' && Boolean(csrf);
              return (
                <article className="panel" key={item.id}>
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">Approval Request</span>
                      <h3>{item.proposal?.summary ?? 'Incident proposal'}</h3>
                    </div>
                    <span className={`badge ${item.state}`}>{item.state.toUpperCase()}</span>
                  </div>
                  <p className="small muted">
                    Run ID: <Link href={`/runs/${item.runId}`}>{item.runId}</Link> · Expires:{' '}
                    {new Date(item.expiresAt).toLocaleString()}
                  </p>
                  <p>
                    {(item.proposal?.steps ?? []).map((step) => step.instruction).join(' ') ||
                      'No specific remediation steps provided.'}
                  </p>
                  {canDecide ? (
                    <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => handleDecision(item.id, item.proposalHash, 'approved')}
                      >
                        {busyId === item.id ? 'Processing…' : 'Approve Proposal'}
                      </button>
                      <button
                        type="button"
                        style={{ background: 'linear-gradient(135deg, #be123c, #9f1239)', color: '#ffffff' }}
                        disabled={busyId === item.id}
                        onClick={() => handleDecision(item.id, item.proposalHash, 'rejected')}
                      >
                        Reject
                      </button>
                    </div>
                  ) : isPending && role === 'technician' ? (
                    <p className="small muted">
                      Technicians cannot approve proposals. A manager/admin session is required.
                    </p>
                  ) : null}
                </article>
              );
            })}
            {!message && !items.length && (
              <p className="muted">No approval requests currently recorded for this tenant.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
