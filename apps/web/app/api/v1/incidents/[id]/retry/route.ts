import { retryIncident } from '@deviceops/core';
import { authenticate, json, problem, problemFromError, requestMetadata, requireMutationProtection } from '@/lib/http';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const metadata = requestMetadata(request);
  const session = await authenticate(request);
  if (!session) return problem(401, 'UNAUTHORIZED', 'Authentication required', metadata);
  try {
    requireMutationProtection(request, session);
    const { id } = await context.params;
    return json(await retryIncident({ actor: session.user, incidentId: id }), metadata, 202);
  } catch (error) { return problemFromError(error, metadata); }
}
