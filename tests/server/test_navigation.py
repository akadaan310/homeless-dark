import copy
from pathlib import Path
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages'))
from dark_server.world import World,distance_m,interpolate
from test_world import content


def local_content():
    c=content();c['walk_regions']=[{'anchor':'cafe','bounds':[-100,-100,100,100],'blockers':[],
        'synthetic':True,'corridor_width_m':2,'free_rects':[[-1,-1,1,1]]}]
    return c


class NavigationTests(unittest.TestCase):
    def test_manual_clearance_does_not_reintroduce_removed_graph_edges(self):
        with tempfile.TemporaryDirectory() as tmp:
            c=local_content();mid=interpolate(c['nodes']['cafe'],c['nodes']['corner'],.5)
            connected=World.create(Path(tmp)/'a',c);self.assertTrue(connected._walkable(connected.snapshot(),mid))
            c['edges']=[e for e in c['edges'] if e['id']!='street']
            separated=World.create(Path(tmp)/'b',c);self.assertFalse(separated._walkable(separated.snapshot(),mid))
    def test_route_reentry_from_manual_position_is_continuous(self):
        with tempfile.TemporaryDirectory() as tmp:
            w=World.create(Path(tmp)/'world',local_content());token=w.register('walker');w.join(token,'join')
            def act(op,args,rid):return w.execute(token,{'schema':'dark.action/1','request_id':rid,'expected_revision':w.snapshot()['revision'],'operation':op,'arguments':args})
            act('manual_move',{'east':.5,'north':0},'input');w.advance(1,'step')
            before=w.snapshot()['actors']['walker']['position'];self.assertIsNone(w.snapshot()['actors']['walker']['node'])
            act('travel',{'destination':'corner','mode':'walk'},'route')
            self.assertEqual(before,w.snapshot()['actors']['walker']['position'])
            w.advance(1,'approach');self.assertLessEqual(distance_m(before,w.snapshot()['actors']['walker']['position']),1.401)
            w.advance(30,'arrive');self.assertEqual(w.snapshot()['actors']['walker']['node'],'corner')
    def test_short_route_to_nearest_node_does_not_complete_before_approach(self):
        with tempfile.TemporaryDirectory() as tmp:
            w=World.create(Path(tmp)/'world',local_content());token=w.register('walker');w.join(token,'join')
            def act(op,args,rid):return w.execute(token,{'schema':'dark.action/1','request_id':rid,'expected_revision':w.snapshot()['revision'],'operation':op,'arguments':args})
            act('manual_move',{'east':1,'north':0},'input');w.advance(2,'step')
            result=act('travel',{'destination':'cafe','mode':'walk'},'route')
            self.assertAlmostEqual(result['data']['distance_m'],2.8,places=3)
            w.advance(1,'part');self.assertIn('walker',w.snapshot()['journeys'])
            w.advance(2,'finish');self.assertEqual(w.snapshot()['actors']['walker']['node'],'cafe')


if __name__=='__main__':unittest.main()
