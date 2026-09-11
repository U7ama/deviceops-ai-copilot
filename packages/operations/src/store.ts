import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { adminSql, withTenant } from "@deviceops/db";
import { createState, type State, type OpsEvent } from "./domain.js";
export const SERVICE_ID = "00000000-0000-4000-8000-000000000001";
const groups = [
  "devices",
  "observations",
  "incidents",
  "approvals",
  "commands",
  "runbooks",
  "topology",
  "discovery",
] as const;
export async function readState(
  tx: postgres.TransactionSql,
  tenantId: string,
  now = Date.now(),
): Promise<State> {
  await tx`select pg_advisory_xact_lock(hashtextextended(${`ops:${tenantId}`},0))`;
  const rows = await tx<
    Array<{ kind: string; id: string; data: Record<string, unknown> }>
  >`select kind,id,data from ops_records where tenant_id=${tenantId}`;
  const meta = rows.find((r) => r.kind === "meta");
  if (!meta) {
    const initial = createState(tenantId, now);
    await saveState(tx, tenantId, initial);
    return initial;
  }
  const s = { ...meta.data, events: [] } as unknown as State;
  for (const group of groups)
    (s[group] as unknown[]) = rows
      .filter((r) => r.kind === group)
      .map((r) => r.data);
  s.observations.sort(
    (a, b) =>
      a.observedAt.localeCompare(b.observedAt) ||
      a.receivedAt.localeCompare(b.receivedAt) ||
      a.id.localeCompare(b.id),
  );
  return s;
}
export async function saveState(
  tx: postgres.TransactionSql,
  tenantId: string,
  s: State,
) {
  const { events, ...rest } = s;
  const meta = Object.fromEntries(
    Object.entries(rest).filter(
      ([k]) => !groups.includes(k as (typeof groups)[number]),
    ),
  );
  await tx`insert into ops_records(tenant_id,kind,id,data) values(${tenantId},'meta','meta',${tx.json(meta as postgres.JSONValue)}) on conflict(tenant_id,kind,id) do update set data=excluded.data,updated_at=now() where ops_records.data is distinct from excluded.data`;
  for (const group of groups) {
    if (s[group].length)
      await tx`insert into ops_records(tenant_id,kind,id,data) select ${tenantId}::uuid,${group},item->>'id',item from jsonb_array_elements(${tx.json(s[group] as unknown as postgres.JSONValue)}::jsonb) as item on conflict(tenant_id,kind,id) do update set data=excluded.data,updated_at=now() where ops_records.data is distinct from excluded.data`;
    if (group === "observations") {
      const ids = s.observations.map((o) => o.id);
      await tx`delete from ops_records where tenant_id=${tenantId} and kind='observations' and not(id=any(${ids}::text[]))`;
    }
  }
  for (const e of events) {
    await tx`insert into ops_events(id,tenant_id,incident_id,type,data,created_at) values(${e.id},${tenantId},${e.incidentId},${e.type},${tx.json(e.data as postgres.JSONValue)},${e.createdAt}) on conflict(id) do nothing`;
    if (e.type === "report.drafted") {
      const i = s.incidents.find((i) => i.id === e.incidentId);
      if (i)
        await tx`insert into ops_notifications(id,tenant_id,incident_id,payload) values(${randomUUID()},${tenantId},${i.id},${tx.json({ incidentId: i.id, summary: i.summary, status: i.status, report: i.report } as postgres.JSONValue)}) on conflict(tenant_id,incident_id) do update set id=excluded.id,payload=excluded.payload,state='queued',attempts=0,available_at=now(),lease_until=null,last_error=null`;
    }
  }
}
export async function transaction<T>(
  tenantId: string,
  actorId: string,
  fn: (s: State, tx: postgres.TransactionSql) => Promise<T> | T,
  readOnly = false,
): Promise<T> {
  return withTenant({ tenantId, userId: actorId }, async (tx) => {
    const s = await readState(tx, tenantId);
    const result = await fn(s, tx);
    if (!readOnly) await saveState(tx, tenantId, s);
    return result;
  });
}
export async function eventsFor(
  tenantId: string,
  actorId: string,
  after = "0",
): Promise<Array<OpsEvent & { sequence: string }>> {
  return withTenant(
    { tenantId, userId: actorId },
    async (tx) =>
      await tx<
        Array<OpsEvent & { sequence: string }>
      >`select id,incident_id as "incidentId",type,data,created_at as "createdAt",sequence::text from ops_events where tenant_id=${tenantId} and sequence>${after}::bigint order by sequence limit 500`,
  );
}
export async function budget() {
  const db = adminSql();
  await db`insert into ops_budget(id,limit_usd) values('bedrock',${Number(process.env.OPS_MODEL_BUDGET_USD ?? 6)}) on conflict(id) do nothing`;
  const [b] = await db<
    Array<{ spentUsd: number; reservedUsd: number; limitUsd: number }>
  >`select spent_usd::float8 as "spentUsd", reserved_usd::float8 as "reservedUsd",limit_usd::float8 as "limitUsd" from ops_budget where id='bedrock'`;
  return b!;
}
