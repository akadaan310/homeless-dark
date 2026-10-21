import copy
import hashlib
import importlib
import json
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages'))

class KernelBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module=importlib.import_module('dark_server.kernel')
        cls.module.KernelBridge.build()
        cls.bridge=cls.module.KernelBridge()
        cls.fixture=cls.bridge.call('plate_fixture',{})['fixture']

    def plate_args(self,policy='RigidCarriage'):
        case=next(c for c in self.fixture['policy_cases'] if c['policy']==policy)
        request=dict(self.fixture['rewrite_request'],policy=policy,destinations=case['destinations'])
        return {'world':copy.deepcopy(self.fixture['plate_world']),'request':request}

    def test_describe_invokes_actual_compiled_core(self):
        result=self.bridge.call('describe',{})
        self.assertEqual(result['status'],'OK');self.assertIn('Dark.World.PlateWorld',result['kernels'])
        self.assertFalse(result['authority_granted']);self.assertEqual(result['physical_validation'],'NOT_RUN')
        self.assertEqual(result['fixture_sha256'],'8abae87f2866dd3a43106c9c77f8f65613245c691d2111949b1b53339ec6bfef')

    def test_plate_apply_actual_kernel_revision_graph_and_continuous_transport(self):
        args=self.plate_args();before=copy.deepcopy(args);result=self.bridge.call('plate_apply',args)
        self.assertEqual(args,before);self.assertEqual(result['status'],'ADMITTED');self.assertEqual(result['revision'],1)
        self.assertEqual(result['next_state']['revision'],1);self.assertEqual(len(result['witness']['transports']),2)
        self.assertTrue(result['witness']['reachability_changed']);self.assertTrue(result['witness']['embedding_changed'])
        self.assertEqual(result['witness']['work_bound'],413)
        for curve in result['witness']['transports']:
            self.assertEqual(curve['curve']['kind'],'rigid_rotation_y');self.assertEqual(curve['start_tick'],100);self.assertEqual(curve['end_tick'],220)
            self.assertEqual([s['t'] for s in curve['samples']],[0,.25,.5,.75,1])
            self.assertNotEqual(curve['samples'][0]['xyz_m'],curve['samples'][-1]['xyz_m'])
            self.assertNotEqual(curve['samples'][2]['xyz_m'],curve['samples'][-1]['xyz_m'])
        self.assertFalse(result['source_projection']['source_coordinates_changed'])
        self.assertEqual(result['physical_validation'],'NOT_RUN')

    def test_validate_and_apply_same_proposal_without_new_authority(self):
        args=self.plate_args();v=self.bridge.call('plate_validate',args);a=self.bridge.call('plate_apply',args)
        self.assertEqual(v['status'],'VALID');self.assertEqual(v['next_state'],a['next_state']);self.assertEqual(v['witness'],a['witness'])
        self.assertFalse(v['authority_granted']);self.assertTrue(v['activation_requires_revalidation'])

    def test_relocation_and_occupied_refusal_use_kernel_witnesses(self):
        result=self.bridge.call('plate_apply',self.plate_args('WitnessedRelocation'))
        self.assertEqual(result['status'],'ADMITTED')
        for curve in result['witness']['transports']:
            self.assertEqual(curve['curve']['kind'],'linear_relocation');self.assertEqual(curve['destination_node'],'osm/node/1603574189')
        args=self.plate_args('RefuseWhileOccupied');result=self.bridge.call('plate_apply',args)
        self.assertEqual(result['status'],'REFUSED');self.assertEqual(result['reason'],'HD-065:occupied');self.assertEqual(result['next_state'],args['world']);self.assertIsNone(result['witness'])

    def test_stale_budget_straddler_missing_relocation_are_atomic_refusals(self):
        for change in ['stale','budget','straddler','missing_destination']:
            args=self.plate_args('WitnessedRelocation' if change=='missing_destination' else 'RigidCarriage')
            if change=='stale':args['request']['expected_revision']=99
            if change=='budget':args['request']['operation_budget']=1
            if change=='straddler':args['world']['occupants'][0]['boundary_straddler']=True
            if change=='missing_destination':args['request']['destinations']={}
            result=self.bridge.call('plate_apply',args)
            self.assertEqual(result['status'],'REFUSED',change);self.assertEqual(result['revision'],0);self.assertIsNone(result['witness'])

    def test_population_source_resolve_move_snapshot_and_exact_retry(self):
        result=self.bridge.call('population_resolve',{'person_id':'wb2024/USA/7','promote':True})
        self.assertEqual(result['status'],'OK');self.assertEqual(result['metrics']['demographic_estimate'],8140897523)
        self.assertEqual(result['metrics']['active_actors'],1);self.assertEqual(result['person']['id'],'wb2024/USA/7')
        move={'snapshot':result['snapshot'],'person_id':'wb2024/USA/7','destination':'BRA','request_id':'trip','expected_revision':0,'migration':False}
        moved=self.bridge.call('population_move',move)
        self.assertEqual(moved['person']['present'],'BRA');self.assertEqual(moved['person']['residence'],'USA');self.assertEqual(moved['revision'],1)
        retry=self.bridge.call('population_move',dict(move,snapshot=moved['snapshot']))
        self.assertEqual(retry['snapshot'],moved['snapshot']);self.assertEqual(retry['revision'],1)
        resumed=self.bridge.call('population_resolve',{'snapshot':moved['snapshot'],'person_id':'wb2024/USA/7'})
        self.assertEqual(resumed['person']['present'],'BRA');self.assertEqual(resumed['snapshot'],moved['snapshot'])

    def test_population_out_of_range_corruption_and_stale_refused(self):
        result=self.bridge.call('population_resolve',{'person_id':'wb2024/TUV/9646'})
        self.assertEqual(result['status'],'REFUSED')
        good=self.bridge.call('population_resolve',{'person_id':'wb2024/TUV/1'})
        bad=self.bridge.call('population_resolve',{'person_id':'wb2024/TUV/1','snapshot':good['snapshot'][:-2]})
        self.assertEqual(bad['status'],'REFUSED')
        stale=self.bridge.call('population_move',{'person_id':'wb2024/TUV/1','destination':'USA','request_id':'stale','expected_revision':9,'migration':True})
        self.assertEqual(stale['status'],'REFUSED')

    def test_population_bulk_inspection_restores_without_realization(self):
        current=self.bridge.call('population_resolve',{'person_id':'wb2024/USA/7','promote':True})
        args={'snapshot':current['snapshot'],'person_ids':['wb2024/USA/7','wb2024/BRA/1']}
        inspected=self.bridge.call('population_inspect',args)
        self.assertEqual(inspected['status'],'OK');self.assertEqual(inspected['snapshot'],current['snapshot'])
        self.assertEqual(inspected['metrics'],current['metrics']);self.assertEqual(len(inspected['persons']),2)
        self.assertEqual(inspected['persons'][0],current['person']);self.assertEqual(inspected['persons'][1]['fidelity'],'Persistent')
        for ids in [['wb2024/USA/7']*2,['wb2024/USA/'+str(i) for i in range(1025)],['wb2024/USA/340003797']]:
            self.assertEqual(self.bridge.call('population_inspect',dict(args,person_ids=ids))['status'],'REFUSED')

    def test_bad_shapes_unknown_operations_and_input_budget_typed(self):
        self.assertEqual(self.bridge.call('unknown',{})['status'],'REFUSED')
        self.assertEqual(self.bridge.call('plate_apply',{'world':[],'request':{}})['status'],'REFUSED')
        with self.assertRaises(self.module.KernelError):self.bridge.call('describe',{'huge':'x'*1048576})
        with self.assertRaises(self.module.KernelError):self.bridge.call('describe',{'bad':float('nan')})

    def test_python_wrapper_timeout_output_budget_and_non_json(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'fake.py'
            for body,expected in [('import time;time.sleep(2)','KERNEL_TIMEOUT'),('import sys;sys.stdout.write("x"*2000000)','KERNEL_OUTPUT_BUDGET'),('print("not json")','KERNEL_PROTOCOL')]:
                path.write_text(body)
                bridge=self.module.KernelBridge(dotnet=sys.executable,dll=path,timeout=.2)
                with self.assertRaises(self.module.KernelError) as e:bridge.call('describe',{})
                self.assertEqual(e.exception.code,expected)

    def test_direct_bridge_rejects_duplicate_keys_invalid_utf8_deep_or_oversized_json(self):
        malformed=[b'{"schema":"dark.kernel-request/1","operation":"describe","operation":"plate_apply","arguments":{}}',
                   b'{"schema":"dark.kernel-request/1","operation":"describe","arguments":{"x":"\xff"}}',
                   b'{"schema":"dark.kernel-request/1","operation":"describe","arguments":{"x":'+b'['*40+b'0'+b']'*40+b'}}',
                   b'x'*1048577]
        for body in malformed:
            proc=subprocess.run([self.bridge.dotnet,str(self.bridge.dll)],input=body,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=10)
            self.assertEqual(proc.returncode,0);self.assertLessEqual(len(proc.stdout),1048576)
            self.assertEqual(json.loads(proc.stdout)['status'],'REFUSED');self.assertEqual(proc.stderr,b'')

if __name__=='__main__':unittest.main()
