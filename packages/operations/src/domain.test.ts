import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createState,
  injectScenario,
  simulatorObservations,
  ingest,
  detect,
  fixtureDiagnosis,
  applyDiagnosis,
  decide,
  executeSimulator,
  verify,
  proposalHash,
  ObservationSchema,
} from "./domain.js";
const tenant = "10000000-0000-4000-8000-000000000001";
const start = Date.parse("2026-09-06T00:00:00Z");
function fault(
  scenario:
    | "switch_failure"
    | "service_hang"
    | "auth_failure"
    | "source_conflict"
    | "recovery_failure",
) {
  const s = createState(tenant, start);
  injectScenario(s, scenario, start);
  for (let n = 1; n <= 3; n++) {
    ingest(s, simulatorObservations(s, start + n * 5000), start + n * 5000);
    detect(s, start + n * 5000);
  }
  return s;
}
function diagnose(s: ReturnType<typeof fault>) {
  const i = s.incidents[0]!;
  applyDiagnosis(s, i, fixtureDiagnosis(s, i), start + 15000);
  return i;
}
describe("autonomous operations", () => {
  it("does not invent health before observation", () =>
    expect(
      createState(tenant, start).devices.every((d) => d.health === "unknown"),
    ).toBe(true));
  it("uses stable but tenant-isolated device IDs", () =>
    expect(createState(tenant).devices[0]!.id).not.toBe(
      createState(randomUUID()).devices[0]!.id,
    ));
  it("requires three transport failures before offline", () => {
    const s = createState(tenant, start);
    injectScenario(s, "switch_failure", start);
    ingest(s, simulatorObservations(s, start + 5000), start + 5000);
    detect(s, start + 5000);
    expect(s.incidents).toHaveLength(0);
  });
  it("collapses upstream and dependent failures into one incident", () => {
    const s = fault("switch_failure");
    expect(s.incidents).toHaveLength(1);
    expect(s.incidents[0]!.deviceIds).toHaveLength(4);
  });
  it("does not re-open duplicate incident from repeated polls", () => {
    const s = fault("switch_failure");
    detect(s, start + 17000);
    expect(s.incidents).toHaveLength(1);
  });
  it("does not group unrelated devices without topology", () => {
    const s = createState(tenant, start);
    s.topology = [];
    injectScenario(s, "switch_failure", start);
    for (let n = 1; n <= 3; n++)
      ingest(s, simulatorObservations(s, start + n * 5000), start + n * 5000);
    detect(s, start + 15000);
    expect(s.incidents).toHaveLength(4);
  });
  it("requires human approval for switch recovery", () => {
    const s = fault("switch_failure");
    const i = diagnose(s);
    executeSimulator(s, start + 15000);
    expect(i.status).toBe("awaiting_approval");
    expect(s.commands).toHaveLength(0);
  });
  it("prevents technician approval", () => {
    const s = fault("switch_failure");
    diagnose(s);
    const p = s.approvals[0]!;
    expect(() =>
      decide(
        s,
        p,
        { id: randomUUID(), role: "technician" },
        "approved",
        p.hash,
        "yes",
        start + 16000,
      ),
    ).toThrow();
  });
  it("rejects changed action hash", () => {
    const s = fault("switch_failure");
    diagnose(s);
    const p = s.approvals[0]!;
    p.targetDeviceId = randomUUID();
    expect(() =>
      decide(
        s,
        p,
        { id: randomUUID(), role: "manager" },
        "approved",
        p.hash,
        "yes",
        start + 16000,
      ),
    ).toThrow();
  });
  it("rejects expired approval", () => {
    const s = fault("switch_failure");
    diagnose(s);
    const p = s.approvals[0]!;
    expect(() =>
      decide(
        s,
        p,
        { id: randomUUID(), role: "manager" },
        "approved",
        p.hash,
        "yes",
        start + 2000000,
      ),
    ).toThrow();
  });
  it("rejects self approval", () => {
    const s = fault("switch_failure");
    diagnose(s);
    const p = s.approvals[0]!;
    const id = randomUUID();
    p.requesterId = id;
    expect(() =>
      decide(
        s,
        p,
        { id, role: "manager" },
        "approved",
        p.hash,
        "yes",
        start + 16000,
      ),
    ).toThrow();
  });
  it("cannot execute a rejected proposal", () => {
    const s = fault("switch_failure");
    const i = diagnose(s);
    const p = s.approvals[0]!;
    decide(
      s,
      p,
      { id: randomUUID(), role: "manager" },
      "rejected",
      p.hash,
      "Need physical inspection",
      start + 16000,
    );
    executeSimulator(s, start + 16000);
    expect(i.status).toBe("escalated");
    expect(s.commands).toHaveLength(0);
  });
  it("does not resolve on command acknowledgment and resolves after sustained recovery", () => {
    const s = fault("switch_failure");
    const i = diagnose(s);
    const p = s.approvals[0]!;
    decide(
      s,
      p,
      { id: randomUUID(), role: "manager" },
      "approved",
      p.hash,
      "Approve simulated recovery",
      start + 16000,
    );
    executeSimulator(s, start + 16000);
    verify(s, start + 16000);
    expect(i.status).toBe("verifying");
    for (let n = 4; n <= 6; n++) {
      ingest(s, simulatorObservations(s, start + n * 5000), start + n * 5000);
      verify(s, start + n * 5000);
    }
    expect(i.status).toBe("resolved");
    expect(i.report).not.toBeNull();
  });
  it("cannot replay approval or execute command twice", () => {
    const s = fault("switch_failure");
    diagnose(s);
    const p = s.approvals[0]!;
    const actor = { id: randomUUID(), role: "manager" };
    decide(s, p, actor, "approved", p.hash, "Approve", start + 16000);
    expect(() =>
      decide(s, p, actor, "approved", p.hash, "Again", start + 16000),
    ).toThrow();
    executeSimulator(s, start + 16000);
    executeSimulator(s, start + 17000);
    expect(s.events.filter((e) => e.type === "action.executed")).toHaveLength(
      1,
    );
  });
  it("automatically executes only allowed simulated service restart", () => {
    const s = fault("service_hang");
    const i = diagnose(s);
    expect(s.approvals[0]!.risk).toBe("automatic");
    executeSimulator(s, start + 16000);
    expect(i.status).toBe("verifying");
  });
  it("escalates command success without recovery", () => {
    const s = fault("recovery_failure");
    const i = diagnose(s);
    const p = s.approvals[0]!;
    decide(
      s,
      p,
      { id: randomUUID(), role: "manager" },
      "approved",
      p.hash,
      "Approve",
      start + 16000,
    );
    executeSimulator(s, start + 16000);
    ingest(s, simulatorObservations(s, start + 140000), start + 140000);
    verify(s, start + 140000);
    expect(i.status).toBe("escalated");
  });
  it("separates authentication failure from reachability", () => {
    const s = fault("auth_failure");
    const d = s.devices.find((d) => d.kind === "projector")!;
    expect(d.reachability).toBe("reachable");
    expect(d.health).toBe("warning");
    diagnose(s);
    expect(s.approvals).toHaveLength(0);
  });
  it("preserves conflict and avoids an automatic action", () => {
    const s = fault("source_conflict");
    expect(s.devices.find((d) => d.kind === "display")!.conflict).toBe(true);
    diagnose(s);
    expect(s.commands).toHaveLength(0);
  });
  it("rejects hallucinated citation IDs", () => {
    const s = fault("switch_failure");
    const i = s.incidents[0]!;
    const d = fixtureDiagnosis(s, i);
    d.evidenceIds.push("invented");
    expect(() => applyDiagnosis(s, i, d, start + 15000)).toThrow(
      "Unrecognized",
    );
  });
  it("cannot use model arguments to act on another device", () => {
    const s = fault("switch_failure");
    const i = s.incidents[0]!;
    const d = fixtureDiagnosis(s, i);
    d.action!.targetDeviceId = randomUUID();
    applyDiagnosis(s, i, d, start + 15000);
    expect(i.status).toBe("escalated");
    expect(s.commands).toHaveLength(0);
  });
  it("never enables real-device writes", () => {
    const s = fault("switch_failure");
    s.devices[0]!.sourceMode = "live";
    const i = diagnose(s);
    expect(i.status).toBe("escalated");
  });
  it("blocks approval after scenario/state changed", () => {
    const s = fault("switch_failure");
    diagnose(s);
    const p = s.approvals[0]!;
    injectScenario(s, "reset", start + 16000);
    expect(() =>
      decide(
        s,
        p,
        { id: randomUUID(), role: "manager" },
        "approved",
        p.hash,
        "Approve",
        start + 17000,
      ),
    ).toThrow();
  });
  it("deduplicates observations", () => {
    const s = createState(tenant, start);
    const o = simulatorObservations(s, start);
    ingest(s, o, start);
    ingest(s, o, start);
    expect(s.observations).toHaveLength(5);
  });
  it("rejects observation outside enrolled tenant devices", () => {
    const s = createState(tenant, start);
    const o = simulatorObservations(s, start)[0]!;
    expect(() => ingest(s, [{ ...o, deviceId: randomUUID() }], start)).toThrow(
      "scope",
    );
  });
  it("rejects future observations and provenance relabeling", () => {
    const s = createState(tenant, start);
    const o = simulatorObservations(s, start)[0]!;
    expect(() =>
      ingest(
        s,
        [{ ...o, observedAt: new Date(start + 10000).toISOString() }],
        start,
      ),
    ).toThrow("clock");
    expect(() => ingest(s, [{ ...o, sourceMode: "live" }], start)).toThrow(
      "provenance",
    );
  });
  it("rejects arbitrary credential and shell fields", () => {
    const s = createState(tenant, start);
    expect(() =>
      ObservationSchema.parse({
        ...simulatorObservations(s, start)[0],
        password: "secret",
      }),
    ).toThrow();
  });
  it("marks stale data unknown", () => {
    const s = createState(tenant, start);
    ingest(s, simulatorObservations(s, start), start);
    ingest(s, [], start + 16000);
    expect(s.devices.every((d) => d.health === "unknown")).toBe(true);
  });
  it("binds proposal policy version in hash", () => {
    const s = fault("switch_failure");
    diagnose(s);
    const p = s.approvals[0]!;
    p.policyVersion = "other";
    expect(proposalHash(p)).not.toBe(p.hash);
  });
});

describe("collector and recovery regressions", () => {
  it("does not fabricate polls or cancel incidents for enrolled collectors on demo reset", () => {
    const s = fault("service_hang");
    const i = diagnose(s);
    const d = s.devices.find((d) => d.id === i.rootDeviceId)!;
    d.collectorManaged = true;
    i.generation = 0;
    const p = s.approvals[0]!;
    p.preconditions.generation = 0;
    p.hash = proposalHash(p);
    const before = simulatorObservations(s, start + 16000);
    expect(before.some((o) => o.deviceId === d.id)).toBe(false);
    executeSimulator(s, start + 16000);
    expect(s.commands[0]!.status).toBe("queued");
    injectScenario(s, "reset", start + 17000);
    expect(i.status).toBe("executing");
    expect(p.status).toBe("approved");
    expect(s.commands[0]!.status).toBe("queued");
  });
  it("clears old simulator source conflicts after resetting its scenario", () => {
    const s = fault("source_conflict");
    injectScenario(s, "reset", start + 20000);
    ingest(s, simulatorObservations(s, start + 25000), start + 25000);
    expect(s.devices.every((d) => !d.conflict && d.health === "online")).toBe(
      true,
    );
  });
  it("labels a live-only incident report with live provenance", () => {
    const s = fault("switch_failure");
    for (const d of s.devices) d.sourceMode = "live";
    const i = diagnose(s);
    expect(i.report?.sourceMode).toBe("live");
  });
  it("requires three observations taken after command execution", () => {
    const s = fault("service_hang");
    const i = diagnose(s);
    executeSimulator(s, start + 16000);
    s.devices.find((d) => d.kind === "service")!.healthySamples = 100;
    ingest(s, simulatorObservations(s, start + 20000), start + 20000);
    verify(s, start + 20000);
    expect(i.status).toBe("verifying");
    expect(i.healthySamples).toBe(1);
  });
  it("reopens a new fault after a resolved incident cooldown", () => {
    const s = fault("service_hang");
    const i = diagnose(s);
    executeSimulator(s, start + 16000);
    for (let n = 4; n <= 6; n++) {
      ingest(s, simulatorObservations(s, start + n * 5000), start + n * 5000);
      verify(s, start + n * 5000);
    }
    expect(i.status).toBe("resolved");
    s.scenario = "service_hang";
    ingest(s, simulatorObservations(s, start + 100000), start + 100000);
    detect(s, start + 100000);
    expect(s.incidents).toHaveLength(2);
  });
});

describe("independent observation dimensions", () => {
  it("combines Ping reachability with fresh application health without creating a conflict", () => {
    const s = createState(tenant, start);
    const d = s.devices[0]!;
    d.collectorManaged = true;
    const base = simulatorObservations(createState(tenant, start), start)[0]!;
    ingest(
      s,
      [
        { ...base, source: "http", health: "healthy" },
        {
          ...base,
          source: "ping",
          observedAt: new Date(start + 1000).toISOString(),
          health: "unknown",
          auth: "unknown",
        },
      ],
      start + 1000,
    );
    expect(d.health).toBe("online");
    expect(d.conflict).toBe(false);
    expect(d.reachability).toBe("reachable");
  });
  it("does not present stale application health as current when Ping keeps responding", () => {
    const s = createState(tenant, start);
    const d = s.devices[0]!;
    d.collectorManaged = true;
    const base = simulatorObservations(createState(tenant, start), start)[0]!;
    ingest(s, [{ ...base, source: "http", health: "healthy" }], start);
    ingest(
      s,
      [
        {
          ...base,
          source: "ping",
          observedAt: new Date(start + 20000).toISOString(),
          health: "unknown",
          auth: "unknown",
        },
      ],
      start + 20000,
    );
    expect(d.health).toBe("unknown");
    expect(d.reachability).toBe("reachable");
  });
});

describe("buffered collector observations", () => {
  it("counts three chronological failures delivered in one batch", () => {
    const s = createState(tenant, start);
    const d = s.devices[0]!;
    d.collectorManaged = true;
    d.pollIntervalMs = 30000;
    const base = simulatorObservations(createState(tenant, start), start)[0]!;
    ingest(
      s,
      [0, 30000, 60000].map((offset) => ({
        ...base,
        source: "edge",
        observedAt: new Date(start + offset).toISOString(),
        reachability: "unreachable" as const,
        health: "unknown" as const,
      })),
      start + 60000,
    );
    expect(d.failures).toBe(3);
    expect(d.health).toBe("offline");
  });
  it("accepts fresh collector evidence older than the built-in five-second poll interval", () => {
    const s = fault("service_hang");
    const d = s.devices.find((d) => d.kind === "service")!;
    d.collectorManaged = true;
    d.pollIntervalMs = 30000;
    const i = s.incidents[0]!;
    i.generation = 0;
    applyDiagnosis(s, i, fixtureDiagnosis(s, i), start + 31000);
    expect(i.status).toBe("executing");
  });
});

it("selects fresh evidence and the intended runbook independently of persisted row order", () => {
  const s = fault("switch_failure");
  const i = s.incidents[0]!;
  const expected = s.runbooks.find(
    (b) => b.title === "Upstream switch outage",
  )!.id;
  s.observations.reverse();
  s.runbooks.reverse();
  const d = fixtureDiagnosis(s, i);
  expect(d.evidenceIds).toContain(expected);
  applyDiagnosis(s, i, d, start + 27000);
  expect(i.status).toBe("awaiting_approval");
});

it('counts consecutive collector failures across its bounded exponential backoff', () => {
  const s=createState(tenant,start),d=s.devices[0]!;d.collectorManaged=true;d.pollIntervalMs=30000;
  const base=simulatorObservations(createState(tenant,start),start)[0]!;
  ingest(s,[0,60000,180000].map(offset=>({...base,source:'edge',observedAt:new Date(start+offset).toISOString(),reachability:'unreachable' as const,health:'unknown' as const})),start+180000);
  expect(d.failures).toBe(3);expect(d.health).toBe('offline');
});
