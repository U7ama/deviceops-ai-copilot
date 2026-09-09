import { createConnection } from "node:net";
import { createHash } from "node:crypto";
import { ConnectorError, sample, type Connector, type ConnectorContext, type EnrolledTarget } from "./types.js";
import { validateTarget } from "./scope.js";
export type PJLinkQuery = "POWR" | "ERST" | "LAMP" | "INPT";
/** One read-only command per TCP session. The PJLink Class 1 challenge prefixes the query. */
export function queryPJLink(target: EnrolledTarget, context: ConnectorContext, command: PJLinkQuery): Promise<string> {
  validateTarget(target, context);
  if (!["POWR", "ERST", "LAMP", "INPT"].includes(command)) throw new ConnectorError("unsupported", "Only registered read queries are allowed");
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: target.address, port: target.port ?? 4352 });
    let buffer = "", greeted = false, finished = false;
    const finish = (error?: ConnectorError, result?: string) => {
      if (finished) return; finished = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(result!);
    };
    const timer = setTimeout(() => finish(new ConnectorError("transport", "PJLink response timeout", greeted ? "reachable" : "unknown")), context.timeoutMs ?? 3000);
    socket.setEncoding("utf8");
    socket.on("error", () => finish(new ConnectorError("transport", "PJLink connection failed", "unreachable")));
    socket.on("end", () => finish(new ConnectorError("protocol", "PJLink connection ended before response", greeted ? "reachable" : "unknown")));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 4096) { finish(new ConnectorError("protocol", "Oversized PJLink reply", "reachable")); return; }
      while (buffer.includes("\r") && !finished) {
        const end = buffer.indexOf("\r"), line = buffer.slice(0, end).replace(/^\n/, ""); buffer = buffer.slice(end + 1);
        if (!greeted) {
          let digest = "";
          if (line === "PJLINK 0") { /* no authentication */ }
          else if (/^PJLINK 1 [a-fA-F0-9]{8}$/.test(line)) {
            if (!context.credential) { finish(new ConnectorError("authentication", "PJLink password required", "reachable")); return; }
            digest = createHash("md5").update(line.slice(9) + context.credential).digest("hex");
          } else { finish(new ConnectorError("protocol", "Invalid PJLink greeting", "reachable")); return; }
          greeted = true; socket.write(`${digest}%1${command} ?\r`); continue;
        }
        if (line === "PJLINK ERRA" || line.endsWith("=ERRA")) { finish(new ConnectorError("authentication", "PJLink authentication rejected", "reachable")); return; }
        const prefix = `%1${command}=`;
        if (!line.startsWith(prefix)) { finish(new ConnectorError("protocol", "Unexpected PJLink reply", "reachable")); return; }
        finish(undefined, line.slice(prefix.length));
      }
    });
  });
}
export const pjlinkConnector: Connector = {
  id: "pjlink", async read(target, context) {
    const deadline = Date.now() + (context.timeoutMs ?? 3000);
    const values: Partial<Record<PJLinkQuery, string>> = {};
    for (const query of ["POWR", "ERST", "LAMP", "INPT"] as const) {
      const timeoutMs = Math.max(10, deadline - Date.now());
      if (Date.now() >= deadline) throw new ConnectorError("transport", "PJLink polling deadline reached", "reachable");
      values[query] = await queryPJLink(target, { ...context, timeoutMs }, query);
    }
    const errors = values.ERST;
    const health = errors && /^[012]{6}$/.test(errors) ? errors.includes("2") ? "error" : errors.includes("1") ? "warning" : "healthy" : "unknown";
    return sample(target, { reachability: "reachable", health, auth: context.credential ? "ok" : "unknown", metrics: {
      power: values.POWR, errorCodes: errors, lamp: values.LAMP, input: values.INPT,
      unsupportedQueries: Object.entries(values).filter(([, value]) => value.startsWith("ERR")).map(([key]) => key), protocol: "pjlink-class1",
    } });
  },
};
