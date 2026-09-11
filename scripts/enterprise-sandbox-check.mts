import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { runSandbox } from '../packages/operations/src/sandbox.js';
process.env.OPS_SANDBOX_PROVIDER='local-container';
const pdf=await readFile('fixtures/enterprise/optical-manual-30-pages.pdf');
const rendered=await runSandbox({operation:'process',contentType:'application/pdf',query:'Campus switch optical attenuation temperature drift',files:[{name:'source.pdf',data:pdf.toString('base64')}]});
assert.equal(rendered.pageCount,30);assert.equal(rendered.pagePreviews?.[0]?.page,30);
assert.equal(rendered.pagePreviews?.length,2);assert.ok(rendered.pagePreviews![0]!.width>600);
assert.ok(rendered.pagePreviews!.every(p=>p.preview.length<=100000));
assert.match(rendered.pages!.find(p=>p.page===30)!.text,/PORT 24/);console.log('PASS page 30 rendered with bounded resolution and original citation');
const files=[{name:'telemetry.csv',data:Buffer.from('temperature\n40\n50\n60\n').toString('base64')}];
const result=await runSandbox({operation:'analyze',files,script:"import csv, statistics\nprint(statistics.mean(float(r['temperature']) for r in csv.DictReader(open('telemetry.csv'))))\nimport matplotlib\nmatplotlib.use('Agg')\nimport matplotlib.pyplot as plt\nplt.plot([40,50,60]);plt.savefig('exports/trend.png')"});
assert.equal(result.exitCode,0);assert.match(result.stdout!,/50.0/);assert.equal(result.artifacts?.length,1);console.log('PASS statistics and exported chart');
const isolation=await runSandbox({operation:'analyze',files,script:`import os,socket,pathlib
assert not any(k.startswith(('AWS_','GEMINI_','DATABASE_','STRANDS_')) for k in os.environ)
assert not pathlib.Path('/var/run/docker.sock').exists()
assert not pathlib.Path('/app').exists()
try:
 socket.create_connection(('1.1.1.1',443),timeout=1)
 raise AssertionError('network accessible')
except OSError: pass
try:
 open('/etc/escape','w').write('x')
 raise AssertionError('root filesystem writable')
except OSError: pass
print('isolated')`});assert.equal(isolation.exitCode,0);assert.match(isolation.stdout!,/isolated/);console.log('PASS network, credentials, host mounts and read-only root');
await assert.rejects(()=>runSandbox({operation:'analyze',files:[{name:'../../escape',data:'eA=='}],script:'print(1)'}));console.log('PASS traversal rejection');
const infinite=await runSandbox({operation:'analyze',files,script:'while True: pass'});assert.notEqual(infinite.exitCode,0);console.log('PASS execution timeout');
const overflow=await runSandbox({operation:'analyze',files,script:"print('x' * 2000000)"});assert.notEqual(overflow.exitCode,0);console.log('PASS excessive output stopped');
assert.equal(execFileSync('docker',['ps','-aq','--filter','name=deviceops-analysis-'],{encoding:'utf8'}).trim(),'');console.log('PASS sandbox containers removed');
