/** Private trusted Docker broker. The generated-code containers receive none of this process's credentials or mounts. */
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { runSandbox, type SandboxInput } from '../../../packages/operations/src/sandbox.js';
const token=process.env.SANDBOX_BROKER_TOKEN??'';
if(token.length<32)throw new Error('A private sandbox broker token is required');
process.env.OPS_SANDBOX_PROVIDER='local-container';
let active=0;
createServer(async(req,res)=>{
 const reply=(status:number,body:unknown)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));};
 if(req.url==='/healthz'){reply(200,{status:'ok',active});return;}
 const supplied=req.headers.authorization?.replace(/^Bearer /,'')??'';
 if(supplied.length!==token.length||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token))){reply(401,{error:'unauthorized'});return;}
 if(req.method!=='POST'||req.url!=='/sandbox'){reply(404,{error:'not_found'});return;}
 if(active>=2){reply(429,{error:'sandbox_busy'});return;}
 active++;
 try{const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>72*1024*1024)throw new Error('body_limit');chunks.push(chunk);}
  const input=JSON.parse(Buffer.concat(chunks).toString()) as SandboxInput;
  if(!['process','analyze'].includes(input.operation))throw new Error('operation_denied');
  reply(200,await runSandbox(input));
 }catch{reply(503,{error:'sandbox_unavailable'});}finally{active--;}
}).listen(Number(process.env.PORT??8091),'0.0.0.0');
