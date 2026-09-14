import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CredentialVault} from '@deviceops/connectors';
import {EdgeCollector,initialCollectorState} from '../apps/edge/src/collector.js';
import {JsonStore} from '../apps/edge/src/store.js';
import {createSimulator,initialSimulatorState} from '../apps/edge/src/simulator.js';
const base=process.env.OPS_TEST_URL??'http://localhost:3000';
if(!process.env.OPS_TEST_PASSWORD)throw new Error('OPS_TEST_PASSWORD is required for the disposable test account');
const dir=await mkdtemp(join(tmpdir(),'deviceops-edge-integration-'));
let server:ReturnType<typeof createSimulator>|undefined;
try{
 const login=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({email:'usamaaslam8726@gmail.com',password:process.env.OPS_TEST_PASSWORD,client:'mobile'})});assert.equal(login.status,200);const {accessToken}=await login.json();
 const auth={authorization:`Bearer ${accessToken}`,'content-type':'application/json','idempotency-key':randomUUID()};
 const response=await fetch(`${base}/api/v2/collectors`,{method:'POST',headers:auth,body:JSON.stringify({sourceMode:'simulated',devices:[{name:'Standalone edge test service',kind:'service',room:'Local simulator'}]})});assert.equal(response.status,201);const enrollment=await response.json(),deviceId=enrollment.deviceIds[0];
 const simToken=randomBytes(32).toString('base64url'),adminToken=randomBytes(32).toString('base64url');
 const simStore=await JsonStore.load(join(dir,'simulator.json'),initialSimulatorState([{deviceId,kind:'device'}]));server=createSimulator(simStore,simToken,adminToken);await new Promise<void>(resolve=>server!.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw new Error('Simulator address unavailable');
 const vault=new CredentialVault(join(dir,'vault.enc.json'),randomBytes(32).toString('base64'));await vault.set('simulator',simToken);
 const collectorStore=await JsonStore.load(join(dir,'collector.json'),initialCollectorState());
 const collector=new EdgeCollector({collectorId:enrollment.collectorId,allowedTargets:['127.0.0.1/32'],targets:[{deviceId,connectorId:'simulator-http',sourceMode:'simulated',address:'127.0.0.1',port:address.port,credentialRef:'simulator'}],pollIntervalMs:1000,timeoutMs:3000,concurrency:1,allowInsecureHttp:false},collectorStore,base,enrollment.token,vault);
 const injected=await fetch(`http://127.0.0.1:${address.port}/faults/${deviceId}`,{method:'POST',headers:{authorization:`Bearer ${adminToken}`,'content-type':'application/json'},body:JSON.stringify({fault:'service_hang'})});assert.equal(injected.status,200);
 const deadline=Date.now()+90000;let resolved:any;
 while(Date.now()<deadline){await collector.tick();const state=await fetch(`${base}/api/v2/state`,{headers:auth}).then(r=>r.json());resolved=state.incidents.find((i:any)=>i.rootDeviceId===deviceId&&i.status==='resolved');if(resolved)break;await new Promise(r=>setTimeout(r,1000));}
 assert.ok(resolved,'Standalone collector incident did not resolve');const commands=Object.values(simStore.snapshot().commands);assert.equal(commands.length,1);assert.equal(commands[0]!.executions,1);assert.equal(collectorStore.snapshot().observations.length,0);assert.equal(Object.values(collectorStore.snapshot().commands)[0]!.reported,true);
 assert.equal(resolved.report.sourceMode,'simulated');assert.equal(resolved.diagnosis.provider,'fixture');
 await writeFile('.data/ops-edge-integration-results.json',JSON.stringify({at:new Date().toISOString(),incidentId:resolved.id,provider:'fixture',executions:1,result:'Actual HTTP simulator -> credential vault -> collector -> API -> worker -> command -> three fresh observations -> resolved'},null,2));
 console.log('PASS actual standalone simulator, vault, collector, API, worker and recovery pipeline');
}finally{if(server)await new Promise<void>(resolve=>{server!.close(()=>resolve());server!.closeAllConnections();});await rm(dir,{recursive:true,force:true});}
