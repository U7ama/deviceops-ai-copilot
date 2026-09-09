'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IncidentDetail, Status } from './incident-detail';
import type { OperationsState, OperationUser } from './types';
import { human, timestamp } from './types';

type View = 'fleet' | 'incidents' | 'discovery' | 'integrations';
const scenarios = [
  { id: 'switch_failure', title: 'Upstream switch', description: 'Group downstream faults, investigate, and review a recovery proposal.' },
  { id: 'service_hang', title: 'Telemetry service', description: 'Investigate a service failure and verify permitted automatic recovery.' },
  { id: 'auth_failure', title: 'Authentication error', description: 'Keep credential failure separate from device reachability.' },
  { id: 'source_conflict', title: 'Conflicting sources', description: 'Inspect freshness and conflicting device observations.' },
  { id: 'recovery_failure', title: 'Failed recovery', description: 'A command acknowledgment cannot resolve an unhealthy device.' }
] as const;
const currency = (value: number) => `$${Number.isFinite(value) ? value.toFixed(4) : '—'}`;

function currentCsrf(fallback: string) {
  const cookie = document.cookie.split('; ').find((part) => part.startsWith('deviceops_csrf='));
  return cookie ? decodeURIComponent(cookie.slice('deviceops_csrf='.length)) : fallback;
}

export default function OperationsPage() {
  const [user, setUser] = useState<OperationUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [csrf, setCsrf] = useState('');
  const [state, setState] = useState<OperationsState | null>(null);
  const [view, setView] = useState<View>('fleet');
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [connectorStatus, setConnectorStatus] = useState('all');
  const [fleetFilter, setFleetFilter] = useState('all');
  const [incidentFilter, setIncidentFilter] = useState('active');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [showDemo, setShowDemo] = useState(false);
  const fetching = useRef(false);
  const actionKeys = useRef(new Map<string, string>());
  const canManage = Boolean(user && ['manager', 'admin', 'owner'].includes(user.role));

  useEffect(() => {
    const controller = new AbortController();
    async function authenticate() {
      try {
        const response = await fetch('/api/v1/auth/me', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const body = await response.json();
        setUser(body.user);
        const csrfResponse = await fetch('/api/v1/auth/csrf', { cache: 'no-store', signal: controller.signal });
        if (csrfResponse.ok) setCsrf((await csrfResponse.json()).csrfToken ?? '');
        else setError('The action token could not be loaded. Refresh this page before submitting an operation.');
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Session could not be loaded.');
      } finally {
        if (!controller.signal.aborted) setAuthLoading(false);
      }
    }
    void authenticate();
    return () => controller.abort();
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const timeout = AbortSignal.timeout(12_000);
      const response = await fetch('/api/v2/state', { cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (response.status === 401) {
        setUser(null); setState(null); setError('Your session has expired. Sign in again to continue.'); return;
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Operations data could not be refreshed.');
      if (!['devices', 'incidents', 'approvals', 'events', 'connectors', 'discovery'].every((field) => Array.isArray(body[field]))) throw new Error('Operations returned an incomplete response.');
      setState(body as OperationsState); setSyncedAt(new Date().toISOString()); setSyncError('');
    } catch (cause) {
      if (!signal?.aborted) setSyncError(cause instanceof Error ? cause.message : 'Operations data could not be refreshed.');
    } finally { fetching.current = false; }
  }, []);

  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      if (timer) clearTimeout(timer);
      if (controller.signal.aborted || document.visibilityState === 'hidden') return;
      await refresh(controller.signal);
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3000);
    }
    const onVisibility = () => {
      if (timer) clearTimeout(timer);
      if (document.visibilityState !== 'hidden') void poll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [user, refresh]);

  async function mutate(path: string, body: Record<string, unknown>, success: string) {
    if (busy) return;
    const token = currentCsrf(csrf);
    if (!token) { setError('Refresh the page to obtain an action token.'); return; }
    const fingerprint = `${path}:${JSON.stringify(body)}`;
    const key = actionKeys.current.get(fingerprint) ?? crypto.randomUUID();
    actionKeys.current.set(fingerprint, key);
    setBusy(true); setMessage(''); setError('');
    try {
      const response = await fetch(path, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token, 'idempotency-key': key },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30_000)
      });
      const result = await response.json();
      if (!response.ok) {
        // Explicit rejections finish this attempt; network failures preserve the logical operation key.
        actionKeys.current.delete(fingerprint);
        if (response.status === 401) { setUser(null); setState(null); }
        throw new Error(result.detail ?? result.error ?? 'The operation was rejected.');
      }
      actionKeys.current.delete(fingerprint);
      await refresh(); setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The operation could not be confirmed. Retrying will reuse its request key.');
    } finally { setBusy(false); }
  }

  if (authLoading) return <section className="ops ops-panel ops-empty" aria-busy="true">Loading your operations workspace…</section>;
  if (!user) return <section className="ops auth-card"><span className="eyebrow">DeviceOps operations</span><h2>Sign in to your workspace</h2><p className="muted">Use your existing DeviceOps account to view fleet health, investigations, and recovery approvals.</p>{error && <p role="alert">{error}</p>}<a className="ops-link-button" href="/">Go to sign in</a></section>;

  const devices = state?.devices ?? [];
  const incidents = state?.incidents ?? [];
  const approvals = state?.approvals ?? [];
  const active = incidents.filter((incident) => !['resolved', 'cancelled'].includes(incident.status));
  const waiting = approvals.filter((approval) => approval.status === 'pending' && new Date(approval.expiresAt).getTime() > Date.now());
  const selected = incidents.find((incident) => incident.id === selectedId) ?? active[0] ?? incidents[0];
  const displayedIncidents = incidentFilter === 'active' ? active : incidents;
  const connectors = state?.connectors ?? [];
  const categories = Array.from(new Set(connectors.map((connector) => connector.category)));
  const statuses = Array.from(new Set(connectors.map((connector) => connector.status)));
  const visibleConnectors = connectors.filter((connector) => (category === 'all' || connector.category === category) && (connectorStatus === 'all' || connector.status === connectorStatus) && `${connector.name} ${connector.category}`.toLowerCase().includes(query.toLowerCase()));
  const budget = state?.budget;
  const budgetPercent = budget && budget.limitUsd > 0 ? Math.min(100, Math.max(0, (budget.spentUsd + budget.reservedUsd) / budget.limitUsd * 100)) : 0;
  function showIncidents(id?: string) { if (id) setSelectedId(id); setView('incidents'); }

  return <div className="ops">
    <section className="ops-hero">
      <div><div className="eyebrow">{user.tenantName} <span aria-hidden="true">/</span> Operations workspace</div><h1>Every incident.<br /><span>A clearer next step.</span></h1><p>Monitor the fleet, investigate the evidence, and verify recovery.</p><div className="ops-hero-meta"><span className={`ops-live-dot ${syncError ? 'ops-live-off' : ''}`} aria-hidden="true" /><span>{syncedAt ? `Last update ${timestamp(syncedAt)}` : 'Connecting to operations…'}</span><span>{human(user.role)}</span></div></div>
      <aside className="ops-mode-card"><span className="ops-caption">INVESTIGATION MODE</span><strong>{state ? state.mode === 'gemini' ? 'Strands + Google Gemini' : state.mode === 'bedrock' ? 'Strands + Amazon Bedrock' : 'Deterministic fixture' : 'Connecting…'}</strong><p>{state && state.mode !== 'fixture' ? 'Configured for live model investigation. Each incident records its actual provider; devices retain their source labels.' : state ? 'Reproducible local workflow. No live AI reasoning is claimed in fixture mode.' : 'Mode is confirmed by the backend.'}</p><div className="ops-budget-row"><span>Model budget</span><strong>{budget ? `${currency(budget.spentUsd)} / ${currency(budget.limitUsd)}` : 'Unavailable'}</strong></div><div className="ops-budget-track" role="progressbar" aria-label="Model budget consumed or reserved" aria-valuenow={Math.round(budgetPercent)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${budgetPercent}%` }} /></div><small>{budget ? `${currency(budget.reservedUsd)} reserved for active invocations` : 'Waiting for budget information'}</small></aside>
    </section>

    {error && <div className="ops-alert ops-alert-error" role="alert">{error}</div>}
    {syncError && <div className="ops-alert ops-alert-error" role="alert">Updates interrupted: {syncError} Displayed data may be stale. <button className="ops-inline-button" onClick={() => void refresh()}>Retry refresh</button></div>}
    {message && <div className="ops-alert" role="status">{message}</div>}

    <section className="ops-stats" aria-label="Operations overview">
      <div><span>Enrolled devices</span><strong>{state ? devices.length : '—'}</strong><small>{devices.filter((device) => device.sourceMode === 'simulated').length} simulated resources</small></div>
      <div><span>Healthy observations</span><strong>{state ? devices.filter((device) => device.health === 'online').length : '—'}</strong><small>Unknown data is never counted online</small></div>
      <button onClick={() => showIncidents()}><span>Open incidents</span><strong>{state ? active.length : '—'}</strong><small>Grouped by observed dependencies</small></button>
      <button onClick={() => showIncidents(waiting[0]?.incidentId)}><span>Awaiting review</span><strong>{state ? waiting.length : '—'}</strong><small>Exact operations need a decision</small></button>
    </section>

    <div className="ops-workspace-bar"><nav aria-label="Operations views" className="ops-tabs">{(['fleet', 'incidents', 'discovery', 'integrations'] as const).map((item) => <button key={item} aria-pressed={view === item} onClick={() => setView(item)}>{item === 'fleet' ? 'Fleet overview' : human(item)}{item === 'incidents' && active.length > 0 && <span>{active.length}</span>}</button>)}</nav>{canManage && <button className="ops-button-secondary" aria-expanded={showDemo} aria-controls="ops-demo-controls" onClick={() => setShowDemo(!showDemo)}>Demo scenarios <span aria-hidden="true">{showDemo ? '−' : '+'}</span></button>}</div>
    {showDemo && canManage && <section id="ops-demo-controls" className="ops-panel ops-demo"><div className="ops-row"><div><h3>Introduce a simulated fault</h3><p>Fault injection changes synthetic devices. Detection and investigation run through the operations workflow.</p></div><button className="ops-button-secondary" disabled={busy || !state} onClick={() => void mutate('/api/v2/demo', { scenario: 'reset' }, 'Simulator reset requested. Pending work is reconciled by the backend.')}>Reset simulator</button></div><div className="ops-demo-grid">{scenarios.map((scenario) => <button key={scenario.id} disabled={busy || !state} onClick={() => { setSelectedId(''); setView('incidents'); void mutate('/api/v2/demo', { scenario: scenario.id }, `${scenario.title} fault injected. Awaiting recorded detection and investigation.`); }}><strong>{scenario.title}</strong><span>{scenario.description}</span></button>)}</div></section>}

    {!state && !syncError && <div className="ops-panel ops-empty" aria-busy="true">Loading fleet observations and incidents…</div>}
    {state && view === 'fleet' && <section className="ops-panel"><div className="ops-row"><div><span className="eyebrow">Fleet health</span><h3>See what the evidence says.</h3><p>Reachability, credentials, freshness, and application health remain separate.</p></div><label className="ops-filter">Show devices<select value={fleetFilter} onChange={(event) => setFleetFilter(event.target.value)}><option value="all">All devices</option><option value="attention">Needs attention</option><option value="online">Healthy</option></select></label></div><div className="ops-table-scroll"><table className="ops-table"><thead><tr><th>Device / location</th><th>Health</th><th>Reachability</th><th>Authentication</th><th>Last observation</th><th>Source</th></tr></thead><tbody>{devices.filter((device) => fleetFilter === 'all' || (fleetFilter === 'online' ? device.health === 'online' : device.health !== 'online')).map((device) => <tr key={device.id}><td><strong>{device.name}</strong><small>{device.room} · {human(device.kind)}</small>{Boolean(Object.keys(device.metrics ?? {}).length) && <details><summary>Measurements</summary><pre>{JSON.stringify(device.metrics, null, 2)}</pre></details>}</td><td><Status value={device.health} />{device.conflict && <small className="ops-conflict">Source conflict</small>}</td><td>{human(device.reachability)}</td><td>{human(device.auth)}</td><td><time dateTime={device.observedAt ?? undefined}>{timestamp(device.observedAt)}</time></td><td><span className="ops-source">{device.sourceMode === 'simulated' ? 'Simulated' : device.sourceMode === 'live' ? 'Live connector' : 'Unknown'}</span></td></tr>)}</tbody></table></div>{devices.length === 0 && <p className="ops-empty">No enrolled devices. Discover simulator candidates to get started.</p>}</section>}

    {state && view === 'incidents' && <div className="ops-incident-grid"><section className="ops-panel ops-incident-list"><div className="ops-row"><h3>Incidents</h3><label className="ops-filter"><span className="ops-sr-only">Incident filter</span><select value={incidentFilter} onChange={(event) => setIncidentFilter(event.target.value)}><option value="active">Open</option><option value="all">All incidents</option></select></label></div><div className="ops-incident-items">{displayedIncidents.map((incident) => <button key={incident.id} className={selected?.id === incident.id ? 'is-selected' : ''} aria-pressed={selected?.id === incident.id} onClick={() => setSelectedId(incident.id)}><div className="ops-row"><Status value={incident.status} /><small>{human(incident.severity)}</small></div><strong>{incident.summary}</strong><span>{incident.deviceIds.length} affected device{incident.deviceIds.length === 1 ? '' : 's'} · {timestamp(incident.createdAt)}</span></button>)}</div>{displayedIncidents.length === 0 && <p className="ops-empty">{incidentFilter === 'active' ? 'No open incidents. Monitoring continues.' : 'No incidents have been recorded.'}</p>}</section>{selected ? <IncidentDetail key={selected.id} incident={selected} devices={devices} runbooks={state.runbooks ?? []} notifications={(state.notifications ?? []).filter((item) => item.incidentId === selected.id)} events={state.events.filter((event) => event.incidentId === selected.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))} approvals={approvals.filter((approval) => approval.incidentId === selected.id)} canManage={canManage} busy={busy} mutate={mutate} /> : <section className="ops-panel ops-empty"><span className="ops-empty-icon" aria-hidden="true">◎</span><h3>Ready for the next incident.</h3><p>Select a recorded incident to inspect its evidence and recovery.<br />Managers can inject a fault from Demo scenarios.</p></section>}</div>}

    {state && view === 'discovery' && <section className="ops-panel"><div className="ops-row"><div><span className="eyebrow">Controlled discovery</span><h3>Review before enrolling.</h3><p>Scan the configured simulator network. Candidates are added to monitoring only after enrollment.</p></div>{canManage && <button disabled={busy} onClick={() => void mutate('/api/v2/discovery', { targets: 'simulator' }, 'Simulator discovery requested. Review candidates before enrollment.')}>Discover simulator</button>}</div><div className="ops-candidates">{state.discovery.map((candidate) => <article key={candidate.id}><div><strong>{candidate.name}</strong><code>{candidate.address}</code></div><Status value={candidate.status} />{canManage && candidate.status !== 'enrolled' && <button className="ops-button-secondary" disabled={busy} onClick={() => void mutate(`/api/v2/discovery/${encodeURIComponent(candidate.id)}/enroll`, {}, `${candidate.name} enrollment accepted.`)}>Enroll candidate</button>}</article>)}</div>{state.discovery.length === 0 && <p className="ops-empty">No discovery candidates yet. An authorized manager can start a simulator scan.</p>}</section>}

    {state && view === 'integrations' && <section className="ops-panel"><div className="ops-row"><div><span className="eyebrow">Connector catalog</span><h3>One interface. Many possibilities.</h3><p>Implementation and verification status are shown for each entry. Planned integrations are roadmap items.</p></div><span className="ops-source">{connectors.length} catalog entries</span></div><div className="ops-catalog-filters"><label>Find an integration<input type="search" placeholder="Search vendor or protocol…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((item) => <option key={item} value={item}>{human(item)}</option>)}</select></label><label>Verification status<select value={connectorStatus} onChange={(event) => setConnectorStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{human(item)}</option>)}</select></label></div><p className="ops-footnote">Showing {visibleConnectors.length} of {connectors.length} entries</p><div className="ops-connector-grid">{visibleConnectors.map((connector) => <article key={connector.id}><span className="ops-caption">{human(connector.category)}</span><h4>{connector.name}</h4><Status value={connector.status} /></article>)}</div>{visibleConnectors.length === 0 && <p className="ops-empty">No integrations match these filters.</p>}</section>}
    <p className="ops-page-note">DeviceOps · Evidence-backed incident operations · Observations refresh every 3 seconds while this tab is visible.</p>
  </div>;
}
