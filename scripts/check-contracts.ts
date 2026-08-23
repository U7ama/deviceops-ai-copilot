import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CONTRACT_VERSION, contractSchemasHash } from "../packages/contracts/src/index.js";

async function main() {
  console.log("[contracts:check] Verifying contract versions across repositories...");

  const targetDirs = [
    { repo: "deviceops-mobile", path: join(process.cwd(), "..", "deviceops-mobile", "contracts", "contract-manifest.json") },
    { repo: "deviceops-automations", path: join(process.cwd(), "..", "deviceops-automations", "contracts", "contract-manifest.json") }
  ];

  let hasError = false;

  for (const item of targetDirs) {
    if (!existsSync(item.path)) {
      console.log(`[contracts:check] Note: ${item.repo} manifest not found at ${item.path} (standalone repository checkout).`);
      continue;
    }
    const content = JSON.parse(readFileSync(item.path, "utf-8"));
    if (content.version !== CONTRACT_VERSION || content.schemasSha256 !== contractSchemasHash()) {
      console.error(`[contracts:check] Stale manifest in ${item.repo}: expected ${CONTRACT_VERSION}, got ${content.version}`);
      hasError = true;
    } else {
      console.log(`[contracts:check] ${item.repo} is up to date (v${content.version}).`);
    }
  }

  if (hasError) {
    console.error("[contracts:check] Contract verification failed!");
    process.exit(1);
  }

  console.log("[contracts:check] All companion repository contracts are valid and synchronized.");
}

main().catch((err) => {
  console.error("[contracts:check] Error checking contracts:", err);
  process.exit(1);
});
