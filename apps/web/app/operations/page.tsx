'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { EnterprisePanel } from './enterprise-panel';
import { IncidentDetail, Status } from './incident-detail';
import type { OperationsState, OperationUser } from './types';
import { human, timestamp } from './types';
import { views, readLocation, isStale, healthLabel, cleanSummary, type View } from './presentation';
import { useEnterprise } from './use-enterprise';
import { AppSidebar } from '../components/AppSidebar';
import { LayoutDashboard, Siren, Network, ShieldCheck, BookOpen, Settings, ChevronRight } from 'lucide-react';
import { useToast } from '../components/Toast';

const labels:Record<View,string>={overview:'Overview',incidents:'Incidents',fleet:'Rooms & Equipment',approvals:'Approvals',knowledge:'Knowledge',admin:'Administration'};
const icons={overview:LayoutDashboard,incidents:Siren,fleet:Network,approvals:ShieldCheck,knowledge:BookOpen,admin:Settings};
const scenarios = [
  { id: 'switch_failure', title: 'Upstream switch', description: 'Group downstream faults, investigate, and review a recovery proposal.' },
  { id: 'service_hang', title: 'Telemetry service', description: 'Investigate a service failure and verify permitted automatic recovery.' },
  { id: 'auth_failure', title: 'Authentication error', description: 'Keep credential failure separate from device reachability.' },
  { id: 'source_conflict', title: 'Conflicting sources', description: 'Inspect freshness and conflicting device observations.' },
  { id: 'recovery_failure', title: 'Failed recovery', description: 'A command acknowledgment cannot resolve an unhealthy device.' }
] as const;
const currency = (value: number) => `$${Number.isFinite(value) ? value.toFixed(4) : '—'}`;

type Toast = { id: string; type: 'success' | 'error'; message: string };

function currentCsrf(fallback: string) {
  const cookie = document.cookie.split('; ').find((part) => part.startsWith('deviceops_csrf='));
  return cookie ? decodeURIComponent(cookie.slice('deviceops_csrf='.length)) : fallback;
}

export default function OperationsPage() {
  const [user, setUser] = useState<OperationUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [csrf, setCsrf] = useState('');
  const [state, setState] = useState<OperationsState | null>(null);
  const [view, updateView] = useState<View>('overview');
  const [fleetQuery,setFleetQuery]=useState('');
  const enterprise=useEnterprise(Boolean(user));
  const [resetReady,setResetReady]=useState(false);const [mobileNav,setMobileNav]=useState(false);
  const { showToast } = useToast();

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
      showToast('success', 'Signed out of DeviceOps.');
      window.location.href = '/';
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Sign out failed.';
      showToast('error', errMsg);
    }
  }

  function navigate(next:View,id?:string){
    const url=new URL(window.location.href);
    url.searchParams.set('view',next);
    if(id)url.searchParams.set('incident',id);
    else url.searchParams.delete('incident');
    window.history.pushState(null,'',url);
    updateView(next);
    setSelectedId(id??'');
    setShowDemo(false);
    setMessage('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function setView(next:View){
    navigate(next);
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  useEffect(()=>{
    const sync=()=>{
      const loc=readLocation(window.location.search);
      updateView(loc.view);
      setSelectedId(loc.incident);
      setShowDemo(false);
      setMessage('');
      setError('');
      if(loc.section) setTimeout(()=>document.getElementById(loc.section)?.scrollIntoView(),100);
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    sync();
    window.addEventListener('popstate',sync);
    return()=>window.removeEventListener('popstate',sync);
  },[]);
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
  const demoRef = useRef<HTMLElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 6000);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (showDemo && demoRef.current && !demoRef.current.contains(target)) {
        const toggleBtn = document.getElementById('ops-toggle-scenarios');
        if (!toggleBtn || !toggleBtn.contains(target)) {
          setShowDemo(false);
        }
      }
      if (message && alertRef.current && !alertRef.current.contains(target)) {
        setMessage('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDemo, message]);

  useEffect(() => {
    setShowDemo(false);
    setMessage('');
    setError('');
  }, [view]);

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

  async function mutate(path: string, body: Record<string, unknown>, success: string): Promise<boolean> {
    if (busy) return false;
    const token = currentCsrf(csrf);
    if (!token) {
      const err = 'Refresh the page to obtain an action token.';
      setError(err);
      showToast('error', err);
      return false;
    }
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
      await refresh();
      setMessage(success);
      showToast('success', success);
      return true;
    } catch (cause) {
      const errMsg = cause instanceof Error ? cause.message : 'The operation could not be confirmed. Retrying will reuse its request key.';
      setError(errMsg);
      showToast('error', errMsg);
      return false;
    } finally { setBusy(false); }
  }

  if (authLoading) return <section className="ops ops-panel ops-empty" aria-busy="true">Loading your operations workspace…</section>;
  if (!user) return <section className="ops auth-card"><span className="eyebrow">DeviceOps operations</span><h2>Sign in to your workspace</h2><p className="muted">Use your existing DeviceOps account to view fleet health, investigations, and recovery approvals.</p>{error && <p role="alert">{error}</p>}<Link className="ops-link-button" href="/">Go to sign in</Link></section>;

  const devices = state?.devices ?? [];
  const incidents = state?.incidents ?? [];
  const approvals = state?.approvals ?? [];
  const active = incidents.filter((incident) => !['resolved', 'cancelled'].includes(incident.status));
  const waiting = approvals.filter((approval) => approval.status === 'pending' && new Date(approval.expiresAt).getTime() > Date.now());
  const selected = selectedId ? incidents.find((incident) => incident.id === selectedId) : active[0] ?? incidents[0];
  const displayedIncidents = incidentFilter === 'active' ? active : incidents;
  const connectors = state?.connectors ?? [];
  const categories = Array.from(new Set(connectors.map((connector) => connector.category)));
  const statuses = Array.from(new Set(connectors.map((connector) => connector.status)));
  const visibleConnectors = connectors.filter((connector) => (category === 'all' || connector.category === category) && (connectorStatus === 'all' || connector.status === connectorStatus) && `${connector.name} ${connector.category}`.toLowerCase().includes(query.toLowerCase()));
  const budget = state?.budget;
  const budgetPercent = budget && budget.limitUsd > 0 ? Math.min(100, Math.max(0, (budget.spentUsd + budget.reservedUsd) / budget.limitUsd * 100)) : 0;
  function showIncidents(id?: string) { navigate('incidents',id); }

  return <div className="ops ops-workspace">
    <AppSidebar currentView={view} onSelectView={setView} user={user} />
    <div className="ops-content">
    {enterprise.data?.controls.stopped&&<div className="ops-alert ops-alert-error" role="alert">Operations are stopped. Dispatched actions are not rolled back. <button onClick={()=>setView('admin')}>View controls</button></div>}

    <section className="ops-hero">
      <div><div className="eyebrow">{user.tenantName} <span aria-hidden="true">/</span> Operations Workspace</div><h1>{labels[view]}</h1><p>Monitor the fleet, investigate the evidence, and verify recovery.</p><div className="ops-hero-meta"><span className={`ops-live-dot ${syncError ? 'ops-live-off' : ''}`} aria-hidden="true" /><span>{syncedAt ? `Last update ${timestamp(syncedAt)}` : 'Connecting to operations…'}</span><span>{human(user.role)}</span></div></div>
    </section>

    {error && (
      <div className="ops-alert ops-alert-error" role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <span>{error}</span>
        <button
          type="button"
          className="ops-inline-button"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.25rem', padding: '0 0.5rem', lineHeight: 1, color: 'inherit' }}
          onClick={() => setError('')}
          aria-label="Dismiss error"
        >
          &times;
        </button>
      </div>
    )}
    {syncError && <div className="ops-alert ops-alert-error" role="alert">Updates interrupted: {syncError} Displayed data may be stale. <button className="ops-inline-button" onClick={() => void refresh()}>Retry refresh</button></div>}
    {message && (
      <div
        ref={alertRef}
        className="ops-alert"
        role="status"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}
      >
        <span>{message}</span>
        <button
          type="button"
          className="ops-inline-button"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.25rem', padding: '0 0.5rem', lineHeight: 1, color: 'inherit' }}
          onClick={() => setMessage('')}
          aria-label="Dismiss notification"
        >
          &times;
        </button>
      </div>
    )}

    <section className="ops-stats" aria-label="Operations overview">
      <div><span>Enrolled Devices</span><strong>{state ? devices.length : '—'}</strong><small>{devices.filter((device) => device.sourceMode === 'simulated').length} simulated resources</small></div>
      <div><span>Fresh Observations</span><strong>{state ? devices.filter((device) => !isStale(device)).length : '—'}</strong><small>Within each device’s polling window</small></div>
      <button onClick={() => showIncidents()}><span>Open Incidents</span><strong>{state ? active.length : '—'}</strong><small>Grouped by observed dependencies</small></button>
      <button onClick={() => showIncidents(waiting[0]?.incidentId)}><span>Awaiting Review</span><strong>{state ? waiting.length : '—'}</strong><small>Exact operations need a decision</small></button>
    </section>

    {(view === 'overview' || view === 'incidents') && (
      <>
        <div className="ops-workspace-bar">
          <p>What needs attention. Evidence you can inspect. A clear next action.</p>
          {canManage && (
            <button
              id="ops-toggle-scenarios"
              className="ops-button-secondary"
              aria-expanded={showDemo}
              aria-controls="ops-demo-controls"
              onClick={() => setShowDemo(!showDemo)}
            >
              {showDemo ? 'Hide Scenarios' : 'Operational Scenarios'}
            </button>
          )}
        </div>
        {showDemo && canManage && (
          <section ref={demoRef} id="ops-demo-controls" className="ops-panel ops-demo">
            <div className="ops-row">
              <div>
                <h3>Operational Incident Drills</h3>
                <p>Simulated operational conditions trigger automated detection, specialist analysis, and verified remediation workflows.</p>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button className="ops-button-secondary" disabled={busy || !state} onClick={() => setResetReady(true)}>Reset Environment</button>
                <button className="ops-button-secondary" type="button" onClick={() => setShowDemo(false)} aria-label="Close scenarios">✕ Close</button>
              </div>
            </div>
            {resetReady && (
              <div className="ops-alert" role="alert">
                <p>Resetting the simulation environment will reconcile pending actions and restore baseline operations. Continue?</p>
                <button disabled={busy} onClick={() => { setResetReady(false); setShowDemo(false); void mutate('/api/v2/demo', { scenario: 'reset' }, 'Environment reset requested.'); }}>Confirm Environment Reset</button>
                <button className="ops-button-secondary" onClick={() => setResetReady(false)}>Cancel</button>
              </div>
            )}
            <div className="ops-demo-grid">
              {scenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  disabled={busy || !state}
                  onClick={() => {
                    setShowDemo(false);
                    setSelectedId('');
                    setView('incidents');
                    void mutate('/api/v2/demo', { scenario: scenario.id }, `${scenario.title} drill initiated. Awaiting recorded detection and investigation.`);
                  }}
                >
                  <strong>{scenario.title}</strong>
                  <span>{scenario.description}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </>
    )}
    {!state && !syncError && <div className="ops-panel ops-empty" aria-busy="true">Loading fleet observations and incidents…</div>}
    {state&&<>
      {view === 'overview' && (
        <section className="ops-panel">
          <h3>Needs Attention</h3>
          <p>Unresolved incidents, including escalations.</p>
          <div className="ops-demo-grid">
            {active.map(i => (
              <button className="ops-button-secondary" key={i.id} onClick={() => showIncidents(i.id)}>
                <Status value={i.status} />
                <strong>{cleanSummary(i.summary)}</strong>
                <span>{i.deviceIds.length} known affected devices</span>
              </button>
            ))}
          </div>
          {!active.length && <p>No open incidents. Monitoring continues.</p>}

          <h3 style={{ marginTop: '28px' }}>Recent Recoveries</h3>
          <p className="ops-footnote">Verified resolution and recovery history from recorded incident telemetry.</p>
          <div className="ops-recovery-list">
            {incidents.filter(i => i.status === 'resolved').slice(0, 5).map(i => (
              <button
                key={i.id}
                type="button"
                className="ops-recovery-card"
                onClick={() => showIncidents(i.id)}
              >
                <div className="ops-recovery-main">
                  <div className="ops-recovery-header">
                    <Status value={i.status} />
                    <span className="ops-recovery-devices">
                      {i.deviceIds.length} affected device{i.deviceIds.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <strong className="ops-recovery-summary">{cleanSummary(i.summary)}</strong>
                </div>
                <div className="ops-recovery-meta">
                  <time dateTime={i.updatedAt}>{timestamp(i.updatedAt)}</time>
                  <ChevronRight size={15} className="ops-recovery-arrow" aria-hidden="true" />
                </div>
              </button>
            ))}
            {!incidents.some(i => i.status === 'resolved') && (
              <p className="ops-empty">No resolved incidents recorded yet.</p>
            )}
          </div>
        </section>
      )}
      {view==='approvals'&&<section className="ops-panel"><h3>Operational Approvals</h3><p>Review the exact proposal in its incident context.</p>{approvals.map(a=><article className="ops-approval" key={a.id}><Status value={a.status==='pending'&&Date.parse(a.expiresAt)<=Date.now()?'expired':a.status}/><h4>{human(a.name)}</h4><p>{devices.find(d=>d.id===a.targetDeviceId)?.name??a.targetDeviceId}</p><button onClick={()=>showIncidents(a.incidentId)}>Review incident and proposal</button></article>)}{!approvals.length&&<p>No operational proposals recorded.</p>}</section>}
      {view==='knowledge'&&(
        <section className="ops-panel">
          <div className="ops-row">
            <div>
              <span className="eyebrow">Institutional Knowledge</span>
              <h3>Reviewed Runbooks</h3>
              <p>Operational remediation runbooks verified against approved incident patterns.</p>
            </div>
          </div>

          <div className="ops-runbook-list">
            {(state.runbooks??[]).filter(b=>b.published).map(b=>(
              <details key={b.id} className="ops-accordion ops-runbook-item">
                <summary>
                  <div className="ops-runbook-summary-inner">
                    <span className="ops-runbook-title">
                      <BookOpen size={16} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                      {b.title}
                    </span>
                    <span className="ops-runbook-badge">Version {b.version}</span>
                  </div>
                </summary>
                <div className="ops-runbook-content">
                  <p>{b.text}</p>
                </div>
              </details>
            ))}
            {!(state.runbooks??[]).some(b=>b.published) && (
              <p className="ops-empty">No published runbooks available.</p>
            )}
          </div>

          <div style={{ marginTop: '32px', marginBottom: '12px' }}>
            <span className="eyebrow">Manager Sign-Off</span>
            <h3 style={{ margin: '4px 0 6px' }}>Incident Reports Awaiting Review</h3>
            <p className="ops-footnote" style={{ margin: 0 }}>
              Completed investigations with drafted reports ready for manager evaluation and approval.
            </p>
          </div>

          <div className="ops-recovery-list">
            {incidents.filter(i=>i.report).map(i=>{
              const summaryText = cleanSummary(i.summary || i.cause);
              return (
                <button
                  key={i.id}
                  type="button"
                  className="ops-recovery-card ops-report-card"
                  onClick={()=>showIncidents(i.id)}
                >
                  <div className="ops-recovery-main">
                    <div className="ops-recovery-header">
                      <Status value={i.status} />
                      <span className="ops-recovery-devices">
                        {i.deviceIds.length} affected device{i.deviceIds.length === 1 ? '' : 's'}
                      </span>
                      <span className="ops-report-draft-badge">Draft Report</span>
                    </div>
                    <strong className="ops-recovery-summary">
                      {summaryText}
                    </strong>
                  </div>
                  <div className="ops-recovery-meta">
                    <span className="ops-report-action-cue">Review Report</span>
                    <time dateTime={i.updatedAt}>{timestamp(i.updatedAt)}</time>
                    <ChevronRight size={15} className="ops-recovery-arrow" aria-hidden="true" />
                  </div>
                </button>
              );
            })}
            {!incidents.some(i=>i.report) && (
              <p className="ops-empty">No incident reports awaiting review at this time.</p>
            )}
          </div>
        </section>
      )}
      {(view==='overview'||view==='fleet'||view==='knowledge'||view==='admin')&&<EnterprisePanel state={state} mutate={mutate} canManage={canManage} {...enterprise} section={view}/>}
    </>}
    {state && view === 'fleet' && <section className="ops-panel"><div className="ops-row"><div><span className="eyebrow">Fleet Health</span><h3>See what the evidence says.</h3><p>Reachability, credentials, freshness, and application health remain separate.</p></div></div><div className="ops-toolbar"><div className="ops-toolbar-search"><input type="search" placeholder="Search rooms or equipment…" value={fleetQuery} onChange={e=>setFleetQuery(e.target.value)}/></div><div className="ops-toolbar-filter"><select value={fleetFilter} onChange={(event) => setFleetFilter(event.target.value)}><option value="all">All Devices</option><option value="attention">Needs Attention</option><option value="online">Operational</option><option value="unreachable">Unreachable</option><option value="auth">Authentication Failed</option><option value="conflict">Source Conflict</option><option value="stale">Stale / No Observation</option><option value="simulated">Simulated Only</option><option value="live">Live Connector Only</option></select></div></div><div className="ops-table-scroll"><table className="ops-table"><thead><tr><th>Device / location</th><th>Health</th><th>Reachability</th><th>Authentication</th><th>Last observation</th><th>Source</th></tr></thead><tbody>{devices.filter(device=>`${device.name} ${device.room}`.toLowerCase().includes(fleetQuery.toLowerCase())).filter((device) => fleetFilter==='all'||(fleetFilter==='online'?device.health==='online':fleetFilter==='attention'?device.health!=='online':fleetFilter==='unreachable'?device.reachability==='unreachable':fleetFilter==='auth'?device.auth==='failed':fleetFilter==='conflict'?device.conflict:fleetFilter==='stale'?isStale(device):device.sourceMode===fleetFilter)).map((device) => <tr key={device.id}><td><strong>{device.name}</strong><small>{device.room} · {human(device.kind)}</small>{Boolean(Object.keys(device.metrics ?? {}).length) && <details className="ops-accordion"><summary>Measurements</summary><pre>{JSON.stringify(device.metrics, null, 2)}</pre></details>}</td><td><span className="ops-status">{healthLabel(device.health)}</span>{device.maintenanceUntil&&<small>Maintenance until {timestamp(device.maintenanceUntil)}</small>}{device.conflict && <small className="ops-conflict">Source conflict</small>}</td><td>{human(device.reachability)}</td><td>{human(device.auth)}</td><td><time dateTime={device.observedAt ?? undefined}>{timestamp(device.observedAt)}</time>{device.observedAt&&isStale(device)&&<small>Stale observation</small>}</td><td><span className="ops-source">{device.sourceMode === 'simulated' ? 'Simulated' : device.sourceMode === 'live' ? 'Live connector' : 'Unknown'}</span></td></tr>)}</tbody></table></div>{devices.length === 0 && <p className="ops-empty">No enrolled devices. Discover simulator candidates to get started.</p>}</section>}

    {state && view === 'incidents' && <div className="ops-incident-grid"><section className="ops-panel ops-incident-list"><div className="ops-row"><h3>Incidents</h3><label className="ops-filter"><span className="ops-sr-only">Incident filter</span><select value={incidentFilter} onChange={(event) => setIncidentFilter(event.target.value)}><option value="active">Open</option><option value="all">All incidents</option></select></label></div><div className="ops-incident-items">{displayedIncidents.map((incident) => <button key={incident.id} className={selected?.id === incident.id ? 'is-selected' : ''} aria-pressed={selected?.id === incident.id} onClick={() => navigate('incidents',incident.id)}><div className="ops-row"><Status value={incident.status} /><small>{human(incident.severity)}</small></div><strong>{cleanSummary(incident.summary)}</strong><span>{incident.deviceIds.length} affected device{incident.deviceIds.length === 1 ? '' : 's'} · {timestamp(incident.createdAt)}</span></button>)}</div>{displayedIncidents.length === 0 && <p className="ops-empty">{incidentFilter === 'active' ? 'No open incidents. Monitoring continues.' : 'No incidents have been recorded.'}</p>}</section>{selected ? <IncidentDetail key={selected.id} incident={selected} devices={devices} runbooks={state.runbooks ?? []} notifications={(state.notifications ?? []).filter((item) => item.incidentId === selected.id)} events={state.events.filter((event) => event.incidentId === selected.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))} approvals={approvals.filter((approval) => approval.incidentId === selected.id)} canManage={canManage} busy={busy} mutate={mutate} /> : <section className="ops-panel ops-empty"><span className="ops-empty-icon" aria-hidden="true">◎</span><h3>{selectedId?'Incident unavailable':'Ready for the next incident.'}</h3><p>Select a recorded incident to inspect its evidence and recovery.<br />Managers can inject a fault from Operational Scenarios.</p></section>}</div>}

    {state && view === 'admin' && <section className="ops-panel"><div className="ops-row"><div><span id="discovery" className="eyebrow">Controlled Discovery</span><h3>Review before enrolling.</h3><p>Scan the configured simulator network. Candidates are added to monitoring only after enrollment.</p></div>{canManage && <button disabled={busy} onClick={() => void mutate('/api/v2/discovery', { targets: 'simulator' }, 'Edge simulator discovery requested. Review candidates before enrollment.')}>Discover Edge Simulators</button>}</div><div className="ops-candidates">{state.discovery.map((candidate) => <article key={candidate.id}><div><strong>{candidate.name}</strong><code>{candidate.address}</code></div><Status value={candidate.status} />{canManage && candidate.status !== 'enrolled' && <button className="ops-button-secondary" disabled={busy} onClick={() => void mutate(`/api/v2/discovery/${encodeURIComponent(candidate.id)}/enroll`, {}, `${candidate.name} enrollment accepted.`)}>Enroll Candidate</button>}</article>)}</div>{state.discovery.length === 0 && <p className="ops-empty">No discovery candidates yet. An authorized manager can start a simulator scan.</p>}</section>}

    {state && view === 'admin' && <section className="ops-panel"><div className="ops-row"><div><span id="connectors" className="eyebrow">Connector Catalog</span><h3>One interface. Many possibilities.</h3><p>Implementation and verification status are shown for each entry. Planned integrations are roadmap items.</p></div><span className="ops-source">{connectors.length} catalog entries</span></div><div className="ops-catalog-filters"><label>Find an Integration<input type="search" placeholder="Search vendor or protocol…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((item) => <option key={item} value={item}>{human(item)}</option>)}</select></label><label>Verification Status<select value={connectorStatus} onChange={(event) => setConnectorStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{human(item)}</option>)}</select></label></div><p className="ops-footnote">Showing {visibleConnectors.length} of {connectors.length} entries</p><div className="ops-connector-grid">{visibleConnectors.map((connector) => <article key={connector.id}><span className="ops-caption">{human(connector.category)}</span><h4>{connector.name}</h4><Status value={connector.status} /></article>)}</div>{visibleConnectors.length === 0 && <p className="ops-empty">No integrations match these filters.</p>}</section>}
    {state&&view==='incidents'&&selected&&<EnterprisePanel state={state} mutate={mutate} canManage={canManage} {...enterprise} key={selected.id} section="incidents" incidentId={selected.id}/>}
    {enterprise.error&&<div role="alert" className="ops-alert ops-alert-error">{enterprise.error} <button onClick={()=>void enterprise.refresh()}>Retry advanced data</button></div>}
    <p className="ops-page-note">DeviceOps · Evidence-backed operations & incident resolution · Observations refresh every 3 seconds while this tab is visible.</p>

  </div></div>;
}
