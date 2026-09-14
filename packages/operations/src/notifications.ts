import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { adminSql } from "@deviceops/db";

const EnvelopeSchema = z
  .object({
    timestamp: z.number().int(),
    nonce: z.string().regex(/^[a-f0-9]{32}$/),
    payloadBase64: z.string().min(1).max(12000),
    signature: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const PayloadSchema = z
  .object({
    purpose: z.enum(["dispatch", "ack"]),
    deliveryId: z.uuid(),
    attempt: z.number().int().min(1).max(4),
    status: z.literal("delivered").optional(),
  })
  .strict();
type Payload = z.infer<typeof PayloadSchema>;
class NotificationError extends Error {
  override name = "DomainError";
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
function secret() {
  const value = process.env.N8N_WEBHOOK_SECRET;
  if (!value || value.length < 32)
    throw new Error(
      "Notification signing secret must contain at least 32 characters",
    );
  return value;
}
export function signNotification(
  payload: Payload,
  key: string,
  now = Date.now(),
) {
  const timestamp = Math.floor(now / 1000),
    nonce = randomBytes(16).toString("hex"),
    payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    timestamp,
    nonce,
    payloadBase64,
    signature: createHmac("sha256", key)
      .update(`${timestamp}.${nonce}.${payloadBase64}`)
      .digest("hex"),
  };
}
export function verifyNotification(
  input: unknown,
  purpose: Payload["purpose"],
  key: string,
  now = Date.now(),
) {
  const e = EnvelopeSchema.parse(input);
  if (Math.abs(Math.floor(now / 1000) - e.timestamp) > 300)
    throw new NotificationError(
      401,
      "EXPIRED_SIGNATURE",
      "Notification signature expired",
    );
  const expected = createHmac("sha256", key)
    .update(`${e.timestamp}.${e.nonce}.${e.payloadBase64}`)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(e.signature, "hex")))
    throw new NotificationError(
      401,
      "BAD_SIGNATURE",
      "Notification signature invalid",
    );
  const payload = PayloadSchema.parse(
    JSON.parse(Buffer.from(e.payloadBase64, "base64url").toString("utf8")),
  );
  if (
    payload.purpose !== purpose ||
    (purpose === "ack" && payload.status !== "delivered")
  )
    throw new NotificationError(
      401,
      "WRONG_PURPOSE",
      "Notification capability has the wrong purpose",
    );
  return payload;
}
export async function dispatchNotifications(deliveryIds?: string[]) {
  if (!process.env.OPS_N8N_WEBHOOK_URL) return;
  const key = secret(),
    db = adminSql();
  const ids = deliveryIds ?? [];
  // A send may have succeeded when its acknowledgement was lost. Never replay it blindly.
  await db`update ops_notifications set state='unknown',lease_until=null,last_error='Delivery acknowledgement missing; inspect Mailpit before manual reconciliation' where state='delivering' and lease_until<now()`;
  await db`update ops_notifications set state='dead_lettered',lease_until=null where attempts>=4 and state in('sending','accepted','retrying') and coalesce(lease_until,available_at)<now()`;
  const rows = await db<
    Array<{ id: string; attempts: number }>
  >`update ops_notifications set state='sending',lease_until=now()+interval '30 seconds',attempts=attempts+1 where id in(select id from ops_notifications where (${deliveryIds === undefined} or id=any(${ids}::uuid[])) and (state in('queued','retrying') or (state in('sending','accepted') and lease_until<now())) and available_at<=now() and attempts<4 order by available_at limit 5 for update skip locked) returning id,attempts`;
  for (const r of rows) {
    try {
      const envelope = signNotification(
        { purpose: "dispatch", deliveryId: r.id, attempt: r.attempts },
        key,
      );
      const response = await fetch(process.env.OPS_N8N_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw new Error(`Notification webhook returned ${response.status}`);
      await db`update ops_notifications set state='accepted' where id=${r.id} and attempts=${r.attempts} and state='sending'`;
    } catch (e) {
      // The workflow might already have claimed or completed this delivery during fetch.
      await db`update ops_notifications set state=${r.attempts >= 4 ? "dead_lettered" : "retrying"},available_at=now()+${Math.min(60, 2 ** r.attempts)}*interval '1 second',lease_until=null,last_error=${e instanceof Error ? e.message : "Dispatch failed"} where id=${r.id} and attempts=${r.attempts} and state='sending'`;
    }
  }
}
export async function claimNotification(input: unknown) {
  const payload = verifyNotification(input, "dispatch", secret());
  const [row] = await adminSql()<
    Array<{ payload: unknown }>
  >`update ops_notifications set state='delivering',lease_until=now()+interval '120 seconds' where id=${payload.deliveryId} and attempts=${payload.attempt} and state in('sending','accepted') returning payload`;
  // The database owns both the tenant and content. Concurrent/replayed claims cannot send twice.
  return row
    ? {
        duplicate: false,
        deliveryId: payload.deliveryId,
        attempt: payload.attempt,
        payload: row.payload,
      }
    : { duplicate: true };
}
export async function acknowledgeNotification(input: unknown) {
  const payload = verifyNotification(input, "ack", secret());
  const rows =
    await adminSql()`update ops_notifications set state='delivered',lease_until=null,last_error=null where id=${payload.deliveryId} and attempts=${payload.attempt} and state in('delivering','unknown','delivered') returning id`;
  if (!rows.length)
    throw new NotificationError(
      409,
      "DELIVERY_STATE",
      "Delivery was never claimed by this attempt",
    );
  return { ok: true };
}
