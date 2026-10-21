import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages'))
from dark_server.world import World
from dark_server.protocol import Client,NetworkFailure


class CliTests(unittest.TestCase):
    def run_cli(self,*args,check=True):
        p=subprocess.run([sys.executable,'tools/darkctl.py','--world',str(self.world_path),*args],cwd=ROOT,
            text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
        if check:self.assertEqual(p.returncode,0,p.stderr+p.stdout)
        return p

    def test_source_content_is_reproducible_and_retains_fiction_boundary(self):
        spec=importlib.util.spec_from_file_location('opening',ROOT/'tools/build_gameplay_content.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        self.assertEqual(module.build(),json.loads((ROOT/'assets/content/world/opening.json').read_text()))
        self.assertTrue(all(not n['native_collision_ready'] for n in module.build()['nodes'].values()))
        self.assertTrue(all('factuality' in e for e in module.build()['edges']))

    def test_real_server_process_external_client_and_sigkill_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.world_path=Path(tmp)/'world.sqlite3';token_path=Path(tmp)/'actor.token'
            self.run_cli('init');self.run_cli('register','cli-player','--token-file',str(token_path),'--scope','author/osm:node:1603574189')
            self.assertEqual(token_path.stat().st_mode&0o777,0o600)
            self.run_cli('join','--token-file',str(token_path))
            self.assertNotEqual(self.run_cli('init',check=False).returncode,0)
            log=Path(tmp)/'server.log'
            with log.open('w') as output:
                server=subprocess.Popen([sys.executable,'tools/darkctl.py','--world',str(self.world_path),'serve','--port','0'],cwd=ROOT,
                    stdout=output,stderr=subprocess.STDOUT,text=True)
                try:
                    deadline=time.monotonic()+8
                    while time.monotonic()<deadline and not log.read_text():time.sleep(.02)
                    endpoint=json.loads(log.read_text().splitlines()[0])['url']
                    client=Client(endpoint,token_path.read_text().strip())
                    obs=client.observe()
                    request=client.proposal('travel',{'destination':'osm:node:2057042478','mode':'walk'},'survive-kill',obs['revision'])
                    committed=client.invoke(request)
                    time.sleep(1.2)
                    server.kill();server.wait(timeout=5)
                    world=World(self.world_path);state=world.snapshot()
                    self.assertIn('cli-player',state['journeys'])
                    self.assertGreater(state['tick'],0)
                    self.assertEqual(world.execute(token_path.read_text().strip(),request),committed)
                    self.assertEqual(world.verify_history()['events'],state['revision'])
                    world.advance(60,'finish-after-kill')
                    self.assertEqual(world.snapshot()['actors']['cli-player']['node'],'osm:node:2057042478')
                    self.run_cli('verify')
                finally:
                    if server.poll() is None:server.kill();server.wait(timeout=5)


if __name__=='__main__':unittest.main()
