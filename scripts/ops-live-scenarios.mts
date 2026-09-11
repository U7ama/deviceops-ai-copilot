/** Explicitly authorized live-provider drill; use only an isolated synthetic database. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const base=process.env.OPS_TEST_URL??'http://localhost:3031';
const password=process.env.OPS_TEST_PASSWORD;
assert.ok(password);
const login=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({email:'manager@alpha.test',password,client:'mobile'})});
assert.equal(login.status,200);
const {accessToken}=await login.json();
async function req(path:string,body?:unknown){
 const r=await fetch(`${base}/api/v2/${path}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${accessToken}`,'content-type':'application/json','idempotency-key':randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
 assert.equal(r.status,200,`Request failed: ${path} (${r.status})`);return r.json();
}
const results:any[]=[];
const scenarios=(process.env.OPS_TEST_SCENARIOS??'switch_failure,service_hang,auth_failure,source_conflict,recovery_failure').split(',');
try {
 for(const scenario of scenarios){
  await req('demo',{scenario:'reset'});
  await req('demo',{scenario});
  const started=Date.now();let last:any;let approved=false;
  while(Date.now()-started<230000){
   const s=await req('state');const incidents=s.incidents.filter((i:any)=>i.generation===s.generation);
   last={scenario,elapsedMs:Date.now()-started,incidents:incidents.map((i:any)=>({id:i.id,status:i.status,cause:i.cause,diagnosis:i.diagnosis})),budget:s.budget,commandCount:s.commands.filter((c:any)=>incidents.some((i:any)=>i.id===c.incidentId)).length};
   const pending=s.approvals.find((p:any)=>p.status==='pending'&&incidents.some((i:any)=>i.id===p.incidentId));
   if(pending&&!approved){await req(`approvals/${pending.id}/decision`,{decision:'approved',proposalHash:pending.hash,reason:'Authorized local simulator verification'});approved=true;}
   if(incidents.length&&incidents.every((i:any)=>['resolved','escalated'].includes(i.status))) break;
   await new Promise(r=>setTimeout(r,1500));
  }
  const expected=['switch_failure','service_hang'].includes(scenario)?'resolved':'escalated';
  last.passed=last.incidents.length>0&&last.incidents.every((i:any)=>i.status===expected&&i.diagnosis?.provider==='strands-gemini');
  if(['switch_failure','service_hang','recovery_failure'].includes(scenario)) last.passed = last.passed && last.commandCount === 1;
  else last.passed = last.passed && last.commandCount === 0;
  if(['switch_failure','recovery_failure'].includes(scenario)) last.passed = last.passed && approved;
  results.push(last);await writeFile('.data/live-scenarios.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(last));
  // Stop at a provider failure instead of burning quota across the entire suite.
  if(last.incidents.some((i:any)=>!i.diagnosis))break;
 }
} finally {await req('demo',{scenario:'reset'});}
if(results.length!==scenarios.length||results.some(r=>!r.passed))process.exitCode=1;
