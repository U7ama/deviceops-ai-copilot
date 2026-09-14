import { createConnection, type Socket } from "node:net";
import { ConnectorError, sample, type Connector, type ConnectorContext, type EnrolledTarget } from "./types.js";
import { validateTarget } from "./scope.js";

/** Biamp Tesira Text Protocol (TTP) client. */
export function queryBiampTTP(target: EnrolledTarget, context: ConnectorContext, command: string): Promise<string> {
  validateTarget(target, context);
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection({ host: target.address, port: target.port ?? 23 });
    let buffer = "", finished = false;
    const finish = (error?: ConnectorError, result?: string) => {
      if (finished) return; finished = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(result!);
    };
    const timer = setTimeout(() => finish(new ConnectorError("transport", "Biamp TTP response timeout")), context.timeoutMs ?? 3000);
    socket.setEncoding("utf8");
    socket.on("error", () => finish(new ConnectorError("transport", "Biamp TTP connection failed", "unreachable")));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 4096) { finish(new ConnectorError("protocol", "Oversized Biamp TTP reply", "reachable")); return; }
      if (buffer.includes("-ERR")) {
        if (/authentication|password/i.test(buffer)) {
          finish(new ConnectorError("authentication", "Biamp TTP authentication rejected", "reachable")); return;
        }
        finish(new ConnectorError("protocol", "Biamp TTP command error", "reachable")); return;
      }
      if (buffer.includes("+OK") && (buffer.includes("\r") || buffer.includes("\n"))) {
        finish(undefined, buffer.trim());
      }
    });
    socket.on("connect", () => {
      if (context.credential) {
        socket.write(`SESSION set login ${context.credential}\r\n`);
      }
      socket.write(`${command}\r\n`);
    });
  });
}

export const biampConnector: Connector = {
  id: "biamp-tesira",
  async read(target, context) {
    const reply = await queryBiampTTP(target, context, "DEVICE get version");
    const health = "unknown";
    return sample(target, {
      reachability: "reachable", health, auth: context.credential ? "ok" : "unknown",
      metrics: { versionReply: reply, protocol: "biamp-tesira-ttp" }
    });
  },
};
