import copy,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'packages'))
from dark_server import decisions as d

class DecisionTests(unittest.TestCase):
    def setUp(self):
        self.nodes={n:{'ready':True} for n in ('home','work','cafe')}
        self.state=d.initialize('npc:ana',{'home':'home','work':'work','social':'cafe'},self.nodes,work_window=(100,200))
    def context(self,**kw):
        result={'tick':100,'node':'home','activity':'idle','pending_trip':False,'world_revision':7,'observations':[],'nearby':[]};result.update(kw);return result
    def test_actual_schedule_proposes_travel_and_work_without_mutation(self):
        before=copy.deepcopy(self.state);r=d.propose(self.state,self.context(),self.nodes)
        self.assertEqual(r['action'],{'type':'travel','destination':'work','purpose':'work'})
        self.assertEqual(self.state,before);self.assertFalse(r['authority_granted']);self.assertEqual(r['world_revision'],7)
        r=d.propose(r['candidate_state'],self.context(tick=101,node='work',activity='travel'),self.nodes)
        self.assertEqual(r['action']['type'],'work')
    def test_rest_overrides_work_and_midnight_schedule_wraps(self):
        self.state['needs']['fatigue']=850
        self.assertEqual(d.propose(self.state,self.context(),self.nodes)['action']['destination'],'home')
        s=d.initialize('npc:night',{'home':'home','work':'work','social':'cafe'},self.nodes,work_window=(80000,1000))
        self.assertEqual(d.propose(s,self.context(tick=100),self.nodes)['action']['purpose'],'work')
    def test_only_local_fresh_observations_change_belief_and_closed_goal_refuses(self):
        obs={'id':'obs:1','kind':'node_access','node':'work','value':'closed','tick':100,'distance_m':10}
        r=d.propose(self.state,self.context(observations=[obs]),self.nodes)
        self.assertEqual(r['action']['type'],'wait');self.assertEqual(r['witness']['refusal'],'destination_observed_closed')
        for bad in (dict(obs,distance_m=26),dict(obs,tick=101),dict(obs,node='unknown')):
            with self.assertRaises(d.DecisionRefused):d.propose(self.state,self.context(observations=[bad]),self.nodes)
    def test_actual_activity_and_elapsed_time_drive_needs_once(self):
        self.state['needs']={'fatigue':500,'company':500}
        a=d.propose(self.state,self.context(tick=30,activity='rest'),self.nodes)['candidate_state']
        self.assertEqual(a['needs']['fatigue'],410)
        b=d.propose(a,self.context(tick=30,activity='rest'),self.nodes)['candidate_state']
        self.assertEqual(a['needs'],b['needs'])
    def test_integer_budget_exhaustion_and_refill_are_atomic(self):
        self.state['budget']['remaining']=0;before=copy.deepcopy(self.state)
        r=d.propose(self.state,self.context(tick=10),self.nodes)
        self.assertEqual(r['action']['type'],'wait');self.assertEqual(r['witness']['refusal'],'decision_budget_exhausted');self.assertEqual(before,self.state)
        self.assertGreater(d.propose(self.state,self.context(tick=60),self.nodes)['candidate_state']['budget']['remaining'],0)
    def test_trip_is_not_replaced_and_unknown_destination_refuses(self):
        r=d.propose(self.state,self.context(pending_trip=True),self.nodes);self.assertEqual(r['action']['type'],'continue_travel')
        with self.assertRaises(d.DecisionRefused):d.initialize('npc:x',{'home':'home','work':'absent','social':'cafe'},self.nodes)
    def test_exact_asymmetric_mixed_nash_beats_both_baselines(self):
        r=d.solve_2x2([[3,0],[0,1]],[[0,2],[1,0]])
        self.assertEqual(r['selected']['row_probability_0'],{'numerator':1,'denominator':3})
        self.assertEqual(r['selected']['column_probability_0'],{'numerator':1,'denominator':4})
        self.assertEqual(r['selected']['max_regret'],0)
        self.assertGreater(r['baselines']['uniform']['max_regret'],0);self.assertGreater(r['baselines']['myopic']['max_regret'],0)
    def test_pure_equilibrium_strategic_duty_refusal_and_degenerate_ties(self):
        self.state=d.initialize('npc:ana',self.state['roles'],self.nodes,work_window=(100,200),traits={'duty':100,'sociability':50})
        r=d.propose(self.state,self.context(nearby=['member'],interaction={'kind':'ride_request','partner':'member','id':'ride:1'}),self.nodes)
        self.assertEqual(r['action']['decision'],'decline');self.assertEqual(r['witness']['game']['selected']['max_regret'],0)
        self.state=d.initialize('npc:ana',self.state['roles'],self.nodes,work_window=(100,200),traits={'duty':0,'sociability':50})
        r=d.propose(self.state,self.context(tick=20,nearby=['member'],interaction={'kind':'ride_request','partner':'member','id':'ride:1'}),self.nodes)
        self.assertEqual(r['action']['decision'],'offer')
        self.assertEqual(d.solve_2x2([[0,0],[0,0]],[[0,0],[0,0]])['selected']['max_regret'],0)
    def test_bad_values_are_typed_and_proposal_is_reproducible(self):
        for value in (True,float('nan'),10**1000):
            with self.assertRaises(d.DecisionRefused):d.solve_2x2([[value,0],[0,1]],[[0,1],[1,0]])
        before=copy.deepcopy(self.state)
        for context in (self.context(tick=-1),self.context(node='absent'),self.context(tick=True),self.context(nearby=[{}])):
            with self.assertRaises(d.DecisionRefused):d.propose(self.state,context,self.nodes)
        self.assertEqual(before,self.state)
        self.assertEqual(d.propose(self.state,self.context(),self.nodes),d.propose(self.state,self.context(),self.nodes))
    def test_observation_replay_conflict_and_state_provenance(self):
        obs={'id':'obs:1','kind':'node_access','node':'work','value':'open','tick':100,'distance_m':2}
        first=d.propose(self.state,self.context(observations=[obs]),self.nodes)['candidate_state']
        with self.assertRaises(d.DecisionRefused):d.propose(first,self.context(tick=101,observations=[dict(obs,value='closed')]),self.nodes)
        self.assertEqual(self.state['roles'],first['roles'])
        self.assertEqual(self.state['definition_sha256'],first['definition_sha256'])
    def test_seeded_exact_equilibria_obey_independent_deviation_check(self):
        import random
        from fractions import Fraction
        rng=random.Random(3471)
        for _ in range(128):
            a=[[rng.randrange(-5,6) for _ in range(2)] for _ in range(2)];b=[[rng.randrange(-5,6) for _ in range(2)] for _ in range(2)]
            result=d.solve_2x2(a,b)['selected'];p=Fraction(**result['row_probability_0']);q=Fraction(**result['column_probability_0'])
            row0=q*a[0][0]+(1-q)*a[0][1];row1=q*a[1][0]+(1-q)*a[1][1]
            col0=p*b[0][0]+(1-p)*b[1][0];col1=p*b[0][1]+(1-p)*b[1][1]
            self.assertEqual(max(row0,row1),p*row0+(1-p)*row1);self.assertEqual(max(col0,col1),q*col0+(1-q)*col1)
    def test_receipt_budget_and_mutated_beliefs_are_typed_refusals(self):
        state=self.state
        for tick in range(1,65):
            obs={'id':'obs:'+str(tick),'kind':'node_access','node':'work','value':'open','tick':tick,'distance_m':2}
            state=d.propose(state,self.context(tick=tick,observations=[obs]),self.nodes)['candidate_state']
        before=copy.deepcopy(state)
        with self.assertRaises(d.DecisionRefused):d.propose(state,self.context(tick=65,observations=[dict(obs,id='obs:65',tick=65)]),self.nodes)
        self.assertEqual(state,before)
        state['beliefs']['work']['value']='closed'
        with self.assertRaises(d.DecisionRefused):d.propose(state,self.context(tick=65),self.nodes)
if __name__=='__main__':unittest.main()
