import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { JsonStore, acquireProcessLock } from "./store.js";
import { createSimulator, initialSimulatorState } from "./simulator.js";
async function main(): Promise<void> {
  const token = process.env.DEVICEOPS_SIMULATOR_TOKEN, admin = process.env.DEVICEOPS_SIMULATOR_ADMIN_TOKEN;
  if (!token || !admin) throw new Error("Simulator and admin tokens are required");
  const stateDirectory = resolve(process.env.DEVICEOPS_SIMULATOR_DATA ?? ".data/simulator");
  const release = await acquireProcessLock(resolve(stateDirectory, "simulator.lock"));
  try {
    const input = JSON.parse(await readFile(process.env.DEVICEOPS_SIMULATOR_CONFIG ?? "simulator.config.json", "utf8")) as Parameters<typeof initialSimulatorState>[0];
    const store = await JsonStore.load(resolve(stateDirectory, "state.json"), initialSimulatorState(input));
    const server = createSimulator(store, token, admin), port = Number(process.env.PORT ?? "4410");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, process.env.DEVICEOPS_SIMULATOR_BIND ?? "127.0.0.1", () => resolve()); });
    process.stdout.write(JSON.stringify({ event: "simulator_listening", port }) + "\n");
    await new Promise<void>((resolve) => {
      const stop = () => { server.close(() => resolve()); server.closeAllConnections(); };
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
    });
  } finally { await release(); }
}
main().catch(() => { process.stderr.write("Simulator failed; verify local configuration, tokens, and state.\n"); process.exitCode = 1; });
