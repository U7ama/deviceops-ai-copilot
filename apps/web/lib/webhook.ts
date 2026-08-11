import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignedWebhookEnvelopeSchema } from '@deviceops/contracts';
import { DomainError } from '@deviceops/core';

export async function verifySignedWebhook(request: Request): Promise<{ envelope: ReturnType<typeof SignedWebhookEnvelopeSchema.parse>; payload: Record<string, unknown> }> {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!secret) throw new DomainError('WEBHOOK_NOT_CONFIGURED', 'Webhook integration is not configured', 503);
  const parsed = SignedWebhookEnvelopeSchema.safeParse(await request.json());
  if (!parsed.success) throw new DomainError('INVALID_WEBHOOK', 'Webhook envelope is invalid', 400);
  const envelope = parsed.data;
  if (Math.abs(Math.floor(Date.now() / 1000) - envelope.timestamp) > 300) throw new DomainError('WEBHOOK_EXPIRED', 'Webhook timestamp is outside the replay window', 401);
  const expected = createHmac('sha256', secret).update(`${envelope.timestamp}.${envelope.nonce}.${envelope.payloadBase64}`).digest();
  const actual = Buffer.from(envelope.signature, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new DomainError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature is invalid', 401);
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(envelope.payloadBase64, 'base64url').toString('utf8')); } catch { throw new DomainError('WEBHOOK_PAYLOAD_INVALID', 'Webhook payload is not valid JSON', 400); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new DomainError('WEBHOOK_PAYLOAD_INVALID', 'Webhook payload must be an object', 400);
  return { envelope, payload: payload as Record<string, unknown> };
}
