import { writeEvidence, readEvidence, deleteEvidence } from "./evidence-objects.js";
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { ClamAvScanner, FixtureScanner } from '@deviceops/media';
import type { SessionUser } from '@deviceops/contracts';
import { transaction, SERVICE_ID } from './store.js';
import { putFeature, featureRecords } from './enterprise-store.js';
import { event } from './domain.js';
import { runSandbox } from './sandbox.js';

export type Artifact = { id:string; incidentId:string; name:string; contentType:string; sha256:string; bytes:number;
 status:'quarantined'|'queued'|'processing'|'ready'|'rejected'|'unavailable'|'deleted'; scan:string;
 createdAt:string; storageKey:string; confirmedDeviceId:string|null; preview?:string;
 pagePreviews?:Array<{page:number;preview:string;width:number;height:number}>;
 pages?:Array<{page:number;text:string}>; error?:string; leaseUntil?:string };
export type Analysis = { id:string; incidentId:string; artifactIds:string[]; script:string; scriptHash:string;
 status:'queued'|'running'|'complete'|'failed'|'cancelled'; createdAt:string; result?:unknown; durationMs?:number; error?:string; leaseUntil?:string };
const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const root=()=>resolve(process.env.OPS_EVIDENCE_ROOT ?? '.data/enterprise-evidence');
const location=(tenant:string,id:string)=>{ z.uuid().parse(tenant);z.uuid().parse(id);return join(root(),tenant,id); };
const manager=(actor:Pick<SessionUser,'role'>)=>{if(!['owner','admin','manager'].includes(actor.role))throw new Error('Manager role required');};
export async function uploadArtifact(actor:SessionUser, raw:unknown) {
 const input=z.object({incidentId:z.uuid(),name:z.string().min(1).max(120).regex(/^[\w .-]+$/),
  contentType:z.enum(['image/png','image/jpeg','application/pdf','text/csv','application/json','text/plain']),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),data:z.string().max(70*1024*1024)}).strict().parse(raw);
 const bytes=Buffer.from(input.data,'base64');
 if(!bytes.length||bytes.length>(input.contentType==='application/pdf'?50:input.contentType.startsWith('image/')?10:20)*1024*1024||digest(bytes)!==input.sha256)throw new Error('Artifact size or checksum mismatch');
 if((input.contentType==='application/pdf'&&!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))||
 (input.contentType==='image/png'&&bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')||
 (input.contentType==='image/jpeg'&&bytes.subarray(0,3).toString('hex')!=='ffd8ff'))throw new Error('File signature mismatch');
 return transaction(actor.tenantId,actor.id,async(s,tx)=>{
  if(!s.incidents.some(i=>i.id===input.incidentId))throw new Error('Incident not found');
  const id=randomUUID(),key=await writeEvidence(actor.tenantId,id,bytes);
  const record:Artifact={id,incidentId:input.incidentId,name:input.name,contentType:input.contentType,sha256:input.sha256,bytes:bytes.length,
   status:'quarantined',scan:'unscanned',createdAt:new Date().toISOString(),storageKey:key,confirmedDeviceId:null};
  try{await putFeature(tx,actor.tenantId,'artifact',record);}catch(e){await deleteEvidence(actor.tenantId,id);throw e;}
  event(s,'artifact.uploaded',{artifactId:id,sha256:record.sha256,actorId:actor.id},Date.now(),input.incidentId);
  return {id,status:record.status};
 });
}
export async function confirmArtifact(actor:SessionUser,id:string,raw:unknown) {
 const {deviceId}=z.object({deviceId:z.uuid()}).strict().parse(raw);
 return transaction(actor.tenantId,actor.id,async(s,tx)=>{
  const a=(await featureRecords<Artifact>(tx,actor.tenantId,'artifact')).find(a=>a.id===id);
  const i=s.incidents.find(i=>i.id===a?.incidentId);
  if(!a||a.status!=='ready'||!i?.deviceIds.includes(deviceId))throw new Error('Unprocessed artifact or device outside incident');
  a.confirmedDeviceId=deviceId;await putFeature(tx,actor.tenantId,'artifact',a);
  event(s,'artifact.association_confirmed',{artifactId:id,deviceId,actorId:actor.id},Date.now(),i.id);
  return {id,confirmedDeviceId:deviceId};
 });
}
export async function artifactPreview(actor:SessionUser,id:string,page?:number) {
 return transaction(actor.tenantId,actor.id,async(_s,tx)=>{
  const a=(await featureRecords<Artifact>(tx,actor.tenantId,'artifact')).find(a=>a.id===id&&a.status==='ready');
  const preview=page===undefined?a?.preview:a?.pagePreviews?.find(p=>p.page===page)?.preview;
  if(!preview||a?.scan!=='clean')throw new Error('Preview unavailable');return {contentType:'image/jpeg',data:preview};
 },true);
}
export async function queueAnalysis(actor:Pick<SessionUser,'id'|'tenantId'|'role'>,raw:unknown) {
 manager(actor);
 const input=z.object({incidentId:z.uuid(),artifactIds:z.array(z.uuid()).min(1).max(8),script:z.string().min(1).max(20000)}).strict().parse(raw);
 return transaction(actor.tenantId,actor.id,async(s,tx)=>{
  if(s.controls?.stopped)throw new Error('Operations stopped');
  const i=s.incidents.find(i=>i.id===input.incidentId);if(!i||i.status==='cancelled')throw new Error('Incident unavailable');
  const artifacts=await featureRecords<Artifact>(tx,actor.tenantId,'artifact');
  if(input.artifactIds.some(id=>!artifacts.some(a=>a.id===id&&a.incidentId===i.id&&a.status==='ready'&&a.scan==='clean')))throw new Error('Approved incident artifacts required');
  if((await featureRecords<Analysis>(tx,actor.tenantId,'analysis')).filter(j=>j.incidentId===i.id).length>=2)throw new Error('Two analysis jobs per incident maximum');
  const j:Analysis={id:randomUUID(),...input,scriptHash:digest(input.script),status:'queued',createdAt:new Date().toISOString()};
  await putFeature(tx,actor.tenantId,'analysis',j);event(s,'analysis.queued',{analysisId:j.id,scriptHash:j.scriptHash,artifactIds:j.artifactIds},Date.now(),i.id);
  return {id:j.id,status:j.status};
 });
}
export async function processArtifacts(tenant:string, analysisId?:string) {
 const claim=await transaction(tenant,SERVICE_ID,async(s,tx)=>{
  const records=await featureRecords<Artifact>(tx,tenant,'artifact');
  for(const a of records.filter(a=>a.status==='processing'&&Date.parse(a.leaseUntil??'')<Date.now())){
   a.status='unavailable';a.error='Processing lease expired; no automatic replay';await putFeature(tx,tenant,'artifact',a);
  }
  const a=analysisId?undefined:records.find(a=>a.status==='quarantined');if(!a||s.controls?.stopped)return null;
  a.status='processing';a.leaseUntil=new Date(Date.now()+60000).toISOString();await putFeature(tx,tenant,'artifact',a);const incident=s.incidents.find(i=>i.id===a.incidentId);return {artifact:a,query:`${incident?.summary??''} ${incident?.cause??''}`.slice(0,2000)};
 });
 if(claim){
  const query=claim.query;const artifact=claim.artifact;
  try{
   const bytes=await readEvidence(tenant,artifact.id);if(digest(bytes)!==artifact.sha256)throw new Error('Stored checksum mismatch');
   const scanner=process.env.MEDIA_CLAMAV_HOST ? new ClamAvScanner({host:process.env.MEDIA_CLAMAV_HOST,maxBytes:50*1024*1024}) :
    new FixtureScanner((process.env.OPS_APPROVED_FIXTURE_HASHES??'').split(',').filter(Boolean));
   const scan=await scanner.scan(bytes);artifact.scan=scan.verdict;
   if(scan.verdict!=='clean'){artifact.status=scan.verdict==='infected'?'rejected':'unavailable';artifact.error='A clean malware scan or approved fixture hash is required';}
   else if(artifact.contentType.startsWith('image/')||artifact.contentType==='application/pdf'){
    const r=await runSandbox({operation:'process',query,contentType:artifact.contentType,files:[{name:'source',data:bytes.toString('base64')}]});
    if(!r.preview)throw new Error("Missing normalized preview");artifact.preview=r.preview;artifact.pages=r.pages??[];artifact.pagePreviews=r.pagePreviews??[];artifact.status='ready';
   } else {artifact.pages=[{page:1,text:bytes.toString('utf8').slice(0,12000)}];artifact.status='ready';}
  }catch{artifact.status='unavailable';artifact.error='Isolated evidence processing unavailable';}
  await transaction(tenant,SERVICE_ID,async(s,tx)=>{await putFeature(tx,tenant,'artifact',artifact);event(s,'artifact.processed',{artifactId:artifact.id,status:artifact.status,scan:artifact.scan},Date.now(),artifact.incidentId);});
 }
 const job=await transaction(tenant,SERVICE_ID,async(s,tx)=>{
  if(s.controls?.stopped)return null;
  const jobs=await featureRecords<Analysis>(tx,tenant,'analysis');
  for(const j of jobs.filter(j=>j.status==='running'&&Date.parse(j.leaseUntil??'')<Date.now())){j.status='failed';j.error='Lease expired; execution outcome unknown';await putFeature(tx,tenant,'analysis',j);}
  const j=jobs.find(j=>j.status==='queued'&&(!analysisId||j.id===analysisId));if(!j)return null;
  if(s.incidents.find(i=>i.id===j.incidentId)?.status==='cancelled'){j.status='cancelled';await putFeature(tx,tenant,'analysis',j);return null;}
  const artifacts=(await featureRecords<Artifact>(tx,tenant,'artifact')).filter(a=>j.artifactIds.includes(a.id)&&a.incidentId===j.incidentId&&a.status==='ready'&&a.scan==='clean');
  if(artifacts.length!==j.artifactIds.length){j.status='failed';j.error='Artifact no longer approved';await putFeature(tx,tenant,'analysis',j);return null;}
  j.status='running';j.leaseUntil=new Date(Date.now()+45000).toISOString();await putFeature(tx,tenant,'analysis',j);return {j,artifacts};
 });
 if(job){const start=Date.now();try{
   const files=await Promise.all(job.artifacts.map(async a=>{const bytes=await readEvidence(tenant,a.id);if(digest(bytes)!==a.sha256)throw new Error('Checksum changed');return {name:`${a.id}.${a.contentType==='text/csv'?'csv':'txt'}`,data:bytes.toString('base64')};}));
   const result=await runSandbox({operation:'analyze',files,script:job.j.script});job.j.result=result;job.j.status=result.exitCode===0?'complete':'failed';
  }catch{job.j.status='failed';job.j.error='Isolated analysis unavailable or failed';}
  job.j.durationMs=Date.now()-start;
  await transaction(tenant,SERVICE_ID,async(s,tx)=>{if(s.controls?.stopped||s.incidents.find(i=>i.id===job.j.incidentId)?.status==='cancelled')job.j.status='cancelled';await putFeature(tx,tenant,'analysis',job.j);event(s,'analysis.completed',{analysisId:job.j.id,status:job.j.status,durationMs:job.j.durationMs},Date.now(),job.j.incidentId);});
 }
}

export async function grantedAnalysis(tenant:string,incidentId:string,raw:unknown) {
 const input=z.object({artifactIds:z.array(z.uuid()).min(1).max(8),script:z.string().min(1).max(20000)}).strict().parse(raw);
 const job=await queueAnalysis({tenantId:tenant,id:SERVICE_ID,role:'manager'}, {...input,incidentId});
 await processArtifacts(tenant,job.id);
 return transaction(tenant,SERVICE_ID,async(_s,tx)=>{
  const result=(await featureRecords<Analysis>(tx,tenant,'analysis')).find(j=>j.id===job.id)!;
  const r=result.result as {stdout?:string;stderr?:string;artifacts?:Array<{name:string}>}|undefined;
  return {id:result.id,status:result.status,scriptHash:result.scriptHash,durationMs:result.durationMs,stdout:r?.stdout?.slice(0,12000),artifacts:r?.artifacts?.map(a=>({name:a.name})),error:result.error};
 },true);
}
