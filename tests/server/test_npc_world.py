from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages'))
from dark_server.world import World
from test_world import content


class NpcWorldTests(unittest.TestCase):
    def test_schedule_moves_to_work_and_preserves_actual_progress_across_reopen(self):
        with tempfile.TemporaryDirectory() as tmp:
            c=content();c['actors']['omar']['schedule']={'roles':{'home':'cafe','work':'airport','social':'corner'},'work_window':[0,3600]}
            w=World.create(Path(tmp)/'w.db',c);start=w.snapshot()['actors']['omar']['position']
            w.advance(61,'start-shift');s=w.snapshot();self.assertIn('omar',s['journeys'])
            self.assertNotEqual(start,s['actors']['omar']['position']);self.assertEqual(s['actors']['omar']['stance'],'walking')
            w=World(w.path);w.advance(1000,'arrive-work');actor=w.snapshot()['actors']['omar']
            self.assertEqual(actor['node'],'airport');self.assertEqual(actor['goal'],'work')
            self.assertGreater(actor['npc_logic']['decision_count'],0);self.assertIn('airport',actor['npc_logic']['beliefs'])
    def test_ride_response_has_executed_equilibrium_witness_and_no_control_takeover(self):
        with tempfile.TemporaryDirectory() as tmp:
            w=World.create(Path(tmp)/'w.db',content());token=w.register('visitor');w.join(token,'join')
            for target in ('mira','omar'):
                response=w.execute(token,{'schema':'dark.action/1','request_id':target,'expected_revision':w.snapshot()['revision'],
                    'operation':'talk','arguments':{'target':target,'act':'request_ride'}})
                game=response['data']['decision_witness']['game']
                self.assertEqual(game['selected']['max_regret'],0)
            self.assertIsNone(w.snapshot()['actors']['visitor']['vehicle'])
    def test_two_replicas_execute_identical_schedule_history(self):
        with tempfile.TemporaryDirectory() as tmp:
            worlds=[World.create(Path(tmp)/str(i),content()) for i in range(2)]
            for w in worlds:
                for i in range(4):w.advance(3600,'hour'+str(i))
            self.assertEqual(worlds[0].head(),worlds[1].head())


if __name__=='__main__':unittest.main()
