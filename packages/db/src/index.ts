import { createHash, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgBoss } from "pg-boss";
import postgres, { type Sql } from "postgres";
import { stableJson, type RunEvent, type SessionUser } from "@deviceops/contracts";
import * as schema from "./schema.js";

let appClient: Sql | undefined;
let adminClient: Sql | undefined;
let boss: PgBoss | undefined;

export interface SessionContext {
  sessionId: string;
  kind: "web" | "mobile";
  csrfHash: string | null;
  user: SessionUser;
}

export function appSql(): Sql {
  appClient ??= postgres(required("DATABASE_URL"), {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false
  });
  return appClient;
}

export function adminSql(): Sql {
  adminClient ??= postgres(required("DATABASE_ADMIN_URL"), {
    max: 3,
    idle_timeout: 10,
    connect_timeout: 10,
    prepare: false
  });
  return adminClient;
}

export function appDb() {
  return drizzle(appSql(), { schema });
}

export function adminDb() {
  return drizzle(adminSql(), { schema });
}

export async function withTenant<T>(
  context: { tenantId: string; userId: string },
  operation: (transaction: postgres.TransactionSql) => Promise<T>
): Promise<T> {
  const result = await appSql().begin(async (transaction) => {
    await transaction`select set_config('app.tenant_id', ${context.tenantId}, true)`;
    await transaction`select set_config('app.user_id', ${context.userId}, true)`;
    return operation(transaction);
  });
  return result as T;
}

export async function queue(): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss({ connectionString: required("DATABASE_ADMIN_URL"), schema: "pgboss" });
    boss.on("error", (error: Error) => console.error(JSON.stringify({ event: "pgboss.error", error: error.message })));
    await boss.start();
  }
  return boss;
}

export async function closeDatabase(): Promise<void> {
  if (boss) await boss.stop({ graceful: true });
  if (appClient) await appClient.end({ timeout: 5 });
  if (adminClient) await adminClient.end({ timeout: 5 });
  boss = undefined;
  appClient = undefined;
  adminClient = undefined;
}

export async function appendRunEvent(
  transaction: postgres.TransactionSql,
  input: {
    tenantId: string;
    runId: string;
    type: RunEvent["type"];
    correlationId: string;
    data: Record<string, unknown>;
  }
): Promise<void> {
  await transaction`
    insert into run_events (id, tenant_id, run_id, type, correlation_id, data)
    values (${randomUUID()}, ${input.tenantId}, ${input.runId}, ${input.type}, ${input.correlationId}, ${transaction.json(input.data as unknown as postgres.JSONValue)})
  `;
}

export async function appendAuditEvent(
  transaction: postgres.TransactionSql,
  input: {
    tenantId: string;
    actorId: string | null;
    action: string;
    targetType: string;
    targetId: string | null;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  await transaction`select pg_advisory_xact_lock(hashtextextended(${input.tenantId}, 0))`;
  const [previous] = await transaction<Array<{ event_hash: string }>>`
    select event_hash from audit_events
    where tenant_id = ${input.tenantId}
    order by sequence desc limit 1
    for update
  `;
  const id = randomUUID();
  const occurredAt = new Date().toISOString();
  const eventHash = createHash("sha256")
    .update(
      stableJson({
        id,
        tenantId: input.tenantId,
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: input.metadata,
        previousHash: previous?.event_hash ?? null,
        occurredAt
      })
    )
    .digest("hex");
  await transaction`
    insert into audit_events
      (id, tenant_id, actor_id, action, target_type, target_id, metadata, previous_hash, event_hash, occurred_at)
    values
      (${id}, ${input.tenantId}, ${input.actorId}, ${input.action}, ${input.targetType}, ${input.targetId},
       ${transaction.json(input.metadata as unknown as postgres.JSONValue)}, ${previous?.event_hash ?? null}, ${eventHash}, ${occurredAt})
  `;
}

export async function findSessionContextByTokenHash(tokenHash: string): Promise<SessionContext | null> {
  const [row] = await adminSql()<
    Array<{
      session_id: string;
      kind: "web" | "mobile";
      csrf_hash: string | null;
      id: string;
      email: string;
      display_name: string;
      tenant_id: string;
      tenant_name: string;
      role: SessionUser["role"];
      demo_mode: boolean;
    }>
  >`
    select s.id as session_id, s.kind, s.csrf_hash,
           u.id, u.email, u.display_name, t.id as tenant_id, t.name as tenant_name,
           m.role, t.demo_mode
    from sessions s
    join users u on u.id = s.user_id
    join tenants t on t.id = s.tenant_id
    join memberships m on m.user_id = u.id and m.tenant_id = t.id
    where s.token_hash = ${tokenHash}
      and s.revoked_at is null
      and s.expires_at > now()
    limit 1
  `;
  if (!row) return null;
  return {
    sessionId: row.session_id,
    kind: row.kind,
    csrfHash: row.csrf_hash,
    user: {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        role: row.role,
        demoMode: row.demo_mode
      }
  };
}

export async function findSessionByTokenHash(tokenHash: string): Promise<SessionUser | null> {
  return (await findSessionContextByTokenHash(tokenHash))?.user ?? null;
}

export function vectorLiteral(vector: number[]): string {
  if (vector.length !== 1536 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Embedding must contain 1536 finite values");
  }
  return `[${vector.join(",")}]`;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
