import { withTenant } from '@deviceops/db';
import { authenticate, json, problem, problemFromError, requestMetadata } from '@/lib/http';

export async function GET(request: Request) {
  const metadata = requestMetadata(request); const session = await authenticate(request);
  if (!session) return problem(401, 'UNAUTHORIZED', 'Authentication required', metadata);
  try {
    const rows = await withTenant({ tenantId: session.user.tenantId, userId: session.user.id }, (transaction) => transaction<Array<{ id: string; run_id: string; requester_id: string; proposal: unknown; proposal_hash: string; state: string; expires_at: string }>>`select id, run_id, requester_id, proposal, proposal_hash, state, expires_at from approval_requests where tenant_id = ${session.user.tenantId} order by created_at desc limit 50`);
    return json({ approvals: rows.map((row) => ({ id: row.id, runId: row.run_id, requesterId: row.requester_id, proposal: row.proposal, proposalHash: row.proposal_hash, state: row.state, expiresAt: row.expires_at })) }, metadata);
  } catch (error) { return problemFromError(error, metadata); }
}
