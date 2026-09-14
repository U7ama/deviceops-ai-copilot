/** Read-only local checks. Never invokes AWS or a model. */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
let failures=0;
const check=(name,passed)=>{console.log(`${passed?'PASS':'FAIL'} ${name}`);if(!passed)failures++;};
check('Node 22.16.0',process.versions.node==='22.16.0');
check('root dependencies installed',existsSync(`${root}/node_modules/tsx/dist/loader.mjs`));
check('Docker Compose available',spawnSync('docker',['compose','version'],{encoding:'utf8'}).status===0);
check('Docker daemon available',spawnSync('docker',['info','--format','{{.ServerVersion}}'],{encoding:'utf8'}).status===0);
const envPath=`${root}/.env.hackathon`;check('private .env.hackathon present',existsSync(envPath));
if(existsSync(envPath)) {
 const env=Object.fromEntries(readFileSync(envPath,'utf8').split('\n').filter(x=>x&&!x.startsWith('#')).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
 for(const key of ['SESSION_SECRET','STRANDS_SERVICE_TOKEN','POSTGRES_ADMIN_PASSWORD','DEVICEOPS_APP_DB_PASSWORD','SEED_PASSWORD'])check(`${key} configured`,(env[key]??'').length>=32);
 const syntax=spawnSync('docker',['compose','--env-file',envPath,'-f',`${root}/compose.hackathon.yaml`,'config','--quiet'],{encoding:'utf8'});check('fixture Compose configuration valid',syntax.status===0);
 check('explicit investigation mode valid',['fixture','bedrock','qwen'].includes(env.OPS_AGENT_MODE??'fixture'));
 if(env.OPS_AGENT_MODE==='qwen') {
  check('Google usage explicitly confirmed',env.QWEN_USAGE_CONFIRMED==='true');
  check('private Qwen key configured',Boolean(env.ABQWEN_API_KEY));
 }
 if(env.OPS_AGENT_MODE==='bedrock') {
  check('promotional credits explicitly confirmed',env.AWS_CREDITS_CONFIRMED==='true');
  check('confirmed usable credit balance at least $50',Number(env.AWS_CREDIT_BALANCE_USD)>=50);
  check('Bedrock model access explicitly confirmed',env.BEDROCK_ACCESS_CONFIRMED==='true');
  const file=env.AWS_SHARED_CREDENTIALS_FILE;check('private AWS credentials file configured',Boolean(file&&existsSync(file)));
 }
}
if(process.argv.includes('--aws')) {
 check('deployment promotional-credit confirmation',process.env.AWS_CREDITS_CONFIRMED==='true');
 check('deployment usable credit balance at least $50',Number(process.env.AWS_CREDIT_BALANCE_USD)>=50);
 console.log('Credit values are operator attestations. Verify coverage/expiry in AWS Billing before provisioning.');
}
process.exitCode=failures?1:0;
