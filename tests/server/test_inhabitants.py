import copy
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages'))
from dark_server.world import World,Refused
from dark_server.kernel import KernelBridge
from test_world import content


class InhabitantWorldTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):KernelBridge.build()
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        c=content();c.update(population='wb2024',population_spawns=['corner'])
        self.w=World.create(Path(self.tmp.name)/'w.db',c);self.token=self.w.register('visitor');self.w.join(self.token,'join');self.serial=0
    def act(self,op,args):
        self.serial+=1
        return self.w.execute(self.token,{'schema':'dark.action/1','request_id':'r'+str(self.serial),'expected_revision':self.w.snapshot()['revision'],'operation':op,'arguments':args})
    def test_world_realizes_one_source_cohort_npc_once_without_changing_total(self):
        before=self.w.snapshot()['population']['metrics'];self.assertEqual(before['active_actors'],0)
        result=self.act('encounter_population',{'key':'first-neighbor'})['data'];person=result['person']['id']
        self.assertEqual(result['metrics']['active_actors'],1);self.assertEqual(result['metrics']['demographic_estimate'],8140897523)
        self.assertIsNone(result['source_person_position']);actor_id=result['spawn']['world_actor_id']
        self.assertEqual(self.w.snapshot()['actors'][actor_id]['population_identity'],person)
        again=self.act('encounter_population',{'key':'first-neighbor'})['data']
        self.assertIsNone(again['spawn']);self.assertEqual(again['metrics']['active_actors'],1)
        self.assertEqual(self.w.verify_history()['events'],3)
    def test_observed_demote_refuses_then_dormancy_preserves_exact_actor_memory(self):
        first=self.act('encounter_population',{'key':'neighbor'})['data'];identity=first['person']['id'];actor_id=first['spawn']['world_actor_id']
        self.act('talk',{'target':actor_id,'act':'greeting'})
        with self.assertRaises(Refused):self.act('dismiss_population',{'identity':identity})
        self.act('travel',{'destination':'airport','mode':'walk'});self.w.advance(1000,'leave-interest')
        remembered=copy.deepcopy(self.w.snapshot()['actors'][actor_id]['memories'])
        self.act('dismiss_population',{'identity':identity});self.assertNotIn(actor_id,self.w.snapshot()['actors'])
        self.w=World(self.w.path);self.act('travel',{'destination':'cafe','mode':'walk'});self.w.advance(1000,'return-interest')
        restored=self.act('restore_population',{'identity':identity})
        self.assertEqual(restored['data']['metrics']['active_actors'],1)
        actor=self.w.snapshot()['actors'][actor_id];self.assertEqual(actor['memories'],remembered)
        self.assertGreater(actor['dormant_seconds'],0)


if __name__=='__main__':unittest.main()
