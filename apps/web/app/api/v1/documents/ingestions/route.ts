import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { appendAuditEvent, withTenant, vectorLiteral } from '@deviceops/db';
import { chunkText, detectPromptInjection, deterministicEmbedding } from '@deviceops/retrieval';
import { hasMinimumRole } from '@deviceops/policy';
import { authenticate, json, problem, problemFromError, requestMetadata, requireMutationProtection } from '@/lib/http';

const IngestionRequest = z.object({ title: z.string().trim().min(3).max(240), version: z.string().trim().min(1).max(80), license: z.string().trim().min(3).max(240), content: z.string().trim().min(40).max(200_000), allowedRoles: z.array(z.enum(['owner', 'admin', 'manager', 'technician', 'viewer'])).min(1).max(5).default(['owner', 'admin', 'manager', 'technician', 'viewer']) }).strict();

export async function POST(request: Request) {
  const metadata = requestMetadata(request); const session = await authenticate(request);
  if (!session) return problem(401, 'UNAUTHORIZED', 'Authentication required', metadata);
  try {
    requireMutationProtection(request, session);
    if (!hasMinimumRole(session.user.role, 'manager')) return problem(403, 'INGESTION_DENIED', 'Manager role is required', metadata);
    const parsed = IngestionRequest.safeParse(await request.json());
    if (!parsed.success) return problem(400, 'INVALID_INGESTION', 'Bundled manual ingestion is invalid', metadata);
    const sourceId = randomUUID(); const versionId = randomUUID(); const chunks = chunkText(parsed.data.content); const checksum = createHash('sha256').update(parsed.data.content).digest('hex');
    await withTenant({ tenantId: session.user.tenantId, userId: session.user.id }, async (transaction) => {
      await transaction`insert into document_sources (id, tenant_id, title, source_type, source_url, license, allowed_roles) values (${sourceId}, ${session.user.tenantId}, ${parsed.data.title}, 'bundled', null, ${parsed.data.license}, ${parsed.data.allowedRoles}::membership_role[])`;
      await transaction`insert into document_versions (id, tenant_id, source_id, version_label, checksum, parser_version, state, published_at) values (${versionId}, ${session.user.tenantId}, ${sourceId}, ${parsed.data.version}, ${checksum}, 'deviceops-text-v1', 'published', now())`;
      for (const chunk of chunks) await transaction`insert into document_chunks (id, tenant_id, source_id, source_version_id, page, start_offset, end_offset, content, content_hash, embedding, embedding_model, injection_signals) values (${randomUUID()}, ${session.user.tenantId}, ${sourceId}, ${versionId}, null, ${chunk.startOffset}, ${chunk.endOffset}, ${chunk.content}, ${chunk.contentHash}, ${vectorLiteral(deterministicEmbedding(chunk.content))}::vector, 'deviceops-deterministic-mock-v1', ${detectPromptInjection(chunk.content)}) on conflict (tenant_id, source_version_id, content_hash) do nothing`;
      await appendAuditEvent(transaction, { tenantId: session.user.tenantId, actorId: session.user.id, action: 'document.ingestion.published', targetType: 'document_version', targetId: versionId, metadata: { sourceId, chunkCount: chunks.length, checksum } });
    });
    return json({ sourceId, versionId, state: 'published', chunkCount: chunks.length, checksum }, metadata, 201);
  } catch (error) { return problemFromError(error, metadata); }
}
