import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { withTenant, closeDatabase } from "@deviceops/db";
const base = process.env.OPS_TEST_URL ?? "http://localhost:3000";
const password = process.env.OPS_TEST_PASSWORD;
if (!password) throw new Error("OPS_TEST_PASSWORD is required");
const results: string[] = [];
async function session(email: string) {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email, password, client: "mobile" }),
  });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  return { token: d.accessToken, user: d.user };
}
async function request(
  token: string,
  path: string,
  body?: unknown,
  key = randomUUID(),
) {
  const r = await fetch(`${base}/api/v2/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20000),
  });
  return { status: r.status, data: await r.json() };
}
async function until(
  token: string,
  predicate: (s: any) => boolean,
  timeout = 90000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const r = await request(token, "state");
    assert.equal(r.status, 200, JSON.stringify(r.data));
    if (predicate(r.data)) return r.data;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Timed out waiting for incident transition");
}
function ok(name: string) {
  results.push(name);
  console.log(`PASS ${name}`);
}
try {
  const m = await session("usamaaslam8726@gmail.com"),
    t = await session("tariq@deviceops.cloud"),
    b = await session("bilal@deviceops.cloud");
  const initial = await request(m.token, "state");
  assert.equal(initial.status, 200, JSON.stringify(initial.data));
  assert.equal(initial.data.connectors.length, 57);
  ok("catalog and authenticated state");
  // Explicit manager review for legacy synthetic fixtures created before criticality metadata existed.
  // Never relax policy for real equipment or overwrite an explicit critical/unknown classification.
  for (const device of initial.data.devices.filter((d: any) => d.sourceMode === "simulated" && d.criticality === undefined)) {
    assert.equal((await request(m.token, `devices/${device.id}/policy`, { criticality: "standard", maintenanceUntil: null })).status, 200);
  }
  assert.equal(
    (await request(t.token, "demo", { scenario: "switch_failure" })).status,
    403,
  );
  ok("technician denied mutation");
  const key = randomUUID();
  const first = await request(
    m.token,
    "demo",
    { scenario: "switch_failure" },
    key,
  );
  assert.equal(first.status, 200);
  assert.deepEqual(
    await request(m.token, "demo", { scenario: "switch_failure" }, key),
    first,
  );
  assert.equal(
    (await request(m.token, "demo", { scenario: "reset" }, key)).status,
    409,
  );
  ok("idempotency and payload conflict");
  let s = await until(m.token, (s) =>
    s.incidents.some(
      (i: any) =>
        i.status === "awaiting_approval" && i.generation === s.generation,
    ),
  );
  const i = s.incidents.find(
    (i: any) =>
      i.status === "awaiting_approval" && i.generation === s.generation,
  );
  assert.equal(i.deviceIds.length, 4);
  assert.equal(i.diagnosis.provider, "fixture");
  ok("unattended grouping and honest fixture diagnosis");
  assert.equal((await request(b.token, `incidents/${i.id}`)).status, 404);
  ok("cross tenant API denies access");
  const p = s.approvals.find(
    (p: any) => p.incidentId === i.id && p.status === "pending",
  );
  const decision = {
    decision: "approved",
    proposalHash: p.hash,
    reason: "Integration test: simulated recovery",
  };
  assert.equal(
    (await request(t.token, `approvals/${p.id}/decision`, decision)).status,
    403,
  );
  assert.equal(
    (
      await request(m.token, `approvals/${p.id}/decision`, {
        ...decision,
        proposalHash: "0".repeat(64),
      })
    ).status,
    409,
  );
  ok("approval role and exact hash");
  assert.equal(
    (await request(m.token, `approvals/${p.id}/decision`, decision)).status,
    200,
  );
  assert.equal(
    (await request(m.token, `approvals/${p.id}/decision`, decision)).status,
    409,
  );
  ok("approval replay denied");
  s = await until(m.token, (s) =>
    s.incidents.some((x: any) => x.id === i.id && x.status === "resolved"),
  );
  assert.equal(
    s.events.filter(
      (e: any) => e.incidentId === i.id && e.type === "action.executed",
    ).length,
    1,
  );
  assert.ok(s.incidents.find((x: any) => x.id === i.id).report);
  ok("one command and sustained recovery");
  const reviewed = {
    title: "Reviewed switch recovery",
    text: "Confirm fresh switch reachability and configured dependencies. Obtain manager approval before the simulated restart, then verify three fresh healthy observations.",
  };
  assert.equal(
    (await request(t.token, `incidents/${i.id}/publish-runbook`, reviewed))
      .status,
    403,
  );
  assert.equal(
    (await request(m.token, `incidents/${i.id}/publish-runbook`, reviewed))
      .status,
    200,
  );
  ok("manager-reviewed runbook publication");
  await withTenant(
    { tenantId: b.user.tenantId, userId: b.user.id },
    async (tx) => {
      const rows =
        await tx`select id from ops_records where tenant_id=${m.user.tenantId}`;
      assert.equal(rows.length, 0);
    },
  );
  ok("real PostgreSQL RLS");
  assert.equal(
    (await request(m.token, "demo", { scenario: "service_hang" })).status,
    200,
  );
  s = await until(m.token, (s) =>
    s.incidents.some(
      (i: any) =>
        i.generation === s.generation &&
        i.rootDeviceId ===
          s.devices.find(
            (d: any) => d.kind === "service" && !d.collectorManaged,
          ).id &&
        i.status === "resolved",
    ),
  );
  ok("automatic allowed service recovery");
  assert.equal(
    (await request(m.token, "demo", { scenario: "auth_failure" })).status,
    200,
  );
  s = await until(m.token, (s) =>
    s.incidents.some(
      (i: any) =>
        i.generation === s.generation &&
        i.status === "escalated" &&
        i.diagnosis?.cause?.includes("Credential"),
    ),
  );
  assert.equal(
    s.devices.find((d: any) => d.kind === "projector").reachability,
    "reachable",
  );
  ok("authentication failure handled separately");
  assert.equal(
    (await request(m.token, "discovery", { targets: "simulator" })).status,
    200,
  );
  s = (await request(m.token, "state")).data;
  const c = s.discovery.find((d: any) => d.address === "simulator://room-d");
  assert.ok(c);
  assert.equal(
    (await request(t.token, `discovery/${c.id}/enroll`, {})).status,
    403,
  );
  assert.equal(
    (await request(m.token, `discovery/${c.id}/enroll`, {})).status,
    200,
  );
  ok("discovery candidate enrollment");
  const enrollment = await request(m.token, "collectors", {
    sourceMode: "live",
    devices: [
      {
        name: "Read-only integration target",
        kind: "service",
        room: "Local test",
      },
    ],
  });
  assert.equal(enrollment.status, 201);
  const collector = enrollment.data;
  const sample = {
    deviceId: collector.deviceIds[0],
    source: "integration",
    sourceMode: "live",
    observedAt: new Date().toISOString(),
    reachability: "reachable",
    health: "error",
    auth: "ok",
    metrics: { application: "hung" },
  };
  assert.equal(
    (
      await request(collector.token, "collector/observations", {
        observations: [{ ...sample, sourceMode: "simulated" }],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(collector.token, "collector/observations", {
        observations: [{ ...sample, deviceId: randomUUID() }],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(collector.token, "collector/observations", {
        observations: [sample],
      })
    ).status,
    200,
  );
  s = await until(m.token, (s) =>
    s.incidents.some(
      (x: any) =>
        x.rootDeviceId === sample.deviceId && x.status === "escalated",
    ),
  );
  assert.equal(
    s.incidents.find((x: any) => x.rootDeviceId === sample.deviceId).report
      .sourceMode,
    "live",
  );
  assert.equal(
    s.commands.some((x: any) => x.deviceId === sample.deviceId),
    false,
  );
  ok("collector scope, provenance and live write prohibition");
  await writeFile(
    ".data/ops-integration-results.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        database: "PostgreSQL16 isolated test",
        provider: "fixture",
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await closeDatabase();
}
