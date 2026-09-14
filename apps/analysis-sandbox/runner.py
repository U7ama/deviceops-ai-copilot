"""Trusted broker protocol inside a disposable restricted container. Outputs remain untrusted."""
import base64, hashlib, io, json, os, pathlib, re, resource, subprocess, sys

def read_file(path, limit):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError('invalid exported artifact')
    return path.read_bytes()

def main():
    raw = sys.stdin.buffer.read(72 * 1024 * 1024 + 1)
    if len(raw) > 72 * 1024 * 1024: raise ValueError('input limit')
    request = json.loads(raw)
    work = pathlib.Path('/tmp/job'); work.mkdir()
    files = request.get('files', [])
    total = 0
    for item in files:
        name = item['name']
        if not name or '/' in name or '\\' in name or name in {'.','..'}: raise ValueError('invalid artifact name')
        data = base64.b64decode(item['data'], validate=True); total += len(data)
        if total > (50 if request['operation']=='process' else 20)*1024*1024: raise ValueError('input limit')
        (work/name).write_bytes(data)
    if request['operation'] == 'process':
        from PIL import Image, ImageOps
        path = work/files[0]['name']; mime = request['contentType']
        if mime == 'application/pdf':
            from pypdf import PdfReader
            doc = PdfReader(path)
            if doc.is_encrypted or len(doc.pages)>500: raise ValueError('unsupported PDF')
            # Full document is never sent to a model. Extract a bounded searchable page index.
            pages = [{'page':n+1, 'text':p.extract_text()[:4000]} for n,p in enumerate(doc.pages)]
            query=request.get('query','')
            if not isinstance(query,str) or len(query)>2000: raise ValueError('query limit')
            terms=set(re.findall(r'[a-z0-9]{3,}',query.lower()))
            ranked=sorted(pages,key=lambda p:(-sum(t in p['text'].lower() for t in terms),p['page']))[:2]
            previews=[]
            for page in ranked:
                number=str(page['page']); prefix=work/('page-'+number)
                subprocess.run(['pdftoppm','-f',number,'-l',number,'-singlefile','-scale-to','1200','-jpeg',str(path),str(prefix)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
                image=Image.open(str(prefix)+'.jpg').convert('RGB')
                for size in (1200,900,600):
                    image.thumbnail((size,size)); out=io.BytesIO(); image.save(out,format='JPEG',quality=65)
                    preview=base64.b64encode(out.getvalue()).decode()
                    if len(preview)<=100000: break
                if len(preview)>100000: raise ValueError('page preview limit')
                previews.append({'page':page['page'],'preview':preview,'width':image.width,'height':image.height})
            if not previews: raise ValueError('empty PDF')
            return {'pages':pages,'pageCount':len(pages),'pagePreviews':previews,'preview':previews[0]['preview'],'contentType':'image/jpeg'}
        Image.MAX_IMAGE_PIXELS=25_000_000
        image=ImageOps.exif_transpose(Image.open(path)); image.load()
        if image.width*image.height>25_000_000: raise ValueError('image pixel limit')
        image.thumbnail((600,600)); output=io.BytesIO(); image.convert('RGB').save(output,format='JPEG',quality=75)
        return {'pages':[], 'preview':base64.b64encode(output.getvalue()).decode(), 'contentType':'image/jpeg', 'width':image.width,'height':image.height}
    script=request['script']
    if len(script.encode())>20000: raise ValueError('script limit')
    (work/'analysis.py').write_text(script)
    (work/'exports').mkdir()
    def limits():
        resource.setrlimit(resource.RLIMIT_FSIZE,(1024*1024,1024*1024))
        resource.setrlimit(resource.RLIMIT_CPU,(25,25))
    with (work/'stdout').open('wb') as out, (work/'stderr').open('wb') as err:
        run=subprocess.run([sys.executable,'-I','analysis.py'],cwd=work,stdin=subprocess.DEVNULL,stdout=out,stderr=err,timeout=28,preexec_fn=limits,
            env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/tmp','MPLCONFIGDIR':'/tmp/matplotlib'})
    exports=sorted((work/'exports').iterdir())
    if len(exports)>3: raise ValueError('export count exceeded')
    return {'exitCode':run.returncode, 'stdout':read_file(work/'stdout',1024*1024).decode(errors='replace'),
        'stderr':read_file(work/'stderr',1024*1024).decode(errors='replace'),
        'artifacts':[{'name':p.name,'data':base64.b64encode(read_file(p,1024*1024)).decode()} for p in exports]}
try:
    print(json.dumps(main()))
except Exception as error:
    print(json.dumps({'error':type(error).__name__})); sys.exit(1)
