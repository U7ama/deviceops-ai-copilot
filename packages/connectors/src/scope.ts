import { isIP } from "node:net";
import type { ConnectorContext, EnrolledTarget } from "./types.js";
export function ipv4Number(address: string): number {
  if (isIP(address) !== 4) throw new Error("An IPv4 literal is required; hostnames and shell expressions are not accepted");
  return address.split(".").reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);
}
function range(entry: string): [number, number] {
  const pieces = entry.split("/");
  if (pieces.length > 2) throw new Error("Invalid target allowlist entry");
  const start = ipv4Number(pieces[0]!);
  if (pieces.length === 1) return [start, start];
  const prefix = Number(pieces[1]);
  if (!/^\d{1,2}$/.test(pieces[1]!) || prefix < 24 || prefix > 32) throw new Error("Allowed subnets must be /24 or smaller");
  const size = 2 ** (32 - prefix), base = Math.floor(start / size) * size;
  return [base, base + size - 1];
}
export function assertAllowedAddress(address: string, allowedTargets: readonly string[]): void {
  const candidate = ipv4Number(address);
  if (allowedTargets.length === 0 || allowedTargets.length > 256) throw new Error("Configure 1 to 256 allowlist entries");
  const ranges = allowedTargets.map(range);
  if (!ranges.some(([from, to]) => candidate >= from && candidate <= to)) throw new Error("Address is outside the configured collector allowlist");
}
export function validateTarget(target: EnrolledTarget, context: ConnectorContext): void {
  assertAllowedAddress(target.address, context.allowedTargets);
  if (!target.deviceId || target.deviceId.length > 128) throw new Error("Invalid device ID");
  if (target.sourceMode !== "live" && target.sourceMode !== "simulated") throw new Error("Explicit sourceMode is required");
  if (target.port !== undefined && (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535)) throw new Error("Invalid target port");
  if (context.timeoutMs !== undefined && (!Number.isInteger(context.timeoutMs) || context.timeoutMs < 10 || context.timeoutMs > 10000)) throw new Error("Timeout must be 10 to 10000 ms");
}
export function expandDiscoveryTargets(entries: readonly string[], allowedTargets: readonly string[]): string[] {
  const output = new Set<string>();
  for (const entry of entries) {
    const [from, to] = range(entry);
    for (let value = from; value <= to; value++) {
      if (to - from > 1 && (value === from || value === to)) continue;
      const address = [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
      assertAllowedAddress(address, allowedTargets); output.add(address);
      if (output.size > 256) throw new Error("Discovery is limited to 256 addresses per job");
    }
  }
  return [...output];
}
