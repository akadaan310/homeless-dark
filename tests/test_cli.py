import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SDK = os.environ.get('DARK_DOTNET', '/tmp/homeless-dotnet/dotnet')
DLL = ROOT / 'tools/Dark.Cli/bin/Debug/net8.0/darkctl.dll'

class CliTests(unittest.TestCase):
    def call(self, *args):
        result = subprocess.run([SDK, str(DLL), *args], text=True, capture_output=True, timeout=30)
        return result.returncode, json.loads(result.stdout)

    def test_describe_is_pure_and_identifies_adapter_limits(self):
        code, output = self.call('describe')
        self.assertEqual(code, 0)
        self.assertEqual(output['schema'], 'darkctl.result/1')
        self.assertEqual(output['data']['founder_authenticated'], False)

    def test_demo_persists_once_replays_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            code, output = self.call('demo', directory)
            self.assertEqual(code, 0)
            self.assertEqual(output['data']['revision'], 2)
            self.assertEqual(output['data']['replayed_sign'], 'A place to return to')
            journal = Path(directory)/'events.darklog'
            before = journal.read_bytes()
            code, replay = self.call('replay', str(journal), output['data']['head'])
            self.assertEqual(code, 0)
            self.assertEqual(replay['data']['events'], 2)
            code, failure = self.call('demo', directory)
            self.assertNotEqual(code, 0)
            self.assertEqual(failure['status'], 'refused')
            self.assertEqual(before, journal.read_bytes())

    def test_replay_requires_trusted_head(self):
        with tempfile.TemporaryDirectory() as directory:
            code, output = self.call('demo', directory)
            self.assertEqual(code, 0)
            code, failure = self.call('replay', str(Path(directory)/'events.darklog'), '0'*64)
            self.assertNotEqual(code, 0)
            self.assertEqual(failure['status'], 'refused')

    def test_npc_snapshot_reloads_in_a_separate_cli_process(self):
        with tempfile.TemporaryDirectory() as directory:
            code, output = self.call('demo', directory)
            self.assertEqual(code, 0)
            saved = output['data']
            self.assertEqual(saved['npc_observations_restored'], 1)
            code, replay = self.call('replay-npc', saved['npc_snapshot'], 'npc-cafe', saved['npc_digest'])
            self.assertEqual(code, 0)
            self.assertEqual(replay['data']['actor_id'], 'npc-cafe')
            self.assertEqual(replay['data']['task'], 'work')
            self.assertEqual(replay['data']['memory_count'], 1)
            self.assertEqual(replay['data']['personality']['Duty'], .8)
            self.assertEqual(replay['data']['observations'][0]['EventId'], 'hello-1')
            code, rejected = self.call('replay-npc', saved['npc_snapshot'], 'another-npc', saved['npc_digest'])
            self.assertEqual(code, 2)
            self.assertEqual(rejected['status'], 'refused')
            code, rejected = self.call('replay-npc', saved['npc_snapshot'], 'npc-cafe', '0'*64)
            self.assertEqual(code, 2)
            self.assertEqual(rejected['status'], 'refused')

if __name__ == '__main__':
    unittest.main()
