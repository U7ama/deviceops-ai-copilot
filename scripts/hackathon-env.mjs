/** Creates local-only secrets once. Never prints values or replaces existing files. */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const path = fileURLToPath(new URL('../.env.hackathon', import.meta.url));
const secret = () => randomBytes(32).toString('hex');
const lines = ['# Local synthetic fixture stack; private generated secrets.',
  'HACKATHON_PORT=3030', 'OPS_AGENT_MODE=fixture', 'OPS_MODEL_BUDGET_USD=6', 'AWS_CREDITS_CONFIRMED=false',
  `POSTGRES_ADMIN_PASSWORD=${secret()}`, `DEVICEOPS_APP_DB_PASSWORD=${secret()}`,
  `SESSION_SECRET=${secret()}`, `STRANDS_SERVICE_TOKEN=${secret()}`, `N8N_WEBHOOK_SECRET=${secret()}`,
  `N8N_ENCRYPTION_KEY=${secret()}`, `SEED_PASSWORD=${secret()}`, 'AWS_REGION=us-east-1'];
try { writeFileSync(path, lines.join('\n')+'\n', {encoding:'utf8',flag:'wx',mode:0o600}); console.log('Created private .env.hackathon (0600). Fixture mode makes no paid model calls.'); }
catch(error) { if(error.code==='EEXIST') console.error('.env.hackathon already exists; preserving it.'); else console.error('Could not create private local configuration.'); process.exitCode=1; }
