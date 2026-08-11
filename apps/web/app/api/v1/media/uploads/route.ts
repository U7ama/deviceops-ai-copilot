import { randomUUID } from 'node:crypto';
import { CreateMediaUploadSchema } from '@deviceops/contracts';
import { adminSql, appendAuditEvent, withTenant } from '@deviceops/db';
import { createMediaStore, validateMediaDeclaration } from '@deviceops/media';
import { authenticate, json, problem, problemFromError, requestMetadata, requireMutationProtection } from '@/lib/http';

export async function POST(request: Request) {
  const metadata = requestMetadata(request);
  const session = await authenticate(request);
  if (!session) return problem(401, 'UNAUTHORIZED', 'Authentication required', metadata);
  try {
    requireMutationProtection(request, session);
    const parsed = CreateMediaUploadSchema.safeParse(await request.json());
    if (!parsed.success) return problem(400, 'INVALID_MEDIA', 'Media declaration is invalid', metadata);
    validateMediaDeclaration({ kind: parsed.data.kind, bytes: parsed.data.bytes, contentType: parsed.data.declaredMime });
    const mediaId = randomUUID();
    const store = createMediaStore();
    if (store.provider === 's3' && process.env.NODE_ENV !== 'production') {
      // S3 is opt-in locally; the local adapter is the only offline reference path.
    }
    const sessionUpload = await store.createUpload({ mediaId, kind: parsed.data.kind, bytes: parsed.data.bytes, contentType: parsed.data.declaredMime, sha256: parsed.data.sha256 });
    const expires = new Date(sessionUpload.target.expiresAt);
    await withTenant({ tenantId: session.user.tenantId, userId: session.user.id }, async (transaction) => {
      await transaction`insert into media_assets (id, tenant_id, owner_id, kind, state, storage_provider, quarantine_key, upload_token_hash, upload_expires_at, declared_mime, bytes, sha256, processor_version, retention_expires_at) values (${mediaId}, ${session.user.tenantId}, ${session.user.id}, ${parsed.data.kind}, 'uploading', ${store.provider}, ${sessionUpload.key}, ${sessionUpload.tokenHash}, ${expires.toISOString()}, ${parsed.data.declaredMime}, ${parsed.data.bytes}, ${parsed.data.sha256}, 'media-v1', now() + interval '30 days')`;
      await transaction`insert into media_events (id, tenant_id, media_id, state, detail) values (${randomUUID()}, ${session.user.tenantId}, ${mediaId}, 'uploading', ${transaction.json({ provider: store.provider })})`;
      await appendAuditEvent(transaction, { tenantId: session.user.tenantId, actorId: session.user.id, action: 'media.upload.created', targetType: 'media_asset', targetId: mediaId, metadata: { kind: parsed.data.kind, bytes: parsed.data.bytes } });
    });
    return json({ mediaId, uploadTarget: sessionUpload.target }, metadata, 201);
  } catch (error) { return problemFromError(error, metadata); }
}
