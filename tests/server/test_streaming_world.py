import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages'))
from dark_server.world import World,Refused
from test_world import content


class StreamingWorldTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.asset=self.root/'volume.json';self.asset.write_text(json.dumps({'schema':'dark.collision-aabb/1','min':[-2,-1,-2],'max':[2,2,2],'spawn':[0,0,0]}))
        c=content();c['streaming']={'manifest':{'schema':'dark.stage-manifest/1','version':'test-v1','assets':[{
            'id':'safe-volume','path':'volume.json','bytes':self.asset.stat().st_size,'sha256':hashlib.sha256(self.asset.read_bytes()).hexdigest(),'kind':'collision','decoder':'collision_aabb'}]},
            'cells':{'cafe-cell':{'node':'cafe','assets':['safe-volume'],'portable_collision':True}}}
        self.path=self.root/'world.db';self.w=World.create(self.path,c,resource_root=self.root)
        self.token=self.w.register('walker');self.w.join(self.token,'join');self.i=0
    def act(self,op,args=None):
        self.i+=1
        return self.w.execute(self.token,{'schema':'dark.action/1','request_id':'r'+str(self.i),'expected_revision':self.w.snapshot()['revision'],'operation':op,'arguments':args or {'cell':'cafe-cell'}})
    def test_prepare_and_activate_are_separate_durable_nonmovement_admissions(self):
        before=self.w.snapshot()['actors']['walker']['position']
        self.act('prepare_cell');s=self.w.snapshot();cell=next(iter(s['staging']['cells'].values()))
        self.assertEqual(cell['gate'],'RESERVE');self.assertEqual(s['actors']['walker']['position'],before)
        self.w=World(self.path,resource_root=self.root)
        self.act('activate_cell');s=self.w.snapshot();self.assertEqual(next(iter(s['staging']['cells'].values()))['gate'],'ACTIVATE')
        self.assertEqual(s['actors']['walker']['position'],before)
        self.assertEqual(self.w.observe(self.token)['streaming']['cells']['cafe-cell']['native_collision'],'NOT_RUN')
    def test_changed_asset_after_reservation_refuses_atomic_activation(self):
        self.act('prepare_cell');head=self.w.head();self.asset.write_text('{}')
        with self.assertRaises(Refused):self.act('activate_cell')
        self.assertEqual(self.w.head(),head)
    def test_actual_position_and_current_route_cannot_be_supplied_by_client(self):
        self.act('prepare_cell')
        self.act('travel',{'destination':'corner','mode':'walk'})
        before=self.w.head()
        with self.assertRaises(Refused):self.act('activate_cell')
        with self.assertRaises(Refused):self.act('activate_cell',{'cell':'cafe-cell','position':'[0,0,0]'})
        self.assertEqual(before,self.w.head())
    def test_expired_reservation_releases_budget_without_proximity_or_player_input(self):
        self.act('prepare_cell');self.act('travel',{'destination':'harbor','mode':'walk'})
        self.w.advance(2000,'walk-away')
        state=self.w.snapshot()['staging']
        self.assertEqual(next(iter(state['cells'].values()))['gate'],'EXPIRED')
        self.assertEqual(state['metrics']['reserved_unique_bytes'],0)

    def test_reservation_deadline_releases_budget_before_cell_ttl(self):
        self.act('prepare_cell')
        state=self.w.snapshot()['staging'];cell=next(iter(state['cells'].values()))
        self.assertEqual(cell['expires_tick'],120)
        self.assertEqual(self.w.observe(self.token)['streaming']['cells']['cafe-cell']['expires_tick'],30)
        self.w.advance(30,'reservation-deadline')
        state=self.w.snapshot()['staging']
        self.assertEqual(next(iter(state['cells'].values()))['gate'],'EXPIRED')
        self.assertEqual(state['metrics']['reserved_unique_bytes'],0)
        self.w.advance(5,'prepare-cooldown')
        self.act('prepare_cell')
        self.act('activate_cell')
        self.w.advance(120,'active-is-not-preparation')
        self.assertEqual(next(iter(self.w.snapshot()['staging']['cells'].values()))['gate'],'ACTIVATE')


if __name__=='__main__':unittest.main()
