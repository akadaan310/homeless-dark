import copy
import importlib
from pathlib import Path
import sys
import unittest
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages'))

class PopulationAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m=importlib.import_module('dark_server.population_runtime')
        from dark_server.kernel import KernelBridge
        KernelBridge.build()
    def setUp(self):self.runtime=self.m.PopulationRuntime.create();self.serial=0
    def context(self,**changes):
        ctx={'actor':'member','tick':0,'country':'USA','position':{'lat':27.9594638,'lon':-82.5054865,'alt':0},'spawn_ready':True,'capabilities':['population:encounter']};ctx.update(changes);return ctx
    def call(self,operation,args,context=None):
        self.serial+=1
        return self.runtime.apply(context or self.context(),{'request_id':'r'+str(self.serial),'expected_revision':self.runtime.revision,'operation':operation,'arguments':args})
    def known_context(self,person,operation,**changes):return self.context(capabilities=[self.m.capability(person,operation)],**changes)
    def encounter(self,key='near-cafe'):return self.call('encounter',{'key':key})
    def test_source_total_zero_initial_realization_and_lazy_country_encounter(self):
        initial=self.runtime.snapshot();self.assertEqual(initial['metrics']['demographic_estimate'],8140897523)
        self.assertEqual(initial['metrics']['stored_individuals'],0);self.assertEqual(initial['metrics']['active_actors'],0)
        result=self.encounter();person=result['person'];self.assertEqual(person['origin'],'USA');self.assertEqual(person['present'],'USA')
        self.assertTrue(result['spawn']['fictional_placement']);self.assertIsNone(result['spawn']['source_person_position']);self.assertFalse(result['authority_granted'])
        self.assertEqual(result['metrics']['active_actors'],1);self.assertEqual(result['counts']['USA']['residents'],340003797)
        self.assertEqual(result['metrics']['virtual_members']+result['metrics']['stored_individuals'],8140897523)
    def test_exact_country_authority_ready_spawn_and_no_arbitrary_identity(self):
        before=self.runtime.snapshot()
        for ctx in [self.context(capabilities=[]),self.context(country='WLD_UNASSIGNED'),self.context(country='XXX'),self.context(spawn_ready=False),self.context(actor='founder_dark')]:
            with self.assertRaises(self.m.PopulationRefused):self.call('encounter',{'key':'key'},ctx)
            self.assertEqual(before,self.runtime.snapshot())
        with self.assertRaises(self.m.PopulationRefused):self.call('encounter',{'key':'key','country':'BRA'})
        with self.assertRaises(self.m.PopulationRefused):self.call('promote',{'identity':'wb2024/USA/1'},self.known_context('wb2024/USA/1','promote'))
    def test_owned_promotion_demotion_and_memories_survive_restart(self):
        person=self.encounter()['person']['id']
        self.call('remember',{'identity':person,'fact':'we met at the cafe'},self.known_context(person,'remember'))
        with self.assertRaises(self.m.PopulationRefused):self.call('demote',{'identity':person},self.known_context(person,'demote'))
        result=self.call('demote',{'identity':person},self.known_context(person,'demote',safe_to_demote=True));self.assertEqual(result['metrics']['active_actors'],0)
        self.runtime=self.m.PopulationRuntime.restore(self.runtime.snapshot())
        result=self.call('promote',{'identity':person},self.known_context(person,'promote'))
        self.assertEqual(result['metrics']['active_actors'],1);self.assertIn('player_report:member:we met at the cafe',result['person']['facts'])
        with self.assertRaises(self.m.PopulationRefused):self.call('demote',{'identity':person},self.known_context(person,'demote',actor='other',safe_to_demote=True))
    def test_repeated_encounter_key_never_duplicates_or_teleports(self):
        first=self.encounter();again=self.encounter()
        self.assertEqual(first['person']['id'],again['person']['id']);self.assertIsNone(again['spawn']);self.assertEqual(again['metrics']['active_actors'],1)
        self.assertEqual(len(self.runtime.snapshot()['encounters']),1)
    def test_active_bound_is_configurable_below_absolute256(self):
        self.runtime=self.m.PopulationRuntime.create(max_active=1);self.encounter('one');before=self.runtime.snapshot()
        with self.assertRaises(self.m.PopulationRefused):self.encounter('two')
        self.assertEqual(before,self.runtime.snapshot())
        with self.assertRaises(self.m.PopulationRefused):self.m.PopulationRuntime.create(max_active=257)
    def test_actual_arrival_trip_migration_and_exact_conservation(self):
        person=self.encounter()['person']['id']
        arrival={'identity':person,'from_country':'USA','to_country':'BRA','tick':1,'event_id':'world-arrival-1','migration_authorized':False}
        ctx=self.known_context(person,'travel',tick=1,country='BRA',position={'lat':-23.55,'lon':-46.63,'alt':0},arrival=arrival)
        result=self.call('travel',{'identity':person},ctx)
        self.assertEqual(result['person']['origin'],'USA');self.assertEqual(result['person']['residence'],'USA');self.assertEqual(result['person']['present'],'BRA')
        self.assertEqual(result['counts']['USA']['absent_residents'],1);self.assertEqual(result['counts']['BRA']['visitors'],1)
        arrival=dict(arrival,from_country='BRA',tick=2,event_id='world-migrate-2',migration_authorized=True)
        ctx=self.known_context(person,'migrate',tick=2,country='BRA',position={'lat':-23.55,'lon':-46.63,'alt':0},arrival=arrival)
        result=self.call('migrate',{'identity':person},ctx)
        self.assertEqual(result['person']['residence'],'BRA');self.assertEqual(result['counts']['BRA']['residents'],211998574)
        self.assertEqual(result['metrics']['demographic_estimate'],8140897523)
    def test_forged_destination_missing_arrival_and_stale_input_refuse(self):
        person=self.encounter()['person']['id'];before=self.runtime.snapshot()
        for args,ctx in [({'identity':person,'destination':'BRA'},self.known_context(person,'travel')),({'identity':person},self.known_context(person,'travel'))]:
            with self.assertRaises(self.m.PopulationRefused):self.call('travel',args,ctx)
            self.assertEqual(before,self.runtime.snapshot())
    def test_snapshot_and_idempotency_preserve_exact_real_ledger(self):
        request={'request_id':'exact','expected_revision':0,'operation':'encounter','arguments':{'key':'fixture'}};ctx=self.context()
        first=self.runtime.apply(ctx,request);state=self.runtime.snapshot();self.runtime=self.m.PopulationRuntime.restore(state)
        self.assertEqual(self.runtime.apply(ctx,request),first);self.assertEqual(self.runtime.snapshot(),state)
        with self.assertRaises(self.m.PopulationRefused):self.runtime.apply(self.context(capabilities=[]),request)
        changed=copy.deepcopy(state);changed['ledger_snapshot']+='bad'
        with self.assertRaises(self.m.PopulationRefused):self.m.PopulationRuntime.restore(changed)
        changed=copy.deepcopy(request);changed['arguments']['key']='changed'
        with self.assertRaises(self.m.PopulationRefused):self.runtime.apply(ctx,changed)

    def test_restore_reconciles_each_encounter_with_real_ledger(self):
        identity=self.encounter()['person']['id'];original=self.runtime.snapshot()
        for key,value in [('active',False),('present_country','BRA'),('world_actor_id','population:USA:wrong')]:
            changed=copy.deepcopy(original);changed['encounters'][identity][key]=value
            changed['checksum']=self.m.digest({k:v for k,v in changed.items() if k!='checksum'})
            with self.assertRaises(self.m.PopulationRefused,msg=key):self.m.PopulationRuntime.restore(changed)
        self.assertEqual(original,self.runtime.snapshot())

    def test_restore_refuses_malformed_or_inconsistent_replay_records(self):
        self.encounter();original=self.runtime.snapshot();cache=next(iter(original['requests']))
        changes=[lambda s:s['requests'][cache].update(response={'status':'FORGED'}),
                 lambda s:s['requests'][cache]['response'].update(revision=0),
                 lambda s:s['requests'][cache]['response']['person'].update(fidelity='Persistent'),
                 lambda s:s['requests'][cache]['response']['witness'].update(actor='other')]
        for mutation in changes:
            changed=copy.deepcopy(original);mutation(changed);changed['checksum']=self.m.digest({k:v for k,v in changed.items() if k!='checksum'})
            with self.assertRaises(self.m.PopulationRefused):self.m.PopulationRuntime.restore(changed)

if __name__=='__main__':unittest.main()
