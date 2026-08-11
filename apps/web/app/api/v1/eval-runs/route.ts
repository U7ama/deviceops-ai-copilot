import { createHash, randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { z } from 'zod';
import { withTenant } from '@deviceops/db';
import { hasMinimumRole } from '@deviceops/policy';
import { authenticate, json, problem, problemFromError, requestMetadata, requireMutationProtection } from '@/lib/http';

const EvalRequest = z.object({ name: z.string().trim().min(2).max(120), version: z.string().trim().min(1).max(40), cases: z.array(z.object({ externalId: z.string().trim().min(1).max(120), category: z.enum(['answerable', 'insufficient_evidence', 'adversarial', 'stale_status', 'tool_failure']), input: z.record(z.string(), z.unknown()), expected: z.record(z.string(), z.unknown()) }).strict()).min(1).max(200) }).strict();

export async function POST(request: Request) {
  const metadata = requestMetadata(request); const session = await authenticate(request);
  if (!session) return problem(401, 'UNAUTHORIZED', 'Authentication required', metadata);
  try {
    requireMutationProtection(request, session);
    if (!hasMinimumRole(session.user.role, 'manager')) return problem(403, 'EVAL_DENIED', 'Manager role is required', metadata);
    const parsed = EvalRequest.safeParse(await request.json());
    if (!parsed.success) return problem(400, 'INVALID_EVAL_DATASET', 'Evaluation dataset is invalid', metadata);
    const datasetId = randomUUID(); const evalRunId = randomUUID(); const commitSha = createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex');
    await withTenant({ tenantId: session.user.tenantId, userId: session.user.id }, async (transaction) => {
      await transaction`insert into eval_datasets (id, tenant_id, name, version, commit_sha) values (${datasetId}, ${session.user.tenantId}, ${parsed.data.name}, ${parsed.data.version}, ${commitSha})`;
      for (const item of parsed.data.cases) await transaction`insert into eval_cases (id, tenant_id, dataset_id, external_id, category, input, expected) values (${randomUUID()}, ${session.user.tenantId}, ${datasetId}, ${item.externalId}, ${item.category}, ${transaction.json(item.input as postgres.JSONValue)}, ${transaction.json(item.expected as postgres.JSONValue)})`;
      await transaction`insert into eval_runs (id, tenant_id, dataset_id, provider, model, config, state) values (${evalRunId}, ${session.user.tenantId}, ${datasetId}, ${process.env.AI_PROVIDER ?? 'mock'}, ${process.env.OPENAI_MODEL ?? 'deviceops-deterministic-mock-v1'}, ${transaction.json({ caseCount: parsed.data.cases.length, commitSha })}, 'queued')`;
    });
    return json({ evalRunId, datasetId, state: 'queued', caseCount: parsed.data.cases.length, commitSha }, metadata, 202);
  } catch (error) { return problemFromError(error, metadata); }
}

export async function GET(request: Request) {
  const metadata = requestMetadata(request); const session = await authenticate(request);
  if (!session) return problem(401, 'UNAUTHORIZED', 'Authentication required', metadata);
  try {
    const rows = await withTenant({ tenantId: session.user.tenantId, userId: session.user.id }, (transaction) => transaction<Array<{ id: string; provider: string; model: string; state: string; summary: unknown; started_at: string }>>`select id, provider, model, state, summary, started_at from eval_runs where tenant_id = ${session.user.tenantId} order by started_at desc limit 50`);
    return json({ evalRuns: rows.map((row) => ({ id: row.id, provider: row.provider, model: row.model, state: row.state, summary: row.summary, startedAt: row.started_at })) }, metadata);
  } catch (error) { return problemFromError(error, metadata); }
}
