'use client';

import { useEffect, useState } from 'react';

type Run = { id: string; state: string; question: string; roomName: string; deviceName: string; diagnosis: any; };
type EventItem = { sequence: string; type: string; data: Record<string, any>; occurredAt: string };

export default function RunTimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const [runId, setRunId] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [message, setMessage] = useState('Loading durable run state…');
  const [csrf, setCsrf] = useState('');
  const [role, setRole] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);

  useEffect(() => { params.then(({ id }) => setRunId(id)); }, [params]);
  useEffect(() => {
    if (!runId) return;
    let active = true;
    async function load() {
      const [runResponse, eventsResponse, meResponse] = await Promise.all([
        fetch(`/api/v1/runs/${runId}`),
        fetch(`/api/v1/runs/${runId}/events`),
        fetch('/api/v1/auth/me')
      ]);
      if (!runResponse.ok) { setMessage('Run is not available in this tenant.'); return; }
      const runBody = await runResponse.json();
      if (active) setRun(runBody.run);
      if (eventsResponse.ok) setEvents(parseSse(await eventsResponse.text()));
      if (meResponse.ok) {
        const me = await meResponse.json(); setRole(me.user.role);
        const csrfResponse = await fetch('/api/v1/auth/csrf');
        if (csrfResponse.ok) setCsrf((await csrfResponse.json()).csrfToken);
      }
      if (active) setMessage('');
    }
    load().catch(() => setMessage('Could not load the run timeline.'));
    return () => { active = false; };
  }, [runId]);

  async function decide(approvalId: string, proposalHash: string) {
    setDecisionBusy(true); setMessage('Submitting server-side approval…');
    const response = await fetch(`/api/v1/approvals/${approvalId}/decision`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: window.location.origin, 'x-csrf-token': csrf },
      body: JSON.stringify({ decision: 'approved', reason: 'Approved from the synthetic operator workspace', proposalHash })
    });
    const body = await response.json();
    setMessage(response.ok ? `Incident ${body.incidentId} was created exactly once.` : (body.detail ?? 'Approval was rejected.'));
    if (response.ok) setRun((current) => current ? { ...current, state: 'completed' } : current);
    setDecisionBusy(false);
  }

  const approval = events.find((event) => event.type === 'approval.required');
  const diagnosis = run?.diagnosis;
  return <section>
    <a href="/">← Back to workspace</a>
    <div className="eyebrow" style={{ marginTop: 28 }}>Durable run timeline</div>
    <h2>{run?.deviceName ?? 'Diagnosis run'}</h2>
    {message && <p className="notice">{message}</p>}
    {run && <p className="muted">{run.question} · <strong>{run.state.replaceAll('_', ' ')}</strong> · {run.roomName}</p>}
    <div className="page-grid">
      <div className="stack">
        <section className="panel"><div className="panel-heading"><div><span className="eyebrow">Server events</span><h3>Replayable execution evidence</h3></div><span className="badge">Last-Event-ID safe</span></div><div className="timeline">{events.map((event) => <article key={`${event.sequence}-${event.type}`}><span className="timeline-sequence">{event.sequence}</span><div><strong>{event.type}</strong><p className="small muted">{new Date(event.occurredAt).toLocaleTimeString()}</p></div></article>)}</div></section>
        {diagnosis && <section className="panel"><span className="eyebrow">Validated output</span><h3>{diagnosis.summary}</h3><p className="muted">{diagnosis.uncertainty}</p><h4>Citations</h4><ul>{diagnosis.citations.map((citation: any) => <li key={citation.id}><strong>{citation.title}</strong> · page {citation.page ?? 'n/a'} · “{citation.excerpt}”</li>)}</ul></section>}
      </div>
      <aside className="panel"><span className="eyebrow">Policy decision</span><h3>{diagnosis?.serverDecision?.requiresApproval ? 'Manager approval required' : 'No approval required'}</h3><p className="muted">Risk and approval are derived by the server from validated steps and evidence. Model advisory flags are not trusted.</p>{approval && role !== 'technician' && csrf && <button disabled={decisionBusy} onClick={() => decide(approval.data.approvalId, approval.data.proposalHash)}>{decisionBusy ? 'Approving…' : 'Approve incident proposal'}</button>}{approval && role === 'technician' && <p className="notice">The requester cannot approve their own proposal.</p>}<div className="small muted" style={{ marginTop: 18 }}>Run ID: {runId}</div></aside>
    </div>
  </section>;
}

function parseSse(text: string): EventItem[] {
  return text.split('\n\n').map((block) => {
    const data = block.split('\n').find((line) => line.startsWith('data: '));
    return data ? JSON.parse(data.slice(6)) : null;
  }).filter((value): value is EventItem => Boolean(value?.type));
}
