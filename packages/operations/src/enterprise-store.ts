import type postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { transaction } from './store.js';
import { event, type State } from './domain.js';
import { attachAnomaly, observeMetric, detectorMetrics, defaultControls, memorySearch, dependencyImpact, type Baseline, type Anomaly } from './enterprise.js';
import type { SessionUser } from '@deviceops/contracts';

export async function featureRecords<T>(tx: postgres.TransactionSql, tenant: string, kind: string): Promise<T[]> {
  const rows = await tx<Array<{data: unknown}>>`select data from ops_enterprise where tenant_id=${tenant} and kind=${kind} order by updated_at desc limit 500`;
  return rows.map(r => r.data as T);
}
export async function putFeature(tx: postgres.TransactionSql, tenant: string, kind: string, value: {id: string}) {
  await tx`insert into ops_enterprise(tenant_id,kind,id,data) values(${tenant},${kind},${value.id},${tx.json(value as unknown as postgres.JSONValue)}) on conflict(tenant_id,kind,id) do update set data=excluded.data,updated_at=now() where ops_enterprise.data is distinct from excluded.data`;
}
export async function detectMetrics(tx: postgres.TransactionSql, tenant: string, s: State, now: number) {
  const baselines = new Map((await featureRecords<Baseline>(tx, tenant, 'baseline')).map(b => [b.id, b]));
  const changed = new Map<string, Baseline>();
  for (const observation of s.observations) {
    for (const metric of detectorMetrics) {
      const id = `${observation.deviceId}:${observation.source}:${metric}`;
      const result = observeMetric(baselines.get(id), observation, metric, now, { threshold: metric === 'opticalRxPower' ? s.devices.find(d=>d.id===observation.deviceId)?.opticalRxMinDbm : undefined });
      if (result.baseline) { baselines.set(id, result.baseline); changed.set(id, result.baseline); }
      if (result.anomaly) {
        attachAnomaly(s, result.anomaly, now);
        await putFeature(tx, tenant, 'anomaly', result.anomaly);
        event(s, 'anomaly.detected', { anomalyId: result.anomaly.id, metric, status: result.anomaly.status }, now, result.anomaly.incidentId);
      }
    }
  }
  for (const b of changed.values()) await putFeature(tx, tenant, 'baseline', b);
}
/** A deterministic replay gate, not a statistical accuracy benchmark. */
export function replayDetector(deviceId: string, source = 'synthetic-replay', metric: 'temperature' | 'opticalRxPower' = 'temperature') {
  let baseline: Baseline | undefined;
  const anomalies: Anomaly[] = [];
  const observations = [];
  const end = Date.now();
  for (let n = 0; n < 58; n++) {
    const at = end - (57 - n) * 30000;
    const observation = { id: randomUUID(), deviceId, source, sourceMode: 'simulated' as const,
      observedAt: new Date(at).toISOString(), receivedAt: new Date(at).toISOString(),
      reachability: 'reachable' as const, health: 'healthy' as const, auth: 'ok' as const,
      metrics: metric === 'temperature' ? { temperature: n < 48 ? 40 + (n % 2) * 0.1 : 40 + (n - 47) * 4, temperatureUnit: 'C' } : { opticalRxPower: n < 48 ? -3 + (n % 2) * 0.05 : -3 - (n - 47) * 0.8, opticalRxPowerUnit: 'dBm' } };
    const result = observeMetric(baseline, observation, metric, at);
    baseline = result.baseline ?? baseline; observations.push(observation);
    if (result.anomaly) anomalies.push(result.anomaly);
  }
  return { passed: anomalies.length > 0 && anomalies.every(a => Date.parse(a.observedAt) >= end - 9 * 30000), baseline: baseline!, anomalies, observations };
}
export async function enterpriseState(actor: SessionUser, query = 'service switch telemetry') {
  return transaction(actor.tenantId, actor.id, async (s, tx) => ({
    topology: s.topology,
    impact: s.devices.map(d => ({deviceId:d.id,...dependencyImpact(s,d.id)})),
    controls: s.controls ?? defaultControls(),
    baselines: await featureRecords<Baseline>(tx, actor.tenantId, 'baseline'),
    anomalies: await featureRecords<Anomaly>(tx, actor.tenantId, 'anomaly'),
    artifacts: (await featureRecords<Record<string, unknown>>(tx, actor.tenantId, 'artifact')).map(({storageKey, preview, pages, pagePreviews, ...record}) => ({...record, pageCount:Array.isArray(pages)?pages.length:0,hasPreview:Boolean(preview),renderedPages:Array.isArray(pagePreviews)?pagePreviews.map((p: {page:number})=>p.page):[]})),
    analyses: await featureRecords(tx, actor.tenantId, 'analysis'),
    memory: memorySearch(s, query),
    providers: { scanner: process.env.MEDIA_CLAMAV_HOST ? 'clamav' : 'fixture-allowlist', reasoning: process.env.OPS_AGENT_MODE ?? 'fixture', workflow: process.env.OPS_INVESTIGATION_WORKFLOW ?? 'single',
      runtime: process.env.STRANDS_TRANSPORT ?? 'http', sandbox: process.env.OPS_SANDBOX_PROVIDER ?? 'disabled', liveAccess: 'unverified' },
  }), true);
}
