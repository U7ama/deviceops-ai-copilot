import { createConnection, type Socket } from "node:net";
import { ConnectorError, sample, type Connector, type ConnectorContext, type EnrolledTarget } from "./types.js";
import { validateTarget } from "./scope.js";

/** Extron Simple Instruction Set (SIS) query over TCP. */
export function queryExtronSIS(target: EnrolledTarget, context: ConnectorContext, query: string): Promise<string> {
  validateTarget(target, context);
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection({ host: target.address, port: target.port ?? 23 });
    let buffer = "", finished = false;
    const finish = (error?: ConnectorError, result?: string) => {
      if (finished) return; finished = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(result!);
    };
    const timer = setTimeout(() => finish(new ConnectorError("transport", "Extron SIS response timeout")), context.timeoutMs ?? 3000);
    socket.setEncoding("utf8");
    socket.on("error", () => finish(new ConnectorError("transport", "Extron SIS connection failed", "unreachable")));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 4096) { finish(new ConnectorError("protocol", "Oversized SIS reply", "reachable")); return; }
      if (/password:/i.test(buffer)) {
        if (!context.credential) { finish(new ConnectorError("authentication", "Extron SIS password required", "reachable")); return; }
        socket.write(`${context.credential}\r`); buffer = ""; return;
      }
      if (/login failed|bad password/i.test(buffer)) {
        finish(new ConnectorError("authentication", "Extron SIS authentication rejected", "reachable")); return;
      }
      if (buffer.includes("\r") || buffer.includes("\n")) {
        const line = buffer.trim();
        finish(undefined, line);
      }
    });
    socket.on("connect", () => {
      socket.write(`${query}\r`);
    });
  });
}

export const extronConnector: Connector = {
  id: "extron-sis",
  async read(target, context) {
    const info = await queryExtronSIS(target, context, "I");
    let partNumber: string | null = null;
    try {
      partNumber = await queryExtronSIS(target, { ...context, timeoutMs: 1500 }, "N");
    } catch {}
    const health = "unknown";
    return sample(target, {
      reachability: "reachable", health, auth: context.credential ? "ok" : "unknown",
      metrics: { firmware: info, partNumber, protocol: "extron-sis" }
    });
  },
};
