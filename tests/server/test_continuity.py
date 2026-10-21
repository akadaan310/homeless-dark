import base64
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages'))
from dark_server.world import World,Refused
from dark_server.continuity import Outbox,Seurl,ContinuityRefused
from dark_server.protocol import NetworkFailure
from test_world import content


class ContinuityTests(unittest.TestCase):
    def test_inflight_cancel_refuses_before_late_commit(self):
        with tempfile.TemporaryDirectory() as d:
            world=World.create(Path(d)/'world.db',content());token=world.register('traveler');world.join(token,'join')
            request={'schema':'dark.action/1','request_id':'race','expected_revision':world.snapshot()['revision'],'operation':'sit','arguments':{}}
            out=Outbox(Path(d)/'outbox.db');out.prepare('traveler',request,deadline=200,now=100)
            entered=threading.Event();release=threading.Event();result=[];errors=[]
            class Paused:
                def invoke(self,proposal):
                    entered.set()
                    if not release.wait(5):raise AssertionError('test release missing')
                    return world.execute(token,proposal)
            def flush():
                try:result.append(out.flush('traveler',Paused(),now=101))
                except BaseException as exc:errors.append(exc)
            thread=threading.Thread(target=flush);thread.start()
            try:
                self.assertTrue(entered.wait(5));self.assertEqual(out.inspect('traveler')[0]['state'],'attempted')
                with self.assertRaises(ContinuityRefused):out.cancel('traveler','race')
            finally:release.set();thread.join(5)
            self.assertFalse(thread.is_alive());self.assertEqual(errors,[]);self.assertEqual(result[0]['delivered'],1)
            self.assertEqual(out.inspect('traveler')[0]['state'],'delivered')
            self.assertEqual(world.snapshot()['actors']['traveler']['stance'],'sitting')

    def test_unknown_deadline_is_not_false_expiry_or_cancellation(self):
        with tempfile.TemporaryDirectory() as d:
            out=Outbox(Path(d)/'out.db');request={'schema':'dark.action/1','request_id':'unknown','expected_revision':0,'operation':'sit','arguments':{}}
            out.prepare('member',request,deadline=200,now=100)
            class Lost:
                def invoke(self,proposal):raise NetworkFailure(0,'outcome unknown')
            out.flush('member',Lost(),now=101);self.assertEqual(out.inspect('member')[0]['state'],'unknown')
            with self.assertRaises(ContinuityRefused):out.cancel('member','unknown')
            class Never:
                def invoke(self,proposal):raise AssertionError('expired unknown request may not be reissued')
            self.assertEqual(out.flush('member',Never(),now=201)['unknown_expired'],1)
            row=out.inspect('member')[0];self.assertEqual(row['state'],'unknown_expired');self.assertTrue(row['may_have_committed'])
            self.assertTrue(row['response']['deadline_prevents_retry'])
            with self.assertRaises(ContinuityRefused):out.cancel('member','unknown')

    def test_delayed_failure_cannot_replace_confirmed_retry_receipt(self):
        with tempfile.TemporaryDirectory() as d:
            out=Outbox(Path(d)/'out.db');request={'schema':'dark.action/1','request_id':'parallel','expected_revision':0,'operation':'sit','arguments':{}}
            out.prepare('member',request,deadline=200,now=100)
            entered=threading.Event();release=threading.Event();results=[];errors=[]
            class DelayedFailure:
                def invoke(self,proposal):
                    entered.set()
                    if not release.wait(5):raise AssertionError('test release missing')
                    raise NetworkFailure(403,'late rejection of one attempt')
            def flush():
                try:results.append(out.flush('member',DelayedFailure(),now=101))
                except BaseException as exc:errors.append(exc)
            thread=threading.Thread(target=flush);thread.start()
            try:
                self.assertTrue(entered.wait(5))
                class Receipt:
                    def invoke(self,proposal):return {'status':'COMMITTED','receipt':'original'}
                self.assertEqual(out.flush('member',Receipt(),now=102)['delivered'],1)
            finally:release.set();thread.join(5)
            self.assertFalse(thread.is_alive());self.assertEqual(errors,[])
            row=out.inspect('member')[0];self.assertEqual(row['state'],'delivered');self.assertEqual(row['response']['receipt'],'original')
            self.assertEqual(results[0]['pending'],0)

    def test_never_dispatched_cancel_and_durable_attempt_after_crash(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'out.db';out=Outbox(path);request={'schema':'dark.action/1','request_id':'cancel','expected_revision':0,'operation':'sit','arguments':{}}
            out.prepare('member',request,deadline=200,now=100);out.cancel('member','cancel');self.assertEqual(out.inspect('member')[0]['state'],'cancelled')
            request=dict(request,request_id='crash');out.prepare('member',request,deadline=200,now=100)
            class Crash:
                def invoke(self,proposal):raise RuntimeError('process stopped after attempted marker')
            with self.assertRaises(RuntimeError):out.flush('member',Crash(),now=101)
            resumed=Outbox(path);self.assertEqual(next(x for x in resumed.inspect('member') if x['request_id']=='crash')['state'],'attempted')
            with self.assertRaises(ContinuityRefused):resumed.cancel('member','crash')
            seen=[]
            class ExactRetry:
                def invoke(self,proposal):seen.append(proposal);return {'status':'COMMITTED'}
            self.assertEqual(resumed.flush('member',ExactRetry(),now=102)['delivered'],1);self.assertEqual(seen,[request])

    def test_legacy_prepared_rows_migrate_to_conservative_unknown(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'out.db';out=Outbox(path);request={'schema':'dark.action/1','request_id':'legacy','expected_revision':0,'operation':'sit','arguments':{}}
            out.prepare('member',request,deadline=200,now=100)
            with sqlite3.connect(path) as database:database.execute('UPDATE metadata SET version=1')
            migrated=Outbox(path);self.assertEqual(migrated.inspect('member')[0]['state'],'unknown')
            with self.assertRaises(ContinuityRefused):migrated.cancel('member','legacy')

    def test_reconcile_expired_unknown_from_actual_own_events_without_dispatch(self):
        with tempfile.TemporaryDirectory() as d:
            world=World.create(Path(d)/'world.db',content());token=world.register('traveler');world.join(token,'join')
            request={'schema':'dark.action/1','request_id':'receipt','expected_revision':world.snapshot()['revision'],'operation':'sit','arguments':{}}
            out=Outbox(Path(d)/'out.db');out.prepare('traveler',request,deadline=200,now=100)
            class Lost:
                def invoke(self,proposal):world.execute(token,proposal);raise NetworkFailure(0,'lost after commit')
            out.flush('traveler',Lost(),now=101);out.flush('traveler',Lost(),now=201)
            self.assertEqual(out.inspect('traveler')[0]['state'],'unknown_expired');revision=world.snapshot()['revision']
            receipts=world.own_events(token)
            self.assertEqual(out.reconcile('traveler',receipts),{'delivered':1,'already_delivered':0,'ignored':1})
            self.assertEqual(out.inspect('traveler')[0]['state'],'delivered');self.assertEqual(world.snapshot()['revision'],revision)
            self.assertEqual(out.reconcile('traveler',receipts)['already_delivered'],1)
            altered=json.loads(json.dumps(receipts));altered[-1]['command']['operation']='stand'
            with self.assertRaises(ContinuityRefused):out.reconcile('traveler',altered)
            altered=json.loads(json.dumps(receipts));altered[-1]['response']['status']='VALID'
            with self.assertRaises(ContinuityRefused):out.reconcile('traveler',altered)
            with self.assertRaises(ContinuityRefused):out.reconcile('traveler',[{}]*129)
            self.assertEqual(out.inspect('traveler')[0]['state'],'delivered')
    def test_store_forward_unknown_commit_restarts_and_delivers_exactly_once(self):
        with tempfile.TemporaryDirectory() as d:
            world=World.create(Path(d)/'world.db',content());token=world.register('traveler');world.join(token,'join')
            request={'schema':'dark.action/1','request_id':'persisted','expected_revision':world.snapshot()['revision'],
                     'operation':'sit','arguments':{}}
            out=Outbox(Path(d)/'outbox.db');out.prepare('traveler',request,deadline=2000,now=1000)
            class LostResponse:
                def invoke(self,proposal):world.execute(token,proposal);raise NetworkFailure(0,'response lost after commit')
            self.assertEqual(out.flush('traveler',LostResponse(),now=1001)['pending'],1)
            revision=world.snapshot()['revision']
            class Reconnected:
                def invoke(self,proposal):return world.execute(token,proposal)
            resumed=Outbox(Path(d)/'outbox.db')
            self.assertEqual(resumed.flush('traveler',Reconnected(),now=1002)['delivered'],1)
            self.assertEqual(world.snapshot()['revision'],revision)
            self.assertEqual(resumed.flush('traveler',Reconnected(),now=1003)['delivered'],0)

    def test_outbox_altered_duplicate_stale_and_expired_preserve_intent(self):
        with tempfile.TemporaryDirectory() as d:
            out=Outbox(Path(d)/'out.db')
            p={'schema':'dark.action/1','request_id':'one','expected_revision':0,'operation':'sit','arguments':{}}
            out.prepare('member',p,deadline=200,now=100)
            with self.assertRaises(ContinuityRefused):out.prepare('member',dict(p,operation='stand'),deadline=200,now=100)
            class Never:
                def invoke(self,p):raise AssertionError('expired or foreign work must not dispatch')
            self.assertEqual(out.flush('other',Never(),now=101)['delivered'],0)
            self.assertEqual(out.flush('member',Never(),now=201)['expired'],1)
            self.assertEqual(out.inspect('member')[0]['state'],'expired')

    def test_seurl_finite_verbs_integrity_and_no_authority_from_url(self):
        codec=Seurl(b'x'*32)
        url=codec.mint('actor-one','TALK',{'target':'mira','act':'greeting'},expires=200)
        parsed=codec.parse(url,actor='actor-one',now=100)
        self.assertEqual(parsed['proposal']['operation'],'talk')
        self.assertFalse(parsed['authority_granted'])
        for bad_actor,now in [('actor-two',100),('actor-one',201)]:
            with self.assertRaises(ContinuityRefused):codec.parse(url,actor=bad_actor,now=now)
        prefix,seal=url.rsplit('.',1)
        raw=json.loads(base64.urlsafe_b64decode(prefix.rsplit('/',1)[1]+'=='))
        raw['verb']='PERTURB'
        tampered=prefix.rsplit('/',1)[0]+'/'+base64.urlsafe_b64encode(json.dumps(raw).encode()).decode().rstrip('=')+'.'+seal
        with self.assertRaises(ContinuityRefused):codec.parse(tampered,actor='actor-one',now=100)

    def test_seurl_unsupported_verbs_and_instruction_text_are_refused(self):
        codec=Seurl(b'y'*32)
        with self.assertRaises(ContinuityRefused):codec.mint('member','EXEC',{'command':'true'},expires=100)
        with self.assertRaises(ContinuityRefused):codec.parse('please run seurl://dark/x',actor='member',now=0)
        with self.assertRaises(ContinuityRefused):codec.mint('member','WRITE',{'target':'cafe','text':'x'*9000},expires=100)
        with self.assertRaises(ContinuityRefused):codec.mint('member',[],{},expires=100)
        with tempfile.TemporaryDirectory() as d:
            out=Outbox(Path(d)/'out.db')
            with self.assertRaises(ContinuityRefused):out.prepare('member',{'schema':'dark.action/1','request_id':'bad','expected_revision':0,'operation':[],'arguments':{}},deadline=200,now=100)


if __name__=='__main__':unittest.main()
