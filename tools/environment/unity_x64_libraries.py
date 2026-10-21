#!/usr/bin/env python3
"""Acquire verified Ubuntu x64 runtime libraries into an isolated diagnostic sysroot."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request

ROOT = Path('/tmp/homeless-native')
LIMIT = 180 * 1024**2
RESERVE = 2 * 1024**3
# This is a loader/headless probe, not a functioning x64 graphics installation.
# GLVND can load libGL without its optional vendor renderer; Mesa/LLVM would add 143 MiB.
OMIT = {'libglx-mesa0', 'libgl1-mesa-dri'}


def main():
    packages = {}; indexes = []
    for suite in ('jammy', 'jammy-updates', 'jammy-security'):
        url = 'https://archive.ubuntu.com/ubuntu/dists/' + suite + '/main/binary-amd64/Packages.gz'
        with urllib.request.urlopen(url, timeout=30) as response:
            raw = response.read(8 * 1024**2 + 1)
        if len(raw) > 8 * 1024**2:
            raise ValueError('package-index budget exceeded')
        indexes.append({'url': url, 'sha256': hashlib.sha256(raw).hexdigest()})
        for paragraph in gzip.decompress(raw).decode().split('\n\n'):
            record = {}
            for line in paragraph.splitlines():
                if line and not line[0].isspace() and ': ' in line:
                    key, value = line.split(': ', 1); record[key] = value
            if record.get('Architecture') == 'amd64' and record.get('Package'):
                packages[record['Package']] = record
    queue = ['libgl1', 'libxcursor1', 'libxrandr2', 'libudev1', 'libgtk-3-0', 'libgdk-pixbuf-2.0-0',
             'libglib2.0-0', 'libxml2', 'zlib1g', 'libcairo2', 'libpango-1.0-0', 'libfontconfig1', 'libstdc++6']
    selected = {}
    while queue:
        package = queue.pop()
        if package in selected or package not in packages or package in OMIT:
            continue  # Architecture-independent data and virtual packages are not ELF loader requirements.
        item = packages[package]; selected[package] = item
        for dependency in (item.get('Pre-Depends', '') + ',' + item.get('Depends', '')).split(','):
            alternatives = [re.split(r'[ (:\[]', part.strip())[0] for part in dependency.split('|')]
            candidate = next((name for name in alternatives if name in packages), None)
            if candidate:
                queue.append(candidate)
    installed_upper_bound = sum(int(item.get('Installed-Size', 0)) * 1024 for item in selected.values())
    download_total = sum(int(item['Size']) for item in selected.values())
    plan = {'packages': len(selected), 'omitted_graphics_vendor_packages': sorted(OMIT), 'scope': 'isolated loader/headless dependencies only', 'installed_upper_bound_bytes': installed_upper_bound, 'download_bytes': download_total,
            'largest': sorted([(name, int(item.get('Installed-Size', 0)) * 1024) for name, item in selected.items()], key=lambda pair: pair[1], reverse=True)[:15]}
    print(json.dumps(plan), flush=True)
    Path('evidence/environment/native-install-unity-x64-library-plan.json').write_text(json.dumps(plan, indent=2) + '\n')
    if installed_upper_bound > LIMIT or download_total > 80 * 1024**2:
        raise ValueError('library plan exceeds explicit budget')
    if shutil.disk_usage(ROOT).free - installed_upper_bound - 20 * 1024**2 < RESERVE:
        raise ValueError('library plan cannot preserve 2 GiB disk reserve')
    report = {'schema': 'dark.unity-x64-library-acquisition/1', 'indexes': indexes,
              'installed_upper_bound_bytes': installed_upper_bound, 'download_bytes': download_total, 'packages': []}
    output = Path('evidence/environment/native-install-unity-x64-libraries.json')
    print(json.dumps({'packages': len(selected), 'installed_upper_bound_bytes': installed_upper_bound, 'download_bytes': download_total}), flush=True)
    for package, item in sorted(selected.items()):
        url = 'https://archive.ubuntu.com/ubuntu/' + item['Filename']
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read(int(item['Size']) + 1)
        if len(data) != int(item['Size']) or hashlib.sha256(data).hexdigest() != item['SHA256']:
            raise ValueError('package integrity mismatch: ' + package)
        with tempfile.NamedTemporaryFile(prefix='homeless-x64-', suffix='.deb') as archive:
            archive.write(data); archive.flush()
            run = subprocess.run(['dpkg-deb', '-x', archive.name, str(ROOT / 'x64')], capture_output=True, text=True, timeout=60)
        record = {'package': package, 'version': item['Version'], 'url': url, 'bytes': len(data),
                  'sha256': item['SHA256'], 'exit_code': run.returncode, 'stderr': run.stderr}
        report['packages'].append(record); output.write_text(json.dumps(report, indent=2) + '\n')
        if run.returncode:
            raise RuntimeError('extraction failed: ' + package)
        if shutil.disk_usage(ROOT).free < RESERVE:
            raise RuntimeError('disk reserve breached')
    # Debian's absolute loader symlink would otherwise resolve to the ARM host.
    loader = ROOT / 'x64/lib64/ld-linux-x86-64.so.2'
    if loader.is_symlink():
        loader.unlink(); loader.symlink_to('../lib/x86_64-linux-gnu/ld-linux-x86-64.so.2')
    report['status'] = 'VERIFIED'; output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'packages': len(report['packages']), 'free_bytes': shutil.disk_usage(ROOT).free}))


if __name__ == '__main__':
    main()
