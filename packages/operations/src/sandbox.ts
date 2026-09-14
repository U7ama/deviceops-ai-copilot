import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
export type SandboxInput = { operation: 'analyze' | 'process'; files: Array<{name:string;data:string}>; script?:string; contentType?:string; query?:string };
export type SandboxResult = { exitCode?:number; stdout?:string; stderr?:string; artifacts?:Array<{name:string;data:string}>;
  pagePreviews?:Array<{page:number;preview:string;width:number;height:number}>;
  pages?:Array<{page:number;text:string}>; pageCount?:number; preview?:string; contentType?:string; error?:string };
function command(args: string[], input = '', timeout = 35000, cap = 8*1024*1024): Promise<string> {
  return new Promise((resolve,reject) => {
    const child = spawn('docker', args, { env:{PATH:process.env.PATH ?? '/usr/bin:/bin',NODE_ENV:'production'}, stdio:['pipe','pipe','pipe'] });
    const chunks:Buffer[]=[]; let size=0; let failure:Error|undefined;
    const timer=setTimeout(()=>{ failure=new Error('Sandbox deadline exceeded'); child.kill('SIGKILL'); },timeout);
    child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>cap){failure=new Error('Sandbox output limit exceeded');child.kill('SIGKILL');}else chunks.push(chunk);});
    child.stderr.resume(); child.stdin.on('error',()=>{});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);if(failure)reject(failure);else if(code!==0)reject(new Error('Sandbox execution unavailable or failed'));else resolve(Buffer.concat(chunks).toString());});
    child.stdin.end(input);
  });
}
export async function runSandbox(input: SandboxInput): Promise<SandboxResult> {
  if (process.env.OPS_SANDBOX_PROVIDER === 'broker') {
    if(!process.env.SANDBOX_BROKER_URL||!process.env.SANDBOX_BROKER_TOKEN)throw new Error('Private broker unavailable');
    const response=await fetch(`${process.env.SANDBOX_BROKER_URL}/sandbox`,{method:'POST',headers:{authorization:`Bearer ${process.env.SANDBOX_BROKER_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(40000)});
    if(!response.ok)throw new Error('Sandbox broker unavailable');
    return await response.json() as SandboxResult;
  }
  if (process.env.OPS_SANDBOX_PROVIDER === 'agentcore') {
    if(!process.env.STRANDS_SERVICE_URL||!process.env.STRANDS_SERVICE_TOKEN)throw new Error('Sandbox service unavailable');
    const response=await fetch(`${process.env.STRANDS_SERVICE_URL}/sandbox`,{method:'POST',headers:{authorization:`Bearer ${process.env.STRANDS_SERVICE_TOKEN}`,'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(35000)});
    if(!response.ok)throw new Error('AgentCore sandbox unavailable');
    return await response.json() as SandboxResult;
  }
  if (process.env.OPS_SANDBOX_PROVIDER !== 'local-container') throw new Error('Sandbox adapter unavailable');
  if ((input.script?.length ?? 0)>20000 || input.files.length<1 || input.files.length>8) throw new Error('Invalid sandbox request');
  let bytes=0;
  for(const f of input.files){if(!/^[a-zA-Z0-9_.-]{1,120}$/.test(f.name)||['.','..'].includes(f.name))throw new Error('Invalid artifact name');bytes+=Buffer.from(f.data,'base64').length;}
  if(bytes>(input.operation==='process'?50:20)*1024*1024)throw new Error('Sandbox input limit exceeded');
  const name=`deviceops-analysis-${randomUUID()}`;
  const image=process.env.OPS_SANDBOX_IMAGE ?? 'deviceops-analysis:local';
  if(image.startsWith('-'))throw new Error('Invalid sandbox image');
  try {
    await command(['create','--name',name,'--network','none','--read-only','--user','65534:65534','--cap-drop','ALL',
      '--security-opt','no-new-privileges','--cpus','1','--memory','256m','--memory-swap','256m','--pids-limit','64',
      '--tmpfs','/tmp:rw,noexec,nosuid,size=100m,mode=1777','--ipc','none','-i',image]);
    const [state]=JSON.parse(await command(['inspect',name]));
    const h=state.HostConfig;
    if(h.NetworkMode!=='none'||!h.ReadonlyRootfs||h.Memory!==268435456||h.PidsLimit!==64||h.NanoCpus!==1000000000||
      state.Config.User!=='65534:65534'||(h.Binds?.length??0)>0||(state.Mounts?.length??0)>0||!h.CapDrop?.includes('ALL')||!h.SecurityOpt?.includes('no-new-privileges'))
      throw new Error('Sandbox isolation could not be verified');
    const result=JSON.parse(await command(['start','-ai',name],JSON.stringify(input),32000)) as SandboxResult;
    if(result.error)throw new Error('Sandbox processing failed');
    return result;
  } finally { await command(['rm','-f',name],'',5000).catch(()=>{}); }
}
