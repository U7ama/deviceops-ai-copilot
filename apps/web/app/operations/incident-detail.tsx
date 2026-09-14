'use client';

import { useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { useToast } from '../components/Toast';
import { RECOVERY_HEALTHY_SAMPLES, RECOVERY_TIMEOUT_MS } from '@deviceops/operations/recovery';
import type { Approval, Device, Incident, Mutation, OperationEvent, OperationsState } from './types';
import { human, object, text, timestamp } from './types';
import { cleanSummary } from './presentation';

export function Status({ value }: { value: string | null | undefined }) {
  const known = (value || 'unknown').toLowerCase();
  const tone = ['online', 'resolved', 'approved', 'enrolled', 'hardware/service-verified', 'simulator-tested'].includes(known) ? 'good'
    : ['offline', 'error', 'escalated', 'rejected', 'failed', 'critical'].includes(known) ? 'bad'
    : ['warning', 'awaiting_approval', 'pending', 'high', 'verifying'].includes(known) ? 'warn' : 'neutral';
  return <span className={`ops-status ops-status-${tone}`}><span aria-hidden="true" />{human(value)}</span>;
}

export function ApprovalCard({ approval, devices, canManage, busy, mutate }: {
  approval: Approval; devices: Device[]; canManage: boolean; busy: boolean; mutate: Mutation;
}) {
  const [reason, setReason] = useState('');
  const [actionBusy, setActionBusy] = useState<'approve' | 'reject' | null>(null);
  const expiresAt = new Date(approval.expiresAt).getTime();
  const expired = !Number.isFinite(expiresAt) || expiresAt <= Date.now();
  const pending = approval.status === 'pending' && !expired;

  async function handleApprove() {
    setActionBusy('approve');
    await mutate(`/api/v2/approvals/${encodeURIComponent(approval.id)}/decision`, { decision: 'approved', proposalHash: approval.hash, reason }, 'Approval recorded. Execution and recovery verification remain separate steps.');
    setActionBusy(null);
  }

  async function handleReject() {
    setActionBusy('reject');
    await mutate(`/api/v2/approvals/${encodeURIComponent(approval.id)}/decision`, { decision: 'rejected', proposalHash: approval.hash, reason }, 'Proposal rejected. The incident remains unresolved.');
    setActionBusy(null);
  }

  return <article className="ops-approval">
    <div className="ops-row"><h4>{human(approval.name)}</h4><Status value={expired && approval.status === 'pending' ? 'expired' : approval.status} /></div>
    <p>Review this exact operation before deciding. Recovery is confirmed separately by fresh device observations.</p>
    <dl className="ops-facts">
      <div><dt>Target</dt><dd>{devices.find((device) => device.id === approval.targetDeviceId)?.name ?? approval.targetDeviceId}<code>{approval.targetDeviceId}</code></dd></div>
      <div><dt>Risk</dt><dd>{human(approval.risk)}</dd></div>
      <div><dt>Expires</dt><dd>{timestamp(approval.expiresAt)}</dd></div>
      {approval.policyVersion && <div><dt>Policy Version</dt><dd>{approval.policyVersion}</dd></div>}
      <div><dt>Expected Disruption</dt><dd>Not available</dd></div>{approval.reason&&<div><dt>Rationale</dt><dd>{approval.reason}</dd></div>}
      <div><dt>Evidence</dt><dd>{approval.evidenceIds.length ? approval.evidenceIds.join(', ') : 'No evidence references supplied'}</dd></div>
    </dl>
    <details className="ops-accordion"><summary>Proposal Hash, Preconditions &amp; Exact Arguments</summary><code>{approval.hash}</code><pre>{JSON.stringify({ preconditions: approval.preconditions, arguments: approval.arguments ?? {} }, null, 2)}</pre></details>
    {pending && canManage ? <div className="ops-approval-controls">
      <label htmlFor={`reason-${approval.id}`}>Decision note<textarea id={`reason-${approval.id}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Record why this operation is appropriate or should be rejected." maxLength={1000} rows={2} /></label>
      <div className="ops-actions">
        <button disabled={busy || actionBusy !== null} onClick={() => void handleApprove()}>{actionBusy === 'approve' ? 'Approving…' : 'Approve Operation'}</button>
        <button className="ops-button-danger" disabled={busy || actionBusy !== null} onClick={() => void handleReject()}>{actionBusy === 'reject' ? 'Rejecting…' : 'Reject Operation'}</button>
      </div>
    </div> : pending ? <p className="ops-footnote">A manager, admin, or owner must review this proposal.</p> : null}
  </article>;
}

function Diagnosis({ value, runbooks, suppliedEvidence, devices }: { value: Record<string, unknown>; runbooks: NonNullable<OperationsState['runbooks']>; suppliedEvidence: Record<string, unknown>[]; devices: Device[] }) {
  const evidence = [...(Array.isArray(value.evidence) ? value.evidence : []), ...suppliedEvidence];
  const citations = Array.isArray(value.citations) ? value.citations : [];
  const evidenceIds = Array.isArray(value.evidenceIds) ? value.evidenceIds : [];
  return <section className="ops-diagnosis">
    <h4>Investigation Findings</h4><p className="ops-footnote">Agent hypotheses are distinct from observed evidence and backend policy.</p>
    {Boolean(value.provider) && <p className="ops-footnote">Provider: {human(text(value.provider))}{Boolean(value.modelId) && <> · {text(value.modelId)}</>}</p>}
    <p>{cleanSummary(text(value.summary) || text(value.diagnosis) || text(value.likelyCause) || text(value.cause) || 'Structured findings are available below.')}</p>
    {Boolean(value.likelyCause || value.probableCause || value.cause) && <p><strong>Likely cause: </strong>{cleanSummary(text(value.likelyCause) || text(value.probableCause) || text(value.cause))}</p>}
    {Boolean(value.uncertainty) && <p className="ops-footnote"><strong>Uncertainty: </strong>{cleanSummary(text(value.uncertainty) || JSON.stringify(value.uncertainty))}</p>}
    {Array.isArray(value.alternatives) && value.alternatives.length > 0 && <p className="ops-footnote"><strong>Alternatives: </strong>{value.alternatives.map((item) => cleanSummary(text(item) || text(object(item).summary) || text(object(item).cause))).filter(Boolean).join('; ')}</p>}
    {evidence.length + citations.length > 0 && <section className="ops-evidence-records"><h4 style={{ margin: '16px 0 10px', fontSize: '14px' }}>Observed Evidence · {evidence.length + citations.length} Records</h4>
      <div className="ops-evidence-grid">
        {[...evidence, ...citations].map((item, index) => {
          const entry = object(item);
          const deviceName = (id: unknown) => devices.find((device) => device.id === id)?.name ?? text(id);
          const heading = text(entry.title) || (entry.kind === 'observation' ? deviceName(entry.deviceId) : entry.kind === 'topology' ? `${deviceName(entry.upstreamId)} → ${deviceName(entry.downstreamId)}` : text(entry.tool)) || text(entry.id) || `Evidence ${index + 1}`;
          const excerpt = entry.kind === 'observation'
            ? `Reachability: ${human(text(entry.reachability))}. Health: ${human(text(entry.health))}. Authentication: ${human(text(entry.auth))}. Observed ${timestamp(text(entry.observedAt))}.`
            : entry.kind === 'topology' ? 'Configured upstream dependency.' : cleanSummary(text(item) || text(entry.excerpt) || text(entry.summary) || text(entry.content) || text(entry.text) || text(entry.observationId));
          return <div className="ops-evidence-card" key={text(entry.id) || index}>
            <div className="ops-evidence-card-header">
              <span className="ops-evidence-type-badge">{human(text(entry.kind) || 'Observation')}</span>
              <span className="ops-evidence-citation">{text(entry.source) || 'Telemetry'}</span>
            </div>
            <strong>{heading}</strong>
            <p className="ops-evidence-excerpt">{excerpt}</p>
            <div className="ops-evidence-footer">
              <small>{entry.version ? `Version ${text(entry.version)} · ` : ''}{text(entry.id)}</small>
            </div>
            {entry.kind === 'observation' && Boolean(entry.metrics) && <details className="ops-accordion"><summary>Raw Metrics</summary><pre>{JSON.stringify(entry.metrics, null, 2)}</pre></details>}
          </div>;
        })}
      </div>
    </section>}
    {runbooks.filter((book) => evidenceIds.includes(book.id)).map((book) => (
      <div className="ops-evidence-card" key={book.id} style={{ marginTop: '12px' }}>
        <div className="ops-evidence-card-header">
          <span className="ops-evidence-type-badge">Runbook</span>
          <span className="ops-evidence-citation">Knowledge Library</span>
        </div>
        <strong>{book.title}</strong>
        <p className="ops-evidence-excerpt">{book.text}</p>
        <div className="ops-evidence-footer">
          <small>Runbook Version {book.version} · {book.id}</small>
        </div>
      </div>
    ))}
    {evidenceIds.length > 0 && (
      <p className="ops-footnote" style={{ marginTop: '12px' }}>
        Evidence references: {evidenceIds.map(id => {
          const s = text(id);
          return s.length > 18 ? s.slice(0, 8) + '…' : s;
        }).join(', ')}
      </p>
    )}
  </section>;
}


export function RunbookReview({ incident, busy, mutate }: { incident: Incident; busy: boolean; mutate: Mutation }) {
  const [title, setTitle] = useState(`Recovery: ${cleanSummary(incident.summary)}`.slice(0, 160));
  const [content, setContent] = useState([
    `# ${cleanSummary(incident.summary)}`, '',
    `Cause: ${text(incident.report?.cause) || incident.cause}`, '',
    `Outcome: ${text(incident.report?.outcome)}`, '',
    'Review these incident-specific findings and adapt them into reusable troubleshooting instructions before publishing.', '',
    `Affected devices: ${incident.deviceIds.join(', ')}`
  ].join('\n'));
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    const msg = 'Reviewed runbook published to the authorized knowledge library.';
    const ok = await mutate(`/api/v2/incidents/${encodeURIComponent(incident.id)}/publish-runbook`, { title, text: content }, msg);
    setSubmitting(false);
    if (ok) {
      setFeedback({ type: 'success', text: msg });
    } else {
      setFeedback({ type: 'error', text: 'Failed to publish runbook. Review requirements or check if already published.' });
    }
  }

  return <details className="ops-runbook-review ops-accordion"><summary>Review &amp; Publish Runbook</summary>
    <form className="stack" onSubmit={handleSubmit}>
      <p className="ops-footnote">Edit this draft into reusable instructions. Publishing makes this knowledge available to subsequent investigations in your tenant.</p>
      <label>Runbook Title<input value={title} onChange={(event) => setTitle(event.target.value)} minLength={5} maxLength={160} required /></label>
      <label>Reviewed Runbook Content<textarea value={content} onChange={(event) => setContent(event.target.value)} minLength={40} maxLength={12000} rows={8} required /></label>
      <div className="ops-actions">
        <button disabled={busy || submitting} type="submit">{submitting ? 'Publishing…' : 'Publish Reviewed Runbook'}</button>
      </div>
      {feedback && (
        <div className={`ops-alert ${feedback.type === 'error' ? 'ops-alert-error' : ''}`} role={feedback.type === 'error' ? 'alert' : undefined} style={{ marginTop: '12px' }}>
          {feedback.text}
        </div>
      )}
    </form>
  </details>;
}

export function IncidentDetail({ incident, devices, runbooks, notifications, events, approvals, canManage, busy, mutate }: {
  notifications: NonNullable<OperationsState['notifications']>;
  incident: Incident; devices: Device[]; runbooks: NonNullable<OperationsState['runbooks']>; events: OperationEvent[]; approvals: Approval[];
  canManage: boolean; busy: boolean; mutate: Mutation;
}) {
  const [investigating, setInvestigating] = useState(false);
  const { showToast } = useToast();
  function downloadReport() {
    if (!incident.report) return;
    const blob = new Blob([JSON.stringify({ incidentId: incident.id, summary: cleanSummary(incident.summary), status: incident.status, report: incident.report }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `deviceops-incident-${incident.id}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('success', `Incident report ${incident.id} downloaded.`);
  }
  return <div className="ops-incident-detail" aria-label="Selected incident">
    {/* Step 1: What Needs Attention */}
    <div className="ops-step-card">
      <div className="ops-step-header">
        <span className="ops-step-number">1</span>
        <div className="ops-step-info">
          <h4 className="ops-step-title">What Needs Attention</h4>
          <span className="ops-step-subtitle">Incident status and operational summary</span>
        </div>
        <Status value={incident.status} />
      </div>
      <div className="ops-step-body">
        <h3 style={{ margin: '0 0 8px', fontSize: '20px' }}>{cleanSummary(incident.summary)}</h3>
        <p className="ops-footnote">Opened {timestamp(incident.createdAt)} · Updated {timestamp(incident.updatedAt)}</p>
      </div>
    </div>

    {/* Step 2: What Is Affected */}
    <div className="ops-step-card">
      <div className="ops-step-header">
        <span className="ops-step-number">2</span>
        <div className="ops-step-info">
          <h4 className="ops-step-title">What Is Affected</h4>
          <span className="ops-step-subtitle">Equipment, rooms, and topology dependencies</span>
        </div>
      </div>
      <div className="ops-step-body">
        <p>Known affected devices and rooms. Stored relationships may not describe the complete impact.</p>
        <div className="ops-chips">
          {incident.deviceIds.map((id) => (
            <span key={id}>{devices.find((device) => device.id === id)?.name ?? id} · {devices.find(device=>device.id===id)?.room??'Location unavailable'}</span>
          ))}
        </div>
      </div>
    </div>

    {/* Step 3: What The Agent Found */}
    <div className="ops-step-card">
      <div className="ops-step-header">
        <span className="ops-step-number">3</span>
        <div className="ops-step-info">
          <h4 className="ops-step-title">What The Agent Found</h4>
          <span className="ops-step-subtitle">Hypotheses, cited evidence, and autonomous agent analysis</span>
        </div>
      </div>
      <div className="ops-step-body">
        {!incident.diagnosis && <p className="ops-empty">{incident.status === 'investigating' ? 'The investigation is running. Tool activity will appear below.' : 'No validated agent findings yet.'}</p>}
        {incident.diagnosis && <Diagnosis value={incident.diagnosis} runbooks={runbooks} suppliedEvidence={incident.evidence ?? []} devices={devices} />}
      </div>
    </div>

    {/* Step 4: What Action Is Required */}
    <div className="ops-step-card">
      <div className="ops-step-header">
        <span className="ops-step-number">4</span>
        <div className="ops-step-info">
          <h4 className="ops-step-title">What Action Is Required</h4>
          <span className="ops-step-subtitle">Human-in-the-loop approvals, controlled execution, and recovery verification</span>
        </div>
      </div>
      <div className="ops-step-body">
        {!approvals.length && <p>{incident.status==='escalated'?'Escalation required. Review the investigation and policy outcome.':incident.status==='resolved'?'Recovery confirmed. Review the report before publishing reusable guidance.':incident.status==='cancelled'?'Investigation cancelled. Dispatched actions are not rolled back.':'No approval proposal recorded. This does not authorize an action.'}</p>}
        <div className="ops-actions">
          {canManage && <button className="ops-button-secondary" disabled={busy || investigating || ['investigating', 'executing', 'verifying', 'awaiting_approval'].includes(incident.status)} onClick={async () => {
            setInvestigating(true);
            await mutate(`/api/v2/incidents/${encodeURIComponent(incident.id)}/investigate`, {}, 'Investigation requested. New findings will appear in the timeline.');
            setInvestigating(false);
          }}>{investigating ? 'Requesting…' : 'Request Investigation'}</button>}
          {incident.report && <button className="ops-button-secondary" onClick={downloadReport}>Download Report</button>}
        </div>
        {approvals.map((approval) => <ApprovalCard key={approval.id} approval={approval} devices={devices} canManage={canManage} busy={busy} mutate={mutate} />)}
        {incident.status==='verifying'&&<section className="ops-evidence" style={{ marginTop: '14px' }}><h4>Recovery Verification</h4><p>{Number.isFinite(incident.healthySamples)?`${incident.healthySamples} / ${RECOVERY_HEALTHY_SAMPLES} qualifying observations per affected device`:'Observation count unavailable'}</p><p>Fresh, healthy observations are required after execution. Verification timeout: {RECOVERY_TIMEOUT_MS/1000} seconds.</p></section>}
        {events.some(e=>e.type==='verification.failed')&&<p className="ops-alert ops-alert-error" style={{ marginTop: '14px' }}>Recovery verification failed. Command acknowledgment did not establish recovery.</p>}
        {incident.report && <section className="ops-report" style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
          <h4>Draft Incident Report</h4>
          <p className="ops-footnote">This report is a draft. Publication to the runbook library requires separate review.</p>
          <p>{text(incident.report.outcome)}</p>
          <details className="ops-accordion"><summary>Full Report Data</summary><pre>{JSON.stringify(incident.report, null, 2)}</pre></details>
          {incident.report.publication === 'published' ? (
            <div className="ops-alert ops-alert-published" style={{ marginTop: '14px' }}>
              <CheckCircle2 size={16} aria-hidden="true" />
              <span>Reviewed runbook published to the authorized knowledge library.</span>
            </div>
          ) : canManage ? (
            <RunbookReview incident={incident} busy={busy} mutate={mutate} />
          ) : null}
        </section>}
        {notifications.length > 0 && <section className="ops-notifications" style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}><h4>Notification Delivery</h4><p className="ops-footnote">Delivery is tracked independently of recovery verification.</p>{notifications.map((notification) => <p key={notification.id}><Status value={notification.state} /> <small>{notification.attempts} delivery attempt{notification.attempts === 1 ? '' : 's'}</small>{notification.lastError && <span className="ops-footnote"> · {notification.lastError}</span>}</p>)}</section>}
      </div>
    </div>

    {/* Activity & Evidence Timeline Card */}
    <div className="ops-step-card">
      <div className="ops-step-header">
        <div className="ops-step-info">
          <h4 className="ops-step-title">Activity &amp; Evidence Timeline</h4>
          <span className="ops-step-subtitle">Recorded events, tool activity, and verification outcomes</span>
        </div>
      </div>
      <div className="ops-step-body">
        <ol className="ops-timeline">{events.length ? events.map((event) => <li key={event.id}>
          <span className="ops-timeline-dot" aria-hidden="true" /><div className="ops-row"><strong>{human(event.type.replaceAll('.', ' / '))}</strong><time dateTime={event.createdAt}>{timestamp(event.createdAt)}</time></div>
          <p>{text(event.data.message) || text(event.data.summary) || text(event.data.toolName) || text(event.data.tool) || text(event.data.name) || text(event.data.status) || text(event.data.reason)}</p>
          {Boolean(event.data.evidenceIds) && <small>Evidence: {Array.isArray(event.data.evidenceIds) ? event.data.evidenceIds.map(text).join(', ') : text(event.data.evidenceIds)}</small>}
        </li>) : <li className="ops-empty">No activity recorded yet.</li>}</ol>
      </div>
    </div>
  </div>;
}
