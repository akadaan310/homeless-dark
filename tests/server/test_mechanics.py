import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages'))
from dark_server.world import World,Refused,distance_m
from dark_server.kernel import KernelBridge


class MechanicsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):KernelBridge.build()

    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'world.db'
        source=json.loads((ROOT/'assets/content/world/opening.json').read_text())
        self.world=World.create(self.path,source)
        self.token=self.world.register('learner',now=100);self.world.join(self.token,'join',now=101)
        self.serial=0

    def action(self,op,args):
        self.serial+=1
        return self.world.execute(self.token,{'schema':'dark.action/1','request_id':'r'+str(self.serial),
            'expected_revision':self.world.snapshot()['revision'],'operation':op,'arguments':args},now=102)

    def learn(self):
        for dest in ('osm:node:2057042478','osm:node:1603574189','osm:node:8066816959','osm:node:1603574189'):
            self.action('travel',{'destination':dest,'mode':'walk'})
            self.serial+=1;self.world.advance(60,'travel-'+str(self.serial))
        return self.action('learn_pattern',{'lesson':'spruce-quarter-turn','answer':'quarter-turn-left'})

    def test_learning_requires_actual_path_memory_and_grants_an_operative_skill(self):
        before=self.world.head()
        with self.assertRaises(Refused):self.action('learn_pattern',{'lesson':'spruce-quarter-turn','answer':'quarter-turn-left'})
        self.assertEqual(before,self.world.head())
        result=self.learn()
        self.assertIn('plate-rewrite',self.world.snapshot()['actors']['learner']['skills'])
        self.assertLess(result['data']['witness']['residual'],1e-8)
        self.assertEqual(len(result['data']['witness']['null_scores']),32)
        with self.assertRaises(Refused):self.action('learn_pattern',{'lesson':'spruce-quarter-turn','answer':'half-turn'})

    def test_unlearned_rewrite_and_occupied_refusal_leave_world_unchanged(self):
        before=self.world.head()
        with self.assertRaises(Refused):self.action('rewrite_plate',{'direction':'forward','policy':'RigidCarriage'})
        self.assertEqual(before,self.world.head())
        self.learn();before=self.world.head()
        with self.assertRaises(Refused):self.action('rewrite_plate',{'direction':'forward','policy':'RefuseWhileOccupied'})
        self.assertEqual(before,self.world.head())

    def test_occupied_rotation_disconnect_inverse_and_graph_change(self):
        self.learn()
        before=self.world.snapshot();old_lina=before['actors']['lina']['position']
        result=self.action('rewrite_plate',{'direction':'forward','policy':'RigidCarriage'})
        self.assertTrue(result['data']['witness']['reachability_changed'])
        self.assertEqual(self.world.snapshot()['actors']['lina']['position'],old_lina)
        self.serial+=1;self.world.advance(4,'half-rotation')
        mid=self.world.snapshot()['actors']['lina']['position']
        self.assertGreater(distance_m(mid,old_lina),1)
        self.world=World(self.path);self.world.advance(4,'finish-rotation')
        end=self.world.snapshot()['actors']['lina']['position']
        self.assertGreater(distance_m(mid,end),1)
        with self.assertRaises(Refused):self.action('travel',{'destination':'osm:node:2057042478','mode':'walk'})
        self.action('travel',{'destination':'osm:node:4520926406','mode':'walk'})
        self.world.advance(60,'new-route');self.action('travel',{'destination':'osm:node:1603574189','mode':'walk'})
        self.world.advance(60,'back-before-inverse')
        self.action('rewrite_plate',{'direction':'inverse','policy':'RigidCarriage'})
        self.world.advance(8,'inverse')
        self.assertLess(distance_m(self.world.snapshot()['actors']['lina']['position'],old_lina),.001)
        self.assertEqual(self.world.snapshot()['content']['nodes'],before['content']['nodes'])
        self.assertEqual(self.world.snapshot()['plate']['revision'],2)
        self.assertEqual(self.world.verify_history()['events'],self.world.snapshot()['revision'])

    def test_relocation_keeps_registered_vehicle_seats_attached(self):
        self.learn()
        self.action('travel',{'destination':'osm:node:2057042478','mode':'walk'});self.world.advance(60,'to-bus')
        self.action('board',{'vehicle':'street-bus','seat':'passenger'})
        self.action('rewrite_plate',{'direction':'forward','policy':'WitnessedRelocation'})
        self.world.advance(4,'relocation-mid')
        s=self.world.snapshot()
        self.assertEqual(s['actors']['learner']['position'],s['vehicles']['street-bus']['position'])
        self.world.advance(4,'relocation-end')
        self.assertEqual(self.world.snapshot()['actors']['learner']['node'],'osm:node:1603574189')


if __name__=='__main__':unittest.main()
