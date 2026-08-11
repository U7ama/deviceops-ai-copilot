import { withTenant } from '@deviceops/db';
import { authenticate, json, problem, problemFromError, requestMetadata } from '@/lib/http';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const metadata = requestMetadata(request); const session = await authenticate(request);
  if (!session) return problem(401, 'UNAUTHORIZED', 'Authentication required', metadata);
  try {
    const { id } = await context.params;
    const result = await withTenant({ tenantId: session.user.tenantId, userId: session.user.id }, async (transaction) => {
      const [run] = await transaction<Array<{ id: string; provider: string; model: string; state: string; summary: unknown; started_at: string; completed_at: string | null }>>`select id, provider, model, state, summary, started_at, completed_at from eval_runs where tenant_id = ${session.user.tenantId} and id = ${id}`;
      if (!run) return null;
      const results = await transaction<Array<{ eval_case_id: string; retrieval_hit_at_5: boolean; abstention_correct: boolean; schema_valid: boolean; citation_valid: boolean; latency_ms: number; cost_usd: string }>>`select eval_case_id, retrieval_hit_at_5, abstention_correct, schema_valid, citation_valid, latency_ms, cost_usd from eval_results where tenant_id = ${session.user.tenantId} and eval_run_id = ${id} order by created_at asc`;
      return { run, results };
    });
    if (!result) return problem(404, 'EVAL_RUN_NOT_FOUND', 'Evaluation run not found', metadata);
    return json({ evalRun: result }, metadata);
  } catch (error) { return problemFromError(error, metadata); }
}
