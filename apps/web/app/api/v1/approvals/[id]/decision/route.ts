import { ApprovalDecisionSchema } from "@deviceops/contracts";
import { decideApproval } from "@deviceops/core";
import { authenticate, json, problem, problemFromError, requestMetadata, requireMutationProtection } from "@/lib/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const metadata = requestMetadata(request);
  const session = await authenticate(request);
  if (!session) return problem(401, "UNAUTHORIZED", "Authentication required", metadata);
  try {
    requireMutationProtection(request, session);
    const parsed = ApprovalDecisionSchema.safeParse(await request.json());
    if (!parsed.success) return problem(400, "INVALID_DECISION", "Approval decision is invalid", metadata);
    const { id } = await context.params;
    return json(await decideApproval({ actor: session.user, approvalId: id, ...parsed.data }), metadata);
  } catch (error) {
    return problemFromError(error, metadata);
  }
}
