#!/usr/bin/env python3
"""Bounded CC0 acquisition; locked sizes/digests; safe ZIP inputs; no Unity claims."""
import argparse, hashlib, io, json, os, re, shutil, struct, time, urllib.parse, urllib.request, zipfile
from pathlib import Path, PurePosixPath
ROOT = Path(__file__).resolve().parents[2]
ALLOWED = {'ambientcg.com','acg-download.struffelproductions.com'}
LIMIT = 350 * 1024**2

def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024**2),b''): h.update(b)
    return h.hexdigest()

def check_url(url):
    p=urllib.parse.urlsplit(url)
    if p.scheme!='https' or p.hostname not in ALLOWED or p.username or p.password or p.port not in (None,443):
        raise ValueError('Unapproved download URL')

class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req,fp,code,msg,headers,newurl)

def fetch(url,target,size,sha=None):
    check_url(url)
    if not 0 < size <= 40*1024**2: raise ValueError('Archive exceeds bounded size')
    target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists():
        if target.stat().st_size!=size or sha and digest(target)!=sha: raise ValueError('Existing archive integrity failure')
        return
    part=target.with_suffix(target.suffix+'.part')
    have=part.stat().st_size if part.exists() else 0
    if have>size: raise ValueError('Oversize partial archive')
    # Complete partials are verified normally, avoiding an invalid Range request.
    if have!=size:
        headers={'User-Agent':'HOMELESS-Art-Acquisition/1.0'}
        if have: headers['Range']=f'bytes={have}-'
        req=urllib.request.Request(url,headers=headers)
        with urllib.request.build_opener(Redirect).open(req,timeout=30) as response:
            check_url(response.url)
            if have and response.status==206:
                if not response.headers.get('Content-Range','').startswith(f'bytes {have}-'): raise ValueError('Bad resumed range')
                mode='ab'
            elif response.status==200: have=0;mode='wb'
            else: raise ValueError('Unexpected HTTP status')
            total=have
            if int(response.headers.get('Content-Length',size-have))>size-have: raise ValueError('Response exceeds lock')
            deadline=time.monotonic()+180
            with open(part,mode) as out:
                while True:
                    if time.monotonic()>deadline: raise TimeoutError('Download deadline; rerun to resume')
                    chunk=response.read(min(1024**2,size-total+1))
                    if not chunk: break
                    total+=len(chunk)
                    if total>size: raise ValueError('Download exceeded byte budget')
                    out.write(chunk)
        if total!=size: raise ValueError('Truncated response; rerun to resume')
    if sha and digest(part)!=sha: raise ValueError('Downloaded SHA-256 mismatch')
    os.replace(part,target)

def safe_members(archive):
    if len(archive.infolist())>80: raise ValueError('Too many ZIP entries')
    total=0
    for info in archive.infolist():
        p=PurePosixPath(info.filename)
        if p.is_absolute() or '..' in p.parts or '\\' in info.filename or (info.external_attr>>16)&0o170000==0o120000:
            raise ValueError('Unsafe ZIP member')
        total+=info.file_size
        if total>120*1024**2 or info.file_size>40*1024**2: raise ValueError('ZIP expansion limit')
    return archive.infolist()

def jpeg_dimensions(data):
    if data[:2]!=b'\xff\xd8': raise ValueError('Not JPEG')
    f=io.BytesIO(data);f.seek(2)
    while True:
        b=f.read(1)
        if not b: raise ValueError('Missing JPEG dimensions')
        if b!=b'\xff': continue
        while b==b'\xff': b=f.read(1)
        marker=b[0]
        if marker in (0xD8,0xD9,0x01) or 0xD0<=marker<=0xD7: continue
        size=struct.unpack('>H',f.read(2))[0]
        if marker in [0xC0,0xC1,0xC2,0xC3]:
            _,height,width=struct.unpack('>BHH',f.read(5));return [width,height]
        f.seek(size-2,1)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--verify',action='store_true');args=parser.parse_args()
    ledger_path=ROOT/'assets/selection.lock.json';ledger=json.loads(ledger_path.read_text())
    cache=ROOT/'assets/cache';art=ROOT/'unity/Assets/HOMELESS/Art/Materials'
    owned=[cache,ROOT/'unity/Assets/HOMELESS/Art',ROOT/'assets/evidence',ROOT/'assets/licenses',ROOT/'evidence/art']
    used=sum(p.stat().st_size for d in owned if d.exists() for p in d.rglob('*') if p.is_file())
    if used>LIMIT: raise ValueError('Art lane disk budget already exceeded')
    for a in ledger['assets']:
        if a['kind']!='ambientCG_PBR_source': continue
        if args.verify:
            if not a['files']: raise ValueError('No acquired files')
            archive=cache/a['archive_filename']
            if archive.exists() and digest(archive)!=a['archive_sha256']: raise ValueError('Master archive integrity mismatch')
            for file in a['files']:
                p=ROOT/file['path']
                if digest(p)!=file['sha256'] or p.stat().st_size!=file['bytes']: raise ValueError('Texture integrity mismatch: '+str(p))
            print(a['id'],'verified',len(a['files']),'source maps');continue
        archive=cache/a['archive_filename']
        used=sum(p.stat().st_size for d in owned if d.exists() for p in d.rglob('*') if p.is_file())
        if shutil.disk_usage(ROOT).free<a['expected_archive_bytes']*3: raise ValueError('Insufficient free disk')
        if used+a['expected_archive_bytes']*3>LIMIT: raise ValueError('Insufficient lane budget')
        fetch(a['download_url'],archive,a['expected_archive_bytes'],a['archive_sha256'])
        a['archive_sha256']=digest(archive);a['archive_path']=str(archive.relative_to(ROOT));a['files']=[]
        with zipfile.ZipFile(archive) as z:
            members=safe_members(z)
            for member in members:
                match=re.fullmatch(re.escape(a['id'])+r'_2K-JPG_(Color|NormalGL|Roughness|AmbientOcclusion|Displacement)\.jpg',member.filename)
                if not match: continue
                data=z.read(member);dims=jpeg_dimensions(data)
                if max(dims)>2048 or min(dims)<512: raise ValueError('Unexpected map dimensions')
                target=art/a['id']/member.filename;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
                semantic=match[1]
                a['files'].append(dict(path=str(target.relative_to(ROOT)),sha256=digest(target),bytes=len(data),dimensions_px=dims,semantic=semantic,color_space='sRGB' if semantic=='Color' else 'linear',source_archive_member=member.filename,modified=False))
        required={'Color','NormalGL','Roughness','Displacement'}
        if not required.issubset({f['semantic'] for f in a['files']}): raise ValueError('Required source maps absent')
        a['states'].update(downloaded=True,integrity_verified=True)
        a['acquired_at_utc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
        a['import_path']=str((art/a['id']).relative_to(ROOT));a['triangles']=0;a['lods']='Texture importer max size profiles; no mesh'
        (art/a['id']/'maps.json').write_text(json.dumps(a,indent=2)+'\n')
        # Persist each completed asset so interruptions resume without repeating work.
        ledger_path.write_text(json.dumps(ledger,indent=2)+'\n');used+=a['expected_archive_bytes']+sum(f['bytes'] for f in a['files'])
        print(a['id'],a['archive_sha256'],len(a['files']),'maps prepared; Unity import NOT RUN',flush=True)

if __name__=='__main__': main()
