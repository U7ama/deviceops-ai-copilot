import { describe, it, expect } from 'vitest';
import { createState, injectScenario, simulatorObservations, ingest, detect, applyDiagnosis, fixtureDiagnosis, executeSimulator } from './domain.js';
import { observeMetric, cancelIncident, memorySearch, relevantPages, dependencyImpact } from './enterprise.js';
import { replayDetector } from './enterprise-store.js';
const tenant = '00000000-0000-4000-8000-000000000009';
describe('enterprise safety and deterministic detection', () => {
  it('warms up on stable telemetry and detects sustained synthetic drift', () => {
    const replay = replayDetector(createState(tenant).devices[0]!.id);
    expect(replay.passed).toBe(true); expect(replay.anomalies.length).toBeGreaterThan(0);
    expect(replay.anomalies[0]!.reasons).toContain('ewma_deviation');
  });
  it('ignores duplicate, stale, missing and incompatible metric values', () => {
    const replay = replayDetector(createState(tenant).devices[0]!.id);
    const o = replay.observations.at(-1)!;
    expect(observeMetric(replay.baseline, o, 'temperature', Date.now())).toEqual({});
    expect(observeMetric(undefined, o, 'temperature', Date.now()+120000)).toEqual({});
    expect(observeMetric(undefined, {...o, metrics:{temperature:40, temperatureUnit:'unknown'}}, 'temperature', Date.now())).toEqual({});
    expect(observeMetric(undefined, {...o, metrics:{}}, 'temperature', Date.now())).toEqual({});
  });
  it('separates source baselines and freezes learning during detected drift', () => {
    const replay = replayDetector(createState(tenant).devices[0]!.id);
    expect(replay.baseline.mean).toBeLessThan(45);
    const result = observeMetric(undefined, {...replay.observations.at(-1)!, source:'cloud'}, 'temperature', Date.now());
    expect(result.baseline!.count).toBe(1); expect(result.anomaly).toBeUndefined();
  });
  it('kill switch and cancellation prevent queued simulator dispatch', () => {
    const now = Date.now(); const s = createState(tenant, now);
    injectScenario(s, 'service_hang', now);
    for(let n=1;n<=4;n++){ ingest(s,simulatorObservations(s,now+n*5000),now+n*5000); detect(s,now+n*5000); }
    const i=s.incidents[0]!; applyDiagnosis(s,i,fixtureDiagnosis(s,i),now+20000);
    expect(s.commands.length).toBe(1);
    cancelIncident(s,i.id,now+20000); executeSimulator(s,now+20000);
    expect(s.commands[0]!.status).toBe('failed'); expect(i.status).toBe('cancelled');
  });
  it('retrieves only published current sources from the supplied tenant state', () => {
    const s=createState(tenant); const other=createState('other');
    const id=s.runbooks[0]!.id; s.runbooks[0]!.deletedAt=new Date().toISOString();
    const result=memorySearch(s,'switch telemetry');
    expect(result.results.some(r=>r.id===id)).toBe(false);
    expect(result.results.some(r=>other.runbooks.some(b=>b.id===r.id))).toBe(false);
    expect(result.retrievalMode).toBe('lexical');
  });
});

describe('optical evidence and dependency impact', () => {
  it('detects falling optical power after warm-up without treating stable negative dBm as a fault', () => {
    const r=replayDetector('optical-device','synthetic-optical','opticalRxPower');
    expect(r.passed).toBe(true);expect(r.anomalies[0]!.slope).toBeLessThan(0);
    expect(r.anomalies[0]!.reasons).toContain('falling_trend');
    expect(r.baseline.mean).toBeGreaterThan(-4);
    expect(r.anomalies.every(a=>a.unit==='dBm')).toBe(true);
  });
  it('ranks a relevant manual page beyond page five and bounds excerpts', () => {
    const pages=Array.from({length:50},(_,n)=>({page:n+1,text:n===29?'Optical receiver attenuation inspection '+ 'x'.repeat(6000):'Copyright and contents'}));
    const result=relevantPages(pages,'optical receiver attenuation');
    expect(result[0]!.page).toBe(30);expect(result[0]!.citation).toBe('page:30');
    expect(result).toHaveLength(5);expect(result[0]!.text.length).toBeLessThanOrEqual(4000);
  });
  it('counts transitive dependencies once and blocks critical downstream recovery', () => {
    const now=Date.now(),s=createState(tenant,now),root=s.devices[0]!,leaf=s.devices[1]!;
    s.topology.push({id:'cycle',upstreamId:leaf.id,downstreamId:root.id});
    leaf.criticality='critical';const impact=dependencyImpact(s,root.id,now);
    expect(impact.downstreamCount).toBe(3);expect(impact.criticalCount).toBe(1);expect(impact.requiresEscalation).toBe(true);
    s.topology=s.topology.filter(e=>e.id!=='cycle');
    injectScenario(s,'switch_failure',now);
    for(let n=1;n<=4;n++){ingest(s,simulatorObservations(s,now+n*5000),now+n*5000);detect(s,now+n*5000);}
    const i=s.incidents.find(i=>i.rootDeviceId===root.id)!;
    applyDiagnosis(s,i,fixtureDiagnosis(s,i),now+20000);
    expect(i.status).toBe('escalated');expect(s.commands).toHaveLength(0);expect(s.approvals).toHaveLength(0);
  });
  it('escalates dangling or unclassified downstream dependencies', () => {
    const s=createState(tenant),root=s.devices[0]!;
    s.topology.push({id:'missing',upstreamId:root.id,downstreamId:'missing-device'});
    expect(dependencyImpact(s,root.id).unknownCount).toBe(1);
    delete s.devices[1]!.criticality;
    expect(dependencyImpact(s,root.id).unknownCount).toBe(2);
  });
});

 it('rechecks dependency policy immediately before dispatch', () => {
    const now=Date.now(),s=createState(tenant,now);
    injectScenario(s,'service_hang',now);
    for(let n=1;n<=4;n++){ingest(s,simulatorObservations(s,now+n*5000),now+n*5000);detect(s,now+n*5000);}
    const incident=s.incidents[0]!;applyDiagnosis(s,incident,fixtureDiagnosis(s,incident),now+20000);
    expect(s.commands).toHaveLength(1);
    const leaf=s.devices[1]!;leaf.criticality='critical';
    s.topology.push({id:'new-dependency',upstreamId:incident.rootDeviceId,downstreamId:leaf.id});
    executeSimulator(s,now+20000);expect(s.commands[0]!.status).toBe('failed');
 });
