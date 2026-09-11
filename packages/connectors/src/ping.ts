import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { ConnectorError, sample, type Connector } from "./types.js";
import { validateTarget } from "./scope.js";
/** Linux iputils ping. A literal IPv4 target and fixed argv ensure no shell execution. */
export const pingConnector: Connector = {
  id: "ping",
  async read(target, context) {
    validateTarget(target, context);
    const timeout = context.timeoutMs ?? 3000;
    const start = performance.now();
    const reply = await new Promise<{ reachable: boolean; output: string }>((resolve, reject) => {
      execFile("ping", ["-n", "-c", "1", "-W", String(Math.ceil(timeout / 1000)), target.address],
        { timeout: timeout + 250, maxBuffer: 8192, env: { PATH: "/usr/bin:/bin", LANG: "C", NODE_ENV: "production" } }, (error, stdout) => {
          if (error && (error as NodeJS.ErrnoException).code === "ENOENT") reject(new ConnectorError("unsupported", "Install Linux iputils-ping"));
          else if (error && !error.killed && error.code !== 1) reject(new ConnectorError("transport", "ICMP probe unavailable"));
          else resolve({ reachable: !error, output: stdout });
        });
    });
    const match = /time[=<]([\d.]+)\s*ms/.exec(reply.output);
    return sample(target, { reachability: reply.reachable ? "reachable" : "unreachable", health: "unknown", auth: "unknown",
      metrics: { ...(reply.reachable ? { latencyMs: match ? Number(match[1]) : Math.round(performance.now() - start) } : {}), protocol: "icmp" } });
  },
};
