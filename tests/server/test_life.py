import copy
import importlib
import json
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages'))

class LifeTests(unittest.TestCase):
    def setUp(self):
        self.m=importlib.import_module('dark_server.life')
        self.defs=json.loads((ROOT/'assets/content/life/entities.json').read_bytes())['entities']
        self.registry=self.m.LifeRegistry.create(self.defs)
        self.serial=0
    def call(self,entity,ability,args=None,tick=0,actor='member',caps=None,request_id=None):
        self.serial+=1
        request={'request_id':request_id or 'r'+str(self.serial),'expected_revision':self.registry.revision,'entity_id':entity,'ability':ability,'arguments':args or {}}
        capabilities=caps if caps is not None else [self.m.capability(entity,ability)]
        return self.registry.apply(actor,capabilities,request,tick)
    def observe(self,entity,kind,payload,tick=0,subject='member'):
        self.serial+=1
        return self.call(entity,'observe',{'observation':{'id':'obs'+str(self.serial),'kind':kind,'subject':subject,'tick':tick,'payload':payload}},tick)

    def test_all_life_fields_shared_contracts_and_addressability(self):
        fields={'entity_id','kind','state','traits','memory','observations','relations','affordances','policy','capabilities','dynamics','schedule','budget','provenance'}
        for entity in self.defs:
            life=self.registry.inspect(entity['id'])
            self.assertEqual(set(life),fields)
            self.assertEqual(life['entity_id'],entity['id'])
        required={'id','version','alphabet','state','grammar','contextual_ranking','denotation','transition','projections','invariants','dependencies','effect_types','capability_requirements','clock','resource_budget','verifier','witness','migration'}
        contracts=self.m.subject_contracts()
        self.assertEqual(set(contracts),{'building','tree','cup','car','star','group'})
        for contract in contracts.values():self.assertEqual(set(contract),required)
        self.assertEqual(len(self.registry.ids()),6)
        with self.assertRaises(self.m.LifeRefused):self.registry.inspect('missing')

    def test_building_light_and_cooldown_scope_refusals_are_atomic(self):
        result=self.call('building:cafe','set_light',{'level':.7},tick=0)
        self.assertEqual(self.registry.inspect('building:cafe')['state']['light'],.7)
        self.assertEqual(result['witness']['effect']['type'],'synthetic_light')
        before=self.registry.snapshot()
        with self.assertRaises(self.m.LifeRefused):self.call('building:cafe','set_light',{'level':.2},tick=1)
        self.assertEqual(before,self.registry.snapshot())
        with self.assertRaises(self.m.LifeRefused):self.call('building:cafe','set_light',{'level':.2},tick=6,caps=[])
        self.assertEqual(before,self.registry.snapshot())

    def test_building_uses_causal_entry_observation_and_can_decline(self):
        with self.assertRaises(self.m.LifeRefused):self.call('building:cafe','decide_entry',{'visitor':'member'})
        self.observe('building:cafe','entry_request',{'visitor':'member'})
        answer=self.call('building:cafe','decide_entry',{'visitor':'member'},tick=1)
        self.assertEqual(answer['witness']['effect']['decision'],'allow')
        self.assertTrue(answer['witness']['causal_observations'])
        self.assertIn('member',self.registry.inspect('building:cafe')['state']['occupants'])
        self.observe('building:cafe','entry_request',{'visitor':'second'},tick=2,subject='second')
        answer=self.call('building:cafe','decide_entry',{'visitor':'second'},tick=3,actor='second')
        self.assertEqual(answer['witness']['effect']['decision'],'decline')

    def test_tree_reacts_to_weather_and_expresses_bounded_glow(self):
        self.observe('tree:oak','weather',{'rain':.8,'heat':.2})
        answer=self.call('tree:oak','react_weather',tick=1)
        self.assertAlmostEqual(self.registry.inspect('tree:oak')['state']['moisture'],.638)
        self.assertTrue(answer['witness']['causal_observations'])
        self.call('tree:oak','glow',{'level':.15},tick=2)
        with self.assertRaises(self.m.LifeRefused):self.call('tree:oak','glow',{'level':1},tick=3)

    def test_cup_reactive_offset_is_synthetic_not_claimed_physics(self):
        before=self.registry.inspect('cup:counter')['provenance']
        result=self.call('cup:counter','nudge',{'dx':.1,'dz':-.1})
        self.assertAlmostEqual(self.registry.inspect('cup:counter')['state']['offset_xz_m'][0],.07)
        self.assertAlmostEqual(self.registry.inspect('cup:counter')['state']['offset_xz_m'][1],-.07)
        self.assertEqual(before,self.registry.inspect('cup:counter')['provenance'])
        self.assertEqual(result['physical_validation'],'NOT_RUN')
        with self.assertRaises(self.m.LifeRefused):self.call('cup:counter','nudge',{'dx':100,'dz':0},tick=1)

    def test_car_ride_policy_proposes_without_taking_control(self):
        self.observe('car:taxi','ride_request',{'requester':'member','destination':'harbor'})
        result=self.call('car:taxi','decide_ride',{'requester':'member'},tick=1)
        effect=result['witness']['effect']
        self.assertEqual(effect['decision'],'offer');self.assertTrue(effect['proposal_only']);self.assertFalse(effect['player_control_changed'])
        self.call('car:taxi','signal',{'direction':'left'},tick=2)
        self.assertEqual(self.registry.inspect('car:taxi')['state']['signal'],'left')

    def test_star_expression_never_changes_source_astrometry(self):
        before=self.registry.inspect('star:fixture')['provenance']
        self.call('star:fixture','twinkle',{'magnitude_offset':-.1})
        self.assertEqual(before,self.registry.inspect('star:fixture')['provenance'])
        self.assertEqual(self.registry.inspect('star:fixture')['state']['magnitude_offset'],-.05)
        with self.assertRaises(self.m.LifeRefused):self.call('star:fixture','move_star',{'ra':10},tick=2)

    def test_sparse_groups_enforce_opt_in_identity_and_exclusive_conflict(self):
        self.call('group:neighbors','join',{'member':'tree:oak','role':'participant'},actor='tree:oak')
        group=self.registry.inspect('group:neighbors')
        self.assertEqual(group['state']['members'],{'tree:oak':'participant'})
        self.assertEqual(self.registry.inspect('tree:oak')['relations']['member_of'],['group:neighbors'])
        with self.assertRaises(self.m.LifeRefused):self.call('group:neighbors','join',{'member':'cup:counter','role':'participant'},tick=1,actor='member')
        self.call('group:neighbors','propose_pattern',{'pattern':'welcome'},tick=2)
        self.assertEqual(self.registry.inspect('group:neighbors')['state']['last_pattern'],'welcome')
        self.assertEqual(self.registry.inspect('tree:oak')['state']['glow'],0)

    def test_exact_retry_after_current_authorization_and_conflict(self):
        req={'request_id':'once','expected_revision':0,'entity_id':'cup:counter','ability':'nudge','arguments':{'dx':.1,'dz':0}}
        cap=[self.m.capability('cup:counter','nudge')]
        first=self.registry.apply('member',cap,req,0)
        self.assertEqual(self.registry.apply('member',cap,req,2),first)
        with self.assertRaises(self.m.LifeRefused):self.registry.apply('member',[],req,2)
        altered=copy.deepcopy(req);altered['arguments']['dx']=.2
        with self.assertRaises(self.m.LifeRefused):self.registry.apply('member',cap,altered,2)
        self.assertEqual(self.registry.revision,1)

    def test_snapshot_restores_identity_memories_relations_and_continuity(self):
        self.observe('car:taxi','ride_request',{'requester':'member','destination':'harbor'})
        self.call('car:taxi','decide_ride',{'requester':'member'},tick=1)
        self.call('group:neighbors','join',{'member':'cup:counter','role':'participant'},tick=2,actor='cup:counter')
        snapshot=self.registry.snapshot();other=self.m.LifeRegistry.restore(json.loads(json.dumps(snapshot)))
        self.assertEqual(other.snapshot(),snapshot)
        self.assertEqual(other.inspect('car:taxi')['memory'],self.registry.inspect('car:taxi')['memory'])
        inspect=other.inspect('car:taxi');inspect['state']['signal']='hacked'
        self.assertNotEqual(other.inspect('car:taxi')['state']['signal'],'hacked')

    def test_budget_clock_stale_revision_and_bad_shapes_refuse(self):
        for op,args in [('set_light',{'level':True}),('set_light',{'level':float('nan')}),('set_light',{'level':2}),('set_light',{'level':.3,'source_geometry':{}})]:
            before=self.registry.snapshot()
            with self.assertRaises(self.m.LifeRefused):self.call('building:cafe',op,args)
            self.assertEqual(self.registry.snapshot(),before)
        self.call('cup:counter','nudge',{'dx':.1,'dz':0},tick=10)
        with self.assertRaises(self.m.LifeRefused):self.call('cup:counter','nudge',{'dx':.1,'dz':0},tick=9)
        request={'request_id':'stale','expected_revision':0,'entity_id':'cup:counter','ability':'nudge','arguments':{'dx':.1,'dz':0}}
        with self.assertRaises(self.m.LifeRefused):self.registry.apply('member',[self.m.capability('cup:counter','nudge')],request,11)

    def test_deterministic_replay_and_source_geometry_immutable(self):
        original={r['id']:self.registry.inspect(r['id'])['provenance'] for r in self.defs}
        second=self.m.LifeRegistry.create(self.defs)
        for index in range(20):
            request={'request_id':'step'+str(index),'expected_revision':index,'entity_id':'cup:counter','ability':'nudge','arguments':{'dx':.01 if index%2==0 else -.01,'dz':0}}
            for registry in [self.registry,second]:registry.apply('member',[self.m.capability('cup:counter','nudge')],request,index)
        self.assertEqual(self.registry.snapshot(),second.snapshot())
        for key,value in original.items():self.assertEqual(self.registry.inspect(key)['provenance'],value)

    def test_one_weather_event_cannot_be_counted_twice(self):
        self.observe('tree:oak','weather',{'rain':.8,'heat':.2})
        self.call('tree:oak','react_weather',tick=1)
        before=self.registry.snapshot()
        with self.assertRaises(self.m.LifeRefused):self.call('tree:oak','react_weather',tick=20)
        self.assertEqual(self.registry.snapshot(),before)

    def test_malformed_snapshot_and_source_mutation_are_typed_refusals(self):
        for mutate in [lambda s:s['entities']['cup:counter'].__setitem__('kind',[]),
                       lambda s:s['entities']['cup:counter']['budget'].__setitem__('remaining',-5),
                       lambda s:s['entities']['cup:counter']['state'].__setitem__('offset_xz_m',[100,0]),
                       lambda s:s['entities']['star:fixture']['provenance']['source_geometry'].__setitem__('right_ascension_deg',50)]:
            state=self.registry.snapshot();mutate(state)
            with self.assertRaises(self.m.LifeRefused):self.m.LifeRegistry.restore(state)

    def test_independent_review_malformed_inputs_refuse_atomically(self):
        before=self.registry.snapshot()
        with self.assertRaises(self.m.LifeRefused):self.call('building:cafe','set_light',{'level':10**1000})
        self.assertEqual(self.registry.snapshot(),before)
        for mutate in [lambda s:s.__setitem__('events',[None]),
                       lambda s:s['entities']['tree:oak'].__setitem__('observations',[{}]),
                       lambda s:s['entities']['cup:counter'].__setitem__('memory',[{}]),
                       lambda s:s.__setitem__('requests',{'invalid':{}})]:
            state=self.registry.snapshot();mutate(state)
            with self.assertRaises(self.m.LifeRefused):self.m.LifeRegistry.restore(state)

    def test_exclusive_membership_and_group_cycles_refuse_atomically(self):
        definitions=copy.deepcopy(self.defs)
        second=copy.deepcopy(definitions[-1]);second['id']='group:other';definitions.append(second)
        self.registry=self.m.LifeRegistry.create(definitions)
        self.call('group:neighbors','join',{'member':'cup:counter','role':'participant'},actor='cup:counter')
        before=self.registry.snapshot()
        with self.assertRaises(self.m.LifeRefused):self.call('group:other','join',{'member':'cup:counter','role':'participant'},actor='cup:counter',tick=1)
        self.assertEqual(self.registry.snapshot(),before)
        self.call('group:neighbors','join',{'member':'group:other','role':'participant'},actor='group:other',tick=2)
        before=self.registry.snapshot()
        with self.assertRaises(self.m.LifeRefused):self.call('group:other','join',{'member':'group:neighbors','role':'participant'},actor='group:neighbors',tick=3)
        self.assertEqual(self.registry.snapshot(),before)

    def test_actual_resource_budget_exhaustion_refill_and_stale_observation(self):
        self.observe('building:cafe','entry_request',{'visitor':'member'})
        for tick in range(1,34):self.call('building:cafe','decide_entry',{'visitor':'member'},tick=tick)
        self.assertEqual(self.registry.inspect('building:cafe')['budget']['remaining'],0)
        before=self.registry.snapshot()
        with self.assertRaises(self.m.LifeRefused) as caught:self.call('building:cafe','decide_entry',{'visitor':'member'},tick=34)
        self.assertEqual(caught.exception.code,'RESOURCE_BUDGET');self.assertEqual(before,self.registry.snapshot())
        self.call('building:cafe','decide_entry',{'visitor':'member'},tick=61)
        self.assertEqual(self.registry.inspect('building:cafe')['budget']['remaining'],97)
        with self.assertRaises(self.m.LifeRefused) as caught:self.call('building:cafe','decide_entry',{'visitor':'member'},tick=301)
        self.assertEqual(caught.exception.code,'OBSERVATION_STALE')

    def test_private_car_declines_and_history_exhaustion_preserves_memory(self):
        definitions=copy.deepcopy(self.defs)
        next(d for d in definitions if d['kind']=='car')['traits']={'helpfulness':.1,'duty':.9}
        self.registry=self.m.LifeRegistry.create(definitions)
        self.observe('car:taxi','ride_request',{'requester':'member','destination':'harbor'})
        result=self.call('car:taxi','decide_ride',{'requester':'member'},tick=1)
        self.assertEqual(result['witness']['effect']['decision'],'decline')
        for index in range(64):self.call('cup:counter','nudge',{'dx':.001 if index%2==0 else -.001,'dz':0},tick=index+2)
        before=self.registry.snapshot()
        with self.assertRaises(self.m.LifeRefused) as caught:self.call('cup:counter','nudge',{'dx':0,'dz':0},tick=66)
        self.assertEqual(caught.exception.code,'MEMORY_BUDGET');self.assertEqual(before,self.registry.snapshot())

if __name__=='__main__':unittest.main()
