import { withTenant } from '@deviceops/db';
import { authenticate, json, problem, problemFromError, requestMetadata } from '@/lib/http';

export async function GET(request: Request) {
  const metadata = requestMetadata(request); const session = await authenticate(request);
  if (!session) return problem(401, 'UNAUTHORIZED', 'Authentication required', metadata);
  try {
    const rows = await withTenant({ tenantId: session.user.tenantId, userId: session.user.id }, (transaction) => transaction<Array<{ id: string; run_id: string; state: string; summary: string; assigned_team: string; last_error: string | null; created_at: string; updated_at: string }>>`select id, run_id, state, summary, assigned_team, last_error, created_at, updated_at from incidents where tenant_id = ${session.user.tenantId} order by created_at desc limit 50`);
    return json({ incidents: rows.map((row) => ({ id: row.id, runId: row.run_id, state: row.state, summary: row.summary, assignedTeam: row.assigned_team, lastError: row.last_error, createdAt: row.created_at, updatedAt: row.updated_at })) }, metadata);
  } catch (error) { return problemFromError(error, metadata); }
}
