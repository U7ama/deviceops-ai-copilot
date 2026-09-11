/** Public normalized transport contract. Secret values never belong in observations. */
export type MetricValue = string | number | boolean | null;
export type SourceMode = "simulated" | "live";
export type Reachability = "reachable" | "unreachable" | "unknown";
export type DeviceHealth = "healthy" | "warning" | "error" | "unknown";
export type Authentication = "ok" | "failed" | "unknown";
export type ConnectorId = "ping" | "snmp-v2c" | "snmp-switch-ports" | "pjlink" | "simulator-http";
export interface Observation {
  deviceId: string; source: string; sourceMode: SourceMode; observedAt: string;
  reachability: Reachability; health: DeviceHealth; auth: Authentication; metrics: Record<string, MetricValue>;
}
export interface EnrolledTarget {
  deviceId: string; connectorId: ConnectorId; address: string; port?: number; sourceMode: SourceMode; credentialRef?: string;
  /** Explicit IF-MIB indexes; no unbounded walk. */
  interfaceIndexes?: number[];
}
export interface ConnectorContext {
  allowedTargets: readonly string[]; timeoutMs?: number;
  /** Loaded locally from vault, never emitted in telemetry. */
  credential?: string;
}
export interface Connector { id: ConnectorId; read(target: EnrolledTarget, context: ConnectorContext): Promise<Observation> }
export type SimulatorAction = "restart_service" | "restart_switch";
export class ConnectorError extends Error {
  constructor(public readonly kind: "authentication" | "transport" | "protocol" | "unsupported", message: string,
    public readonly reachability: Reachability = "unknown") { super(message); this.name = "ConnectorError"; }
}
export function sample(target: EnrolledTarget, values: Pick<Observation, "reachability" | "health" | "auth"> & { metrics: Record<string, unknown> }): Observation {
  return { deviceId: target.deviceId, source: target.connectorId, sourceMode: target.sourceMode, observedAt: new Date().toISOString(), ...values, metrics: flattenMetrics(values.metrics) };
}
export function failedSample(target: EnrolledTarget, error: unknown): Observation {
  const typed = error instanceof ConnectorError ? error : new ConnectorError("protocol", "Connector failed");
  return sample(target, { reachability: typed.reachability, health: "unknown", auth: typed.kind === "authentication" ? "failed" : "unknown", metrics: { errorKind: typed.kind } });
}

/** Backend metrics are bounded scalars. Preserve port/source identity with dotted paths. */
export function flattenMetrics(input: Record<string, unknown>): Record<string, MetricValue> {
  const output: Record<string, MetricValue> = {};
  const visit = (value: unknown, path: string, depth: number): void => {
    if (!path || path.length > 80 || Object.keys(output).length >= 256 || depth > 4) return;
    if (value === null || typeof value === "boolean") output[path] = value;
    else if (typeof value === "number") output[path] = Number.isFinite(value) ? value : null;
    else if (typeof value === "string") output[path] = value.slice(0, 400);
    else if (Array.isArray(value)) value.slice(0, 96).forEach((item, index) => visit(item, `${path}.${index}`, depth + 1));
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value).slice(0, 96)) {
      if (/^[a-zA-Z0-9_-]{1,80}$/.test(key) && !["__proto__", "constructor", "prototype"].includes(key)) visit(item, `${path}.${key}`, depth + 1);
    }
  };
  for (const [key, value] of Object.entries(input).slice(0, 256)) if (/^[a-zA-Z0-9_-]{1,80}$/.test(key) && !["__proto__", "constructor", "prototype"].includes(key)) visit(value, key, 0);
  return output;
}
