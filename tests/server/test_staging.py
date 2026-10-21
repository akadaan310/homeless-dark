import copy
import hashlib
import importlib
import io
import json
from pathlib import Path
import random
import sys
import tempfile
import unittest
import wave
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'packages'))

class StagingTests(unittest.TestCase):
    def setUp(self):
        self.m=importlib.import_module('dark_server.staging')
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        collision={'schema':'dark.collision-aabb/1','min':[0,0,0],'max':[10,3,10],'spawn':[2,1,2]}
        (self.root/'collision.json').write_text(json.dumps(collision))
        stream=io.BytesIO()
        with wave.open(stream,'wb') as wav:wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000);wav.writeframes(b'\0\0'*160)
        (self.root/'voice.wav').write_bytes(stream.getvalue())
        self.manifest={'schema':'dark.stage-manifest/1','version':'fixture-v1','assets':[]}
        for asset,path,kind,decoder in [('collision','collision.json','collision','collision_aabb'),('voice','voice.wav','voice','pcm_wave')]:
            data=(self.root/path).read_bytes();self.manifest['assets'].append({'id':asset,'path':path,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'kind':kind,'decoder':decoder})
        self.registry=self.m.Staging.create(self.root,self.manifest);self.serial=0
    def call(self,op,args=None,cell='cell',actor='member',tick=0,caps=None,actual=None):
        self.serial+=1
        req={'request_id':'r'+str(self.serial),'expected_revision':self.registry.revision,'cell_id':cell,'operation':op,'arguments':args or {}}
        scopes=[self.m.scope(cell,'activate' if op=='ACTIVATE' else 'prepare')] if caps is None else caps
        return self.registry.apply(actor,scopes,req,tick,actual=actual)
    def observe(self,cell='cell',actor='member',tick=0):
        return self.call('OBSERVE',{'assets':['collision','voice'],'path':[[0,0,0],[3,0,0],[3,0,4]],'path_revision':7,'mode':'walk','speed_mps':1.4,'speed_confidence':.8,'wait_ticks':2,'observed_tick':tick,'anticipated_tick':None,'visible':True,'ttl_ticks':100},cell,actor,tick)
    def prepare(self):
        self.observe()
        for op in ['PREDICT','ADMIT','STAGE','VERIFY','DECODE','INSTANTIATE','COLLISION_READY','RESERVE']:self.call(op)
    def actual(self):return {'actor':'member','path_revision':7,'catalog_version':'fixture-v1','position':[2,1,2],'observed_tick':0}
    def test_full_real_local_lifecycle_and_retirement(self):
        self.prepare();cell=self.registry.inspect('cell')
        self.assertEqual(cell['gate'],'RESERVE');self.assertEqual(cell['lifecycle'],'collision_ready')
        self.assertEqual(cell['decoded']['voice']['frames'],160)
        self.assertEqual(cell['prediction']['path_distance_m'],7)
        self.assertAlmostEqual(cell['prediction']['time_to_use_ticks'],8.25)
        result=self.call('ACTIVATE',actual=self.actual())
        self.assertEqual(self.registry.inspect('cell')['lifecycle'],'active');self.assertFalse(result['effect']['world_position_changed'])
        self.assertFalse(result['authority_granted']);self.assertEqual(result['physical_validation'],'NOT_RUN')
        self.call('RETIRE');self.call('CACHE');self.assertEqual(self.registry.inspect('cell')['lifecycle'],'cached')
        self.assertGreater(self.registry.snapshot()['metrics']['actual_bytes_read'],0)
    def test_reservation_deadline_releases_held_capacity_before_preparation_ttl(self):
        self.prepare();cell=self.registry.inspect('cell')
        self.assertEqual(cell['reservation']['expires_tick'],30);self.assertEqual(cell['expires_tick'],100)
        self.call('EXPIRE',tick=30)
        self.assertEqual(self.registry.inspect('cell')['gate'],'EXPIRED')
        self.assertEqual(self.registry.snapshot()['metrics']['reserved_unique_bytes'],0)
    def test_signed64_clock_cleanup_and_ttl_overflow_refusal(self):
        maximum=2**63-1;self.observe(tick=maximum-100)
        self.call('EXPIRE',tick=maximum);before=self.registry.snapshot()
        for cell,tick in [('overflow',maximum),('too-late',maximum+1)]:
            with self.assertRaises(self.m.StageRefused):self.observe(cell=cell,tick=tick)
            self.assertEqual(self.registry.snapshot(),before)
    def test_history_exhaustion_cannot_strand_active_resources(self):
        # Exercise the real 512-event bound, including two independently active
        # cells. Every remaining cleanup must still fit after admission refuses.
        for index in range(244):
            self.observe(tick=index*5);self.call('CANCEL',tick=index*5)
        tick=1220
        for cell in ('one','two'):
            self.observe(cell=cell,tick=tick)
            for op in ['PREDICT','ADMIT','STAGE','VERIFY','DECODE','INSTANTIATE','COLLISION_READY','RESERVE']:
                self.call(op,cell=cell,tick=tick)
            self.call('ACTIVATE',cell=cell,tick=tick,actual=dict(self.actual(),observed_tick=tick))
        self.assertEqual(self.registry.revision,508)
        before=self.registry.snapshot()
        with self.assertRaises(self.m.StageRefused):self.observe(cell='bait',tick=tick)
        self.assertEqual(self.registry.snapshot(),before)
        for cell in ('one','two'):
            self.call('RETIRE',cell=cell,tick=tick);self.call('CACHE',cell=cell,tick=tick)
        self.assertEqual(self.registry.revision,512)
        self.assertEqual(self.registry.snapshot()['metrics']['reserved_unique_bytes'],0)
    def test_snapshot_byte_exhaustion_preserves_all_mandatory_cleanup(self):
        actor='a'*128;serial=0;active='active'.ljust(128,'x')
        def call(op,cell,args=None,tick=0,actual=None):
            nonlocal serial
            serial+=1
            return self.registry.apply(actor,[self.m.scope(cell,'activate' if op=='ACTIVATE' else 'prepare')],
                {'request_id':str(serial).zfill(128),'expected_revision':self.registry.revision,'cell_id':cell,'operation':op,'arguments':args or {}},tick,actual)
        def observe(cell,tick,large):
            path=[[1.2345678901234567,2.3456789012345678,3.4567890123456789] for _ in range(256)] if large else [[0,0,0],[2,1,2]]
            return call('OBSERVE',cell,{'assets':['collision','voice'],'path':path,'path_revision':7,'mode':'walk','speed_mps':1.4,'speed_confidence':.8,'wait_ticks':2,'observed_tick':tick,'anticipated_tick':None,'visible':True,'ttl_ticks':100},tick)
        observe(active,0,False)
        for op in ['PREDICT','ADMIT','STAGE','VERIFY','DECODE','INSTANTIATE','COLLISION_READY','RESERVE']:call(op,active)
        call('ACTIVATE',active,actual=dict(self.actual(),actor=actor))
        for index in range(256):
            tick=index*5;cell=('c'+str(index%31)).ljust(128,'x')
            try:observe(cell,tick,True);call('CANCEL',cell,tick=tick)
            except self.m.StageRefused:break
        else:self.fail('expected bounded byte admission refusal')
        self.assertLess(self.registry.revision,400,'byte capacity should be reached before event capacity')
        for cell,record in self.registry.snapshot()['cells'].items():
            if record['gate'] not in self.m.TERMINAL|{'ACTIVATE'}:call('CANCEL',cell,tick=tick)
        call('RETIRE',active,tick=tick);call('CACHE',active,tick=tick)
        final=self.registry.snapshot();self.assertEqual(final['metrics']['reserved_unique_bytes'],0)
        self.assertLessEqual(len(self.m.encode(final)),1048576)
    def test_prediction_preparation_cannot_activate_or_move_actor(self):
        self.observe();before=self.registry.snapshot()
        with self.assertRaises(self.m.StageRefused):self.call('ACTIVATE',actual=self.actual())
        self.assertEqual(before,self.registry.snapshot())
        self.call('PREDICT');self.assertEqual(self.registry.inspect('cell')['lifecycle'],'requested')
        self.assertNotIn('actors',self.registry.snapshot())
    def test_current_activation_authority_and_actual_preconditions(self):
        self.prepare();before=self.registry.snapshot()
        for caps,actual in [([],self.actual()),([self.m.scope('cell','activate')],None),([self.m.scope('cell','activate')],dict(self.actual(),path_revision=8)),([self.m.scope('cell','activate')],dict(self.actual(),position=[99,0,0])),([self.m.scope('cell','activate')],dict(self.actual(),actor='other'))]:
            with self.assertRaises(self.m.StageRefused):self.call('ACTIVATE',caps=caps,actual=actual)
            self.assertEqual(before,self.registry.snapshot())
        with self.assertRaises(self.m.StageRefused):self.call('ACTIVATE',tick=6,actual=self.actual())
    def test_integrity_and_size_changes_refuse_without_partial_state(self):
        self.observe()
        for op in ['PREDICT','ADMIT','STAGE']:self.call(op)
        (self.root/'voice.wav').write_bytes(b'corrupt')
        before=self.registry.snapshot()
        with self.assertRaises(self.m.StageRefused):self.call('VERIFY')
        self.assertEqual(before,self.registry.snapshot())
    def test_caller_manifest_mutation_cannot_rebind_content(self):
        self.manifest['assets'][0]['path']='voice.wav'
        self.manifest['assets'][0]['bytes']=self.manifest['assets'][1]['bytes']
        self.manifest['assets'][0]['sha256']=self.manifest['assets'][1]['sha256']
        self.observe()
        for op in ['PREDICT','ADMIT','STAGE','VERIFY','DECODE']:self.call(op)
        self.assertEqual(self.registry.inspect('cell')['decoded']['collision']['schema'],'dark.collision-aabb/1')
    def test_path_escape_symlink_and_special_file_refuse(self):
        for path in ['../escape','/etc/passwd','./voice.wav','x//voice.wav','x\\voice.wav','voice\0.wav']:
            manifest=copy.deepcopy(self.manifest);manifest['assets'][0]['path']=path
            with self.assertRaises(self.m.StageRefused):self.m.Staging.create(self.root,manifest)
        (self.root/'collision.json').unlink();(self.root/'collision.json').symlink_to('/etc/passwd')
        self.observe();self.call('PREDICT');self.call('ADMIT');before=self.registry.snapshot()
        with self.assertRaises(self.m.StageRefused):self.call('STAGE')
        self.assertEqual(before,self.registry.snapshot())
    def test_cancel_expiry_failure_and_hysteresis(self):
        self.observe();self.call('PREDICT');self.call('ADMIT');self.call('STAGE');self.call('CANCEL')
        self.assertEqual(self.registry.inspect('cell')['lifecycle'],'cancelled')
        self.assertGreater(self.registry.snapshot()['metrics']['wasted_stage_bytes'],0)
        with self.assertRaises(self.m.StageRefused):self.observe(tick=1)
        self.observe(tick=5);self.call('EXPIRE',tick=106);self.assertEqual(self.registry.inspect('cell')['gate'],'EXPIRED')
        self.observe(cell='failed',tick=106);self.call('FAIL',{'reason':'network_unavailable'},cell='failed',tick=106)
        self.assertEqual(self.registry.inspect('failed')['lifecycle'],'failed')
    def test_quota_and_cancelled_prediction_baiting(self):
        for index in range(4):
            cell='c'+str(index);self.observe(cell);self.call('PREDICT',cell=cell);self.call('ADMIT',cell=cell);self.call('CANCEL',cell=cell)
        self.observe('bait');self.call('PREDICT',cell='bait');before=self.registry.snapshot()
        with self.assertRaises(self.m.StageRefused) as error:self.call('ADMIT',cell='bait')
        self.assertEqual(error.exception.code,'ACTOR_RATE');self.assertEqual(before,self.registry.snapshot())
    def test_small_budget_deduplicates_shared_assets(self):
        size=sum(a['bytes'] for a in self.manifest['assets'])
        self.registry=self.m.Staging.create(self.root,self.manifest,{'resident_bytes':size})
        for cell in ['one','two']:
            self.observe(cell);self.call('PREDICT',cell=cell);self.call('ADMIT',cell=cell)
        self.assertEqual(self.registry.snapshot()['metrics']['reserved_unique_bytes'],size)
        self.registry=self.m.Staging.create(self.root,self.manifest,{'resident_bytes':size-1})
        self.observe();self.call('PREDICT')
        with self.assertRaises(self.m.StageRefused):self.call('ADMIT')
    def test_low_speed_confidence_and_stale_path_estimates(self):
        base={'path':[[0,0,0],[10,0,0]],'speed_mps':0,'speed_confidence':0,'wait_ticks':3,'observed_tick':0,'anticipated_tick':20,'visible':False,'mode':'walk'}
        result=self.m.estimate_time(base,5);self.assertEqual(result['time_to_use_ticks'],15);self.assertEqual(result['basis'],'scheduled')
        base['anticipated_tick']=None
        self.assertIsNone(self.m.estimate_time(base,5)['time_to_use_ticks'])
        base['visible']=True;self.assertEqual(self.m.estimate_time(base,5)['basis'],'visible_anticipation')
        base['observed_tick']=0
        with self.assertRaises(self.m.StageRefused):self.m.estimate_time(base,301)
        base['speed_mps']=10**1000
        with self.assertRaises(self.m.StageRefused):self.m.estimate_time(base,0)
    def test_idempotency_requires_current_scope_and_snapshot_continuity(self):
        self.prepare();req={'request_id':'active','expected_revision':self.registry.revision,'cell_id':'cell','operation':'ACTIVATE','arguments':{}}
        scopes=[self.m.scope('cell','activate')];first=self.registry.apply('member',scopes,req,0,actual=self.actual())
        restored=self.m.Staging.restore(self.root,self.manifest,json.loads(json.dumps(self.registry.snapshot())))
        self.assertEqual(restored.apply('member',scopes,req,1,actual=self.actual()),first)
        with self.assertRaises(self.m.StageRefused):restored.apply('member',[],req,1,actual=self.actual())
        changed=copy.deepcopy(req);changed['arguments']={'changed':True}
        with self.assertRaises(self.m.StageRefused):restored.apply('member',scopes,changed,1,actual=self.actual())
    def test_restore_rejects_catalog_change_and_malformed_state(self):
        self.prepare();snapshot=self.registry.snapshot()
        for mutate in [lambda s:s.__setitem__('events',[None]),lambda s:s['cells']['cell'].__setitem__('gate','FAKE'),lambda s:s['cache'].__setitem__('unknown',{}),lambda s:s.__setitem__('revision',100)]:
            changed=copy.deepcopy(snapshot);mutate(changed)
            with self.assertRaises(self.m.StageRefused):self.m.Staging.restore(self.root,self.manifest,changed)
        manifest=copy.deepcopy(self.manifest);manifest['version']='different'
        with self.assertRaises(self.m.StageRefused):self.m.Staging.restore(self.root,manifest,snapshot)
    def test_bad_collision_spawn_and_decoder_refuse(self):
        data=json.dumps({'schema':'dark.collision-aabb/1','min':[0,0,0],'max':[10,3,10],'spawn':[100,1,2]}).encode()
        (self.root/'collision.json').write_bytes(data);entry=self.manifest['assets'][0];entry['bytes']=len(data);entry['sha256']=hashlib.sha256(data).hexdigest()
        self.registry=self.m.Staging.create(self.root,self.manifest)
        self.observe()
        for op in ['PREDICT','ADMIT','STAGE','VERIFY']:self.call(op)
        with self.assertRaises(self.m.StageRefused):self.call('DECODE')
    def test_expired_reservation_and_wrong_order_refuse(self):
        self.observe();before=self.registry.snapshot()
        for op in ['STAGE','VERIFY','DECODE','RESERVE','CACHE']:
            with self.assertRaises(self.m.StageRefused):self.call(op)
            self.assertEqual(before,self.registry.snapshot())
        for op in ['PREDICT','ADMIT','STAGE','VERIFY','DECODE','INSTANTIATE','COLLISION_READY','RESERVE']:self.call(op)
        before=self.registry.snapshot()
        with self.assertRaises(self.m.StageRefused):self.call('ACTIVATE',tick=31,actual=dict(self.actual(),observed_tick=31))
        self.assertEqual(before,self.registry.snapshot())
    def test_fifo_parent_symlink_and_missing_file_fail_promptly(self):
        import os
        (self.root/'collision.json').unlink();os.mkfifo(self.root/'collision.json')
        self.observe();self.call('PREDICT');self.call('ADMIT')
        with self.assertRaises(self.m.StageRefused):self.call('STAGE')
        (self.root/'collision.json').unlink()
        with self.assertRaises(self.m.StageRefused):self.call('STAGE')
        (self.root/'link').symlink_to(self.root,target_is_directory=True)
        self.manifest['assets'][0]['path']='link/voice.wav';self.registry=self.m.Staging.create(self.root,self.manifest)
        self.observe();self.call('PREDICT');self.call('ADMIT')
        with self.assertRaises(self.m.StageRefused):self.call('STAGE')
    def test_actual_mutation_after_reserve_is_refused_at_activation(self):
        self.prepare();(self.root/'voice.wav').write_bytes(b'changed')
        before=self.registry.snapshot()
        with self.assertRaises(self.m.StageRefused):self.call('ACTIVATE',actual=self.actual())
        self.assertEqual(before,self.registry.snapshot())
    def test_allocator_exact_oracle_and_deterministic_counterexample(self):
        items=[{'id':'a','bytes':3,'benefit':5,'required':False},{'id':'b','bytes':2,'benefit':3,'required':False},{'id':'c','bytes':2,'benefit':3,'required':False}]
        result=self.m.compare_allocations(items,4)
        self.assertEqual(result['greedy']['benefit'],5);self.assertEqual(result['exact']['benefit'],6);self.assertEqual(result['missed_benefit'],1)
        rng=random.Random(73)
        for _ in range(100):
            items=[{'id':str(i),'bytes':rng.randrange(1,10),'benefit':rng.randrange(1,20),'required':False} for i in range(8)]
            result=self.m.compare_allocations(items,20);self.assertLessEqual(result['greedy']['benefit'],result['exact']['benefit']);self.assertLessEqual(result['greedy']['bytes'],20)
            self.assertEqual(self.m.compare_allocations(list(reversed(items)),20),result)
    def test_bootstrap_manifest_hashes_actual_known_art_audio(self):
        repo=Path(__file__).resolve().parents[2];manifest=self.m.bootstrap_manifest(repo)
        self.assertTrue(any(a['kind']=='mesh' for a in manifest['assets']));self.assertTrue(any(a['kind']=='voice' for a in manifest['assets']))
        for asset in manifest['assets']:
            data=(repo/asset['path']).read_bytes();self.assertEqual(len(data),asset['bytes']);self.assertEqual(hashlib.sha256(data).hexdigest(),asset['sha256'])

if __name__=='__main__':unittest.main()
