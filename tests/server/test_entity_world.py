import copy
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages'))
from dark_server.world import World,Refused
from test_world import content


def populated():
    c=content()
    c['life']={'definitions':[
        {'id':'building:cafe','kind':'building','provenance':{'source_id':'authored:cafe','source_geometry':c['nodes']['cafe'],'geometry_status':'fictional'}},
        {'id':'car:taxi','kind':'car','traits':{'helpfulness':.9,'duty':.1},'provenance':{'source_id':'authored:taxi','source_geometry':c['nodes']['cafe'],'geometry_status':'fictional'}}],
        'placements':{'building:cafe':{'node':'cafe','radius_m':8},'car:taxi':{'vehicle':'taxi','radius_m':5}},
        'public_abilities':{'building:cafe':['set_light'],'car:taxi':['signal']}}
    return c


class EntityWorldTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'world.db';self.w=World.create(self.path,populated())
        self.token=self.w.register('visitor');self.w.join(self.token,'join');self.serial=0
    def action(self,operation,arguments):
        self.serial+=1
        return self.w.execute(self.token,{'schema':'dark.action/1','request_id':'action'+str(self.serial),
            'expected_revision':self.w.snapshot()['revision'],'operation':operation,'arguments':arguments})
    def test_entity_effect_is_atomic_durable_and_observable_without_private_memory(self):
        before=self.w.snapshot()['life']['entities']['building:cafe']['provenance']
        response=self.action('entity_action',{'entity':'building:cafe','ability':'set_light','input':{'level':.7}})
        self.assertEqual(response['status'],'COMMITTED')
        reopened=World(self.path);observed=reopened.observe(self.token)['entities']['building:cafe']
        self.assertEqual(observed['state']['light'],.7);self.assertNotIn('memory',observed)
        self.assertEqual(reopened.snapshot()['life']['entities']['building:cafe']['provenance'],before)
        self.assertEqual(reopened.verify_history()['events'],2)
    def test_forged_observation_and_remote_effect_are_refused_without_state_change(self):
        before=self.w.head()
        with self.assertRaises(Refused):self.action('entity_action',{'entity':'building:cafe','ability':'observe','input':{}})
        with self.assertRaises(Refused):self.action('entity_action',{'entity':'building:cafe','ability':'set_light','input':{'level':True}})
        self.assertEqual(before,self.w.head())
        self.action('travel',{'destination':'corner','mode':'walk'});self.w.advance(60,'arrive')
        before=self.w.head()
        with self.assertRaises(Refused):self.action('entity_action',{'entity':'building:cafe','ability':'set_light','input':{'level':.5}})
        self.assertEqual(before,self.w.head())
    def test_host_observes_own_request_and_ride_offer_does_not_take_control(self):
        decision=self.action('request_entry',{'entity':'building:cafe'})
        self.assertEqual(decision['data']['witness']['effect']['visitor'],'visitor')
        ride=self.action('request_vehicle_ride',{'entity':'car:taxi','destination':'corner'})
        self.assertEqual(ride['data']['witness']['effect']['decision'],'offer')
        s=self.w.snapshot();self.assertIsNone(s['actors']['visitor']['vehicle']);self.assertFalse(s['journeys'])
        observation=s['life']['entities']['car:taxi']['observations'][0]
        self.assertEqual(observation['subject'],'visitor')
    def test_validate_does_not_commit_nested_life_candidate(self):
        request={'schema':'dark.action/1','request_id':'dry','expected_revision':1,'operation':'entity_action',
            'arguments':{'entity':'building:cafe','ability':'set_light','input':{'level':1}}}
        before=self.w.head();self.assertEqual(self.w.validate(self.token,request)['status'],'VALID')
        self.assertEqual(before,self.w.head());self.assertEqual(self.w.snapshot()['life']['revision'],0)
    def test_huge_json_integer_is_typed_refusal(self):
        before=self.w.head()
        with self.assertRaises(Refused):self.action('manual_move',{'east':10**1000,'north':0})
        self.assertEqual(self.w.head(),before)


if __name__=='__main__':unittest.main()
