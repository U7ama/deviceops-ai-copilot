import { withTenant } from '@deviceops/db';
import { createMediaStore, LocalFilesystemStore, type UploadSession } from '@deviceops/media';
import { authenticate, problem, problemFromError, requestMetadata, requireMutationProtection } from '@/lib/http';

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const metadata = requestMetadata(request); const session = await authenticate(request);
  if (!session) return problem(401, 'UNAUTHORIZED', 'Authentication required', metadata);
  try {
    requireMutationProtection(request, session);
    const { id } = await context.params; const store = createMediaStore();
    if (!(store instanceof LocalFilesystemStore)) return problem(501, 'MEDIA_WORKER_REQUIRED', 'S3 media deletion is handled by the isolated worker', metadata);
    const row = await withTenant({ tenantId: session.user.tenantId, userId: session.user.id }, async (transaction) => {
      const [asset] = await transaction<Array<{ id: string; quarantine_key: string; clean_key: string | null; state: string }>>`select id, quarantine_key, clean_key, state from media_assets where tenant_id = ${session.user.tenantId} and id = ${id} and owner_id = ${session.user.id}`;
      return asset;
    });
    if (!row) return problem(404, 'MEDIA_NOT_FOUND', 'Media asset not found', metadata);
    const uploadSession: UploadSession = { mediaId: row.id, key: row.quarantine_key, tokenHash: null, target: { provider: 'local', method: 'PUT', url: '', expiresAt: new Date(Date.now() + 60_000).toISOString(), mediaId: row.id } };
    await store.delete(uploadSession, row.clean_key);
    await withTenant({ tenantId: session.user.tenantId, userId: session.user.id }, async (transaction) => {
      await transaction`update media_assets set state = 'deleted', deleted_at = now(), updated_at = now() where tenant_id = ${session.user.tenantId} and id = ${row.id} and state <> 'deleted'`;
      await transaction`insert into media_events (id, tenant_id, media_id, state, detail) values (gen_random_uuid(), ${session.user.tenantId}, ${row.id}, 'deleted', '{}'::jsonb)`;
    });
    return new Response(null, { status: 204, headers: { 'X-Request-ID': metadata.requestId, 'X-Correlation-ID': metadata.correlationId } });
  } catch (error) { return problemFromError(error, metadata); }
}
