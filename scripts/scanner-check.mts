import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {ClamAvScanner} from '../packages/media/src/index.js';
const host=execFileSync('docker',['inspect','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}','deviceops-hackathon-clamav-1'],{encoding:'utf8'}).trim();
const scanner=new ClamAvScanner({host,timeoutMs:30000});
assert.equal((await scanner.scan(Buffer.from('DeviceOps clean scanner verification'))).verdict,'clean');
const test=Buffer.from('WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=','base64');
assert.equal((await scanner.scan(test)).verdict,'infected');
console.log('PASS real scanner accepts clean input and rejects the standard harmless antivirus test signature');
