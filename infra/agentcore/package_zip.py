"""Package staged ARM64 dependencies plus the existing agent (no downloads).

Stage python/ site-packages and node from the cached ARM64 image in a temporary
folder, bundle mcp-entry.ts as operations-mcp.cjs, then run this script.
"""
import argparse
import hashlib
from pathlib import Path
import shutil
import zipfile
p=argparse.ArgumentParser();p.add_argument('stage',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
repo=Path(__file__).resolve().parents[2]
for name in ['python/strands','node','operations-mcp.cjs']:
    if not (a.stage/name).exists():raise SystemExit('Missing staged dependency: '+name)
# Pinned SDK file must be unmodified; use bounded_mcp.py for our lifecycle policy.
if hashlib.sha256((a.stage/'python/strands/tools/mcp/mcp_client.py').read_bytes()).hexdigest() != '0ea0ff985d5362cc79c602c0d70bc1935ae5c43c606e69775f9e66c1720f12b3':
    raise SystemExit('Staged MCP SDK differs from the verified pinned dependency; do not package an ad hoc patch')
shutil.copyfile(Path(__file__).with_name('zip_main.py'),a.stage/'main.py')
dest=a.stage/'apps/strands-agent';dest.mkdir(parents=True,exist_ok=True)
for src in (repo/'apps/strands-agent').glob('*.py'):shutil.copy2(src,dest/src.name)
files=[f for f in a.stage.rglob('*') if f.is_file() and '__pycache__' not in f.parts and f.suffix!='.pyc']
if sum(f.stat().st_size for f in files)>750*1024**2:raise SystemExit('Uncompressed ZIP exceeds limit')
with zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED,compresslevel=3) as z:
    for f in files:z.write(f,f.relative_to(a.stage))
if a.output.stat().st_size>250*1024**2:raise SystemExit('Compressed ZIP exceeds limit')
print('ZIP bytes:',a.output.stat().st_size)
