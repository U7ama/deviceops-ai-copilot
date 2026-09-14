import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {adminSql,closeDatabase} from '@deviceops/db';
import {callTool,recoverInvocations,createState,injectScenario,simulatorObservations,ingest,detect} from '@deviceops/operations';
import {transaction,SERVICE_ID} from '../packages/operations/src/store.js';
const db=adminSql(),token=randomBytes(32).toString('base64url'),invocationId=randomUUID();let incidentId='';
process.env.OPS_AGENT_MODE='fixture';
try{
 const [tenant]=await db`select id from tenants order by name limit 1`;assert.ok(tenant);const now=Date.now();
 const shadow=createState(tenant.id,now-20000);injectScenario(shadow,'service_hang',now-20000);ingest(shadow,simulatorObservations(shadow,now),now);detect(shadow,now);
 const incident=shadow.incidents[0]!;incidentId=incident.id;incident.status='investigating';incident.invocationId=invocationId;
 await transaction(tenant.id,SERVICE_ID,s=>{s.incidents.push(incident);});
 await db`insert into ops_invocations(id,tenant_id,incident_id,status,grant_hash,expires_at,lease_until,reserved_usd) values(${invocationId},${tenant.id},${incidentId},'running',${createHash('sha256').update(token).digest('hex')},now()+interval '1 minute',now()+interval '2 minutes',0)`;
 await assert.rejects(callTool('wrong-grant','get_incident_context',{}));
 const client=new Client({name:'operations-integration',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','apps/mcp/src/index.ts'],cwd:process.cwd(),env:{DEVICEOPS_MCP_GRANT:token,DEVICEOPS_URL:process.env.OPS_TEST_URL??'http://localhost:3000',NODE_ENV:'production'},stderr:'pipe'});
 let context:any;
 try{await client.connect(transport);assert.equal((await client.listTools()).tools.length,7);const result:any=await client.callTool({name:'get_incident_context',arguments:{}});context=JSON.parse(result.content[0].text);}finally{await client.close();}
assert.equal(context.incident.id,incidentId);assert.deepEqual(context.devices.map((d:any)=>d.id),incident.deviceIds);console.log('PASS grant binds tools to its incident and devices');
 await assert.rejects(callTool(token,'get_device_health',{deviceId:randomUUID()}),/scope/i);await assert.rejects(callTool(token,'get_incident_context',{tenantId:randomUUID()}));console.log('PASS tool arguments cannot override device or tenant scope');
 for(let n=0;n<9;n++)await callTool(token,'get_incident_context',{});
 await assert.rejects(callTool(token,'get_incident_context',{}));console.log('PASS durable twelve-call grant budget');
 await db`update ops_invocations set expires_at=now()-interval '1 second',lease_until=now()-interval '1 second' where id=${invocationId}`;
 await recoverInvocations();const [row]=await db`select status,cost_usd from ops_invocations where id=${invocationId}`;assert.equal(row.status,'failed');assert.equal(Number(row.cost_usd),0);console.log('PASS expired invocation lease closes without replay');
}finally{
 await db`delete from ops_invocations where id=${invocationId}`;
 if(incidentId){await db`delete from ops_notifications where incident_id=${incidentId}`;await db`delete from ops_events where incident_id=${incidentId}`;await db`delete from ops_records where kind='incidents' and id=${incidentId}`;}
 await closeDatabase();
}
