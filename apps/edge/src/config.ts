import { readFile } from "node:fs/promises";
import { connectors, validateTarget, type EnrolledTarget } from "@deviceops/connectors";
export interface EdgeConfig {
  collectorId: string; allowedTargets: string[]; targets: EnrolledTarget[];
  pollIntervalMs: number; timeoutMs: number; concurrency: number; allowInsecureHttp: boolean;
}
export function parseConfig(value: unknown): EdgeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected collector config object");
  const input = value as Record<string, unknown>;
  if (typeof input.collectorId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.collectorId)) throw new Error("Invalid collector ID");
  if (!Array.isArray(input.allowedTargets) || input.allowedTargets.some((entry) => typeof entry !== "string")) throw new Error("Explicit allowedTargets are required");
  if (!Array.isArray(input.targets) || input.targets.length > 1024) throw new Error("Configure at most 1024 enrolled targets");
  const pollIntervalMs = input.pollIntervalMs ?? 30000, timeoutMs = input.timeoutMs ?? 3000, concurrency = input.concurrency ?? 4;
  if (typeof pollIntervalMs !== "number" || !Number.isInteger(pollIntervalMs) || pollIntervalMs < 1000 || pollIntervalMs > 3600000) throw new Error("Polling interval must be 1000 to 3600000 ms");
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 10000) throw new Error("Timeout must be 10 to 10000 ms");
  if (typeof concurrency !== "number" || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error("Concurrency must be 1 to 4");
  const keys = new Set<string>();
  for (const raw of input.targets) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid enrollment");
    const target = raw as EnrolledTarget;
    if (!Object.hasOwn(connectors, target.connectorId)) throw new Error("Connector is planned or unknown; cannot enroll");
    validateTarget(target, { allowedTargets: input.allowedTargets as string[], timeoutMs });
    if (target.credentialRef !== undefined && !/^[a-zA-Z0-9_-]{1,128}$/.test(target.credentialRef)) throw new Error("Invalid credential reference");
    if (Object.keys(raw).some((key) => !["deviceId", "connectorId", "address", "port", "sourceMode", "credentialRef", "interfaceIndexes"].includes(key))) throw new Error("Unknown enrollment field; store secrets in the vault");
    const key = `${target.deviceId}:${target.connectorId}`;
    if (keys.has(key)) throw new Error("Duplicate device/source enrollment"); keys.add(key);
    if (target.connectorId === "simulator-http" && target.sourceMode !== "simulated") throw new Error("Simulator adapter requires simulated sourceMode");
    if (target.sourceMode === "live" && pollIntervalMs < 5000) throw new Error("Live devices require at least a five-second polling interval");
  }
  return { collectorId: input.collectorId, allowedTargets: input.allowedTargets as string[], targets: input.targets as EnrolledTarget[], pollIntervalMs, timeoutMs, concurrency, allowInsecureHttp: input.allowInsecureHttp === true };
}
export async function loadConfig(filename: string): Promise<EdgeConfig> {
  const encoded = await readFile(filename, "utf8");
  if (encoded.length > 1048576) throw new Error("Configuration exceeds 1 MiB");
  return parseConfig(JSON.parse(encoded));
}
export function validateBackendUrl(value: string, allowInsecureHttp: boolean): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("DEVICEOPS_URL must be a bare backend origin without credentials");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (allowInsecureHttp || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("Use HTTPS for remote backend or explicitly opt into HTTP for a trusted Docker network");
  return url.origin;
}
