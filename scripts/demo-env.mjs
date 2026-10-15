/** Prepare the local demo without replacing existing private configuration. */
import { existsSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const config = fileURLToPath(new URL('../.env.demo', import.meta.url));
const legacyConfig = fileURLToPath(new URL('../.env.hackathon', import.meta.url));
if (existsSync(config)) {
  console.log('Private .env.demo already exists; preserving it.');
} else {
  if (!existsSync(legacyConfig)) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./hackathon-env.mjs', import.meta.url))], { stdio: 'pipe' });
    if (result.status !== 0) {
      console.error('Could not prepare private local configuration.');
      process.exit(1);
    }
  }
  symlinkSync('.env.hackathon', config);
  console.log('Prepared private .env.demo using existing local configuration. Fixture mode makes no paid model calls.');
}
