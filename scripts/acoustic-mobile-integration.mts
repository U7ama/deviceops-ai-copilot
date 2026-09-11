import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {photoPayload} from '../../deviceops-mobile/src/incident-evidence.ts';
import {runSandbox} from '../packages/operations/src/sandbox.js';
const base=process.env.OPS_TEST_URL??'http://localhost:3030';
async function login(email:string){const r=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({email,password:process.env.OPS_TEST_PASSWORD,client:'mobile'})});assert.equal(r.status,200);return r.json();}
async function request(token:string,path:string,body?:unknown){const r=await fetch(`${base}/api/v2/${path}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','idempotency-key':randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)});return {status:r.status,data:await r.json()};}
async function until(token:string,check:(state:any)=>boolean){for(let n=0;n<60;n++){const r=await request(token,'enterprise');assert.equal(r.status,200);if(check(r.data))return r.data;await new Promise(r=>setTimeout(r,1000));}throw Error('Evidence transition timed out');}
const manager=await login('manager@alpha.test'),tech=await login('tech@alpha.test'),other=await login('tech@beta.test');
const initial=(await request(manager.accessToken,'enterprise')).data;
assert.equal(initial.providers.scanner,'clamav','Real scanner required for mobile photo test');
try{
 await request(manager.accessToken,'demo',{scenario:'reset'});
 await request(manager.accessToken,'enterprise/replay',{});
 await request(manager.accessToken,'enterprise/controls',{stopped:false,detectorMode:'trigger'});
 await request(manager.accessToken,'enterprise/replay',{});
 const state=(await request(manager.accessToken,'state')).data;
 const incident=state.incidents.find((i:any)=>i.generation===state.generation&&i.summary.startsWith('Proactive'));assert.ok(incident);
 process.env.OPS_SANDBOX_PROVIDER='local-container';
 const photo=await runSandbox({operation:'process',contentType:'image/png',files:[{name:'rack.png',data:(await readFile('fixtures/enterprise/staged-rack.png')).toString('base64')}]});
 const payload=await photoPayload(incident.id,photo.preview!,async bytes=>createHash('sha256').update(bytes).digest('hex'));
 const upload=await request(tech.accessToken,'artifacts',payload);assert.equal(upload.status,201);
 const denied=await request(other.accessToken,'artifacts',payload);assert.ok(denied.status>=400);
 const ready=await until(tech.accessToken,s=>s.artifacts.some((a:any)=>a.id===upload.data.id&&['ready','unavailable','rejected'].includes(a.status)));
 const artifact=ready.artifacts.find((a:any)=>a.id===upload.data.id);assert.equal(artifact.status,'ready');assert.equal(artifact.scan,'clean');
 assert.equal((await request(tech.accessToken,`artifacts/${artifact.id}/confirm`,{deviceId:incident.rootDeviceId})).status,200);
 console.log('PASS mobile JPEG checksum, authenticated upload, real scan, processing and device confirmation');console.log('PASS cross-tenant mobile upload denied');
 const csv=await readFile('fixtures/enterprise/fan-vibration.csv');const acoustic=await request(tech.accessToken,'artifacts',{incidentId:incident.id,name:'fan-vibration.csv',contentType:'text/csv',data:csv.toString('base64'),sha256:createHash('sha256').update(csv).digest('hex')});assert.equal(acoustic.status,201);
 await until(tech.accessToken,s=>s.artifacts.some((a:any)=>a.id===acoustic.data.id&&a.status==='ready'));
 const script=await readFile('fixtures/enterprise/analysis/acoustic-spectrum.py','utf8');
 const analysis=await request(manager.accessToken,'analyses',{incidentId:incident.id,artifactIds:[acoustic.data.id],script});assert.equal(analysis.status,202);
 const done=await until(manager.accessToken,s=>s.analyses.some((a:any)=>a.id===analysis.data.id&&['complete','failed'].includes(a.status)));
 const job=done.analyses.find((a:any)=>a.id===analysis.data.id);assert.equal(job.status,'complete');const metrics=JSON.parse(job.result.stdout);assert.ok(Math.abs(metrics.dominantObservedHz-3200)<5);assert.equal(job.result.artifacts[0].name,'acoustic-spectrum.png');
 console.log('PASS authenticated acoustic analysis produced measured spectrum and chart');
 await writeFile('.data/acoustic-mobile-verification.json',JSON.stringify({mode:'fixture',scanner:'clamav',incidentId:incident.id,photoArtifactId:artifact.id,acousticArtifactId:acoustic.data.id,analysisId:job.id,metrics,physicalCamera:'not tested'},null,2));
}finally{await request(manager.accessToken,'enterprise/controls',{stopped:initial.controls.stopped,detectorMode:initial.controls.detectorMode});}
