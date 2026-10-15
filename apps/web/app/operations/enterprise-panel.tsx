'use client';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useCallback, useEffect, useRef, useState } from 'react';
import { UploadCloud, FileText, Image as ImageIcon, Shield, Cpu, Network, Radio, Settings, BookOpen, Activity, Search, Paperclip, TriangleAlert } from 'lucide-react';
import type { OperationsState, Mutation } from './types';
import { acousticSpectrumScript } from './analysis-presets';
import { human, timestamp, object } from './types';
import { cleanSummary } from './presentation';
import { useToast } from '../components/Toast';
type Point={at:string;value:number};
export type FeatureState={ topology:Array<{id:string;upstreamId:string;downstreamId:string}>; impact:Array<{deviceId:string;downstreamCount:number;criticalCount:number;unknownCount:number;requiresEscalation:boolean}>; controls:{stopped:boolean;detectorMode:string;replayVerified:boolean};
 anomalies:Array<{id:string;metric:string;unit:string;value:number;baseline:number;slope:number;observedAt:string;sourceMode:string;status:string;points:Point[]}>;
 baselines:Array<{id:string;metric:string;count:number;mean:number;unit:string;version:number}>;
 artifacts:Array<{id:string;incidentId:string;name:string;status:string;scan:string;pageCount:number;renderedPages?:number[];hasPreview:boolean;confirmedDeviceId:string|null;error?:string}>;
 analyses:Array<{id:string;incidentId:string;status:string;scriptHash:string;durationMs?:number;result?:{stdout?:string;stderr?:string;artifacts?:Array<{name:string;data:string}>};error?:string}>;
 memory:{retrievalMode:string;results:Array<{id:string;title:string;text:string;type:string;version:string;reviewStatus:string}>};providers:Record<string,string> };
function Sparkline({points}:{points:Point[]}) {
 const values=points.map(p=>p.value),min=Math.min(...values)-2,max=Math.max(...values)+2;
 return <svg viewBox="0 0 500 110" role="img" aria-label="Observed metric trend" style={{width:'100%',maxWidth:600}}><path d="M 10 100 H 490" stroke="var(--text-muted)"/><polyline fill="none" stroke="var(--text-muted)" strokeWidth="3" points={points.map((p,n)=>`${10+n*480/Math.max(1,points.length-1)},${100-(p.value-min)*90/(max-min)}`).join(' ')}/><text x="12" y="15" fontSize="12" fill="currentColor">{max.toFixed(1)}</text><text x="12" y="98" fontSize="12" fill="currentColor">{min.toFixed(1)}</text></svg>;
}

const SPECIALIST_INFO: Record<string, { role: string; description: string; telemetry: string }> = {
  network: {
    role: 'Network Specialist Sub-Agent',
    description: 'Analyzes reachability, topology links, switch port status (e.g. 0 vs 3 ports up), packet routing, and upstream outage dependencies.',
    telemetry: 'Ping, switch port status, topology relationships, link flap events'
  },
  system: {
    role: 'System Specialist Sub-Agent',
    description: 'Inspects application layer health, background services, daemon hangs, process responsiveness, and device authentication credentials.',
    telemetry: 'Application health, service states, auth tokens, memory utilization'
  },
  power: {
    role: 'Power & Thermal Specialist Sub-Agent',
    description: 'Monitors measured operating temperatures, voltage levels, power supply rails, and hardware thermal sensors for brownout anomalies.',
    telemetry: 'Temperature sensors, voltage inputs, hardware metrics'
  },
  critic: {
    role: 'Critic Supervisor Sub-Agent',
    description: 'Audits multi-agent hypotheses for contradictions, unsupported claims, evidence gaps, freshness, and escalation policy compliance.',
    telemetry: 'Cross-specialist audit, citation validation, escalation policies'
  }
};

export function EnterprisePanel({state,mutate,canManage,data,error,refresh,query,setQuery,section,incidentId}:{state:OperationsState;mutate:Mutation;canManage:boolean;data:FeatureState|null;error:string;refresh:()=>Promise<void>;query:string;setQuery:(q:string)=>void;section:'overview'|'fleet'|'incidents'|'knowledge'|'admin'|'demo';incidentId?:string}) {
 const { showToast } = useToast();
 const [localError,setError]=useState('');const incident=incidentId??'';
 const [focus,setFocus]=useState(state.devices[0]?.id??'');
 const [isDragging, setIsDragging] = useState(false);
 const fileInputRef = useRef<HTMLInputElement>(null);
 const [selected,setSelected]=useState<string[]>([]),[script,setScript]=useState("import csv, glob, statistics\nimport matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nrows=list(csv.DictReader(open(glob.glob('*.csv')[0])))\nvalues=[float(r['temperature']) for r in rows]\nprint({'samples':len(values),'mean':statistics.mean(values),'max':max(values)})\nplt.plot(values); plt.ylabel('Temperature C'); plt.xlabel('Sample')\nplt.savefig('exports/temperature.png')");
 async function action(path:string,body:Record<string,unknown>,message:string){await mutate(`/api/v2/${path}`,body,message);await refresh();}
 async function upload(file:File){try{if(!incident)throw new Error('Select an incident first');if(file.size>(file.type.startsWith('image/')?10:50)*1024*1024)throw new Error('File exceeds upload limit');const bytes=new Uint8Array(await file.arrayBuffer());const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');let binary='';for(let n=0;n<bytes.length;n+=32768)binary+=String.fromCharCode(...bytes.subarray(n,n+32768));const contentType=file.type|| (file.name.endsWith('.csv')?'text/csv':'text/plain');await action('artifacts',{incidentId:incident,name:file.name,contentType,sha256:hash,data:btoa(binary)},'Evidence quarantined for processing.');}catch(e){const msg=e instanceof Error?e.message:'Upload failed';setError(msg);showToast('error',msg);}}
 return <div className="ops-enterprise">{localError&&<p role="alert">{localError}</p>}
  {section==='admin'&&(<section className="ops-panel"><div className="ops-row"><div><span className="eyebrow">Automation settings</span><h3><Settings aria-hidden="true" />Operations controls</h3><p>Pause new automated operations or choose whether detected anomalies can trigger an investigation. Dispatched actions are not rolled back.</p></div>{canManage&&data&&<Button variant="outline" className="ops-button-secondary" onClick={()=>void action('enterprise/controls',{stopped:!data.controls.stopped},'Operations control updated.')}>{data.controls.stopped?'Resume operations':'Stop operations'}</Button>}</div>
  {data&&<p>{Object.entries(data.providers).map(([key,value])=>`${human(key)}: ${human(value)}`).join(' · ')}</p>}{(error||localError)&&<p role="alert">{localError||error}</p>}
  {canManage&&data&&<Button onClick={()=>void action('enterprise/controls',{detectorMode:data.controls.detectorMode==='trigger'?'observe':'trigger'},'Detector mode updated.')} disabled={!data.controls.replayVerified}>{data.controls.detectorMode==='trigger'?'Observe only':'Enable investigation triggers'}</Button>}</section>)}
  {section==='fleet'&&( <section className="ops-panel"><h3><Network aria-hidden="true" />Connected equipment</h3><p>Choose a device to see its known connections and potential downstream impact.</p>
  <label>Inspect Device<NativeSelect value={focus} onChange={e=>setFocus(e.target.value)}>{state.devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect></label>
  <svg viewBox={`0 0 640 ${Math.max(160,state.devices.length*70)}`} role="img" aria-label="Campus device dependency map" style={{width:'100%',maxWidth:720}}>
  {data?.topology.map(edge=>{const a=state.devices.findIndex(d=>d.id===edge.upstreamId),b=state.devices.findIndex(d=>d.id===edge.downstreamId);if(a<0||b<0)return null;return <line key={edge.id} x1={state.devices[a]?.kind==='switch'?155:465} y1={35+a*70} x2={state.devices[b]?.kind==='switch'?155:465} y2={35+b*70} stroke={edge.upstreamId===focus||edge.downstreamId===focus?'var(--primary)':'var(--border)'} strokeWidth="3"/>;})}
  {state.devices.map((d,n)=><g key={d.id}><rect x={d.kind==='switch'?10:320} y={10+n*70} width="290" height="50" rx="8" fill={d.id===focus?'var(--surface-secondary)':'var(--surface)'} stroke={d.health==='offline'||d.criticality==='critical'?'var(--danger)':'var(--border)'}/><text x={d.kind==='switch'?22:332} y={30+n*70} fontSize="13" fill="var(--text)">{d.name.slice(0,36)}</text><text x={d.kind==='switch'?22:332} y={49+n*70} fontSize="12" fill="var(--text-muted)">{d.health} · {d.criticality??'unclassified'} · {d.sourceMode}</text></g>)}
  </svg>
  {data?.impact.filter(i=>i.deviceId===focus).map(i=><p key={i.deviceId}>{i.downstreamCount} known downstream devices · {i.criticalCount} critical · {i.unknownCount} unknown impact · {i.requiresEscalation?'Backend policy blocks recovery; escalation required.':'Existing approval and freshness policies still apply.'}</p>)}
  <details className="ops-accordion"><summary>Stored Dependency Relationships</summary>{data?.topology.map(e=><p key={e.id}>{state.devices.find(d=>d.id===e.upstreamId)?.name??e.upstreamId} → {state.devices.find(d=>d.id===e.downstreamId)?.name??e.downstreamId}</p>)}{!data?.topology.length&&<p>No relationships recorded. Downstream impact is unknown.</p>}</details>
  {canManage&&<>{state.devices.find(d=>d.id===focus)?.sourceMode==='simulated'&&<label>Device Criticality Policy<NativeSelect value={state.devices.find(d=>d.id===focus)?.criticality??'unknown'} onChange={e=>void action(`devices/${focus}/policy`,{criticality:e.target.value,maintenanceUntil:state.devices.find(d=>d.id===focus)?.maintenanceUntil??null},'Device policy reviewed.')}><option value="standard">Standard</option><option value="critical">Critical</option><option value="unknown">Unknown</option></NativeSelect></label>}</>}
  </section>)}
  {section==='incidents'&&( <section className="ops-panel ops-specialists-panel" style={{ marginTop: '36px' }}>
    <div className="ops-row">
      <div>
        <span className="eyebrow">Multi-Agent System</span>
        <h3><Cpu aria-hidden="true" />Specialist findings</h3>
        <p>Network, system, and power specialists examine the evidence. A reviewer checks their findings for gaps and contradictions.</p>
      </div>
    </div>
    {state.events.filter(e=>e.type==="specialist.progress"&&e.incidentId===incident).length > 0 && (
      <div className="ops-agent-stream">
        {state.events.filter(e=>e.type==="specialist.progress"&&e.incidentId===incident).slice(-5).map(e=>{
          const rawStage = String(e.data.stage || 'specialist');
          const stageDisplay = ({
            specialist_finding: 'Specialist Finding',
            critic: 'Critic Review',
            investigation: 'Investigation',
          } as Record<string, string>)[rawStage] ?? human(rawStage);
          const rawHyp = object(e.data.result).hypothesis;
          const hyp = typeof rawHyp === 'string' ? cleanSummary(rawHyp) : '';
          return (
            <div key={e.id} className="ops-stream-item">
              <div className="ops-stream-meta">
                <span className="ops-stream-badge">{stageDisplay}</span>
                <span className="ops-stream-status">
                  <strong>{human(String(e.data.status))}</strong> · {timestamp(e.createdAt)}
                </span>
              </div>
              {hyp && <span className="ops-stream-hypothesis">— {hyp}</span>}
            </div>
          );
        })}
      </div>
    )}
    {state.incidents.filter(i=>i.id===incident).map(i=>{
      const envelope=object(i.diagnosis?.enterprise);
      const findings=Array.isArray(envelope.findings)?envelope.findings.map(object):[];
      return (
        <article key={i.id} style={{ display: 'grid', gap: '16px' }}>
          <div className="ops-incident-header-bar">
            <div className="ops-incident-header-info">
              <h4 style={{ margin: '0 0 6px', fontSize: '17px', fontWeight: 650, lineHeight: 1.4 }}>{cleanSummary(i.summary)}</h4>
              <small style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                Status: <strong style={{ color: 'var(--text)', textTransform: 'capitalize' }}>{human(i.status)}</strong> · Inference Provider: <strong style={{ color: 'var(--text)' }}>{String(i.diagnosis?.provider ?? 'Strands + Qwen')}</strong>
              </small>
            </div>
            {canManage && !['resolved', 'cancelled'].includes(i.status) && (
              <Button
                className="ops-button-secondary ops-cancel-investigation-btn"
                type="button"
                onClick={() => void action(`incidents/${i.id}/cancel`, {}, 'Cancellation recorded. Dispatched actions are not rolled back.')}
              >
                Cancel Investigation
              </Button>
            )}
          </div>

          {findings.length ? (
            <div className="ops-agent-grid">
              {findings.map((f, n) => {
                const rawSpec = String(f.specialist || 'specialist').toLowerCase();
                const specName = rawSpec.charAt(0).toUpperCase() + rawSpec.slice(1);
                const isNetwork = /network|switch|routing/i.test(rawSpec);
                const isHardware = /hardware|physical|acoustic|rack/i.test(rawSpec);
                const isOptics = /optic|laser|fiber|power/i.test(rawSpec);
                const Icon = isNetwork ? Network : isOptics ? Radio : isHardware ? Cpu : Shield;
                const uncertainty = String(f.uncertainty || '').toLowerCase();
                const confLevel = uncertainty.includes('low') || uncertainty.includes('none') ? 'high' : uncertainty.includes('medium') || uncertainty.includes('mod') ? 'medium' : 'low';
                const statusStr = human(String(f.status || 'evaluating'));
                const statusCap = statusStr.charAt(0).toUpperCase() + statusStr.slice(1);
                const info = SPECIALIST_INFO[rawSpec] ?? {
                  role: `${specName} Specialist Sub-Agent`,
                  description: 'Specialist AI sub-agent analyzing domain observations and evidence.',
                  telemetry: 'Domain telemetry, reachability, and anomaly baselines'
                };

                return (
                  <div key={n} className="ops-agent-card">
                    <div className="ops-agent-header">
                      <div className="ops-agent-identity">
                        <div
                          className="ops-agent-avatar ops-tooltip-trigger"
                          tabIndex={0}
                          role="region"
                          aria-label={`${info.role}: ${info.description}`}
                        >
                          <Icon size={20} />
                          <div className="ops-agent-tooltip" role="tooltip">
                            <div className="ops-agent-tooltip-header">
                              <Icon size={14} />
                              <strong>{info.role}</strong>
                            </div>
                            <p className="ops-agent-tooltip-body">{info.description}</p>
                            <div className="ops-agent-tooltip-footer">
                              <span className="ops-agent-tooltip-label">Telemetry Analyzed:</span>
                              <span className="ops-agent-tooltip-val">{info.telemetry}</span>
                            </div>
                          </div>
                        </div>
                        <div className="ops-agent-meta">
                          <strong>{specName}</strong>
                          <span className="ops-agent-tag">Specialist Sub-Agent</span>
                        </div>
                      </div>
                      <span className={`ops-confidence-pill ${confLevel}`}>
                        {statusCap}
                      </span>
                    </div>

                    <blockquote className="ops-agent-hypothesis">
                      {cleanSummary(String(f.hypothesis))}
                    </blockquote>

                    <div className="ops-agent-status-row">
                      <span>Uncertainty: <strong>{cleanSummary(String(f.uncertainty || 'Evaluated'))}</strong></span>
                    </div>

                    {Array.isArray(f.evidenceIds) && f.evidenceIds.length > 0 && (
                      <div>
                        <small style={{ fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>CITED EVIDENCE</small>
                        <div className="ops-evidence-pills">
                          {f.evidenceIds.map((id, idx)=>(
                            <span key={idx} className="ops-evidence-pill">
                              <Paperclip size={12} aria-hidden="true" /> {String(id)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {Array.isArray(f.gaps) && f.gaps.length > 0 && (
                      <p className="ops-missing-gaps">
                        <TriangleAlert size={14} aria-hidden="true" /> Missing observations: {f.gaps.map(g => cleanSummary(String(g))).join('; ')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="ops-empty">No specialist agent findings recorded for this investigation yet.</p>
          )}
        </article>
      );
    })}
  </section>)}
  {(section==='overview'||section==='demo')&&( <section className="ops-panel" id="anomalies"><div className="ops-row"><div><h3><Activity aria-hidden="true" />Unusual device readings</h3>{section==='demo'&&canManage&&<Button variant="outline" className="ops-button-secondary" onClick={()=>void action('enterprise/critical-demo',{},'Critical campus dependency scenario started.')}>Replay critical dependency drill</Button>}<p>Detector mode: {data?.controls.detectorMode??'loading'} · Telemetry replay: {data?.controls.replayVerified?'passed':'not verified'}</p></div>{canManage&&section==='demo'&&<div><Button variant="outline" className="ops-button-secondary" onClick={()=>void action('enterprise/replay',{},'Thermal drift telemetry replay completed.')}>Replay thermal drift telemetry</Button><Button variant="outline" className="ops-button-secondary" onClick={()=>void action('enterprise/replay',{metric:'opticalRxPower'},'Optical power attenuation telemetry replay completed.')}>Replay optical attenuation telemetry</Button>{data?.controls.replayVerified&&<Button variant="outline" className="ops-button-secondary" onClick={()=>void action('enterprise/controls',{detectorMode:data.controls.detectorMode==='trigger'?'observe':'trigger'},'Detector mode updated.')}>{data.controls.detectorMode==='trigger'?'Observe only':'Enable investigation triggers'}</Button>}</div>}</div>
  {data?.anomalies.slice(-6).reverse().map(a=><article key={a.id}><h4>{human(a.metric)}: {a.value.toFixed(1)} {a.unit}</h4><p>Baseline {a.baseline.toFixed(1)} {a.unit} · Trend {a.slope.toFixed(2)} / minute · {a.sourceMode} · {a.status}</p><Sparkline points={a.points}/><small>{timestamp(a.observedAt)} · Observed drift; failure time is not predicted.</small></article>)}
  {data && !data.anomalies.length && <p className="ops-empty">No unusual readings recorded. New detections will appear here.</p>}
  <details className="ops-accordion"><summary>Compare with normal readings</summary>{data && !data.baselines.length && <p>Not enough observations to establish normal readings yet.</p>}{data?.baselines.map(b=><p key={b.id}>{b.metric}: {b.mean.toFixed(2)} {b.unit} · {b.count} samples · version {b.version} · {b.count<48?'insufficient history':'warm'}</p>)}</details></section>)}
  {section==='incidents'&&Boolean(incident)&&(<section className="ops-panel">
    <div className="ops-row">
      <div>
        <span className="eyebrow">Physical &amp; Forensic Telemetry</span>
        <h3><FileText aria-hidden="true" />Evidence &amp; analysis</h3>
        <p>Upload photos, documents, or logs for this incident. Files are scanned before they can be used in an isolated analysis.</p>
      </div>
    </div>

    <div
      className={`ops-dropzone ${isDragging ? 'is-dragover' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void upload(f); }}
      onClick={() => fileInputRef.current?.click()}
      role="button"
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInputRef.current?.click(); } }}
      tabIndex={0}
      aria-label="Upload evidence files"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,application/pdf,.csv,.json,.txt"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
      />
      <UploadCloud size={36} className="ops-dropzone-icon" />
      <span className="ops-dropzone-title">Drag &amp; drop evidence files here, or click to browse</span>
      <span className="ops-dropzone-hint">Supports field photos (PNG, JPG up to 10MB), documents (PDF up to 50MB), telemetry CSVs, and logs</span>
    </div>

    <div className="ops-artifact-grid">
      {data?.artifacts.filter(a=>a.incidentId===incident).map(a=>(
        <div key={a.id} className="ops-artifact-card">
          <div className="ops-artifact-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {a.name.match(/\.(png|jpe?g)$/i) ? <ImageIcon size={18} className="ops-nav-icon" /> : <FileText size={18} className="ops-nav-icon" />}
              <strong className="ops-artifact-name">{a.name}</strong>
            </div>
            <div className="ops-artifact-badges">
              <span className={`ops-artifact-badge ${a.scan==='clean'?'is-clean':a.scan==='threat'?'is-threat':''}`}>
                {a.scan === 'clean' ? '✓ ClamAV Clean' : a.scan === 'threat' ? '⚠ Threat Detected' : `Scan: ${a.scan}`}
              </span>
              <span className="ops-artifact-badge">{a.status}</span>
            </div>
          </div>
          {a.pageCount > 0 && <small style={{ color: 'var(--text-muted)' }}>{a.pageCount} page{a.pageCount > 1 ? 's' : ''}</small>}
          {a.error && <p role="alert" style={{ color: 'var(--danger)', fontSize: '12px' }}>{a.error}</p>}
          {a.hasPreview && !a.renderedPages?.length && (
            <div className="ops-artifact-preview-container">
              <img alt={`Evidence preview: ${a.name}`} src={`/api/v2/artifacts/${a.id}/preview`} className="ops-artifact-preview" />
            </div>
          )}
          {a.renderedPages?.map(page=>(
            <figure key={page} style={{ margin: 0 }}>
              <div className="ops-artifact-preview-container">
                <img alt={`Evidence ${a.name}, page ${page}`} src={`/api/v2/artifacts/${a.id}/preview?page=${page}`} className="ops-artifact-preview" />
              </div>
              <figcaption style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>Document page {page} · citation {a.id}:page:{page}</figcaption>
            </figure>
          ))}
          {a.status==='ready' && (
            <div className="ops-artifact-footer">
              <label className="ops-checkbox-label">
                <input type="checkbox" checked={selected.includes(a.id)} onChange={e=>setSelected(e.target.checked?[...selected,a.id]:selected.filter(id=>id!==a.id))}/>
                <span>Include in isolated sandbox analysis</span>
              </label>
              <label className="ops-artifact-target-label">
                <span>Associated equipment target:</span>
                <NativeSelect
                  value={a.confirmedDeviceId??''}
                  onChange={e=>{if(e.target.value)void action(`artifacts/${a.id}/confirm`,{deviceId:e.target.value},'Device association confirmed.');}}
                  style={{ padding: '6px 10px', borderRadius: '6px' }}
                >
                  <option value="">Unconfirmed / general incident evidence</option>
                  {state.devices.filter(d=>state.incidents.find(i=>i.id===incident)?.deviceIds.includes(d.id)).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
                </NativeSelect>
              </label>
            </div>
          )}
        </div>
      ))}
    </div>
    {canManage && (
      <div className="ops-sandbox-container">
        <div className="ops-sandbox-header">
          <div className="ops-sandbox-dots">
            <span className="ops-sandbox-dot red" />
            <span className="ops-sandbox-dot yellow" />
            <span className="ops-sandbox-dot green" />
          </div>
          <span className="ops-sandbox-title">Sandboxed Python Analysis Runner</span>
          <div className="ops-sandbox-badges">
            <span className="ops-sandbox-badge">30s limit</span>
            <span className="ops-sandbox-badge">256 MiB</span>
            <span className="ops-sandbox-badge">No Network</span>
          </div>
        </div>
        <div className="ops-sandbox-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <Button variant="outline"
              className="ops-button-secondary"
              onClick={()=>{
                setScript(acousticSpectrumScript);
                const readyCsv = data?.artifacts.find(a => a.incidentId === incident && a.status === 'ready' && a.name.endsWith('.csv'));
                if (readyCsv) {
                  setSelected([readyCsv.id]);
                  showToast('success', `Loaded acoustic spectrum preset & selected ${readyCsv.name}.`);
                } else {
                  setSelected([]);
                  showToast('success','Loaded acoustic spectrum analysis Python preset.');
                }
              }}
            >
              Load Acoustic Spectrum Preset
            </Button>
            <Button variant="outline"
              className="ops-button-secondary"
              disabled={!selected.length}
              title={!selected.length ? 'Check "Include in isolated sandbox analysis" on a clean evidence file above to enable' : 'Run sandboxed Python analysis with selected evidence'}
              onClick={()=>void action('analyses',{incidentId:incident,artifactIds:selected,script},'Analysis queued in restricted sandbox.')}
            >
              Run Isolated Analysis ({selected.length} file{selected.length === 1 ? '' : 's'})
            </Button>
          </div>
          <p style={{ fontSize: '12px', margin: '4px 0', color: 'var(--text-muted)' }}>For acoustics, select exactly one waveform CSV with time_seconds, baseline_amplitude and observed_amplitude. Spectral peaks are observations, not diagnosed faults.</p>
          <details className="ops-accordion" open>
            <summary>Review the Python analysis script</summary>
            <label style={{ margin: '8px 0 0' }}>
              <Textarea aria-label="Python analysis" rows={8} value={script} onChange={e=>setScript(e.target.value)} style={{ width: '100%', fontFamily: 'monospace', fontSize: '12.5px' }} />
            </label>
          </details>
        </div>
      </div>
    )}
    {data?.analyses.filter(j=>j.incidentId===incident).map(j=><article key={j.id} style={{ marginTop: '12px', padding: '14px', background: 'var(--surface-secondary)', borderRadius: '8px' }}><h4>Analysis {human(j.status)}</h4><p>{j.error??j.result?.stdout?.slice(0,2000)??'Awaiting execution'}</p><details className="ops-accordion"><summary>Analysis Execution Details</summary><small>Script SHA-256 {j.scriptHash} · {j.durationMs??0} ms</small><pre>{j.result?.stdout}{j.result?.stderr}</pre></details>{j.result?.artifacts?.filter(a=>a.name.endsWith('.png')).map(a=><img key={a.name} alt={`Untrusted analysis chart ${a.name}`} src={`data:image/png;base64,${a.data}`} style={{maxWidth:'100%',maxHeight:300,borderRadius:'6px',marginTop:'8px'}}/>)}</article>)}
  </section>)}
  {section==='knowledge'&&(<section className="ops-panel">
    <div className="ops-row">
      <div>
        <span className="eyebrow">Institutional Memory</span>
        <h3><Search aria-hidden="true" />Search team knowledge</h3>
        <p>Retrieval mode: <strong>{human(data?.memory.retrievalMode ?? 'loading')}</strong> · Historical advice cannot override current evidence or policy.</p>
      </div>
    </div>
    <label style={{ display: 'block', margin: '20px 0 26px' }}>
      <span style={{ fontSize: '11.5px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block', marginBottom: '8px' }}>
        Search Incident History &amp; Reviewed Knowledge
      </span>
      <Input
        value={query}
        onChange={e=>setQuery(e.target.value)}
        placeholder="Search past incidents, runbooks, and failure signatures…"
        style={{ width: '100%', padding: '14px 18px', fontSize: '14px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--surface-secondary)', color: 'var(--text)', boxSizing: 'border-box' }}
      />
    </label>
    <div className="ops-memory-grid">
      {data?.memory.results.map(m=>(
        <div key={m.id} className="ops-memory-card">
          <div className="ops-memory-header">
            <span className="ops-memory-badge">{human(m.type)}</span>
            <span className="ops-memory-status">{human(m.reviewStatus)} · v{m.version}</span>
          </div>
          <h4>{cleanSummary(m.title)}</h4>
          <p>{cleanSummary(m.text)}</p>
          <small className="ops-memory-source">Source: {cleanSummary(m.id)}</small>
        </div>
      ))}
      {!data?.memory.results.length && (
        <p className="ops-empty">No matching records yet. Try a device name, symptom, or incident keyword.</p>
      )}
    </div>
  </section>)}
 </div>;
}
