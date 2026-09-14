import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
const key=(tenant:string,id:string)=>{z.uuid().parse(tenant);z.uuid().parse(id);return `enterprise/${tenant}/${id}`;};
const local=(tenant:string,id:string)=>join(resolve(process.env.OPS_EVIDENCE_ROOT??'.data/enterprise-evidence'),key(tenant,id));
const bucket=()=>process.env.OPS_EVIDENCE_BUCKET;
const client=()=>new S3Client({region:process.env.AWS_REGION??'us-east-1',maxAttempts:1});
export async function writeEvidence(tenant:string,id:string,bytes:Buffer) {
 const b=bucket();if(b){await client().send(new PutObjectCommand({Bucket:b,Key:key(tenant,id),Body:bytes,ServerSideEncryption:'AES256',ContentType:'application/octet-stream'}));return key(tenant,id);}
 const path=local(tenant,id);await mkdir(resolve(path,'..'),{recursive:true,mode:0o700});await writeFile(path,bytes,{flag:'wx',mode:0o600});return key(tenant,id);
}
export async function readEvidence(tenant:string,id:string) {
 const b=bucket();if(!b)return readFile(local(tenant,id));
 const r=await client().send(new GetObjectCommand({Bucket:b,Key:key(tenant,id)}));
 if(!r.Body)throw new Error('Evidence unavailable');
 const chunks:Buffer[]=[];let bytes=0;
 for await(const chunk of r.Body as AsyncIterable<Uint8Array>){bytes+=chunk.length;if(bytes>50*1024*1024)throw new Error('Evidence object limit');chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks);
}
export async function deleteEvidence(tenant:string,id:string){const b=bucket();if(b)await client().send(new DeleteObjectCommand({Bucket:b,Key:key(tenant,id)}));else await rm(local(tenant,id),{force:true});}
