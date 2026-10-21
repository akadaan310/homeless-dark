#!/usr/bin/env python3
"""Bounded real Editor startup under ISA translation, without credentials or activation bypass."""
import json
import argparse
import os
from pathlib import Path
import resource
import shutil
import signal
import stat
import subprocess
import time


def available_memory():
    for line in Path('/proc/meminfo').read_text().splitlines():
        if line.startswith('MemAvailable:'):
            return int(line.split()[1]) * 1024
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prelaunch-licensing', action='store_true', help='Run the unchanged official client under translation before starting Editor.')
    parser.add_argument('--allow-licensing-memfd', action='store_true', help='Permit .NET sparse 2 TiB JIT backing file, retaining live physical-resource bounds.')
    parser.add_argument('--bounded-licensing-gc', action='store_true', help='Apply documented per-process .NET 256 MiB managed-heap and two-processor caps.')
    parser.add_argument('--wait-licensing-socket', action='store_true', help='Wait for the actual translated licensing IPC endpoint, up to 60 seconds.')
    args = parser.parse_args()
    suffix = '-translated-client' if args.prelaunch_licensing else ''
    if args.allow_licensing_memfd: suffix += '-memfd'
    if args.bounded_licensing_gc: suffix += '-gc'
    if args.wait_licensing_socket: suffix += '-ready'
    project = Path('/dev/shm/homeless-unity-startup-project' + suffix)
    if project.exists():
        raise SystemExit('Refusing an existing diagnostic project; inspect previous evidence first.')
    if available_memory() < 3 * 1024**3:
        raise SystemExit('Insufficient available memory for bounded startup.')
    project.mkdir()
    evidence = Path('evidence/environment').resolve()
    log = evidence / ('native-install-unity-batch' + suffix + '.log')
    console = evidence / ('native-install-unity-batch-console' + suffix + '.log')
    command = ['qemu-x86_64', '-L', '/tmp/homeless-native/x64',
               '/tmp/homeless-native/unity-squashfs/Editor/Unity', '-batchmode', '-nographics', '-quit',
               '-createProject', str(project), '-logFile', str(log)]

    def limits():
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (32 * 1024**2, 32 * 1024**2))

    def licensing_limits():
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        # Actual strace showed ftruncate(8,2199023255552) for .NET virtual JIT backing;
        # this is a sparse memfd, not 2 TiB of physical memory or disk allocation.
        cap = 2 * 1024**4 if args.allow_licensing_memfd else 32 * 1024**2
        resource.setrlimit(resource.RLIMIT_FSIZE, (cap, cap))

    licensing = None; licensing_file = None; licensing_command = None
    licensing_environment = {}
    if args.prelaunch_licensing:
        licensing_command = ['qemu-x86_64', '-L', '/tmp/homeless-native/x64',
            '/tmp/homeless-native/unity-squashfs/Editor/Data/Resources/Licensing/Client/Unity.Licensing.Client',
            '--namedPipe', 'LicenseClient-' + os.environ.get('USER', 'ubuntu')]
        licensing_file = (evidence / ('native-install-unity-licensing' + suffix + '.log')).open('w')
        if args.bounded_licensing_gc:
            licensing_environment = {'DOTNET_GCHeapHardLimit': '0x10000000', 'DOTNET_GCConserveMemory': '9', 'DOTNET_PROCESSOR_COUNT': '2'}
        licensing = subprocess.Popen(licensing_command, stdout=licensing_file, stderr=subprocess.STDOUT, preexec_fn=licensing_limits,
                                     start_new_session=True, env={**os.environ, **licensing_environment})
        warmup = time.monotonic(); warmup_wall = time.time()
        socket_path = Path('/tmp/LicenseClient-' + os.environ.get('USER', 'ubuntu') + '.sock')
        while licensing.poll() is None and time.monotonic() - warmup < (60 if args.wait_licensing_socket else 20):
            if available_memory() < 3 * 1024**3 or shutil.disk_usage('/').free < 2 * 1024**3:
                os.killpg(licensing.pid, signal.SIGTERM); licensing.wait(timeout=5)
                raise SystemExit('Physical resource reserve reached during licensing warm-up; owned process stopped.')
            if args.wait_licensing_socket and socket_path.exists():
                socket_stat = socket_path.stat()
                if stat.S_ISSOCK(socket_stat.st_mode) and socket_stat.st_mtime >= warmup_wall - 1: break
            time.sleep(.5)
    start = time.monotonic(); reason = None; peak_project_bytes = 0; minimum_memory = available_memory()
    with console.open('w') as output:
        process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, preexec_fn=limits, start_new_session=True)
        while process.poll() is None:
            elapsed = time.monotonic() - start; memory = available_memory(); minimum_memory = min(minimum_memory, memory)
            size = sum(path.stat().st_size for path in project.rglob('*') if path.is_file())
            peak_project_bytes = max(peak_project_bytes, size)
            if elapsed >= 120: reason = '120 second startup deadline'
            elif memory < 3 * 1024**3: reason = '3 GiB available-memory reserve'
            elif size > 100 * 1024**2: reason = '100 MiB diagnostic-project cap'
            elif shutil.disk_usage('/').free < 2 * 1024**3: reason = '2 GiB physical disk reserve'
            elif console.stat().st_size > 8 * 1024**2 or (licensing_file and Path(licensing_file.name).stat().st_size > 8 * 1024**2): reason = '8 MiB diagnostic log cap'
            if reason:
                os.killpg(process.pid, signal.SIGTERM)
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: os.killpg(process.pid, signal.SIGKILL); process.wait()
                break
            time.sleep(.5)
    if licensing:
        if licensing.poll() is None:
            os.killpg(licensing.pid, signal.SIGTERM)
            try: licensing.wait(timeout=5)
            except subprocess.TimeoutExpired: os.killpg(licensing.pid, signal.SIGKILL); licensing.wait()
        licensing_file.close()
    report = {'schema': 'dark.unity-native-startup/1', 'command': command, 'exit_code': process.returncode,
              'elapsed_seconds': time.monotonic() - start, 'limit_reached': reason,
              'minimum_available_memory_bytes': minimum_memory, 'peak_project_bytes': peak_project_bytes,
              'scope': 'Actual translated Linux Editor startup with an empty diagnostic project; no activation bypass.',
              'license_activated': False, 'gameplay_project_imported': False, 'native_gameplay_tested': False,
              'logs': [str(log), str(console)]}
    if licensing: report.update(licensing_command=licensing_command, licensing_process_exit=licensing.returncode, allow_licensing_sparse_memfd=args.allow_licensing_memfd, licensing_environment=licensing_environment)
    (evidence / ('native-install-unity-batch' + suffix + '.json')).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
