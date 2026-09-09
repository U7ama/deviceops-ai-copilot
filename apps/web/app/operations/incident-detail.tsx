'use client';

import { useState } from 'react';
import type { Approval, Device, Incident, Mutation, OperationEvent, OperationsState } from './types';
import { human, object, text, timestamp } from './types';

export function Status({ value }: { value: string | null | undefined }) {
  const known = (value || 'unknown').toLowerCase();
  const tone = ['online', 'resolved', 'approved', 'enrolled', 'hardware/service-verified', 'simulator-tested'].includes(known) ? 'good'
    : ['offline', 'error', 'escalated', 'rejected', 'failed', 'critical'].includes(known) ? 'bad'
    : ['warning', 'awaiting_approval', 'pending', 'high', 'verifying'].includes(known) ? 'warn' : 'neutral';
  return <span className={`ops-status ops-status-${tone}`}><span aria-hidden="true" />{human(value)}</span>;
}

function ApprovalCard({ approval, devices, canManage, busy, mutate }: {
  approval: Approval; devices: Device[]; canManage: boolean; busy: boolean; mutate: Mutation;
}) {
  const [reason, setReason] = useState('');
  const expiresAt = new Date(approval.expiresAt).getTime();
  const expired = !Number.isFinite(expiresAt) || expiresAt <= Date.now();
  const pending = approval.status === 'pending' && !expired;
  return <article className="ops-approval">
    <div className="ops-row"><h4>{human(approval.name)}</h4><Status value={expired && approval.status === 'pending' ? 'expired' : approval.status} /></div>
    <p>Review this exact operation before deciding. Recovery is confirmed separately by fresh device observations.</p>
    <dl className="ops-facts">
      <div><dt>Target</dt><dd>{devices.find((device) => device.id === approval.targetDeviceId)?.name ?? approval.targetDeviceId}<code>{approval.targetDeviceId}</code></dd></div>
      <div><dt>Risk</dt><dd>{human(approval.risk)}</dd></div>
      <div><dt>Expires</dt><dd>{timestamp(approval.expiresAt)}</dd></div>
      {approval.policyVersion && <div><dt>Policy version</dt><dd>{approval.policyVersion}</dd></div>}
      <div><dt>Proposal hash</dt><dd><code>{approval.hash}</code></dd></div>
      <div><dt>Evidence</dt><dd>{approval.evidenceIds.length ? approval.evidenceIds.join(', ') : 'No evidence references supplied'}</dd></div>
    </dl>
    <details><summary>Preconditions and exact arguments</summary><pre>{JSON.stringify({ preconditions: approval.preconditions, arguments: approval.arguments ?? {} }, null, 2)}</pre></details>
    {pending && canManage ? <div className="ops-approval-controls">
      <label htmlFor={`reason-${approval.id}`}>Decision note<textarea id={`reason-${approval.id}`} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Record why this operation is appropriate or should be rejected." maxLength={1000} rows={2} /></label>
      <div className="ops-actions">
        <button disabled={busy} onClick={() => void mutate(`/api/v2/approvals/${encodeURIComponent(approval.id)}/decision`, { decision: 'approved', proposalHash: approval.hash, reason }, 'Approval recorded. Execution and recovery verification remain separate steps.')}>Approve operation</button>
        <button className="ops-button-danger" disabled={busy} onClick={() => void mutate(`/api/v2/approvals/${encodeURIComponent(approval.id)}/decision`, { decision: 'rejected', proposalHash: approval.hash, reason }, 'Proposal rejected. The incident remains unresolved.')}>Reject operation</button>
      </div>
    </div> : pending ? <p className="ops-footnote">A manager, admin, or owner must review this proposal.</p> : null}
  </article>;
}

function Diagnosis({ value, runbooks, suppliedEvidence, devices }: { value: Record<string, unknown>; runbooks: NonNullable<OperationsState['runbooks']>; suppliedEvidence: Record<string, unknown>[]; devices: Device[] }) {
  const evidence = [...(Array.isArray(value.evidence) ? value.evidence : []), ...suppliedEvidence];
  const citations = Array.isArray(value.citations) ? value.citations : [];
  const evidenceIds = Array.isArray(value.evidenceIds) ? value.evidenceIds : [];
  return <section className="ops-diagnosis">
    <h4>Investigation findings</h4>
    {Boolean(value.provider) && <p className="ops-footnote">Provider: {human(text(value.provider))}{Boolean(value.modelId) && <> · {text(value.modelId)}</>}</p>}
    <p>{text(value.summary) || text(value.diagnosis) || text(value.likelyCause) || text(value.cause) || 'Structured findings are available below.'}</p>
    {Boolean(value.likelyCause || value.probableCause || value.cause) && <p><strong>Likely cause: </strong>{text(value.likelyCause) || text(value.probableCause) || text(value.cause)}</p>}
    {Boolean(value.uncertainty) && <p className="ops-footnote"><strong>Uncertainty: </strong>{text(value.uncertainty) || JSON.stringify(value.uncertainty)}</p>}
    {Array.isArray(value.alternatives) && value.alternatives.length > 0 && <p className="ops-footnote"><strong>Alternatives: </strong>{value.alternatives.map((item) => text(item) || text(object(item).summary) || text(object(item).cause)).filter(Boolean).join('; ')}</p>}
    {evidence.length + citations.length > 0 && <details className="ops-evidence-records"><summary>Inspect {evidence.length + citations.length} stored evidence records</summary>{[...evidence, ...citations].map((item, index) => {
      const entry = object(item);
      const deviceName = (id: unknown) => devices.find((device) => device.id === id)?.name ?? text(id);
      const heading = text(entry.title) || (entry.kind === 'observation' ? deviceName(entry.deviceId) : entry.kind === 'topology' ? `${deviceName(entry.upstreamId)} → ${deviceName(entry.downstreamId)}` : text(entry.tool)) || text(entry.id) || `Evidence ${index + 1}`;
      const excerpt = entry.kind === 'observation'
        ? `Reachability: ${human(text(entry.reachability))}. Health: ${human(text(entry.health))}. Authentication: ${human(text(entry.auth))}. Observed ${timestamp(text(entry.observedAt))}.`
        : entry.kind === 'topology' ? 'Configured upstream dependency.' : text(item) || text(entry.excerpt) || text(entry.summary) || text(entry.content) || text(entry.text) || text(entry.observationId);
      return <blockquote className="ops-evidence" key={text(entry.id) || index}><strong>{heading}</strong><p>{excerpt}</p><small>{text(entry.source)} {entry.version ? `Version ${text(entry.version)}` : ''} · {text(entry.id)}</small>{entry.kind === 'observation' && Boolean(entry.metrics) && <pre>{JSON.stringify(entry.metrics, null, 2)}</pre>}</blockquote>;
    })}</details>}
    {runbooks.filter((book) => evidenceIds.includes(book.id)).map((book) => <blockquote className="ops-evidence" key={book.id}><strong>{book.title}</strong><p>{book.text}</p><small>Runbook version {book.version} · {book.id}</small></blockquote>)}
    {evidenceIds.length > 0 && <p className="ops-footnote">Evidence references: {evidenceIds.map(text).join(', ')}</p>}
  </section>;
}


function RunbookReview({ incident, busy, mutate }: { incident: Incident; busy: boolean; mutate: Mutation }) {
  const [title, setTitle] = useState(`Recovery: ${incident.summary}`.slice(0, 160));
  const [content, setContent] = useState([
    `# ${incident.summary}`, '',
    `Cause: ${text(incident.report?.cause) || incident.cause}`, '',
    `Outcome: ${text(incident.report?.outcome)}`, '',
    'Review these incident-specific findings and adapt them into reusable troubleshooting instructions before publishing.', '',
    `Affected devices: ${incident.deviceIds.join(', ')}`
  ].join('\n'));
  return <details className="ops-runbook-review"><summary>Review and publish a runbook</summary>
    <form className="stack" onSubmit={(event) => {
      event.preventDefault();
      void mutate(`/api/v2/incidents/${encodeURIComponent(incident.id)}/publish-runbook`, { title, text: content }, 'Reviewed runbook published to the authorized knowledge library.');
    }}>
      <p className="ops-footnote">Edit this draft into reusable instructions. Publishing makes this knowledge available to subsequent investigations in your tenant.</p>
      <label>Runbook title<input value={title} onChange={(event) => setTitle(event.target.value)} minLength={5} maxLength={160} required /></label>
      <label>Reviewed runbook content<textarea value={content} onChange={(event) => setContent(event.target.value)} minLength={40} maxLength={12000} rows={8} required /></label>
      <button disabled={busy} type="submit">Publish reviewed runbook</button>
    </form>
  </details>;
}

export function IncidentDetail({ incident, devices, runbooks, notifications, events, approvals, canManage, busy, mutate }: {
  notifications: NonNullable<OperationsState['notifications']>;
  incident: Incident; devices: Device[]; runbooks: NonNullable<OperationsState['runbooks']>; events: OperationEvent[]; approvals: Approval[];
  canManage: boolean; busy: boolean; mutate: Mutation;
}) {
  function downloadReport() {
    if (!incident.report) return;
    const blob = new Blob([JSON.stringify({ incidentId: incident.id, summary: incident.summary, status: incident.status, report: incident.report }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `deviceops-incident-${incident.id}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="ops-panel ops-incident-detail" aria-label="Selected incident">
    <div className="ops-row"><span className="eyebrow">Incident investigation</span><Status value={incident.status} /></div>
    <h3>{incident.summary}</h3>
    <p className="ops-footnote">Opened {timestamp(incident.createdAt)} · Updated {timestamp(incident.updatedAt)}</p>
    <div className="ops-chips">{incident.deviceIds.map((id) => <span key={id}>{devices.find((device) => device.id === id)?.name ?? id}</span>)}</div>
    {!incident.diagnosis && <p className="ops-empty">{incident.status === 'investigating' ? 'The investigation is running. Tool activity will appear below.' : 'No validated agent findings yet.'}</p>}
    {incident.diagnosis && <Diagnosis value={incident.diagnosis} runbooks={runbooks} suppliedEvidence={incident.evidence ?? []} devices={devices} />}
    <div className="ops-actions">{canManage && <button className="ops-button-secondary" disabled={busy || ['investigating', 'executing', 'verifying', 'awaiting_approval'].includes(incident.status)} onClick={() => void mutate(`/api/v2/incidents/${encodeURIComponent(incident.id)}/investigate`, {}, 'Investigation requested. New findings will appear in the timeline.')}>Request investigation</button>}{incident.report && <button className="ops-button-secondary" onClick={downloadReport}>Download report</button>}</div>
    {approvals.map((approval) => <ApprovalCard key={approval.id} approval={approval} devices={devices} canManage={canManage} busy={busy} mutate={mutate} />)}
    {incident.report && <section className="ops-report"><h4>Draft incident report</h4><p className="ops-footnote">This report is a draft. Publication to the runbook library requires separate review.</p><pre>{JSON.stringify(incident.report, null, 2)}</pre>{canManage && <RunbookReview incident={incident} busy={busy} mutate={mutate} />}</section>}
    {notifications.length > 0 && <section className="ops-notifications"><h4>Notification delivery</h4><p className="ops-footnote">Delivery is tracked independently of recovery verification.</p>{notifications.map((notification) => <p key={notification.id}><Status value={notification.state} /> <small>{notification.attempts} delivery attempt{notification.attempts === 1 ? '' : 's'}</small>{notification.lastError && <span className="ops-footnote"> · {notification.lastError}</span>}</p>)}</section>}
    <h4>Activity and evidence</h4>
    <p className="ops-footnote">Recorded events, tool activity, and recovery outcomes.</p>
    <ol className="ops-timeline">{events.length ? events.map((event) => <li key={event.id}>
      <span className="ops-timeline-dot" aria-hidden="true" /><div className="ops-row"><strong>{human(event.type.replaceAll('.', ' / '))}</strong><time dateTime={event.createdAt}>{timestamp(event.createdAt)}</time></div>
      <p>{text(event.data.message) || text(event.data.summary) || text(event.data.toolName) || text(event.data.tool) || text(event.data.name) || text(event.data.status) || text(event.data.reason)}</p>
      {Boolean(event.data.evidenceIds) && <small>Evidence: {Array.isArray(event.data.evidenceIds) ? event.data.evidenceIds.map(text).join(', ') : text(event.data.evidenceIds)}</small>}
    </li>) : <li className="ops-empty">No activity recorded yet.</li>}</ol>
  </section>;
}
