import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONTRACT_VERSION, contractSchemasHash } from "../packages/contracts/src/index.js";

async function main() {
  console.log("[contracts:export] Exporting contract snapshot...");

  const manifest = {
    name: "deviceops-contracts",
    version: CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    schemasSha256: contractSchemasHash()
  };

  const targetDirs = [
    join(process.cwd(), "packages", "contracts", "dist"),
    join(process.cwd(), "..", "deviceops-mobile", "contracts"),
    join(process.cwd(), "..", "deviceops-automations", "contracts")
  ];

  for (const dir of targetDirs) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "contract-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
  }

  console.log("[contracts:export] Contract manifest exported successfully to companion repositories.");
}

main().catch((err) => {
  console.error("[contracts:export] Error exporting contracts:", err);
  process.exit(1);
});
