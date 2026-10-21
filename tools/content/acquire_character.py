#!/usr/bin/env python3
"""Acquire only selected CC0 MakeHuman assets; preserve exact source bytes."""
import hashlib, io, json, pathlib, urllib.request, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/content/makehuman'
REV = 'a8bc2d54ff0ac92e78ff71431b1023eda42bf482'
ZIP = 'https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip'
RAW = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/' + REV + '/'
PREFIXES = ('clothes/male_casualsuit01/', 'hair/short01/', 'teeth/teeth_base/',
            'tongue/tongue01/', 'eyes/high-poly/', 'skins/young_caucasian_male/',
            'skins/middleage_african_male/', 'clothes/shoes01/')
FILES = ('eyes/materials/brown.mhmat', 'eyes/materials/brown_eye.png')

class RemoteZip(io.RawIOBase):
    """Range reader refuses whole-archive fallback and excessive responses."""
    def __init__(self, url):
        self.url, self.pos = url, 0
        with urllib.request.urlopen(urllib.request.Request(url, headers={'Range':'bytes=0-0'}), timeout=45) as r:
            if r.status != 206: raise ValueError('range support required')
            self.size = int(r.headers['Content-Range'].split('/')[-1])
    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        if not 0 <= self.pos <= self.size: raise ValueError('range outside archive')
        return self.pos
    def tell(self): return self.pos
    def read(self, n=-1):
        n = min(n if n >= 0 else self.size, self.size-self.pos)
        if n <= 0: return b''
        if n > 16*1024*1024: raise ValueError('member range over limit')
        request = urllib.request.Request(self.url, headers={'Range':f'bytes={self.pos}-{self.pos+n-1}'})
        with urllib.request.urlopen(request, timeout=60) as r:
            if r.status != 206: raise ValueError('whole archive response refused')
            b = r.read(n+1)
        if len(b) != n: raise ValueError('incorrect range response')
        self.pos += n
        return b

def save(rel, data, url, record):
    path = OUT/rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    record.append({'path':str(path.relative_to(ROOT)), 'bytes':len(data),
                   'sha256':hashlib.sha256(data).hexdigest(), 'source':url, 'license':'CC0-1.0'})

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    lock = ROOT/'assets/content/selection.json'
    selection = {'schema':'homeless.content-selection/1', 'state':'FREE_SELECTED',
      'license_evidence':'https://github.com/makehumancommunity/makehuman/blob/'+REV+'/LICENSE.md',
      'makehuman_revision':REV, 'archive':ZIP, 'selected_prefixes':PREFIXES,
      'selected_files':FILES, 'native_visual_acceptance':'NOT_RUN',
      'speech':'espeak-ng offline formant synthesis; no cloned or recorded person voice',
      'vehicle':'original unbranded fictional sedan; no third-party vehicle model'}
    lock.write_text(json.dumps(selection,indent=2)+'\n')
    previous=ROOT/'assets/content/sources.lock.json'
    pinned={x['path']:x for x in json.loads(previous.read_text())['files']} if previous.exists() else {}
    record=[]
    def reuse(rel):
        p=OUT/rel;entry=pinned.get(str(p.relative_to(ROOT)))
        if entry and p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==entry['sha256']:
            record.append(entry);return True
        return False
    for p in ('LICENSE.md','LICENSE.ASSETS.md','makehuman/data/3dobjs/base.obj',
              'makehuman/data/rigs/default.mhskel','makehuman/data/rigs/default_weights.mhw'):
        if reuse(p):continue
        with urllib.request.urlopen(RAW+p, timeout=60) as r: data=r.read(8*1024*1024+1)
        if len(data)>8*1024*1024:raise ValueError('source too large')
        save(p, data, RAW+p, record)
    with zipfile.ZipFile(RemoteZip(ZIP)) as z:
        for info in z.infolist():
            n=info.filename
            if info.is_dir() or n.endswith('.thumb'):continue
            if not (n.startswith(PREFIXES) or n in FILES):continue
            if reuse('system/'+n):continue
            if '..' in pathlib.PurePosixPath(n).parts or n.startswith('/') or info.file_size>16*1024*1024:
                raise ValueError('unsafe archive member')
            save('system/'+n,z.read(info),ZIP+'#'+n,record)
    (ROOT/'assets/content/sources.lock.json').write_text(json.dumps({'schema':'homeless.content-sources/1',
      'files':record,'archive_bytes':280737770,'source_master_resolution_preserved':True},indent=2)+'\n')
    print(json.dumps({'files':len(record),'bytes':sum(x['bytes'] for x in record)}))

if __name__ == '__main__':main()
