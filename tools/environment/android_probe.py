#!/usr/bin/env python3
"""Bounded diagnostic boot; does not certify Unity or Galaxy A16 performance."""
import argparse
import json
import os
from pathlib import Path
import resource
import shutil
import signal
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', type=Path, default=Path('/tmp/homeless-native'))
    parser.add_argument('--seconds', type=int, default=90)
    parser.add_argument('--output', type=Path,
                        default=Path('evidence/environment/native-install-android-configured-boot.json'))
    args = parser.parse_args()
    if not 1 <= args.seconds <= 300:
        parser.error('--seconds must be between 1 and 300')
    reserve = 2 * 1024**3
    if shutil.disk_usage(args.prefix).free < reserve:
        parser.error('less than 2 GiB free; no boot attempted')
    root = args.prefix.resolve()
    sdk = root / 'sdk'
    image = sdk / 'system-images/android-26/default/arm64-v8a'
    if not all((image / name).is_file() for name in ('kernel-ranchu', 'ramdisk.img', 'system.img', 'vendor.img')):
        parser.error('diagnostic image absent; see native-install-image-reclamation.json and Android source hashes before a budgeted reacquisition')
    avd = root / 'avd/homeless_api26.avd'
    avd.mkdir(parents=True, exist_ok=True)
    if not (avd / 'userdata-qemu.img').exists():
        subprocess.run(['cp', '--sparse=always', str(image / 'userdata.img'),
                        str(avd / 'userdata-qemu.img')], check=True)
    env = os.environ.copy()
    env.update(ANDROID_SDK_ROOT=str(sdk), ANDROID_AVD_HOME=str(root / 'avd'),
               ANDROID_EMULATOR_HOME=str(root / 'emulator-home'))
    command = ['xvfb-run', '-a', 'qemu-x86_64', '-L', str(root / 'x64'),
               '-E', 'LD_LIBRARY_PATH=' + str(sdk / 'emulator/lib64'),
               str(sdk / 'emulator/qemu/linux-x86_64/qemu-system-aarch64-headless'),
               '-avd', 'homeless_api26']
    for flag, path in [('sysdir', image), ('kernel', image / 'kernel-ranchu'),
                       ('ramdisk', image / 'ramdisk.img'), ('system', image / 'system.img'),
                       ('vendor', image / 'vendor.img'), ('data', avd / 'userdata-qemu.img')]:
        command += ['-' + flag, str(path)]
    command += ['-no-window', '-no-audio', '-no-snapshot', '-gpu', 'swiftshader_indirect',
                '-feature', '-Vulkan', '-accel', 'off', '-memory', '1024', '-cores', '1',
                '-port', '5556', '-verbose', '-show-kernel']
    args.output.parent.mkdir(parents=True, exist_ok=True)
    log_path = args.output.with_suffix('.log')
    start = time.monotonic()
    boot = False
    adb_evidence = []
    reason = 'process_exit'
    # This applies only to the diagnostic child, avoiding multi-GB crash dumps.
    def child_limits():
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        os.setsid()
    with log_path.open('w') as log:
        process = subprocess.Popen(command, env=env, stdout=log,
                                   stderr=subprocess.STDOUT, preexec_fn=child_limits)
        next_adb = start + 15
        try:
            while process.poll() is None:
                now = time.monotonic()
                if now - start >= args.seconds:
                    reason = 'bounded_duration'
                    break
                if shutil.disk_usage(root).free < reserve:
                    reason = 'two_gib_reserve_guard'
                    break
                if now >= next_adb:
                    next_adb = now + 15
                    result = subprocess.run(['adb', '-s', 'emulator-5556', 'shell',
                                             'getprop', 'sys.boot_completed'],
                                            capture_output=True, text=True, timeout=5)
                    adb_evidence.append({'elapsed_seconds': round(now - start, 2),
                                         'exit_code': result.returncode,
                                         'stdout': result.stdout, 'stderr': result.stderr})
                    if result.returncode == 0 and result.stdout.strip() == '1':
                        boot = True
                        reason = 'android_boot_completed'
                        break
                time.sleep(.5)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
    result = {'schema': 'homeless-native-boot-probe/1', 'argv': command,
              'duration_seconds': round(time.monotonic() - start, 2),
              'exit_code': process.returncode, 'termination_reason': reason,
              'android_boot_complete': boot, 'adb_observations': adb_evidence,
              'host_architecture': os.uname().machine, 'guest_abi': 'arm64-v8a',
              'guest_api': 26, 'cpu_mode': 'TCG under qemu-user x86_64 translation',
              'unity_gameplay_run': False, 'galaxy_a16_measurement': False,
              'free_bytes_after': shutil.disk_usage(root).free, 'log': str(log_path)}
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    return 0 if boot else 2


if __name__ == '__main__':
    raise SystemExit(main())
