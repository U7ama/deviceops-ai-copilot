import { performance } from "node:perf_hooks";

const REDACTED = "[REDACTED]";
const secretKeyPattern =
  /authorization|cookie|password|secret|token|api[-_]?key|raw(Media|Prompt|Audio|Image)/i;

export type LogLevel = "debug" | "info" | "warn" | "error";

export function redact(value: unknown, key = ""): unknown {
  if (secretKeyPattern.test(key)) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        redact(child, childKey)
      ])
    );
  }
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, `Bearer ${REDACTED}`)
      .replace(/sk-[A-Za-z0-9_-]{12,}/g, REDACTED);
  }
  return value;
}

export function log(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {}
): void {
  const safeFields = redact(fields) as Record<string, unknown>;
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...safeFields
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function logStructured(
  event: string,
  fields: Record<string, unknown> = {},
  level: LogLevel = "info"
): void {
  log(level, event, fields);
}

type MetricLabels = Record<string, string | number | boolean>;

class MetricsRegistry {
  readonly #counters = new Map<string, number>();
  readonly #observations = new Map<string, number[]>();

  increment(name: string, labels: MetricLabels = {}, amount = 1): void {
    const key = this.key(name, labels);
    this.#counters.set(key, (this.#counters.get(key) ?? 0) + amount);
  }

  observe(name: string, value: number, labels: MetricLabels = {}): void {
    const key = this.key(name, labels);
    const values = this.#observations.get(key) ?? [];
    values.push(value);
    if (values.length > 10_000) values.shift();
    this.#observations.set(key, values);
  }

  snapshot(): Record<string, unknown> {
    return {
      counters: Object.fromEntries(this.#counters),
      observations: Object.fromEntries(
        [...this.#observations.entries()].map(([key, values]) => [
          key,
          {
            count: values.length,
            p50: percentile(values, 0.5),
            p95: percentile(values, 0.95),
            p99: percentile(values, 0.99)
          }
        ])
      )
    };
  }

  toPrometheus(): string {
    const lines: string[] = [];
    for (const [key, value] of this.#counters) lines.push(`${key} ${value}`);
    for (const [key, values] of this.#observations) {
      lines.push(`${key}_count ${values.length}`);
      lines.push(`${key}_p50 ${percentile(values, 0.5)}`);
      lines.push(`${key}_p95 ${percentile(values, 0.95)}`);
      lines.push(`${key}_p99 ${percentile(values, 0.99)}`);
    }
    return `${lines.join("\n")}\n`;
  }

  private key(name: string, labels: MetricLabels): string {
    const safeName = name.replace(/[^a-zA-Z0-9_:]/g, "_");
    const entries = Object.entries(labels).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    if (entries.length === 0) return safeName;
    const rendered = entries
      .map(([label, value]) => `${label}="${String(value).replaceAll('"', '\\"')}"`)
      .join(",");
    return `${safeName}{${rendered}}`;
  }
}

export const metrics = new MetricsRegistry();

export function recordTraceSpan(
  service: string,
  name: string,
  durationMs: number,
  attributes: Record<string, unknown> = {}
): void {
  const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://127.0.0.1:4318/v1/traces";
  const now = Date.now();
  const payload = {
    resourceSpans: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: service } }] },
        scopeSpans: [
          {
            scope: { name: "@deviceops/observability" },
            spans: [
              {
                traceId: Math.random().toString(16).slice(2).padStart(32, "0"),
                spanId: Math.random().toString(16).slice(2).padStart(16, "0"),
                name,
                kind: 1,
                startTimeUnixNano: (BigInt(now - Math.max(1, Math.round(durationMs))) * 1_000_000n).toString(),
                endTimeUnixNano: (BigInt(now) * 1_000_000n).toString(),
                attributes: Object.entries(attributes).map(([k, v]) => ({
                  key: k,
                  value:
                    typeof v === "number"
                      ? Number.isInteger(v)
                        ? { intValue: v }
                        : { doubleValue: v }
                      : typeof v === "boolean"
                        ? { boolValue: v }
                        : { stringValue: String(v) }
                }))
              }
            ]
          }
        ]
      }
    ]
  };
  fetch(otelEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(() => undefined);
}

export async function timed<T>(
  metric: string,
  operation: () => Promise<T>,
  labels: MetricLabels = {}
): Promise<T> {
  const start = performance.now();
  try {
    const result = await operation();
    const duration = performance.now() - start;
    metrics.observe(metric, duration, { ...labels, ok: true });
    recordTraceSpan(
      process.env.OTEL_SERVICE_NAME ?? "deviceops-api",
      metric,
      duration,
      { ...labels, ok: true }
    );
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    metrics.observe(metric, duration, { ...labels, ok: false });
    recordTraceSpan(
      process.env.OTEL_SERVICE_NAME ?? "deviceops-api",
      metric,
      duration,
      { ...labels, ok: false }
    );
    throw error;
  }
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return Number((sorted[index] ?? 0).toFixed(2));
}
