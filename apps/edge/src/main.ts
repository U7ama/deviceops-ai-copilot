import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CredentialVault } from "@deviceops/connectors";
import { loadConfig } from "./config.js";
import { EdgeCollector, initialCollectorState, type CollectorState } from "./collector.js";
import { JsonStore, acquireProcessLock } from "./store.js";
import { discoverTargets } from "./discovery.js";
async function main(): Promise<void> {
  const command = process.argv[2] ?? "run", stateDirectory = resolve(process.env.DEVICEOPS_EDGE_DATA ?? ".data");
  const release = await acquireProcessLock(resolve(stateDirectory, "edge.lock"));
  try {
    const state = await JsonStore.load<CollectorState>(resolve(stateDirectory, "collector.json"), initialCollectorState());
    const vault = process.env.DEVICEOPS_VAULT_KEY ? new CredentialVault(resolve(stateDirectory, "credentials.enc.json"), process.env.DEVICEOPS_VAULT_KEY) : undefined;
    if (["vault-set", "vault-revoke", "resume-credential"].includes(command)) {
      const reference = process.argv[3]; if (!reference) throw new Error("Supply an opaque credential reference");
      if (command === "vault-set") {
        if (!vault || !process.env.DEVICEOPS_CREDENTIAL_VALUE) throw new Error("Set DEVICEOPS_VAULT_KEY and DEVICEOPS_CREDENTIAL_VALUE in the process environment");
        await vault.set(reference, process.env.DEVICEOPS_CREDENTIAL_VALUE); delete process.env.DEVICEOPS_CREDENTIAL_VALUE;
      } else if (command === "vault-revoke") {
        if (!vault) throw new Error("DEVICEOPS_VAULT_KEY is required"); await vault.revoke(reference);
      }
      await state.update((value) => {
        if (command === "vault-revoke") value.pausedCredentials[reference] = true; else delete value.pausedCredentials[reference];
        value.retries = {};
      });
      process.stdout.write(JSON.stringify({ status: "updated", command }) + "\n"); return;
    }
    const config = await loadConfig(process.env.DEVICEOPS_EDGE_CONFIG ?? "edge.config.json");
    if (command === "discover") {
      const entries = process.argv.slice(3); if (!entries.length) throw new Error("Supply explicit IPs or configured /24-or-smaller CIDRs");
      const result = await discoverTargets(entries, { allowedTargets: config.allowedTargets, timeoutMs: config.timeoutMs });
      process.stdout.write(JSON.stringify(result, null, 2) + "\n"); return;
    }
    if (command !== "run" && command !== "once") throw new Error("Commands: run, once, discover, vault-set, vault-revoke, resume-credential");
    const backend = process.env.DEVICEOPS_URL, token = process.env.DEVICEOPS_COLLECTOR_TOKEN;
    if (!backend || !token) throw new Error("Set DEVICEOPS_URL and DEVICEOPS_COLLECTOR_TOKEN");
    const collector = new EdgeCollector(config, state, backend, token, vault, (event, detail) => process.stdout.write(JSON.stringify({ at: new Date().toISOString(), event, ...detail }) + "\n"));
    const stop = new AbortController();
    process.once("SIGINT", () => stop.abort()); process.once("SIGTERM", () => stop.abort());
    do {
      await collector.tick(); if (command === "once" || stop.signal.aborted) break;
      await delay(Math.min(config.pollIntervalMs, 5000), undefined, { signal: stop.signal }).catch(() => undefined);
    } while (!stop.signal.aborted);
  } finally { await release(); }
}
main().catch(() => { process.stderr.write("Edge failed. Check configuration, permissions, credentials, and local state; secret-bearing error details are suppressed.\n"); process.exitCode = 1; });
