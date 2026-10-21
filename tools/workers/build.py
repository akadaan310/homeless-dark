#!/usr/bin/env python3
"""Fetch the exact MIT QuickJS source, verify bytes, build a no-host-import worker."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT=Path(__file__).resolve().parents[2]
URL='https://bellard.org/quickjs/quickjs-2026-06-04.tar.xz'
HASH='b376e839b322978313d929fd20663b11ba58b75df5a46c126dd19ea2fa70ad2a'


def build():
    cache=ROOT/'assets/cache/quickjs-2026-06-04.tar.xz';cache.parent.mkdir(parents=True,exist_ok=True)
    if not cache.exists():
        with urllib.request.urlopen(URL,timeout=30) as response:raw=response.read(4*1024*1024+1)
        if len(raw)>4*1024*1024 or hashlib.sha256(raw).hexdigest()!=HASH:raise ValueError('QuickJS source integrity mismatch')
        cache.write_bytes(raw)
    if hashlib.sha256(cache.read_bytes()).hexdigest()!=HASH:raise ValueError('QuickJS source hash mismatch')
    out=ROOT/'artifacts/workers/dark-js';out.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='dark-js-build-') as temporary:
        work=Path(temporary)
        with tarfile.open(cache) as archive:
            for item in archive.getmembers():
                if not (work/item.name).resolve().is_relative_to(work) or not (item.isfile() or item.isdir()):raise ValueError('unsafe archive member')
            archive.extractall(work)
        source=work/'quickjs-2026-06-04'
        license_target=ROOT/'tools/workers/QuickJS-LICENSE.txt'
        license_target.write_bytes((source/'LICENSE').read_bytes())
        sources=['quickjs.c','dtoa.c','libregexp.c','libunicode.c','cutils.c']
        argv=['cc','-O2','-fwrapv','-D_GNU_SOURCE','-DCONFIG_VERSION="2026-06-04"','-I'+str(source),
              str(ROOT/'tools/workers/dark_js.c'),*[str(source/f) for f in sources],'-lm','-lpthread','-o',str(out)]
        result=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180)
        log=ROOT/'evidence/server/worker-build.log';log.parent.mkdir(parents=True,exist_ok=True);log.write_bytes(result.stdout)
        if result.returncode:raise RuntimeError('C worker build failed; see '+str(log))
    record={'source_url':URL,'source_sha256':HASH,'source_bytes':cache.stat().st_size,'license':'MIT',
            'binary_path':str(out.relative_to(ROOT)),'binary_sha256':hashlib.sha256(out.read_bytes()).hexdigest(),
            'source_version':'2026-06-04','host_imports':[],'os_filter':'Linux seccomp allowlist; no file-open/network/exec syscalls',
            'limits':{'engine_memory_bytes':16777216,'process_address_space_bytes':134217728,'CPU_seconds':1,
                      'engine_deadline_seconds':.15,'interrupt_callbacks':10000,'stdin_bytes':65536,'stdout_bytes':65537},
            'security_claim':'bounded worker with defense in depth; not a formally audited JS engine or general host shell'}
    (ROOT/'tools/workers/source.lock.json').write_text(json.dumps(record,indent=2)+'\n')
    return record


if __name__=='__main__':print(json.dumps(build(),indent=2))
