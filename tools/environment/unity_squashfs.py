#!/usr/bin/env python3
"""Stream the pinned official Editor into a bounded RAM-backed read-only image."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import shutil
import signal
import subprocess
import threading
import time
import urllib.request

URL = 'https://download.unity3d.com/download_unity/9ea152932a88/LinuxEditorInstaller/Unity.tar.xz'
SIZE = 4519451520
MD5 = '8afcf8e7770623c480ad835cd93d2897'
CAP = 5 * 1024**3
MEMORY_FLOOR = 3 * 1024**3


def memory():
    fields = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    return int(fields['MemAvailable'].split()[0]) * 1024


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', type=Path, default=Path('/dev/shm/homeless-unity-6000.1.0f1.sqfs'))
    parser.add_argument('--output', type=Path, default=Path('evidence/environment/native-install-unity-squashfs.json'))
    args = parser.parse_args()
    if args.image.exists() or args.image.parent.resolve() != Path('/dev/shm'):
        parser.error('use a new image directly inside /dev/shm; no existing file is overwritten')
    if memory() < CAP + MEMORY_FLOOR or shutil.disk_usage('/dev/shm').free < CAP + 128 * 1024**2:
        parser.error('insufficient shared memory or available RAM for bounded acquisition')
    report = {'schema': 'dark.unity-squashfs-acquisition/1', 'url': URL, 'expected_bytes': SIZE,
              'expected_md5': MD5, 'image_cap_bytes': CAP, 'available_ram_floor_bytes': MEMORY_FLOOR,
              'timeout_seconds': 1200, 'input_bytes': 0, 'samples': [], 'status': 'RUNNING'}
    start = time.monotonic(); digest = hashlib.sha256(); md5 = hashlib.md5()
    errors = []; transfer_done = threading.Event()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    log = args.output.with_suffix('.log')

    def limits():
        resource.setrlimit(resource.RLIMIT_FSIZE, (CAP, CAP))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    with log.open('w') as stream:
        command = ['tar2sqfs', '-q', '-s', '-c', 'zstd', '-X', 'level=10', '-j', '1', '-Q', '2', str(args.image)]
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=stream, stderr=subprocess.STDOUT,
                                   start_new_session=True, preexec_fn=limits)
        report['argv'] = command

        def transfer():
            try:
                with urllib.request.urlopen(URL, timeout=30) as response:
                    if response.status != 200 or int(response.headers.get('Content-Length', -1)) != SIZE:
                        raise ValueError('official archive response length/status mismatch')
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        report['input_bytes'] += len(chunk)
                        if report['input_bytes'] > SIZE:
                            raise ValueError('archive byte budget exceeded')
                        digest.update(chunk); md5.update(chunk); process.stdin.write(chunk)
                process.stdin.close()
            except Exception as error:
                errors.append(type(error).__name__ + ': ' + str(error))
                try:
                    process.stdin.close()
                except OSError:
                    pass
            finally:
                transfer_done.set()

        thread = threading.Thread(target=transfer, daemon=True); thread.start()
        reason = None; next_sample = 0
        while process.poll() is None:
            elapsed = time.monotonic() - start; available = memory()
            allocated = args.image.stat().st_size if args.image.exists() else 0
            if elapsed >= next_sample:
                sample = {'elapsed_seconds': round(elapsed, 1), 'input_bytes': report['input_bytes'],
                          'image_bytes': allocated, 'available_ram_bytes': available}
                report['samples'].append(sample); print(json.dumps(sample), flush=True); next_sample = elapsed + 20
                args.output.write_text(json.dumps(report, indent=2) + '\n')
            if available < MEMORY_FLOOR:
                reason = 'available_ram_floor'; break
            if elapsed > 1200:
                reason = 'time_budget'; break
            if allocated > CAP:
                reason = 'image_size_cap'; break
            if errors:
                reason = 'transfer_failed'; break
            time.sleep(.5)
        if reason:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=5)
        thread.join(timeout=35)
        report.update(exit_code=process.returncode, duration_seconds=round(time.monotonic() - start, 3),
                      archive_sha256=digest.hexdigest(), archive_md5=md5.hexdigest(), transfer_done=transfer_done.is_set(),
                      errors=errors, termination_reason=reason,
                      image_bytes=args.image.stat().st_size if args.image.exists() else 0)
        okay = process.returncode == 0 and transfer_done.is_set() and not errors and report['input_bytes'] == SIZE and md5.hexdigest() == MD5
        report['status'] = 'VERIFIED' if okay else 'FAILED'
        if not okay and args.image.exists():
            args.image.unlink(); report['own_partial_image_removed'] = True
        report['image_path'] = str(args.image) if okay else None
        report['unity_activation_verified'] = False
        report['unity_gameplay_executed'] = False
        args.output.write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({key: value for key, value in report.items() if key != 'samples'}, indent=2))
        return 0 if okay else 1


if __name__ == '__main__':
    raise SystemExit(main())
