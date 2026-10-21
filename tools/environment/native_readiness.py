#!/usr/bin/env python3
"""Inspect real tools and bounded execution; never equate probes with gameplay."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import shutil
import struct
import subprocess
import tempfile
import time


def run(argv, *, timeout=20, stdin=None):
    start = time.monotonic()
    try:
        result = subprocess.run(argv, input=stdin, capture_output=True, text=True, timeout=timeout)
        return {'argv': list(map(str, argv)), 'exit_code': result.returncode,
                'stdout': result.stdout[-16000:], 'stderr': result.stderr[-16000:],
                'duration_seconds': round(time.monotonic() - start, 3)}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {'argv': list(map(str, argv)), 'exit_code': None, 'error': str(error),
                'duration_seconds': round(time.monotonic() - start, 3)}


def x64_exit_fixture(exit_code=42):
    """Small original static ELF: exit(exit_code), proving only ISA/syscall execution."""
    code = b'\xb8\x3c\x00\x00\x00\xbf' + struct.pack('<I', exit_code) + b'\x0f\x05'
    base, offset = 0x400000, 64 + 56
    header = struct.pack('<16sHHIQQQIHHHHHH', b'\x7fELF\x02\x01\x01' + bytes(9),
                         2, 62, 1, base + offset, 64, 0, 0, 64, 56, 1, 64, 0, 0)
    segment = struct.pack('<IIQQQQQQ', 1, 5, 0, base, base, offset + len(code), offset + len(code), 4096)
    return header + segment + code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', type=Path, default=Path('/tmp/homeless-native'))
    parser.add_argument('--output', type=Path, default=Path('evidence/environment/native-install-readiness.json'))
    args = parser.parse_args()
    prefix = args.prefix.resolve()
    qemu = ['qemu-x86_64', '-L', str(prefix / 'x64'), '-E',
            'LD_LIBRARY_PATH=' + str(prefix / 'sdk/emulator/lib64')]
    commands = {
        'jdk': ['java', '-version'], 'adb': ['adb', 'version'],
        'qemu_user': ['qemu-x86_64', '--version'],
        'qemu_system': ['qemu-system-aarch64', '--version'],
        'software_gl': ['xvfb-run', '-a', 'glxinfo', '-B'],
        'blender': ['blender', '-b', '--factory-startup', '--python-expr',
                    'import bpy; print("OCIO_ENABLED", bpy.app.build_options.opencolorio); print("BLENDER", bpy.app.version_string)'],
        'espeak': ['espeak-ng', '--version'], 'cmake': ['cmake', '--version'],
        'sdkmanager': [str(prefix / 'sdk/cmdline-tools/13.0/bin/sdkmanager'), '--version'],
        'android_engine': qemu + [str(prefix / 'sdk/emulator/qemu/linux-x86_64/qemu-system-aarch64-headless'), '-version'],
        'android_acceleration': qemu + [str(prefix / 'sdk/emulator/emulator-check'), 'accel'],
        'binder_module': ['modprobe', '--dry-run', 'binder_linux'],
        'packages': ['dpkg-query', '-W', '-f=${Package}\t${Version}\t${Architecture}\n',
                     'adb', 'openjdk-17-jdk-headless', 'qemu-user', 'qemu-system-arm',
                     'xvfb', 'mesa-utils', 'blender', 'blender-data', 'espeak-ng', 'cmake', 'squashfs-tools-ng', 'squashfuse'],
    }
    probes = {name: run(command) for name, command in commands.items()}
    with tempfile.TemporaryDirectory(prefix='homeless-isa-probe-') as temporary:
        fixture = Path(temporary) / 'exit42-x64'
        fixture.write_bytes(x64_exit_fixture())
        fixture.chmod(0o755)
        probes['x64_syscall_fixture'] = run(['qemu-x86_64', str(fixture)])
    monitor = '\n'.join(json.dumps({'execute': command}) for command in
                         ['qmp_capabilities', 'query-status', 'quit']) + '\n'
    for mode in ['tcg', 'kvm']:
        probes['arm_machine_' + mode] = run(['qemu-system-aarch64', '-machine', 'virt',
            '-cpu', 'cortex-a57', '-accel', mode, '-m', '128', '-S', '-display', 'none',
            '-nodefaults', '-qmp', 'stdio'], stdin=monitor)
    candidates = [Path('/opt/unity/Editor/Unity'), Path('/opt/Unity/Editor/Unity'), prefix / 'unity-squashfs/Editor/Unity']
    candidates += list((Path.home() / 'Unity/Hub/Editor').glob('*/Editor/Unity'))
    if os.environ.get('UNITY_EDITOR_PATH'):
        candidates.append(Path(os.environ['UNITY_EDITOR_PATH']))
    present = [str(path) for path in candidates if path.is_file()]
    if (prefix / 'unity-squashfs/Editor/Unity').is_file():
        probes['unity_translated_version'] = run(['qemu-x86_64', '-L', str(prefix / 'x64'), str(prefix / 'unity-squashfs/Editor/Unity'), '-version'])
    # Presence is not activation. Never read or print license/credential contents.
    license_paths = [Path.home() / '.local/share/unity3d/Unity/Unity_lic.ulf',
                     Path('/var/lib/unity3d/Unity_lic.ulf')]
    report = {'schema': 'homeless-native-readiness/1',
        'observed_at': datetime.now(timezone.utc).isoformat(),
        'host': {'architecture': platform.machine(), 'kernel': platform.release(),
                 'cpu_count': os.cpu_count(), 'disk_free_bytes': shutil.disk_usage('/').free,
                 'kvm_device_present': Path('/dev/kvm').exists(),
                 'binder_device_present': any(Path(p).exists() for p in ['/dev/binder', '/dev/binderfs'])},
        'probes': probes, 'unity_editor_candidates_present': present,
        'unity_license_file_present': any(p.exists() for p in license_paths),
        'unity_activation_verified': False,
        'pinned_editor': {'version': '6000.1.0f1', 'revision': '9ea152932a88',
            'archive_bytes': 4519451520, 'installed_bytes': 8481863680,
            'android_support_installed_bytes': 1350645118},
        'mandatory_gates': {'unity_import': 'NOT_RUN', 'unity_android_build': 'NOT_RUN',
            'unity_native_render_capture': 'NOT_RUN', 'galaxy_a16_20_minute_session': 'NOT_RUN'},
        'network_observation': {'cloud_environment_status_tool_available': False,
                               'policy_file_present': Path('/etc/codex/network-policy.json').exists()},
        'interpretation': 'QEMU/GL tool execution is diagnostic only. No device or game gate passes from these probes.'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'output': str(args.output), 'host': report['host'],
                      'exit_codes': {name: p['exit_code'] for name, p in probes.items()}}, indent=2))


if __name__ == '__main__':
    main()
