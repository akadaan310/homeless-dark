import concurrent.futures
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'packages'))
from dark_server.world import World
from dark_server.protocol import create_server, Client, NetworkFailure
from test_world import content


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.world=World.create(Path(self.tmp.name)/'w.db',content())
        self.token=self.world.register('human_one',scopes=['author/cafe'])
        self.other=self.world.register('human_two')
        self.ai=self.world.register('external_controller',controller='external_ai')
        for token,rid in ((self.token,'join-one'),(self.other,'join-two'),(self.ai,'join-ai')):self.world.join(token,rid)
        self.server=create_server(self.world,port=0)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.addCleanup(self.stop)
        self.url='http://127.0.0.1:'+str(self.server.server_address[1])
        self.client=Client(self.url,self.token)

    def stop(self):
        self.server.shutdown();self.server.server_close();self.thread.join(2)

    def raw(self,path,body=None,token=None,headers=None):
        h={'Accept':'application/purl+json',**(headers or {})}
        if token:h['Authorization']='Bearer '+token
        req=Request(self.url+path,data=body,headers=h)
        try:
            with urlopen(req,timeout=3) as r:return r.status,json.loads(r.read())
        except HTTPError as e:return e.code,json.loads(e.read())

    def test_purl_discovery_and_read_never_mutates(self):
        before=self.world.head()
        code,manifest=self.raw('/.well-known/purl')
        self.assertEqual(code,200);self.assertEqual(manifest['protocol'],'PURL/0.1')
        self.assertIn('/r/{id}/ops/{operation}',manifest['endpoints'].values())
        code,resource=self.raw('/r/world/manifest',token=self.token)
        self.assertEqual(resource['kind'],'resource-manifest')
        self.assertTrue(any(o['name']=='travel' for o in resource['operations']))
        self.raw('/r/world',token=self.token)
        self.assertEqual(self.raw('/r/world?action=sit',token=self.token)[0],405)
        self.assertEqual(before,self.world.head())

    def test_plain_get_cannot_read_private_memories_or_forge_founder(self):
        self.assertEqual(self.raw('/r/world')[0],401)
        self.assertEqual(self.raw('/r/world',token='founder_dark')[0],401)
        _,manifest=self.raw('/r/world/manifest')
        self.assertFalse(manifest['requester']['authenticated'])
        self.assertFalse(any(o['available'] for o in manifest['operations'] if not o['safe']))

    def test_client_invokes_manifest_path_with_exact_retry_after_new_state(self):
        observed=self.client.observe()
        request=self.client.proposal('sit',{},'seated',observed['revision'])
        result=self.client.invoke(request)
        other=Client(self.url,self.other)
        other.invoke(other.proposal('sit',{},'other-sit',other.observe()['revision']))
        self.assertEqual(self.client.invoke(request),result)

    def test_validate_uses_admission_without_committing(self):
        before=self.world.head()
        request=self.client.proposal('author',{'target':'cafe','text':'At the corner'},'author-one',self.client.observe()['revision'])
        self.assertEqual(self.client.validate(request)['status'],'VALID')
        self.assertEqual(before,self.world.head())
        self.client.invoke(request)
        self.assertNotEqual(before,self.world.head())

    def test_two_connections_race_stale_revision_only_one_commits(self):
        rev=self.client.observe()['revision']
        c2=Client(self.url,self.other)
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            futures=[pool.submit(c.invoke,c.proposal('sit',{},'race',rev)) for c in (self.client,c2)]
            outcomes=[]
            for future in futures:
                try:outcomes.append(future.result()['status'])
                except NetworkFailure as e:outcomes.append(e.status)
        self.assertCountEqual(outcomes,['COMMITTED',409])

    def test_http_shapes_and_operator_only_operations_refuse(self):
        for body,headers in [(b'<html>bad</html>',{'Content-Type':'text/html'}),(b'{',{'Content-Type':'application/json'}),
                             (b'{"input":{},"input":{},"expected_version":1}',{'Content-Type':'application/json'}),
                             (b'x'*9000,{'Content-Type':'application/json'})]:
            with self.subTest(body=body[:15]):
                self.assertIn(self.raw('/r/world/ops/sit',body,self.token,headers)[0],(400,413,415))
        before=self.world.head()
        for op in ('advance','set_role','register'):
            request=self.client.proposal(op,{},'bad-'+op,self.client.observe()['revision'])
            with self.assertRaises(NetworkFailure):self.client.invoke(request)
        self.assertEqual(before,self.world.head())

    def test_event_interest_is_scoped_and_continuity_cursor_is_durable(self):
        self.client.invoke(self.client.proposal('sit',{},'local',self.client.observe()['revision']))
        _,events=self.raw('/r/world/events',token=self.other)
        self.assertTrue(events['events'])
        self.assertFalse(any(e['command'].get('request_id')=='local' for e in events['events']))
        _,continuity=self.raw('/r/world/continuity',token=self.token)
        self.assertEqual(continuity['actor'],'human_one')
        self.assertEqual(continuity['head'],self.world.head())

    def test_actual_external_controller_uses_same_http_schema(self):
        ai=Client(self.url,self.ai)
        for i in range(3):
            obs=ai.observe()
            operation,args=('talk',{'target':'mira','act':'greeting'}) if i==0 else ('sit' if i==1 else 'stand',{})
            ai.invoke(ai.proposal(operation,args,'ai-'+str(i),obs['revision']))
        events=self.world.own_events(self.ai)
        self.assertEqual(len(events),4)
        self.assertEqual(self.world.observe(self.ai)['actor']['controller'],'external_ai') # actual bounded policy client; not an LLM claim

    def test_network_parser_rejects_html_empty_truncated_and_oversized(self):
        for status,ct,body in [(204,'application/json',b''),(200,'text/html',b'<html/>'),(200,'application/json',b'{'),
                                (200,'application/json',b'x'*(1048576+1)),(500,'application/json',b'{}')]:
            with self.subTest(status=status,ct=ct):
                with self.assertRaises(NetworkFailure):Client.decode(status,ct,body)

    def test_actual_global_terrain_http_is_authenticated_bounded_and_pure(self):
        before=self.world.head()
        self.assertEqual(self.raw('/r/world/terrain?lat=35&lon=139')[0],401)
        code,result=self.raw('/r/world/terrain?lat=35&lon=139&width=3&span=1000',token=self.token)
        self.assertEqual(code,200);self.assertEqual(len(result['grid']['heights_m_msl']),9)
        self.assertFalse(result['native_collision_ready']);self.assertEqual(before,self.world.head())
        self.assertEqual(self.raw('/r/world/terrain?lat=35&lon=139',token=self.token)[0],429)

    def test_cli_script_worker_prepares_then_commits_through_real_http_outbox(self):
        source=Path(self.tmp.name)/'program.js';source.write_text('return [{operation:"author", arguments:{target:"cafe", text:"A shared corner"}}];')
        token=Path(self.tmp.name)/'token';token.write_text(self.token)
        outbox=Path(self.tmp.name)/'out.db';before=self.world.head()
        def invoke(*args):
            run=subprocess.run([sys.executable,str(ROOT/'tools/darkctl.py'),*args,'--url',self.url,'--token-file',str(token)],
                cwd=ROOT,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
            self.assertEqual(run.returncode,0,run.stdout+run.stderr);return json.loads(run.stdout)['result']
        prepared=invoke('script','--source',str(source),'--outbox',str(outbox))
        self.assertFalse(prepared['authority_granted']);self.assertEqual(before,self.world.head())
        result=invoke('flush','--outbox',str(outbox));self.assertEqual(result['delivered'],1)
        self.assertEqual(self.world.snapshot()['signs']['cafe']['text'],'A shared corner')
        after=self.world.head();invoke('flush','--outbox',str(outbox));self.assertEqual(after,self.world.head())


if __name__=='__main__':unittest.main()
