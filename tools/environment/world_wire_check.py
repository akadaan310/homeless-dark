#!/usr/bin/env python3
"""Exchange real Python observations and C# proposals; no Unity engine substitutes."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'packages'))
from dark_server.world import World


def main():
    source = ROOT / 'assets/content/world/opening.json'
    with tempfile.TemporaryDirectory(prefix='homeless-wire-') as directory:
        temporary = Path(directory)
        world = World.create(temporary / 'world.sqlite3', json.loads(source.read_text()))
        token = world.register('wire-observer', now=100)
        world.join(token, 'wire-join', now=101)
        world.execute(token, {'schema': 'dark.action/1', 'request_id': 'wire-greeting',
            'expected_revision': world.snapshot()['revision'], 'operation': 'talk',
            'arguments': {'target': 'mira', 'act': 'greeting'}}, now=102)
        observed = world.observe(token, now=103)
        path = temporary / 'observation.json'
        path.write_text(json.dumps(observed, ensure_ascii=False))
        command = [os.environ.get('DARK_DOTNET', '/tmp/homeless-dotnet/dotnet'), 'run', '--project',
                   'tools/environment/WorldWireTests', '--', '--observe', str(path)]
        run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=120)
        evidence = ROOT / 'evidence/environment'
        (evidence / 'native-install-world-wire-tests.log').write_text(run.stdout + run.stderr)
        if run.returncode:
            print(run.stdout + run.stderr); return run.returncode
        proposal = json.loads(Path(str(path) + '.proposal').read_text())
        result = world.execute(token, {'schema': 'dark.action/1', 'request_id': 'wire-csharp-sit',
            'expected_revision': proposal['expected_version'] - 1, 'operation': 'sit',
            'arguments': proposal['input']}, now=104)
        if result['status'] != 'COMMITTED' or world.observe(token, now=105)['actor']['stance'] != 'sitting':
            raise AssertionError('C# proposal did not produce an admitted Python action')
        life = json.loads(Path(str(path) + '.life-proposal').read_text())
        life_result = world.execute(token, {'schema': 'dark.action/1', 'request_id': 'wire-csharp-light',
            'expected_revision': life['expected_version'] - 1, 'operation': 'entity_action', 'arguments': life['input']}, now=106)
        if life_result['status'] != 'COMMITTED' or world.observe(token, now=107)['entities']['building:cafe']['state']['light'] != .5:
            raise AssertionError('C# nested Life proposal failed actual authority admission')
        report = {'schema': 'dark.cross-language-wire-check/1', 'status': 'PASS',
            'opening_content_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'actual_observation_revision': observed['revision'], 'parsed_speech_events': len(observed['speech']),
            'csharp_proposal_committed_revision': result['revision'], 'history': world.verify_history(),
            'csharp_life_proposal_committed_revision': life_result['revision'],
            'unity_native_execution': 'NOT_RUN', 'transport_scope': 'in-process authoritative Python World; HTTP and UnityWebRequest require their own checks'}
        (evidence / 'native-install-world-wire.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2))
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
