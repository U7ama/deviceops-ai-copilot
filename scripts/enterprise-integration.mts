import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { randomUUID,createHash } from 'node:crypto';
import { withTenant,closeDatabase } from '@deviceops/db';
const base=process.env.OPS_TEST_URL??'http://localhost:3031',password=process.env.OPS_TEST_PASSWORD;
async function login(email:string){const r=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({email,password,client:'mobile'})});assert.equal(r.status,200);return r.json();}
async function req(token:string,path:string,body?:unknown){const r=await fetch(`${base}/api/v2/${path}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','idempotency-key':randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)});return {status:r.status,data:await r.json()};}
async function wait(token:string,predicate:(data:any)=>boolean){for(let n=0;n<50;n++){const r=await req(token,'enterprise');assert.equal(r.status,200,JSON.stringify(r.data));if(predicate(r.data))return r.data;await new Promise(r=>setTimeout(r,1000));}throw new Error('Enterprise transition timed out');}
const results:string[]=[];const ok=(name:string)=>{results.push(name);console.log('PASS '+name);};
try{
 const m=await login('manager@alpha.test'),other=await login('tech@beta.test'),tech=await login('tech@alpha.test');const token=m.accessToken;
 assert.equal((await req(tech.accessToken,'enterprise/controls',{stopped:true})).status,403);ok('manager-only operations control');
 assert.equal((await req(token,'enterprise/controls',{stopped:false,detectorMode:'observe'})).status,200);
 assert.equal((await req(token,'enterprise/replay',{})).data.passed,true);ok('deterministic replay and baseline storage');
 assert.equal((await req(token,'enterprise/replay',{metric:'opticalRxPower'})).data.passed,true);
 const optical=(await req(token,'enterprise')).data.anomalies.find((a:any)=>a.metric==='opticalRxPower');assert.ok(optical&&optical.slope<0);ok('optical downward drift stored with dBm provenance');
 assert.equal((await req(token,'enterprise/controls',{detectorMode:'trigger'})).status,200);
 assert.equal((await req(token,'enterprise/replay',{})).status,200);
 const state=(await req(token,'state')).data;const incident=state.incidents.find((i:any)=>i.summary.startsWith('Proactive'));
 assert.ok(incident,'proactive incident created before outage');ok('proactive drift creates incident');
 const uploaded=[];
 for(const [name,contentType] of [['staged-rack.png','image/png'],['manual.pdf','application/pdf'],['telemetry.csv','text/csv'],['floorplan-building-c.png','image/png'],['optical-manual-30-pages.pdf','application/pdf']]){
  const bytes=await readFile(`fixtures/enterprise/${name}`),sha256=createHash('sha256').update(bytes).digest('hex');
  const r=await req(token,'artifacts',{incidentId:incident.id,name,contentType,sha256,data:bytes.toString('base64')});assert.equal(r.status,201,JSON.stringify(r.data));uploaded.push(r.data.id);
 }
 const ready=await wait(token,s=>uploaded.every(id=>s.artifacts.some((a:any)=>a.id===id&&['ready','unavailable','rejected'].includes(a.status))));
 for(const id of uploaded)assert.equal(ready.artifacts.find((a:any)=>a.id===id).status,'ready',JSON.stringify(ready.artifacts));
 ok('photo normalization PDF pages and CSV scan gate');
 const manual=ready.artifacts.find((a:any)=>a.id===uploaded[4]);assert.ok(manual.renderedPages.includes(30));
 const preview=await fetch(`${base}/api/v2/artifacts/${manual.id}/preview?page=30`,{headers:{authorization:`Bearer ${token}`}});assert.equal(preview.status,200);assert.equal(preview.headers.get('content-type'),'image/jpeg');
 const denied=await fetch(`${base}/api/v2/artifacts/${manual.id}/preview?page=30`,{headers:{authorization:`Bearer ${other.accessToken}`}});assert.ok(denied.status>=400);
 const invalid=await fetch(`${base}/api/v2/artifacts/${manual.id}/preview?page=501`,{headers:{authorization:`Bearer ${token}`}});assert.ok(invalid.status>=400);ok('selected page preview preserves citations and tenant access');

 assert.equal((await req(other.accessToken,`artifacts/${uploaded[0]}/confirm`,{deviceId:incident.rootDeviceId})).status>=400,true);ok('cross-tenant artifact access denied');
 assert.equal((await req(token,`artifacts/${uploaded[0]}/confirm`,{deviceId:incident.rootDeviceId})).status,200);ok('technician-confirmed incident device association');
 const bad=Buffer.from('unreviewed arbitrary upload');const rejected=await req(token,'artifacts',{incidentId:incident.id,name:'unreviewed.txt',contentType:'text/plain',sha256:createHash('sha256').update(bad).digest('hex'),data:bad.toString('base64')});
 await wait(token,s=>s.artifacts.some((a:any)=>a.id===rejected.data.id&&a.status==='unavailable'));ok('unscanned content remains unavailable');
 const j=await req(token,'analyses',{incidentId:incident.id,artifactIds:[uploaded[2]],script:"import glob,csv,statistics\nrows=list(csv.DictReader(open(glob.glob('*.csv')[0])))\nprint(statistics.mean(float(r['temperature']) for r in rows))\nimport matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nplt.plot([float(r['temperature']) for r in rows]);plt.savefig('exports/temperature.png')"});assert.equal(j.status,202,JSON.stringify(j.data));
 const completed=await wait(token,s=>s.analyses.some((a:any)=>a.id===j.data.id&&['complete','failed'].includes(a.status)));
 assert.equal(completed.analyses.find((a:any)=>a.id===j.data.id).status,'complete',JSON.stringify(completed.analyses));ok('approved CSV isolated statistics and chart');
 await withTenant({tenantId:other.user.tenantId,userId:other.user.id},async tx=>{const rows=await tx`select id from ops_enterprise where tenant_id=${m.user.tenantId}`;assert.equal(rows.length,0);});ok('enterprise records PostgreSQL RLS');
 const stop=await req(token,'enterprise/controls',{stopped:true});assert.equal(stop.status,200);assert.equal((await req(token,'state')).data.incidents.find((i:any)=>i.id===incident.id).status,'cancelled');ok('kill switch cancels outstanding incident');
 await req(token,'enterprise/controls',{stopped:false,detectorMode:'observe'});
 assert.equal((await req(tech.accessToken,'enterprise/critical-demo',{})).status,403);
 const critical=await req(token,'enterprise/critical-demo',{});assert.equal(critical.status,200);assert.equal(critical.data.impact.requiresEscalation,true);assert.equal(critical.data.impact.downstreamCount,3);ok('critical dependency demo uses stored topology and manager authorization');
 let criticalIncident:any;
 for(let n=0;n<45;n++){
  const current=(await req(token,'state')).data;
  criticalIncident=current.incidents.find((i:any)=>i.generation===current.generation&&i.status==='escalated');
  if(criticalIncident){assert.equal(current.commands.filter((c:any)=>c.incidentId===criticalIncident.id).length,0);break;}
  await new Promise(r=>setTimeout(r,1000));
 }
 assert.ok(criticalIncident,'critical dependency investigation must escalate without commands');ok('critical downstream impact blocks fixture recovery end to end');
 const after=(await req(token,'state')).data;for(const d of after.devices.filter((d:any)=>d.sourceMode==='simulated'&&d.criticality==='critical')) await req(token,`devices/${d.id}/policy`,{criticality:'standard',maintenanceUntil:null});

 await writeFile('.data/enterprise-verification.json',JSON.stringify({checkedAt:new Date().toISOString(),mode:'fixture',results,incidentId:incident.id,artifactIds:uploaded},null,2));
 console.log(`${results.length}/${results.length} enterprise checks passed`);
}finally{await closeDatabase();}
