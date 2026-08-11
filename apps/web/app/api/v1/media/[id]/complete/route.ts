import { createHash } from 'node:crypto';
import { adminSql, withTenant } from '@deviceops/db';
import { createMediaStore, FixtureScanner, LocalFilesystemStore, type UploadSession } from '@deviceops/media';
import { authenticate, json, problem, problemFromError, requestMetadata, requireMutationProtection } from '@/lib/http';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const metadata = requestMetadata(request);
  const session = await authenticate(request);
  if (!session) return problem(401, 'UNAUTHORIZED', 'Authentication required', metadata);
  try {
    requireMutationProtection(request, session);
    const { id } = await context.params;
    const store = createMediaStore();
    if (!(store instanceof LocalFilesystemStore)) return problem(501, 'MEDIA_WORKER_REQUIRED', 'S3 media completion is handled by the isolated worker', metadata);
    const row = await withTenant({ tenantId: session.user.tenantId, userId: session.user.id }, async (transaction) => {
      const [asset] = await transaction<Array<{ id: string; quarantine_key: string; bytes: string; sha256: string; declared_mime: string; state: string; kind: 'image' | 'voice' }>>`select id, quarantine_key, bytes, sha256, declared_mime, state, kind from media_assets where tenant_id = ${session.user.tenantId} and id = ${id} and owner_id = ${session.user.id}`;
      return asset;
    });
    if (!row || !['quarantined', 'ready'].includes(row.state)) return problem(409, 'MEDIA_NOT_READY_FOR_SCAN', 'Media must be uploaded before completion', metadata);
    const uploadSession: UploadSession = { mediaId: row.id, key: row.quarantine_key, tokenHash: null, target: { provider: 'local', method: 'PUT', url: '', expiresAt: new Date(Date.now() + 60_000).toISOString(), mediaId: row.id } };
    const stored = await store.verifyUpload(uploadSession);
    if (stored.bytes !== Number(row.bytes) || stored.sha256 !== row.sha256) return problem(400, 'UPLOAD_CHECKSUM_MISMATCH', 'Stored media failed checksum verification', metadata);
    const scanner = new FixtureScanner((process.env.MEDIA_FIXTURE_SHA256 ?? '').split(',').map((value) => value.trim()).filter(Boolean));
    const scan = await scanner.scan(await store.readQuarantined(uploadSession));
    const nextState = scan.verdict === 'clean' ? 'ready' : scan.verdict === 'unscanned' ? 'quarantined' : 'rejected';
    await withTenant({ tenantId: session.user.tenantId, userId: session.user.id }, async (transaction) => {
      await transaction`update media_assets set state = ${nextState}, detected_mime = ${stored.contentType}, scanner = ${scan.engine}, scanner_version = ${scan.engineVersion}, scan_status = ${scan.verdict}, scanned_at = now(), updated_at = now() where tenant_id = ${session.user.tenantId} and id = ${row.id}`;
      await transaction`insert into media_events (id, tenant_id, media_id, state, detail) values (gen_random_uuid(), ${session.user.tenantId}, ${row.id}, ${nextState}, ${transaction.json({ verdict: scan.verdict, detail: scan.detail })})`;
    });
    return json({ mediaId: row.id, state: nextState, scanner: scan.verdict, attachable: nextState === 'ready' }, metadata, nextState === 'ready' ? 200 : 202);
  } catch (error) { return problemFromError(error, metadata); }
}
