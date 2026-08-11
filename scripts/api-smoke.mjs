import assert from "node:assert/strict";
import postgres from "postgres";
import { createHash } from "node:crypto";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const password = process.env.SMOKE_PASSWORD;
const adminUrl = process.env.DATABASE_ADMIN_URL;

if (!password) throw new Error("SMOKE_PASSWORD is required");
if (!adminUrl) throw new Error("DATABASE_ADMIN_URL is required");

const roomId = "20000000-0000-4000-8000-000000000001";
const deviceId = "30000000-0000-4000-8000-000000000001";
const idempotencyKey = `smoke-${crypto.randomUUID()}`;
const createBody = {
  roomId,
  deviceId,
  question: "The wall display is offline after a power interruption. What should I check?",
  mediaIds: []
};

async function login(email) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ email, password, client: "web" })
  });
  assert.equal(response.status, 200, `login failed for ${email}`);
  const body = await response.json();
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  assert.ok(cookie.includes("deviceops_session="));
  assert.ok(cookie.includes("deviceops_csrf="));
  return { cookie, csrf: body.csrfToken };
}

function request(session, path, init = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      cookie: session.cookie,
      ...(init.method && init.method !== "GET"
        ? { origin: baseUrl, "x-csrf-token": session.csrf }
        : {}),
      ...init.headers
    }
  });
}

async function expectStatus(response, status, label) {
  if (response.status !== status) {
    const body = await response.text();
    throw new Error(`${label}: expected ${status}, received ${response.status}: ${body}`);
  }
  return response;
}

async function main() {
  const technician = await login("tech@alpha.test");
  const createHeaders = { "idempotency-key": idempotencyKey };
  const createdResponse = await expectStatus(
    await request(technician, "/api/v1/runs", {
      method: "POST",
      headers: createHeaders,
      body: JSON.stringify(createBody)
    }),
    202,
    "create run"
  );
  const created = await createdResponse.json();

  const repeatedResponse = await expectStatus(
    await request(technician, "/api/v1/runs", {
      method: "POST",
      headers: createHeaders,
      body: JSON.stringify(createBody)
    }),
    202,
    "repeat idempotent run"
  );
  const repeated = await repeatedResponse.json();
  assert.equal(repeated.runId, created.runId, "same idempotency key must return the same run");

  await expectStatus(
    await request(technician, "/api/v1/runs", {
      method: "POST",
      headers: createHeaders,
      body: JSON.stringify({ ...createBody, question: "Different request under the same key" })
    }),
    409,
    "idempotency conflict"
  );

  let run;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await expectStatus(
      await request(technician, `/api/v1/runs/${created.runId}`),
      200,
      "get run"
    );
    const payload = await response.json();
    run = payload.run;
    if (["awaiting_approval", "completed", "failed"].includes(run.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(run?.state, "awaiting_approval", "grounded consequential guidance must await approval");
  assert.equal(run.diagnosis.serverDecision.requiresApproval, true);
  assert.ok(run.diagnosis.citations.length > 0, "diagnosis must include validated citations");

  const eventsResponse = await expectStatus(
    await request(technician, `/api/v1/runs/${created.runId}/events`, {
      headers: { "last-event-id": "0" }
    }),
    200,
    "SSE replay"
  );
  const eventsText = await eventsResponse.text();
  const events = parseSse(eventsText);
  const approvalEvent = events.find((event) => event.type === "approval.required");
  assert.ok(approvalEvent, "durable approval.required event must be replayed");
  assert.deepEqual(
    events.map((event) => BigInt(event.sequence)),
    events.map((event) => BigInt(event.sequence)).toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    "event sequences must be monotonic"
  );

  await expectStatus(
    await request(technician, `/api/v1/approvals/${approvalEvent.data.approvalId}/decision`, {
      method: "POST",
      body: JSON.stringify({
        decision: "approved",
        reason: "self approval must fail",
        proposalHash: approvalEvent.data.proposalHash
      })
    }),
    403,
    "separation of duties"
  );

  const betaTechnician = await login("tech@beta.test");
  await expectStatus(
    await request(betaTechnician, `/api/v1/runs/${created.runId}`),
    404,
    "cross-tenant run lookup"
  );

  const manager = await login("manager@alpha.test");
  const approvedResponse = await expectStatus(
    await request(manager, `/api/v1/approvals/${approvalEvent.data.approvalId}/decision`, {
      method: "POST",
      body: JSON.stringify({
        decision: "approved",
        reason: "synthetic integration smoke approval",
        proposalHash: approvalEvent.data.proposalHash
      })
    }),
    200,
    "manager approval"
  );
  const approved = await approvedResponse.json();
  assert.ok(approved.incidentId, "approval must atomically create one incident");

  await expectStatus(
    await request(manager, `/api/v1/approvals/${approvalEvent.data.approvalId}/decision`, {
      method: "POST",
      body: JSON.stringify({
        decision: "approved",
        reason: "duplicate decision must fail",
        proposalHash: approvalEvent.data.proposalHash
      })
    }),
    409,
    "approval replay"
  );

  const infectedFixture = Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE", "utf8");
  const mediaCreate = await expectStatus(
    await request(technician, "/api/v1/media/uploads", {
      method: "POST",
      body: JSON.stringify({ kind: "image", bytes: infectedFixture.length, declaredMime: "image/jpeg", sha256: createHash("sha256").update(infectedFixture).digest("hex") })
    }),
    201,
    "create quarantined media"
  );
  const media = await mediaCreate.json();
  const uploadResponse = await fetch(media.uploadTarget.url, { method: "PUT", headers: { cookie: technician.cookie, "content-type": "image/jpeg", "x-content-sha256": createHash("sha256").update(infectedFixture).digest("hex") }, body: infectedFixture });
  assert.equal(uploadResponse.status, 204, "media upload must verify its one-time target");
  const completedMedia = await expectStatus(
    await request(technician, `/api/v1/media/${media.mediaId}/complete`, { method: "POST", body: "{}" }),
    202,
    "infected media completion"
  );
  const mediaResult = await completedMedia.json();
  assert.equal(mediaResult.state, "rejected", "infected fixture must fail closed");

  const sql = postgres(adminUrl, { max: 1, prepare: false });
  try {
    const [counts] = await sql`
      select
        (select count(*)::int from incidents where run_id = ${created.runId}) as incidents,
        (select count(*)::int from outbox_events where aggregate_id = ${approved.incidentId}) as incident_outbox,
        (select count(*)::int from audit_events where target_id = ${approvalEvent.data.approvalId}) as approval_audits
    `;
    assert.equal(counts.incidents, 1, "approval replay must not duplicate incidents");
    assert.equal(counts.incident_outbox, 1, "incident must have one transactional outbox event");
    assert.ok(counts.approval_audits >= 1, "approval must produce an audit event");
  } finally {
    await sql.end({ timeout: 5 });
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    runId: created.runId,
    incidentId: approved.incidentId,
    finalState: run.state,
    citations: run.diagnosis.citations.length,
    events: events.map((event) => event.type),
    controls: {
      idempotency: "verified",
      tenantIsolation: "verified",
      separationOfDuties: "verified",
      approvalReplay: "verified",
      transactionalOutbox: "verified",
      mediaQuarantine: "verified"
    }
  }, null, 2)}\n`);
}

function parseSse(text) {
  return text
    .split("\n\n")
    .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(6)))
    .filter((value) => value && typeof value === "object" && "type" in value);
}

await main();
