'use client';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { EnterprisePanel } from './enterprise-panel';
import { IncidentDetail, Status } from './incident-detail';
import type { OperationsState, OperationUser } from './types';
import { human, timestamp } from './types';
import { views, readLocation, isStale, healthLabel, cleanSummary, type View } from './presentation';
import { useEnterprise } from './use-enterprise';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Activity, CheckCircle2, TriangleAlert, Clock3, ArrowRight, Radar, FlaskConical } from 'lucide-react';
import { LayoutDashboard, Siren, Network, ShieldCheck, BookOpen, Settings, ChevronRight } from 'lucide-react';
import { useToast } from '../components/Toast';

const labels:Record<View,string>={overview:'Overview',incidents:'Incidents',fleet:'Rooms & Equipment',approvals:'Approvals',knowledge:'Knowledge',admin:'Administration'};
const descriptions:Record<View,string>={overview:'Your fleet at a glance. See what needs attention and choose your next step.',incidents:'Choose an incident, inspect the findings, and review the proposed recovery.',fleet:'Find equipment by name or room, check its health, and explore connected devices.',approvals:'Review proposed operations before they run. Each decision stays linked to its incident.',knowledge:'Find reviewed troubleshooting guides and turn incident reports into reusable knowledge.',admin:'Manage discovery, integrations, and the controls that govern automated operations.'};
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

  return <WorkspaceLayout currentView={view} onSelectView={setView} user={user} pageTitle={labels[view]} pageDescription={descriptions[view]} pageHeaderAction={<span className="workspace-sync"><span className={`ops-live-dot ${syncError ? 'ops-live-off' : ''}`} aria-hidden="true" />{syncedAt ? `Updated ${timestamp(syncedAt)}` : 'Connecting…'}</span>}>
    {enterprise.data?.controls.stopped&&<div className="ops-alert ops-alert-error" role="alert">Operations are stopped. Dispatched actions are not rolled back. <Button onClick={()=>setView('admin')}>View controls</Button></div>}



    {error && (
      <div className="ops-alert ops-alert-error" role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <span>{error}</span>
        <Button variant="ghost"
          type="button"
          className="ops-inline-button"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.25rem', padding: '0 0.5rem', lineHeight: 1, color: 'inherit' }}
          onClick={() => setError('')}
          aria-label="Dismiss error"
        >
          &times;
        </Button>
      </div>
    )}
    {syncError && <div className="ops-alert ops-alert-error" role="alert">Updates interrupted: {syncError} Displayed data may be stale. <Button variant="ghost" className="ops-inline-button" onClick={() => void refresh()}>Retry refresh</Button></div>}
    {message && (
      <div
        ref={alertRef}
        className="ops-alert"
        role="status"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}
      >
        <span>{message}</span>
        <Button variant="ghost"
          type="button"
          className="ops-inline-button"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.25rem', padding: '0 0.5rem', lineHeight: 1, color: 'inherit' }}
          onClick={() => setMessage('')}
          aria-label="Dismiss notification"
        >
          &times;
        </Button>
      </div>
    )}

    {view === 'overview' && <section className="ops-stats" aria-label="Operations overview">
      <Card className="metric-card"><CardHeader><CardDescription>Monitored devices</CardDescription><Activity size={16} aria-hidden="true" /></CardHeader><CardContent><strong>{state ? devices.length : '—'}</strong><p>{devices.filter(device => device.sourceMode === 'simulated').length} simulated devices</p></CardContent></Card>
      <Card className="metric-card"><CardHeader><CardDescription>Recent updates</CardDescription><CheckCircle2 size={16} aria-hidden="true" /></CardHeader><CardContent><strong>{state ? devices.filter(device => !isStale(device)).length : '—'}</strong><p>Devices with current observations</p></CardContent></Card>
      <Card className="metric-card"><Button variant="ghost" className="metric-action" onClick={() => showIncidents()}><CardHeader><CardDescription>Open incidents</CardDescription><TriangleAlert size={16} aria-hidden="true" /></CardHeader><CardContent><strong>{state ? active.length : '—'}</strong><p>Select to investigate the cause</p></CardContent></Button></Card>
      <Card className="metric-card"><Button variant="ghost" className="metric-action" onClick={() => showIncidents(waiting[0]?.incidentId)}><CardHeader><CardDescription>Pending approvals</CardDescription><Clock3 size={16} aria-hidden="true" /></CardHeader><CardContent><strong>{state ? waiting.length : '—'}</strong><p>Select to review a proposed action</p></CardContent></Button></Card>
    </section>}



    {!state && !syncError && <div className="ops-panel ops-empty" aria-busy="true">Loading fleet observations and incidents…</div>}
    {state&&<>
      {view === 'overview' && (
        <>
        <section className="overview-guidance" aria-label="Recommended next step">
          <span className="guidance-icon"><ShieldCheck size={24} aria-hidden="true" /></span>
          <div className="guidance-copy"><h2>{waiting.length ? 'A recovery proposal needs your review' : active.length ? 'Start with the open incidents' : 'Your incident queue is clear'}</h2><p>{waiting.length ? `${waiting.length} pending proposal${waiting.length === 1 ? '' : 's'}. Check the evidence and expected impact before deciding.` : active.length ? `${active.length} open incident${active.length === 1 ? '' : 's'}. Review the findings to understand what needs attention.` : 'Check equipment health and recent observations to see how your fleet is doing.'}</p></div>
          <Button onClick={()=>waiting.length ? showIncidents(waiting[0]?.incidentId) : active.length ? showIncidents(active[0]?.id) : setView('fleet')}>{waiting.length ? 'Review proposal' : active.length ? 'Investigate incident' : 'View equipment'}<ArrowRight size={16} aria-hidden="true" /></Button>
        </section>
        <div className="overview-links">
          <Button variant="outline" className="overview-link" onClick={()=>setView('fleet')}><Network aria-hidden="true" /><span><strong>Check equipment</strong><small>Find a room or device and inspect its latest observations.</small></span></Button>
          <Button variant="outline" className="overview-link" onClick={()=>setView('approvals')}><ShieldCheck aria-hidden="true" /><span><strong>Review approvals</strong><small>See proposed operations and make an informed decision.</small></span></Button>
          <Button variant="outline" className="overview-link" onClick={()=>setView('knowledge')}><BookOpen aria-hidden="true" /><span><strong>Find a troubleshooting guide</strong><small>Search reviewed runbooks and previous incident findings.</small></span></Button>
        </div>
        <div className="overview-panels"><section className="ops-panel">
          <h3><TriangleAlert aria-hidden="true" />Needs Attention</h3>
          <p>Open incidents that need investigation, a decision, or escalation.</p>
          <div className="ops-demo-grid">
            {active.map(i => (
              <Button variant="outline" className="ops-button-secondary" key={i.id} onClick={() => showIncidents(i.id)}>
                <Status value={i.status} />
                <strong>{cleanSummary(i.summary)}</strong>
                <span className="incident-card-footer"><span>{i.deviceIds.length} affected device{i.deviceIds.length === 1 ? '' : 's'}</span><b>View incident<ArrowRight size={14} aria-hidden="true" /></b></span>
              </Button>
            ))}
          </div>
          {!active.length && <p>No open incidents. Monitoring continues.</p>}

          </section><section className="ops-panel"><h3><CheckCircle2 aria-hidden="true" />Recent Recoveries</h3>
          <p className="ops-footnote">Recovery confirmed by device observations.</p>
          <div className="ops-recovery-list">
            {incidents.filter(i => i.status === 'resolved').slice(0, 5).map(i => (
              <Button variant="ghost"
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
              </Button>
            ))}
            {!incidents.some(i => i.status === 'resolved') && (
              <p className="ops-empty">No recoveries recorded yet. Resolved incidents will appear here.</p>
            )}
          </div>
        </section></div></>
      )}
      {view==='approvals'&&<section className="ops-panel"><h3><ShieldCheck aria-hidden="true" />Proposed operations</h3><p>Open an incident to review the evidence, target device, and exact action before approving or rejecting.</p>{approvals.map(a=><article className="ops-approval" key={a.id}><Status value={a.status==='pending'&&Date.parse(a.expiresAt)<=Date.now()?'expired':a.status}/><h4>{human(a.name)}</h4><p>{devices.find(d=>d.id===a.targetDeviceId)?.name??a.targetDeviceId}</p><Button onClick={()=>showIncidents(a.incidentId)}>Review incident and proposal</Button></article>)}{!approvals.length&&<p>No operational proposals recorded.</p>}</section>}
      {view==='knowledge'&&(
        <section className="ops-panel">
          <div className="ops-row">
            <div>
              <span className="eyebrow">Institutional Knowledge</span>
              <h3><BookOpen aria-hidden="true" />Reviewed Runbooks</h3>
              <p>Step-by-step troubleshooting guides reviewed by your team.</p>
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
            <h3 style={{ margin: '4px 0 6px' }}>Incident Reports Pending approvals</h3>
            <p className="ops-footnote" style={{ margin: 0 }}>
              Completed investigations with drafted reports ready for manager evaluation and approval.
            </p>
          </div>

          <div className="ops-recovery-list">
            {incidents.filter(i=>i.report).map(i=>{
              const summaryText = cleanSummary(i.summary || i.cause);
              return (
                <Button variant="ghost"
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
                </Button>
              );
            })}
            {!incidents.some(i=>i.report) && (
              <p className="ops-empty">No incident reports awaiting review at this time.</p>
            )}
          </div>
        </section>
      )}
    {(view === 'overview' || view === 'incidents') && (
      <>
        <div className="ops-workspace-bar">
          <p>Practice a recovery workflow with simulated devices.</p>
          {canManage && (
            <Button variant="outline"
              id="ops-toggle-scenarios"
              className="ops-button-secondary"
              aria-expanded={showDemo}
              aria-controls="ops-demo-controls"
              onClick={() => setShowDemo(!showDemo)}
            >
              <FlaskConical size={16} aria-hidden="true" />{showDemo ? 'Hide Scenarios' : 'Operational Scenarios'}
            </Button>
          )}
        </div>
        {showDemo && canManage && (
          <section ref={demoRef} id="ops-demo-controls" className="ops-panel ops-demo">
            <div className="ops-row">
              <div>
                <h3>Practice incident recovery</h3>
                <p>Choose a scenario to see detection, investigation, and recovery using simulated equipment.</p>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Button variant="outline" className="ops-button-secondary" disabled={busy || !state} onClick={() => setResetReady(true)}>Reset Environment</Button>
                <Button variant="outline" className="ops-button-secondary" type="button" onClick={() => setShowDemo(false)} aria-label="Close scenarios">✕ Close</Button>
              </div>
            </div>
            {resetReady && (
              <div className="ops-alert" role="alert">
                <p>Resetting the simulation environment will reconcile pending actions and restore baseline operations. Continue?</p>
                <Button disabled={busy} onClick={() => { setResetReady(false); setShowDemo(false); void mutate('/api/v2/demo', { scenario: 'reset' }, 'Environment reset requested.'); }}>Confirm Environment Reset</Button>
                <Button variant="outline" className="ops-button-secondary" onClick={() => setResetReady(false)}>Cancel</Button>
              </div>
            )}
            <div className="ops-demo-grid">
              {scenarios.map((scenario) => (
                <Button
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
                </Button>
              ))}
            </div>
          </section>
        )}
      </>
    )}
      {(view==='overview'||view==='fleet'||view==='knowledge'||view==='admin')&&<EnterprisePanel state={state} mutate={mutate} canManage={canManage} {...enterprise} section={view}/>}
    </>}
    {state && view === 'fleet' && <section className="ops-panel"><div className="ops-row"><div><span className="eyebrow">Fleet Health</span><h3><Network aria-hidden="true" />Equipment health</h3><p>Search by room or device. Health, connectivity, and sign-in status are shown separately.</p></div></div><div className="ops-toolbar"><div className="ops-toolbar-search"><Input aria-label="Search rooms or equipment" type="search" placeholder="Search rooms or equipment…" value={fleetQuery} onChange={e=>setFleetQuery(e.target.value)}/></div><div className="ops-toolbar-filter"><NativeSelect aria-label="Equipment filter" value={fleetFilter} onChange={(event) => setFleetFilter(event.target.value)}><option value="all">All Devices</option><option value="attention">Needs Attention</option><option value="online">Operational</option><option value="unreachable">Unreachable</option><option value="auth">Authentication Failed</option><option value="conflict">Source Conflict</option><option value="stale">Stale / No Observation</option><option value="simulated">Simulated Only</option><option value="live">Live Connector Only</option></NativeSelect></div></div><div className="ops-table-scroll"><Table className="ops-table"><TableHeader><TableRow><TableHead>Device / location</TableHead><TableHead>Health</TableHead><TableHead>Reachability</TableHead><TableHead>Authentication</TableHead><TableHead>Last observation</TableHead><TableHead>Source</TableHead></TableRow></TableHeader><TableBody>{devices.filter(device=>`${device.name} ${device.room}`.toLowerCase().includes(fleetQuery.toLowerCase())).filter((device) => fleetFilter==='all'||(fleetFilter==='online'?device.health==='online':fleetFilter==='attention'?device.health!=='online':fleetFilter==='unreachable'?device.reachability==='unreachable':fleetFilter==='auth'?device.auth==='failed':fleetFilter==='conflict'?device.conflict:fleetFilter==='stale'?isStale(device):device.sourceMode===fleetFilter)).map((device) => <TableRow key={device.id}><TableCell><strong>{device.name}</strong><small>{device.room} · {human(device.kind)}</small>{Boolean(Object.keys(device.metrics ?? {}).length) && <details className="ops-accordion"><summary>Measurements</summary><pre>{JSON.stringify(device.metrics, null, 2)}</pre></details>}</TableCell><TableCell><span className="ops-status">{healthLabel(device.health)}</span>{device.maintenanceUntil&&<small>Maintenance until {timestamp(device.maintenanceUntil)}</small>}{device.conflict && <small className="ops-conflict">Source conflict</small>}</TableCell><TableCell>{human(device.reachability)}</TableCell><TableCell>{human(device.auth)}</TableCell><TableCell><time dateTime={device.observedAt ?? undefined}>{timestamp(device.observedAt)}</time>{device.observedAt&&isStale(device)&&<small>Stale observation</small>}</TableCell><TableCell><span className="ops-source">{device.sourceMode === 'simulated' ? 'Simulated' : device.sourceMode === 'live' ? 'Live connector' : 'Unknown'}</span></TableCell></TableRow>)}</TableBody></Table></div>{devices.length === 0 && <p className="ops-empty">No enrolled devices. Discover simulator candidates to get started.</p>}</section>}

    {state && view === 'incidents' && <div className="ops-incident-grid"><section className="ops-panel ops-incident-list"><div className="ops-row"><h3>Incidents</h3><label className="ops-filter"><span className="ops-sr-only">Incident filter</span><NativeSelect value={incidentFilter} onChange={(event) => setIncidentFilter(event.target.value)}><option value="active">Open</option><option value="all">All incidents</option></NativeSelect></label></div><div className="ops-incident-items">{displayedIncidents.map((incident) => <Button variant="outline" key={incident.id} className={selected?.id === incident.id ? 'is-selected' : ''} aria-pressed={selected?.id === incident.id} onClick={() => navigate('incidents',incident.id)}><div className="ops-row"><Status value={incident.status} /><small>{human(incident.severity)}</small></div><strong>{cleanSummary(incident.summary)}</strong><span>{incident.deviceIds.length} affected device{incident.deviceIds.length === 1 ? '' : 's'} · {timestamp(incident.createdAt)}</span></Button>)}</div>{displayedIncidents.length === 0 && <p className="ops-empty">{incidentFilter === 'active' ? 'No open incidents. Monitoring continues.' : 'No incidents have been recorded.'}</p>}</section>{selected ? <IncidentDetail key={selected.id} incident={selected} devices={devices} runbooks={state.runbooks ?? []} notifications={(state.notifications ?? []).filter((item) => item.incidentId === selected.id)} events={state.events.filter((event) => event.incidentId === selected.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))} approvals={approvals.filter((approval) => approval.incidentId === selected.id)} canManage={canManage} busy={busy} mutate={mutate} /> : <section className="ops-panel ops-empty"><Siren size={32} aria-hidden="true" style={{margin: '0 auto 12px', color: 'var(--primary)'}} /><h3>{selectedId?'Incident unavailable':'Choose an incident'}</h3><p>Select an incident from the list to review its findings and proposed actions.<br />Managers can use Operational Scenarios to practice a simulated workflow.</p></section>}</div>}

    {state && view === 'admin' && <section className="ops-panel"><div className="ops-row"><div><span id="discovery" className="eyebrow">Controlled Discovery</span><h3><Radar aria-hidden="true" />Discover equipment</h3><p>Scan the configured simulator network, then review each device before adding it to monitoring.</p></div>{canManage && <Button disabled={busy} onClick={() => void mutate('/api/v2/discovery', { targets: 'simulator' }, 'Edge simulator discovery requested. Review candidates before enrollment.')}>Discover Edge Simulators</Button>}</div><div className="ops-candidates">{state.discovery.map((candidate) => <article key={candidate.id}><div><strong>{candidate.name}</strong><code>{candidate.address}</code></div><Status value={candidate.status} />{canManage && candidate.status !== 'enrolled' && <Button variant="outline" className="ops-button-secondary" disabled={busy} onClick={() => void mutate(`/api/v2/discovery/${encodeURIComponent(candidate.id)}/enroll`, {}, `${candidate.name} enrollment accepted.`)}>Enroll Candidate</Button>}</article>)}</div>{state.discovery.length === 0 && <p className="ops-empty">No discovery candidates yet. An authorized manager can start a simulator scan.</p>}</section>}

    {state && view === 'admin' && <section className="ops-panel"><div className="ops-row"><div><span id="connectors" className="eyebrow">Connector Catalog</span><h3><Settings aria-hidden="true" />Available integrations</h3><p>Find a vendor or protocol and check its readiness. Planned integrations are not available for live use.</p></div><span className="ops-source">{connectors.length} catalog entries</span></div><div className="ops-catalog-filters"><label>Find an Integration<Input type="search" placeholder="Search vendor or protocol…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label>Category<NativeSelect value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((item) => <option key={item} value={item}>{human(item)}</option>)}</NativeSelect></label><label>Verification Status<NativeSelect value={connectorStatus} onChange={(event) => setConnectorStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{human(item)}</option>)}</NativeSelect></label></div><p className="ops-footnote">Showing {visibleConnectors.length} of {connectors.length} entries</p><div className="ops-connector-grid">{visibleConnectors.map((connector) => <article key={connector.id}><span className="ops-caption">{human(connector.category)}</span><h4>{connector.name}</h4><Status value={connector.status} /></article>)}</div>{visibleConnectors.length === 0 && <p className="ops-empty">No integrations match these filters.</p>}</section>}
    {state&&view==='incidents'&&selected&&<EnterprisePanel state={state} mutate={mutate} canManage={canManage} {...enterprise} key={selected.id} section="incidents" incidentId={selected.id}/>}
    {enterprise.error&&<div role="alert" className="ops-alert ops-alert-error">{enterprise.error} <Button onClick={()=>void enterprise.refresh()}>Retry advanced data</Button></div>}
    {view === 'overview' && state && <details className="ops-accordion runtime-disclosure"><summary><Settings size={16} aria-hidden="true" />Investigation mode &amp; usage budget</summary><Card className="runtime-card"><CardHeader><CardDescription>Configured investigation mode</CardDescription><CardTitle>{({ fixture: 'Deterministic fixture', bedrock: 'Strands + Amazon Bedrock', qwen: 'Strands + Alibaba Qwen', gemini: 'Strands + Google Gemini' } as Record<string, string>)[state.mode] ?? human(state.mode)}</CardTitle></CardHeader><CardContent><p>{state.mode === 'fixture' ? 'Reproducible local workflow. No live AI reasoning is claimed in fixture mode.' : 'Configured provider; incident evidence records identify the reasoning used for each investigation.'}</p><div className="runtime-budget"><span>Model budget</span><strong>{currency(budget?.spentUsd ?? 0)} / {currency(budget?.limitUsd ?? 0)}</strong></div><div className="ops-budget-track" role="progressbar" aria-label="Model budget used and reserved" aria-valuenow={budgetPercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${budgetPercent}%` }} /></div><small>{currency(budget?.reservedUsd ?? 0)} reserved for active invocations</small></CardContent></Card></details>}
    <p className="ops-page-note">DeviceOps · Evidence-backed operations & incident resolution · Observations refresh every 3 seconds while this tab is visible.</p>

  </WorkspaceLayout>;
}
