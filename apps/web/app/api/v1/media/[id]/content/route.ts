import { createHash } from 'node:crypto';
import { adminSql, withTenant } from '@deviceops/db';
import { createMediaStore, LocalFilesystemStore, type UploadSession } from '@deviceops/media';
import { authenticate, problem, problemFromError, requestMetadata } from '@/lib/http';

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const metadata = requestMetadata(request);
  const session = await authenticate(request);
  if (!session) return problem(401, 'UNAUTHORIZED', 'Authentication required', metadata);
  try {
    const { id } = await context.params;
    const token = new URL(request.url).searchParams.get('uploadToken');
    if (!token || !request.body) return problem(400, 'UPLOAD_TOKEN_REQUIRED', 'A one-time upload token and body are required', metadata);
    const store = createMediaStore();
    if (!(store instanceof LocalFilesystemStore)) return problem(501, 'DIRECT_UPLOAD_UNSUPPORTED', 'This provider requires its presigned upload target', metadata);
    const row = await withTenant({ tenantId: session.user.tenantId, userId: session.user.id }, async (transaction) => {
      const [asset] = await transaction<Array<{ id: string; quarantine_key: string; upload_token_hash: string | null; bytes: string; sha256: string; declared_mime: string; state: string }>>`select id, quarantine_key, upload_token_hash, bytes, sha256, declared_mime, state from media_assets where tenant_id = ${session.user.tenantId} and id = ${id} and owner_id = ${session.user.id}`;
      return asset;
    });
    if (!row || row.state !== 'uploading') return problem(404, 'MEDIA_NOT_UPLOADABLE', 'Media upload is not available', metadata);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    if (tokenHash !== row.upload_token_hash) return problem(403, 'UPLOAD_TOKEN_INVALID', 'Upload token is invalid', metadata);
    const uploadSession: UploadSession = { mediaId: row.id, key: row.quarantine_key, tokenHash: row.upload_token_hash, target: { provider: 'local', method: 'PUT', url: '', expiresAt: new Date(Date.now() + 60_000).toISOString(), mediaId: row.id } };
    const stored = await store.writeUpload(uploadSession, request.body, Number(row.bytes));
    if (stored.bytes !== Number(row.bytes) || stored.sha256 !== row.sha256) return problem(400, 'UPLOAD_CHECKSUM_MISMATCH', 'Uploaded bytes do not match the declaration', metadata);
    await withTenant({ tenantId: session.user.tenantId, userId: session.user.id }, async (transaction) => {
      await transaction`update media_assets set state = 'quarantined', detected_mime = ${stored.contentType}, updated_at = now() where tenant_id = ${session.user.tenantId} and id = ${row.id} and state = 'uploading'`;
      await transaction`insert into media_events (id, tenant_id, media_id, state, detail) values (gen_random_uuid(), ${session.user.tenantId}, ${row.id}, 'quarantined', ${transaction.json({ bytes: stored.bytes, sha256: stored.sha256 })})`;
    });
    return new Response(null, { status: 204, headers: { 'X-Request-ID': metadata.requestId, 'X-Correlation-ID': metadata.correlationId } });
  } catch (error) { return problemFromError(error, metadata); }
}
