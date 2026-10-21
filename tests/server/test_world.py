import copy
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT/'packages'))
from dark_server.world import World, Refused, canonical, distance_m


def content():
    nodes = {
        'cafe': {'lat': 27.9594638, 'lon': -82.5054865, 'ready': True},
        'corner': {'lat': 27.9594638, 'lon': -82.5052865, 'ready': True},
        'airport': {'lat': 27.9694638, 'lon': -82.5052865, 'ready': True},
        'harbor': {'lat': 27.9794638, 'lon': -82.5052865, 'ready': True},
        'island': {'lat': 27.9894638, 'lon': -82.5052865, 'ready': True},
        'remote': {'lat': 33.9776848, 'lon': -118.448647, 'ready': True},
        'unloaded': {'lat': 28, 'lon': -82, 'ready': False},
    }
    edges = [
        {'id':'street','a':'cafe','b':'corner','modes':['walk','guided','drive','taxi','bus','bike','scooter','motorcycle']},
        {'id':'airport-road','a':'corner','b':'airport','modes':['walk','drive','taxi','bus']},
        {'id':'harbor-road','a':'corner','b':'harbor','modes':['walk','drive','taxi']},
        {'id':'flight','a':'airport','b':'remote','modes':['aircraft','helicopter']},
        {'id':'ferry','a':'harbor','b':'island','modes':['boat','ferry']},
        {'id':'unfinished','a':'island','b':'unloaded','modes':['walk']},
    ]
    actors = {
        'mira': {'node':'cafe','controller':'npc','sociability':.9,'duty':.1,'goal':'socialize'},
        'omar': {'node':'cafe','controller':'npc','sociability':.2,'duty':.9,'goal':'work'},
        'distant': {'node':'remote','controller':'npc','sociability':.9,'duty':.1,'goal':'socialize'},
    }
    vehicles = {
        'taxi': {'node':'cafe','mode':'taxi','capacity':3,'autonomous':True},
        'car': {'node':'cafe','mode':'drive','capacity':2,'autonomous':False},
        'plane': {'node':'airport','mode':'aircraft','capacity':4,'autonomous':False},
        'boat': {'node':'harbor','mode':'boat','capacity':3,'autonomous':False},
    }
    return {'schema':'dark.world-content/1','id':'fixture','spawn':'cafe','nodes':nodes,'edges':edges,'actors':actors,'vehicles':vehicles,'source_versions':{'geography':'declared-test-fixture'},'physical_validation':'NOT_RUN'}


class WorldTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)/'world.sqlite3'
        self.world = World.create(self.path, content())
        self.token = self.world.register('player', scopes=['author/cafe'], now=100)
        self.other = self.world.register('other', now=100)
        self.world.join(self.token, 'join-player', now=101)
        self.world.join(self.other, 'join-other', now=101)
        self.serial = 0

    def action(self, op, args=None, token=None, request_id=None, revision=None):
        self.serial += 1
        request = {'schema':'dark.action/1','request_id':request_id or 'r'+str(self.serial),
                   'expected_revision':self.world.snapshot()['revision'] if revision is None else revision,
                   'operation':op,'arguments':args or {}}
        return self.world.execute(token or self.token, request, now=102)

    def advance_until_arrived(self, maximum=20):
        for i in range(maximum):
            if not self.world.snapshot()['journeys']: return
            self.serial += 1
            self.world.advance(3600, 'step-'+str(self.serial))
        self.fail('journey failed to arrive within declared simulated budget')

    def test_read_is_pure_and_distant_npc_does_not_know_local_conversation(self):
        before = self.world.head()
        self.world.observe(self.token, now=102)
        self.assertEqual(before, self.world.head())
        self.action('talk', {'target':'mira','act':'greeting'})
        s = self.world.snapshot()
        self.assertTrue(s['actors']['mira']['memories'])
        self.assertFalse(s['actors']['distant']['memories'])
        self.assertNotEqual(s['actors']['mira']['memories'][-1]['id'], '')

    def test_npc_refusal_and_independent_clock_schedule(self):
        a = self.action('talk', {'target':'mira','act':'request_ride'})
        b = self.action('talk', {'target':'omar','act':'request_ride'})
        self.assertEqual(a['data']['response_act'], 'offer_ride')
        self.assertEqual(b['data']['response_act'], 'decline_ride')
        self.world.advance(60,'independent-life')
        s = self.world.snapshot()
        self.assertEqual(s['tick'],60)
        self.assertGreater(s['actors']['omar']['decisions'],0)
        self.assertGreater(len(s['speech']),2)

    def test_identity_expiry_and_no_self_assigned_founder(self):
        before = self.world.head()
        with self.assertRaises(Refused):self.world.join('founder_dark','bad-name',now=102)
        with self.assertRaises(Refused):self.world.observe(self.token,now=100+86400)
        self.assertEqual(before,self.world.head())
        self.assertEqual(self.world.observe(self.token,now=102)['actor']['role'],'member')
        with self.assertRaises(Refused):self.action('set_role',{'role':'founder_dark'})

    def test_revision_exact_retry_and_altered_duplicate(self):
        revision=self.world.snapshot()['revision']
        a=self.action('sit',request_id='same',revision=revision)
        b=self.action('sit',request_id='same',revision=revision)
        self.assertEqual(a,b)
        with self.assertRaises(Refused):self.action('stand',request_id='same',revision=revision)
        with self.assertRaises(Refused):self.action('stand',revision=revision)
        self.assertEqual(self.world.snapshot()['actors']['player']['stance'],'sitting')

    def test_walking_is_continuous_cancel_stops_without_teleport_and_resumes(self):
        self.action('travel',{'destination':'corner','mode':'walk'})
        self.world.advance(2,'walk-two-seconds')
        middle=self.world.snapshot()['actors']['player']['position']
        self.assertGreater(distance_m(middle,content()['nodes']['cafe']),0)
        self.assertLess(distance_m(middle,content()['nodes']['cafe']),distance_m(content()['nodes']['cafe'],content()['nodes']['corner']))
        self.action('cancel')
        self.world.advance(30,'pause-walking')
        self.assertEqual(self.world.snapshot()['actors']['player']['position'],middle)
        self.action('resume')
        self.advance_until_arrived()
        self.assertEqual(self.world.snapshot()['actors']['player']['node'],'corner')

    def test_two_riders_capacity_driver_control_and_attached_movement(self):
        self.action('board',{'vehicle':'car','seat':'driver'})
        self.action('board',{'vehicle':'car','seat':'passenger'},token=self.other)
        with self.assertRaises(Refused):self.action('travel',{'destination':'airport','mode':'drive'},token=self.other)
        self.action('travel',{'destination':'airport','mode':'drive'})
        self.world.advance(2,'drive-two')
        s=self.world.snapshot()
        self.assertEqual(s['actors']['player']['position'],s['actors']['other']['position'])
        self.assertEqual(s['actors']['player']['position'],s['vehicles']['car']['position'])
        with self.assertRaises(Refused):self.action('exit')
        self.advance_until_arrived()
        self.action('exit')
        self.assertIsNone(self.world.snapshot()['actors']['player']['vehicle'])

    def test_taxi_consent_and_ground_air_ground_journey(self):
        self.action('board',{'vehicle':'taxi','seat':'passenger'})
        with self.assertRaises(Refused):self.action('travel',{'destination':'airport','mode':'taxi'})
        self.action('consent_trip',{'destination':'airport','max_distance_m':5000})
        self.action('travel',{'destination':'airport','mode':'taxi'})
        self.advance_until_arrived();self.action('exit')
        self.action('board',{'vehicle':'plane','seat':'driver'})
        self.action('travel',{'destination':'remote','mode':'aircraft'})
        self.world.advance(30,'takeoff')
        self.assertGreater(self.world.snapshot()['actors']['player']['position']['alt'],0)
        self.advance_until_arrived();self.action('exit')
        self.assertEqual(self.world.snapshot()['actors']['player']['node'],'remote')

    def test_boat_trip_and_unready_destination_refuse_without_mutation(self):
        self.action('travel',{'destination':'harbor','mode':'walk'});self.advance_until_arrived()
        self.action('board',{'vehicle':'boat','seat':'driver'})
        self.action('travel',{'destination':'island','mode':'boat'});self.advance_until_arrived();self.action('exit')
        before=self.world.head()
        with self.assertRaises(Refused):self.action('travel',{'destination':'unloaded','mode':'walk'})
        self.assertEqual(before,self.world.head())

    def test_overlay_and_braid_are_not_visit_and_no_unlearned_portal(self):
        start=self.world.snapshot()['actors']['player']['position']
        self.action('overlay',{'destination':'remote'})
        self.action('braid',{'destination':'remote'})
        self.assertEqual(self.world.snapshot()['actors']['player']['position'],start)
        with self.assertRaises(Refused):self.action('visit',{'destination':'remote'})

    def test_scoped_authoring_and_contribution_persists_across_reopen(self):
        self.action('author',{'target':'cafe','text':'A place to return to'})
        with self.assertRaises(Refused):self.action('author',{'target':'remote','text':'unauthorized'})
        reopened=World(self.path)
        self.assertEqual(reopened.snapshot()['signs']['cafe']['text'],'A place to return to')
        self.assertEqual(reopened.head(),self.world.head())
        self.assertEqual(reopened.verify_history()['events'],self.world.snapshot()['revision'])

    def test_disconnect_during_trip_and_exact_retry_after_restart(self):
        revision=self.world.snapshot()['revision']
        result=self.action('travel',{'destination':'corner','mode':'walk'},request_id='trip',revision=revision)
        self.world.advance(2,'before-disconnect')
        position=self.world.snapshot()['actors']['player']['position']
        self.world=World(self.path)
        self.assertEqual(self.world.snapshot()['actors']['player']['position'],position)
        self.assertEqual(self.action('travel',{'destination':'corner','mode':'walk'},request_id='trip',revision=revision),result)
        self.advance_until_arrived()
        self.assertEqual(self.world.snapshot()['actors']['player']['node'],'corner')

    def test_tampered_state_refuses_and_existing_world_never_reseeded(self):
        with self.assertRaises(FileExistsError):World.create(self.path,content())
        with sqlite3.connect(self.path) as conn:
            conn.execute("UPDATE world SET state='{}' WHERE id=1")
        with self.assertRaises(Refused):World(self.path).snapshot()

    def test_invalid_commands_and_budget_refusals_leave_state_unchanged(self):
        for op,args in [('travel',{'destination':'remote','mode':'walk'}),('talk',{'target':'distant','act':'greeting'}),('author',{'target':'cafe','text':'x'*1025}),('travel',{'destination':'corner','mode':'unknown'}),('board',{'vehicle':'missing','seat':'driver'})]:
            with self.subTest(op=op,args=args):
                before=self.world.head()
                with self.assertRaises(Refused):self.action(op,args)
                self.assertEqual(before,self.world.head())
        with self.assertRaises(Refused):self.world.advance(3601,'over-budget')

    def test_revocation_survives_restart(self):
        self.world.revoke(self.token)
        with self.assertRaises(Refused):World(self.path).observe(self.token,now=102)

    def test_identity_namespaces_cannot_move_an_unboarded_vehicle(self):
        for name in ('car','system','founder_dark'):
            with self.subTest(name=name):
                with self.assertRaises(Refused):self.world.register(name,now=100)
        fixture=content();fixture['actors']['car']=fixture['actors'].pop('mira')
        with self.assertRaises(Refused):World.create(Path(self.temp.name)/'collision.db',fixture)

    def test_malformed_types_and_validation_encoding_have_typed_atomic_refusals(self):
        before=self.world.head()
        for op,args in [('talk',{'target':[],'act':'greeting'}),('travel',{'destination':{},'mode':'walk'}),
                        ('board',{'vehicle':[],'seat':'driver'}),('overlay',{'destination':[]})]:
            with self.subTest(op=op):
                with self.assertRaises(Refused):self.action(op,args)
        for value in (float('nan'),'\ud800'):
            request={'schema':'dark.action/1','request_id':'invalid','expected_revision':self.world.snapshot()['revision'],
                     'operation':'author','arguments':{'target':'cafe','text':value}}
            with self.assertRaises(Refused):self.world.validate(self.token,request,now=102)
        self.assertEqual(before,self.world.head())

    def test_token_is_not_valid_before_issuance_and_null_does_not_become_operator(self):
        with self.assertRaises(Refused):self.world.observe(self.token,now=99)
        with self.assertRaises(Refused):self.world.join(None,'system-join',now=102)

    def test_manual_walk_has_speed_expiry_and_authored_collision_limits(self):
        fixture=content()
        fixture['walk_regions']=[{'anchor':'cafe','bounds':[-5,-5,5,5],'blockers':[[2,-1,4,1]],'synthetic':True}]
        world=World.create(Path(self.temp.name)/'manual.db',fixture)
        token=world.register('walker',now=100);world.join(token,'join',now=101)
        def act(e,n,rid):
            return world.execute(token,{'schema':'dark.action/1','request_id':rid,'expected_revision':world.snapshot()['revision'],
                'operation':'manual_move','arguments':{'east':e,'north':n}},now=102)
        start=world.snapshot()['actors']['walker']['position']
        act(1,1,'diagonal');world.advance(1,'one')
        self.assertAlmostEqual(distance_m(start,world.snapshot()['actors']['walker']['position']),1.4,places=3)
        world.advance(10,'expired')
        stopped=world.snapshot()['actors']['walker']['position']
        world.advance(10,'still-stopped')
        self.assertEqual(stopped,world.snapshot()['actors']['walker']['position'])
        with self.assertRaises(Refused):act(100,0,'too-fast')
        act(1,0,'east-boundary');world.advance(5,'edge')
        self.assertLess(distance_m(start,world.snapshot()['actors']['walker']['position']),8)

    def test_manual_move_requires_authored_region_and_foot_control(self):
        with self.assertRaises(Refused):self.action('manual_move',{'east':1,'north':0})
        self.action('board',{'vehicle':'car','seat':'driver'})
        with self.assertRaises(Refused):self.action('manual_move',{'east':1,'north':0})


if __name__=='__main__':unittest.main()
