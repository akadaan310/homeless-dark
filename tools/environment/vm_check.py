#!/usr/bin/env python3
"""Execute portable scenarios and real Unity API compilation when its official references are mounted."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dotnet', default=os.environ.get('DARK_DOTNET', '/tmp/homeless-dotnet/dotnet'))
    parser.add_argument('--output', type=Path, default=Path('evidence/environment/native-install-vm-check.json'))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    args.output = (root / args.output).resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    results = []
    with tempfile.TemporaryDirectory(prefix='homeless-vm-world-') as fixture:
        commands = [
            ('core', ['run', '--project', 'tests/Dark.Core.Tests']),
            ('math', ['run', '--project', 'tests/Dark.Math.Tests']),
            ('cli-persistent-fixture', ['run', '--project', 'tools/Dark.Cli', '--', 'demo', fixture]),
            ('world-wire', ['run', '--project', 'tools/environment/WorldWireTests']),
            ('unity-syntax-self-test', ['run', '--project', 'tools/environment/UnitySyntax', '--', '--self-test']),
            ('unity-syntax', ['run', '--project', 'tools/environment/UnitySyntax', '--', str(root)]),
        ]
        for name, command in commands:
            start = time.monotonic()
            process = subprocess.run([args.dotnet] + command, cwd=root, capture_output=True,
                                     text=True, timeout=120)
            log = args.output.parent / ('native-install-vm-' + name + '.log')
            log.write_text(process.stdout + process.stderr)
            results.append({'name': name, 'argv': [args.dotnet] + command,
                            'exit_code': process.returncode,
                            'duration_seconds': round(time.monotonic() - start, 3),
                            'log': str(log.relative_to(root))})
    semantic = 'NOT_RUN_REFERENCES_UNAVAILABLE'
    if Path('/tmp/homeless-native/unity-squashfs/Editor/Data/Managed/UnityEngine/UnityEngine.CoreModule.dll').is_file():
        command = [sys.executable, 'tools/environment/unity_api_check.py', '--dotnet', args.dotnet]
        start = time.monotonic(); process = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=180)
        log = args.output.parent / 'native-install-vm-unity-real-api.log'; log.write_text(process.stdout + process.stderr)
        results.append({'name': 'unity-real-api', 'argv': command, 'exit_code': process.returncode,
                        'duration_seconds': round(time.monotonic() - start, 3), 'log': str(log.relative_to(root))})
        semantic = 'PASS_REAL_OFFICIAL_REFERENCES' if process.returncode == 0 else 'FAIL'
    report = {'schema': 'homeless-vm-behavior-check/1', 'results': results,
              'portable_checks_status': 'PASS' if all(r['exit_code'] == 0 for r in results) else 'FAIL',
              'unity_semantic_compilation': semantic, 'unity_editor_project_import': 'NOT_RUN', 'unity_rendering': 'NOT_RUN',
              'android_gameplay': 'NOT_RUN', 'galaxy_a16_measurement': 'NOT_RUN',
              'scope': 'Portable scenarios, syntax and actual-assembly semantic compilation when installed; native lifecycle/import/render/device acceptance remain separate.'}
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    return 0 if report['portable_checks_status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
