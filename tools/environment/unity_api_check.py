#!/usr/bin/env python3
"""Compile real Unity sources against verified installed Editor/API assemblies without running its engine."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024**2), b''): value.update(block)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--editor', type=Path, default=Path('/tmp/homeless-native/unity-squashfs/Editor'))
    parser.add_argument('--dotnet', default=os.environ.get('DARK_DOTNET', '/tmp/homeless-dotnet/dotnet'))
    args = parser.parse_args(); editor = args.editor.resolve(); managed = editor / 'Data/Managed'
    templates = editor / 'Data/Resources/PackageManager/ProjectTemplates/libcache/com.unity.template.3d-cross-platform-17.0.14/ScriptAssemblies'
    if not (managed / 'UnityEngine/UnityEngine.CoreModule.dll').is_file() or not (templates / 'Unity.RenderPipelines.Universal.Runtime.dll').is_file():
        raise SystemExit('Pinned real Unity/URP assemblies unavailable; refusing substitute references.')
    references = sorted(set((managed / 'UnityEngine').glob('*.dll')) | set(templates.glob('Unity.RenderPipelines.*.dll'))
                        | {templates / ('Unity.' + name + '.dll') for name in ['Mathematics', 'Collections', 'Burst']})
    sources = sorted((ROOT / 'unity/Assets/HOMELESS').glob('Runtime/**/*.cs')) + sorted((ROOT / 'unity/Assets/HOMELESS').glob('Editor/**/*.cs'))
    command = [args.dotnet, 'build', 'tools/environment/UnityEditorApiCompile', '--nologo',
               '-p:UnityManagedDir=' + str(managed), '-p:UnityTemplateAssemblies=' + str(templates)]
    started = time.monotonic(); run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=180)
    evidence = ROOT / 'evidence/environment'; log = evidence / 'native-install-unity-editor-api-compile.log'
    log.write_text(run.stdout + run.stderr)
    report = {'schema': 'dark.unity-real-api-compile/1', 'status': 'PASS' if run.returncode == 0 else 'FAIL',
              'command': command, 'exit_code': run.returncode, 'elapsed_seconds': time.monotonic() - started,
              'pinned_editor': '6000.1.0f1 (9ea152932a88)', 'editor_binary_sha256': digest(editor / 'Unity'),
              'sources': [{'path': str(path.relative_to(ROOT)), 'sha256': digest(path)} for path in sources],
              'official_assembly_references': [{'path': str(path.relative_to(editor)), 'bytes': path.stat().st_size, 'sha256': digest(path)} for path in references],
              'urp_source_version': json.loads((editor / 'Data/Resources/PackageManager/BuiltInPackages/com.unity.render-pipelines.universal/package.json').read_text())['version'],
              'scope': 'C#9/netstandard2.1 semantic compilation of all Unity runtime and Editor source against actual official assemblies; no generated engine stubs.',
              'limitations': ['Unity Editor project import NOT_RUN', 'Native component lifecycle/render/physics NOT_RUN', 'Android player build NOT_RUN', 'Galaxy A16 acceptance NOT_RUN']}
    (evidence / 'native-install-unity-api-compile.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'source_files': len(sources), 'real_assembly_references': len(references), 'log': str(log)}))
    if run.returncode: print(run.stdout[-4000:] + run.stderr[-4000:])
    return run.returncode


if __name__ == '__main__':
    raise SystemExit(main())
