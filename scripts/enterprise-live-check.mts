/** One explicitly selected live specialist investigation. No automatic retries or provider fallback. */
import { adminSql, closeDatabase } from '@deviceops/db';
import { transaction,SERVICE_ID } from '../packages/operations/src/store.js';
import { injectScenario,ingest,simulatorObservations,detect,investigate,tickTenant } from '@deviceops/operations';
import {writeFile} from 'node:fs/promises';
try {
 const [tenant]=await adminSql()<Array<{id:string}>>`select m.tenant_id as id from memberships m join users u on u.id=m.user_id where u.email='usamaaslam8726@gmail.com' limit 1`;
 if(!tenant)throw new Error('Primary test tenant missing');
 // Preserve all existing charges. This isolated ledger permits at most one additional reservation below $2 total.
 await adminSql()`update ops_budget set limit_usd=greatest(limit_usd,2) where id='bedrock'`;
 const incidentId=await transaction(tenant.id,SERVICE_ID,s=>{
  if(s.controls)s.controls={...s.controls,stopped:false,detectorMode:'observe'};
  const now=Date.now();injectScenario(s,'service_hang',now);
  for(let n=3;n>=0;n--){const at=now-n*5000;ingest(s,simulatorObservations(s,at),at);detect(s,at);}
  const i=s.incidents.filter(i=>i.status==='detected').at(-1);if(!i)throw new Error('No live-test incident');return i.id;
 });
 const start=Date.now();await investigate(tenant.id,incidentId);
 for(let n=0;n<22;n++){await tickTenant(tenant.id);const i=await transaction(tenant.id,SERVICE_ID,s=>s.incidents.find(i=>i.id===incidentId)!,true);if(['resolved','escalated','cancelled'].includes(i.status))break;await new Promise(r=>setTimeout(r,3000));}
 const result=await transaction(tenant.id,SERVICE_ID,s=>{const i=s.incidents.find(i=>i.id===incidentId)!;return {incidentId,status:i.status,cause:i.cause,provider:i.diagnosis?.provider,enterprise:i.diagnosis?.enterprise,usage:i.diagnosis?.usage,toolCalls:i.diagnosis?.toolCalls,commands:s.commands.filter(c=>c.incidentId===i.id).length,elapsedMs:Date.now()-start};},true);
 await writeFile('.data/enterprise-live-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await closeDatabase();}
