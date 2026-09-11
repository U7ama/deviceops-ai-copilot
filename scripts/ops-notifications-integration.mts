import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { adminSql, closeDatabase } from "@deviceops/db";
import {
  dispatchNotifications,
  claimNotification,
  acknowledgeNotification,
  signNotification,
} from "../packages/operations/src/notifications.js";
const key = "integration-only-notification-key-32-chars";
process.env.N8N_WEBHOOK_SECRET = key;
const db = adminSql(),
  ids: string[] = [];
const envelopes: any[] = [];
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  envelopes.push(JSON.parse(body));
  res.writeHead(200, { "content-type": "application/json" });
  res.end("{}");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("Missing server address");
process.env.OPS_N8N_WEBHOOK_URL = `http://127.0.0.1:${address.port}/test`;
async function state(id: string) {
  const [row] =
    await db`select state,attempts from ops_notifications where id=${id}`;
  return row;
}
try {
  const [tenant] = await db`select id from tenants order by name limit 1`;
  assert.ok(tenant);
  async function insert() {
    const id = randomUUID();
    ids.push(id);
    await db`insert into ops_notifications(id,tenant_id,incident_id,payload) values(${id},${tenant.id},${randomUUID()},${db.json({ summary: "Local notification test", incidentId: randomUUID(), status: "resolved" })})`;
    return id;
  }
  const id = await insert();
  await dispatchNotifications([id]);
  assert.equal((await state(id)).state, "accepted");
  console.log("PASS HTTP acceptance does not imply delivery");
  const claimed = await Promise.all([
    claimNotification(envelopes[0]),
    claimNotification(envelopes[0]),
  ]);
  assert.equal(claimed.filter((x) => !x.duplicate).length, 1);
  assert.equal((await state(id)).state, "delivering");
  console.log(
    "PASS concurrent signed claims produce one delivery authorization",
  );
  const ack = signNotification(
    { purpose: "ack", deliveryId: id, attempt: 1, status: "delivered" },
    key,
  );
  await acknowledgeNotification(ack);
  await acknowledgeNotification(ack);
  assert.equal((await state(id)).state, "delivered");
  console.log("PASS signed acknowledgement and safe acknowledgement replay");
  await assert.rejects(
    acknowledgeNotification(
      signNotification(
        { purpose: "ack", deliveryId: id, attempt: 2, status: "delivered" },
        key,
      ),
    ),
  );
  console.log("PASS unrelated attempt cannot acknowledge delivery");
  const lost = await insert();
  await dispatchNotifications([lost]);
  await claimNotification(envelopes[1]);
  await db`update ops_notifications set lease_until=now()-interval '1 second' where id=${lost}`;
  const count = envelopes.length;
  await dispatchNotifications([lost]);
  assert.equal((await state(lost)).state, "unknown");
  assert.equal(envelopes.length, count);
  console.log(
    "PASS missing post-send acknowledgement blocks automatic redelivery",
  );
} finally {
  if (ids.length)
    await db`delete from ops_notifications where id=any(${ids}::uuid[])`;
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  await closeDatabase();
}
