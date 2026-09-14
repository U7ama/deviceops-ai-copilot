import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Socket } from "node:net";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createSocket, type Socket as DatagramSocket } from "node:dgram";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import {
  CredentialVault,
  flattenMetrics,
  assertAllowedAddress,
  expandDiscoveryTargets,
  integrationCatalog,
  pingConnector,
  pjlinkConnector,
  queryPJLink,
  snmpConnector,
  snmpSwitchConnector,
  extronConnector,
  axisConnector,
  sonyConnector,
  netioConnector,
  barcoConnector,
  biampConnector,
  crestronNvxConnector,
  zoomConnector,
  failedSample,
  type EnrolledTarget
} from "./index.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
const context = { allowedTargets: ["127.0.0.1/32"], timeoutMs: 1000 };

function target(connectorId: EnrolledTarget["connectorId"], port?: number): EnrolledTarget {
  return { deviceId: "fixture-device", address: "127.0.0.1", sourceMode: "simulated", connectorId, ...(port ? { port } : {}) };
}

async function tcpFixture(reply: (command: string) => string | null, password?: string): Promise<number> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket)); socket.on("error", () => undefined);
    socket.write(password ? "PJLINK 1 1234abcd\r" : "PJLINK 0\r");
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString(); if (!buffer.endsWith("\r")) return;
      if (password) {
        const digest = createHash("md5").update("1234abcd" + password).digest("hex");
        if (!buffer.startsWith(digest)) { socket.end("PJLINK ERRA\r"); return; }
        buffer = buffer.slice(32);
      }
      const result = reply(buffer); if (result !== null) socket.write(result); buffer = "";
    });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  cleanups.push(async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  return (server.address() as { port: number }).port;
}

async function httpFixture(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<number> {
  const server = createHttpServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return (server.address() as { port: number }).port;
}

interface FixtureMib { registerProvider(provider: object): void; setScalarValue(name: string, value: unknown): void; addTableRow(name: string, values: unknown[]): void }
interface FixtureAgent { getAuthorizer(): { addCommunity(value: string): void }; getMib(): FixtureMib; listener: { sockets: Record<string, DatagramSocket> }; close(callback: () => void): void }
interface FixtureLibrary { createAgent(options: object, callback: (error: unknown) => void): FixtureAgent; MibProviderType: { Scalar: number; Table: number }; ObjectType: { OctetString: number; Integer: number; TimeTicks: number }; MaxAccess: Record<string, number> }

async function snmpFixture(): Promise<number> {
  const snmp = createRequire(import.meta.url)("net-snmp") as FixtureLibrary;
  const reservation = createSocket("udp4"); reservation.bind(0, "127.0.0.1"); await once(reservation, "listening");
  const port = reservation.address().port; await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const agent = snmp.createAgent({ port, address: "127.0.0.1", transport: "udp4", disableAuthorization: false }, () => undefined);
  agent.getAuthorizer().addCommunity("fixture-read-only");
  const mib = agent.getMib();
  for (const [name, oid, type, value] of [["sysDescr", "1.3.6.1.2.1.1.1", snmp.ObjectType.OctetString, "Fixture switch"], ["sysUpTime", "1.3.6.1.2.1.1.3", snmp.ObjectType.TimeTicks, 5000], ["sysName", "1.3.6.1.2.1.1.5", snmp.ObjectType.OctetString, "switch-a"]] as const) {
    mib.registerProvider({ name, type: snmp.MibProviderType.Scalar, oid, scalarType: type, maxAccess: snmp.MaxAccess["read-only"] }); mib.setScalarValue(name, value);
  }
  mib.registerProvider({ name: "ifTable", type: snmp.MibProviderType.Table, oid: "1.3.6.1.2.1.2.2.1", maxAccess: snmp.MaxAccess["not-accessible"],
    tableColumns: [[1, "ifIndex", snmp.ObjectType.Integer], [2, "ifDescr", snmp.ObjectType.OctetString], [7, "ifAdminStatus", snmp.ObjectType.Integer], [8, "ifOperStatus", snmp.ObjectType.Integer]].map(([number, name, type]) => ({ number, name, type, maxAccess: snmp.MaxAccess["read-only"] })), tableIndex: [{ columnName: "ifIndex" }] });
  mib.addTableRow("ifTable", [1, "uplink", 1, 1]); mib.addTableRow("ifTable", [2, "projector", 1, 2]);
  await Promise.all(Object.values(agent.listener.sockets).map((socket) => once(socket, "listening")));
  cleanups.push(() => new Promise<void>((resolve) => agent.close(resolve))); return port;
}

describe("connector catalog and scope", () => {
  it("retains all 57 entries with truthful implementation and category counts", () => {
    expect(integrationCatalog).toHaveLength(57); expect(new Set(integrationCatalog.map((item) => item.id)).size).toBe(57);
    expect(Object.fromEntries(["cloud", "on-lan", "server", "manufacturer-cloud"].map((category) => [category, integrationCatalog.filter((item) => item.category === category).length]))).toEqual({ cloud: 11, "on-lan": 39, server: 6, "manufacturer-cloud": 1 });
    expect(integrationCatalog.filter((item) => item.status === "planned")).toHaveLength(45);
    expect(integrationCatalog.filter((item) => item.status === "simulator-tested")).toHaveLength(11);
    expect(integrationCatalog.filter((item) => item.status === "implemented")).toHaveLength(1);
    expect(integrationCatalog.some((item) => item.status === "hardware/service-verified")).toBe(false);
  });
  it("rejects shell inputs, DNS targets, out-of-scope addresses and broad subnets", () => {
    for (const address of ["127.0.0.1;id", "$(id)", "localhost", "127.0.0.2", "169.254.169.254"]) expect(() => assertAllowedAddress(address, context.allowedTargets)).toThrow();
    expect(() => expandDiscoveryTargets(["10.0.0.0/23"], ["10.0.0.0/23"])).toThrow(/24/);
    expect(expandDiscoveryTargets(["10.0.0.0/24"], ["10.0.0.0/24"])).toHaveLength(254);
    expect(expandDiscoveryTargets(["127.0.0.1", "127.0.0.1/32"], context.allowedTargets)).toEqual(["127.0.0.1"]);
  });
  it("emits only bounded scalar metrics compatible with the ingestion contract", () => {
    const metrics = flattenMetrics({ ports: [{ index: 2, operStatus: 1 }], description: "x".repeat(500), invalid: Number.NaN });
    expect(metrics).toEqual({ "ports.0.index": 2, "ports.0.operStatus": 1, description: "x".repeat(400), invalid: null });
    expect(Object.values(metrics).every((value) => value === null || ["string", "number", "boolean"].includes(typeof value))).toBe(true);
  });
  it("uses actual loopback ICMP without inferring application health", async () => {
    const result = await pingConnector.read(target("ping"), context);
    expect(result.reachability).toBe("reachable"); expect(result.health).toBe("unknown"); expect(result.metrics.latencyMs).toEqual(expect.any(Number));
  });
});

describe("PJLink TCP protocol", () => {
  it("reads authenticated status and preserves unsupported queries", async () => {
    const replies: Record<string, string> = { POWR: "1", ERST: "010000", LAMP: "ERR1", INPT: "31" };
    const port = await tcpFixture((command) => { const name = command.slice(2, 6); return `%1${name}=${replies[name]}\r`; }, "fixture-password");
    const result = await pjlinkConnector.read(target("pjlink", port), { ...context, credential: "fixture-password" });
    expect(result.health).toBe("warning"); expect(result.auth).toBe("ok"); expect(result.metrics["unsupportedQueries.0"]).toBe("LAMP");
  });
  it("distinguishes rejected passwords from offline state without exposing secrets", async () => {
    const port = await tcpFixture(() => null, "expected-secret");
    const device = target("pjlink", port);
    const error = await queryPJLink(device, { ...context, credential: "bad-secret" }, "POWR").catch((value: unknown) => value);
    expect(failedSample(device, error)).toMatchObject({ reachability: "reachable", auth: "failed", health: "unknown" });
    expect(JSON.stringify(failedSample(device, error))).not.toMatch(/bad-secret|expected-secret/);
  });
  it("bounds a server that never answers", async () => {
    const port = await tcpFixture(() => null), started = Date.now();
    await expect(queryPJLink(target("pjlink", port), { ...context, timeoutMs: 30 }, "POWR")).rejects.toMatchObject({ kind: "transport" });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("SNMP UDP fixtures", () => {
  it("reads standard system fields and explicit IF-MIB ports over v2c", async () => {
    const port = await snmpFixture(), credential = "fixture-read-only";
    const result = await snmpConnector.read(target("snmp-v2c", port), { ...context, credential });
    expect(result.metrics).toMatchObject({ description: "Fixture switch", uptimeTicks: 5000, name: "switch-a" });
    expect(result.health).toBe("unknown");
    const ports = await snmpSwitchConnector.read({ ...target("snmp-switch-ports", port), interfaceIndexes: [1, 2] }, { ...context, credential });
    expect(ports.health).toBe("warning"); expect(ports.metrics).toMatchObject({ "ports.0.index": 1, "ports.0.description": "uplink", "ports.0.adminStatus": 1, "ports.0.operStatus": 1, "ports.1.index": 2, "ports.1.description": "projector", "ports.1.adminStatus": 1, "ports.1.operStatus": 2 });
  });
  it("does not assert credential failure or offline from a dropped v2c request", async () => {
    const port = await snmpFixture(), device = target("snmp-v2c", port);
    const error = await snmpConnector.read(device, { ...context, timeoutMs: 30, credential: "wrong-community" }).catch((value: unknown) => value);
    expect(failedSample(device, error)).toMatchObject({ reachability: "unknown", health: "unknown", auth: "unknown", metrics: { errorKind: "transport" } });
  });
});

describe("Extron SIS TCP protocol", () => {
  it("reads firmware and part number over SIS ASCII protocol", async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket); socket.on("data", (data) => {
        const cmd = data.toString().trim();
        if (cmd === "I") socket.write("1.04\r\n");
        else if (cmd === "N") socket.write("60-1234-01\r\n");
      });
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    cleanups.push(async () => { for (const s of sockets) s.destroy(); await new Promise<void>((r) => server.close(() => r())); });

    const result = await extronConnector.read(target("extron-sis", port), context);
    expect(result.reachability).toBe("reachable");
    expect(result.health).toBe("unknown");
    expect(result.metrics).toMatchObject({ firmware: "1.04", partNumber: "60-1234-01", protocol: "extron-sis" });
  });
});

describe("Axis VAPIX HTTP API", () => {
  it("reads camera device info with basic auth", async () => {
    const port = await httpFixture((req, res) => {
      if (req.url === "/axis-cgi/basicdeviceinfo.cgi") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ DeviceInformation: { Model: "M3065-V", SerialNumber: "ACCC8E123456", Version: "10.12.203", Uptime: 86400 } }));
      } else {
        res.writeHead(404); res.end();
      }
    });
    const result = await axisConnector.read(target("axis-vapix", port), { ...context, credential: "root:pass" });
    expect(result.reachability).toBe("reachable");
    expect(result.health).toBe("unknown");
    expect(result.metrics).toMatchObject({ model: "M3065-V", serialNumber: "ACCC8E123456", firmwareVersion: "10.12.203", uptimeSeconds: 86400, protocol: "axis-vapix" });
  });

  it("handles 401 unauthorized gracefully", async () => {
    const port = await httpFixture((_req, res) => {
      res.writeHead(401); res.end();
    });
    const device = target("axis-vapix", port);
    const error = await axisConnector.read(device, context).catch((e: unknown) => e);
    expect(failedSample(device, error)).toMatchObject({ reachability: "reachable", auth: "failed" });
  });
});

describe("Sony BRAVIA B2B REST API", () => {
  it("reads display power status via JSON-RPC with PSK", async () => {
    const port = await httpFixture((req, res) => {
      if (req.url === "/sony/system" && req.headers["x-auth-psk"] === "secret-psk") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result: [{ status: "active" }], id: 1 }));
      } else {
        res.writeHead(403); res.end();
      }
    });
    const result = await sonyConnector.read(target("sony-pro", port), { ...context, credential: "secret-psk" });
    expect(result.reachability).toBe("reachable");
    expect(result.health).toBe("healthy");
    expect(result.metrics.powerStatus).toBe("active");
  });
});

describe("NETIO Smart PDU JSON API", () => {
  it("reads voltage, power, and outputs from netio.json", async () => {
    const port = await httpFixture((req, res) => {
      if (req.url === "/netio.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          Agent: { Model: "PowerPDU 4C", Version: "3.4.1" },
          GlobalMeasure: { Voltage: 230.2, Frequency: 50.0, TotalPower: 350 },
          Outputs: [{ ID: 1, Name: "Display", State: 1 }, { ID: 2, Name: "Amp", State: 1 }]
        }));
      } else {
        res.writeHead(404); res.end();
      }
    });
    const result = await netioConnector.read(target("netio-pdu", port), context);
    expect(result.reachability).toBe("reachable");
    expect(result.health).toBe("healthy");
    expect(result.metrics).toMatchObject({ model: "PowerPDU 4C", voltage: 230.2, totalPowerWatts: 350, outputCount: 2, protocol: "netio-json" });
  });
});

describe("Barco ClickShare REST API", () => {
  it("reads ClickShare unit status and temperature", async () => {
    const port = await httpFixture((req, res) => {
      if (req.url === "/v2/system") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ model: "CX-50", serialNumber: "1928374", firmwareVersion: "02.14.00", temperature: 41.5, status: "ok" }));
      } else {
        res.writeHead(404); res.end();
      }
    });
    const result = await barcoConnector.read(target("barco-clickshare", port), context);
    expect(result.reachability).toBe("reachable");
    expect(result.health).toBe("healthy");
    expect(result.metrics).toMatchObject({ model: "CX-50", serialNumber: "1928374", temperatureC: 41.5, status: "ok" });
  });
});

describe("Biamp Tesira TTP TCP protocol", () => {
  it("reads DSP device version over line-delimited TTP", async () => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("data", (data) => {
        if (data.toString().includes("DEVICE get version")) {
          socket.write("+OK \"version\": \"4.3.0.12\"\r\n");
        }
      });
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    cleanups.push(async () => { for (const s of sockets) s.destroy(); await new Promise<void>((r) => server.close(() => r())); });

    const result = await biampConnector.read(target("biamp-tesira", port), context);
    expect(result.reachability).toBe("reachable");
    expect(result.health).toBe("unknown");
    expect(result.metrics.protocol).toBe("biamp-tesira-ttp");
  });
});

describe("Crestron DM NVX REST API", () => {
  it("reads streaming device model and firmware", async () => {
    const port = await httpFixture((req, res) => {
      if (req.url === "/Device/DeviceInfo") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ Device: { DeviceInfo: { Model: "DM-NVX-360", SerialNumber: "20491823", FirmwareVersion: "7.1.5034" } } }));
      } else {
        res.writeHead(404); res.end();
      }
    });
    const result = await crestronNvxConnector.read(target("crestron-nvx-nax", port), context);
    expect(result.reachability).toBe("reachable");
    expect(result.health).toBe("unknown");
    expect(result.metrics).toMatchObject({ model: "DM-NVX-360", serialNumber: "20491823", firmwareVersion: "7.1.5034" });
  });
});

describe("Zoom Rooms Cloud REST API", () => {
  it("does not invent room or peripheral health when telemetry is missing", async () => {
    const port = await httpFixture((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "fixture-device" }));
    });
    const result = await zoomConnector.read(target("zoom-rooms", port), context);
    expect(result.reachability).toBe("reachable");
    expect(result.health).toBe("unknown");
    expect(result.metrics).toMatchObject({
      roomStatus: null, roomHealth: null, microphoneStatus: null,
      speakerStatus: null, cameraStatus: null
    });
  });

  it("reads room status and peripheral health", async () => {
    const port = await httpFixture((req, res) => {
      if (req.url?.startsWith("/v2/rooms/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "Available",
          health: "Good",
          devices: { microphone: "Normal", speaker: "Normal", camera: "Normal" }
        }));
      } else {
        res.writeHead(404); res.end();
      }
    });
    const result = await zoomConnector.read(target("zoom-rooms", port), { ...context, credential: "mock-oauth-token" });
    expect(result.reachability).toBe("reachable");
    expect(result.health).toBe("healthy");
    expect(result.metrics).toMatchObject({
      roomStatus: "Available",
      roomHealth: "Good",
      microphoneStatus: "Normal",
      speakerStatus: "Normal",
      cameraStatus: "Normal"
    });
  });
});

describe("local credential vault", () => {
  it("encrypts, replaces, revokes and rejects tampering or a different key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deviceops-vault-")); cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const filename = join(directory, "credentials.json"), key = randomBytes(32).toString("base64"), vault = new CredentialVault(filename, key);
    await vault.set("snmp", "never-in-plaintext"); expect(await vault.get("snmp")).toBe("never-in-plaintext");
    expect(await readFile(filename, "utf8")).not.toContain("never-in-plaintext"); expect((await stat(filename)).mode & 0o777).toBe(0o600);
    await expect(new CredentialVault(filename, randomBytes(32).toString("base64")).get("snmp")).rejects.toThrow(/authentication/);
    await vault.set("snmp", "replacement"); expect(await vault.get("snmp")).toBe("replacement");
    await vault.revoke("snmp"); expect(await vault.get("snmp")).toBeUndefined(); expect(await vault.get("constructor")).toBeUndefined();
    const envelope = JSON.parse(await readFile(filename, "utf8")) as { tag: string }; envelope.tag = randomBytes(16).toString("base64");
    await writeFile(filename, JSON.stringify(envelope)); await expect(vault.get("snmp")).rejects.toThrow(/authentication/);
  });
});
