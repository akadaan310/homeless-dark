"""Deterministic NPC proposals and an exact finite two-player Nash solver.

The World supplies admitted observations and actual activity, validates the
precondition/revision, routes travel, and commits candidate state. This module
never moves an actor, speaks, spends world currency, or grants a capability.
"""
import copy,hashlib,json,re
from fractions import Fraction as F

class DecisionRefused(Exception):
    def __init__(self,code,why):self.code=code;self.witness=why;super().__init__(code+': '+why)
    def as_dict(self):return {'status':'REFUSED','code':self.code,'witness':self.witness}
def need(ok,code,why):
    if not ok:raise DecisionRefused(code,why)
def identity(x):
    need(isinstance(x,str) and re.fullmatch(r'[A-Za-z0-9_:.-]{1,128}',x),'IDENTITY','bounded explicit identity');return x
def integer(x,lo,hi):return type(x) is int and lo<=x<=hi
def fields(x,required,optional=()):need(isinstance(x,dict) and set(required)<=set(x)<=set(required)|set(optional),'FIELDS','missing or unknown fields')
def digest(x):
    try:return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()).hexdigest()
    except (ValueError,TypeError,UnicodeError,RecursionError) as exc:raise DecisionRefused('ENCODING','finite JSON required') from exc
def ratio(x):return {'numerator':x.numerator,'denominator':x.denominator}
def _matrix(a):
    need(isinstance(a,list) and len(a)==2 and all(isinstance(r,list) and len(r)==2 and all(integer(v,-1000000,1000000) for v in r) for r in a),'GAME','bounded integer2x2 utilities');return [[F(v) for v in row] for row in a]
def _profile(a,b,p,q):
    rows=[q*r[0]+(1-q)*r[1] for r in a];cols=[p*b[0][j]+(1-p)*b[1][j] for j in range(2)]
    ua=p*rows[0]+(1-p)*rows[1];ub=q*cols[0]+(1-q)*cols[1]
    regrets=[max(rows)-ua,max(cols)-ub]
    return {'row_probability_0':ratio(p),'column_probability_0':ratio(q),'expected_utility_exact':[ratio(ua),ratio(ub)],
      'expected_utilities':[float(ua),float(ub)],'regret_exact':[ratio(v) for v in regrets],'regrets':[float(v) for v in regrets],
      'max_regret':float(max(regrets)),'support':'pure' if p in (0,1) and q in (0,1) else 'mixed'},ua+ub,regrets
def solve_2x2(row_utilities,column_utilities):
    """Enumerate pure profiles and exact indifference solutions, including ties.

    A2x2 equilibrium is pure, one-player indifferent along a boundary, or has
    both support sizes2. Candidate0,1,1/2 plus each exact indifference root
    covers all these cases; it need not enumerate every point in a continuum.
    """
    a=_matrix(row_utilities);b=_matrix(column_utilities);ps={F(0),F(1),F(1,2)};qs=set(ps)
    den=a[0][0]-a[0][1]-a[1][0]+a[1][1]
    if den:
        q=(a[1][1]-a[0][1])/den
        if 0<=q<=1:qs.add(q)
    den=b[0][0]-b[0][1]-b[1][0]+b[1][1]
    if den:
        p=(b[1][1]-b[1][0])/den
        if 0<=p<=1:ps.add(p)
    equilibria=[]
    for p in sorted(ps):
        for q in sorted(qs):
            profile,welfare,regrets=_profile(a,b,p,q)
            if max(regrets)==0:equilibria.append((welfare,p,q,profile))
    need(bool(equilibria),'SOLVER','no equilibrium witness found')
    equilibria.sort(key=lambda x:(-x[0],x[1],x[2]))
    p=F(1) if sum(a[0])>=sum(a[1]) else F(0)
    q=F(1) if b[0][0]+b[1][0]>=b[0][1]+b[1][1] else F(0)
    return {'schema':'dark.exact-nash2x2/1','row_utilities':copy.deepcopy(row_utilities),'column_utilities':copy.deepcopy(column_utilities),
      'algorithm':'exact rational support/indifference enumeration','selection':'maximum summed utility, then lexicographic probabilities',
      'selected':equilibria[0][3],'equilibria':[e[3] for e in equilibria],
      'baselines':{'uniform':_profile(a,b,F(1,2),F(1,2))[0],'myopic':_profile(a,b,p,q)[0]},
      'assumptions':['two players choose independently from two actions','utilities are supplied model values, not inferred human preferences'],
      'maximum_profiles_checked':16,'strategic_realism_claim':False}

def _definition(state):return {k:state[k] for k in ('npc_id','roles','work_window','traits')}
def _nodes(nodes):
    need(isinstance(nodes,dict) and 1<=len(nodes)<=10000,'NODES','bounded content-defined nodes')
    for key,row in nodes.items():identity(key);need(isinstance(row,dict) and type(row.get('ready')) is bool,'NODE','explicit readiness')
def initialize(npc_id,roles,nodes,tick=0,work_window=(28800,61200),traits=None):
    _nodes(nodes);identity(npc_id);fields(roles,('home','work','social'))
    need(all(isinstance(v,str) and v in nodes for v in roles.values()),'ROLES','every role binds a content-defined node')
    need(integer(tick,0,10**12) and isinstance(work_window,(list,tuple)) and len(work_window)==2 and all(integer(t,0,86399) for t in work_window) and work_window[0]!=work_window[1],'SCHEDULE','nonempty daily work interval')
    traits={'duty':60,'sociability':50} if traits is None else copy.deepcopy(traits);fields(traits,('duty','sociability'))
    need(all(integer(v,0,100) for v in traits.values()),'TRAITS','integer traits0..100')
    state={'schema':'dark.npc-state/1','npc_id':npc_id,'roles':copy.deepcopy(roles),'work_window':list(work_window),'traits':traits,
      'tick':tick,'needs':{'fatigue':250,'company':300},'remainders':{'fatigue':0,'company':0},
      'budget':{'remaining':100,'window_start':tick},'beliefs':{},'receipts':{},'decision_count':0}
    state['definition_sha256']=digest(_definition(state));return state
def _validate(state,nodes):
    fields(state,('schema','npc_id','roles','work_window','traits','tick','needs','remainders','budget','beliefs','receipts','decision_count','definition_sha256'))
    need(state['schema']=='dark.npc-state/1' and state['definition_sha256']==digest(_definition(state)),'STATE','definition fingerprint mismatch')
    initialize(state['npc_id'],state['roles'],nodes,state['tick'],state['work_window'],state['traits'])
    fields(state['needs'],('fatigue','company'));fields(state['remainders'],('fatigue','company'));fields(state['budget'],('remaining','window_start'))
    need(all(integer(v,0,1000) for v in state['needs'].values()) and integer(state['remainders']['fatigue'],0,19) and integer(state['remainders']['company'],0,9),'NEEDS','bounded integer needs and carry')
    need(integer(state['budget']['remaining'],0,100) and integer(state['budget']['window_start'],0,state['tick']) and integer(state['decision_count'],0,10**12),'BUDGET','integer simulation budget')
    need(isinstance(state['beliefs'],dict) and len(state['beliefs'])<=3 and isinstance(state['receipts'],dict) and len(state['receipts'])<=64,'MEMORY','bounded beliefs and causal receipts')
    for key,row in state['beliefs'].items():
        fields(row,('id','kind','node','value','tick','distance_m'));need(key in state['roles'].values() and row['node']==key,'BELIEF','bound role node')
        identity(row['id']);need(row['value'] in ('open','closed') and row['kind']=='node_access' and integer(row['tick'],0,state['tick']),'BELIEF','valid observed belief')
        need(type(row['distance_m']) in (int,float) and 0<=row['distance_m']<=25 and state['receipts'].get(row['id'])==digest(row),'BELIEF','local observation matches causal receipt')
    for key,value in state['receipts'].items():identity(key);need(isinstance(value,str) and re.fullmatch('[0-9a-f]{64}',value),'RECEIPT','observed input fingerprint')
    need(len(json.dumps(state))<=65536,'STATE_BUDGET','maximum64KiB NPC state')
def _propose(state,context,nodes):
    _nodes(nodes);_validate(state,nodes)
    fields(context,('tick','node','activity','pending_trip','world_revision','observations','nearby'),('interaction',))
    tick=context['tick'];need(integer(tick,state['tick'],min(10**12,state['tick']+600)),'CLOCK','advance0..600 trusted seconds per step')
    need(isinstance(context['node'],str) and context['node'] in nodes and context['activity'] in ('idle','rest','socialize','work','travel') and type(context['pending_trip']) is bool and integer(context['world_revision'],0,10**12),'ACTUAL','valid World activity/node/revision')
    need(isinstance(context['nearby'],list) and len(context['nearby'])<=32,'OBSERVATION','bounded nearby actors')
    for actor in context['nearby']:identity(actor)
    need(len(set(context['nearby']))==len(context['nearby']),'OBSERVATION','unique nearby identities')
    need(isinstance(context['observations'],list) and len(context['observations'])<=16,'OBSERVATION','at most16 admitted local observations')
    candidate=copy.deepcopy(state);elapsed=tick-state['tick'];candidate['tick']=tick
    for key,period,activity,rate in [('fatigue',20,'rest',3),('company',10,'socialize',4)]:
        if context['activity']==activity:candidate['needs'][key]=max(0,candidate['needs'][key]-rate*elapsed);candidate['remainders'][key]=0
        else:
            gain,rem=divmod(candidate['remainders'][key]+elapsed,period);candidate['needs'][key]=min(1000,candidate['needs'][key]+gain);candidate['remainders'][key]=rem
    causes=[]
    for observation in context['observations']:
        fields(observation,('id','kind','node','value','tick','distance_m'));identifier=identity(observation['id'])
        need(observation['kind']=='node_access' and isinstance(observation['node'],str) and observation['node'] in state['roles'].values() and observation['value'] in ('open','closed'),'OBSERVATION','known role node and typed access observation')
        distance=observation['distance_m'];need(type(distance) in (int,float) and 0<=distance<=25 and integer(observation['tick'],max(0,tick-300),tick),'OBSERVATION','fresh local observation within25m')
        signature=digest(observation);prior=candidate['receipts'].get(identifier)
        need(prior is None or prior==signature,'OBSERVATION_CONFLICT','causal identity reused with changed observation')
        need(prior is not None or len(candidate['receipts'])<64,'MEMORY_BUDGET','receipt capacity requires explicit World archival')
        candidate['receipts'][identifier]=signature;old=candidate['beliefs'].get(observation['node'])
        if old is None or (observation['tick'],identifier)>(old['tick'],old['id']):candidate['beliefs'][observation['node']]=copy.deepcopy(observation)
        causes.append(identifier)
    budget=candidate['budget']
    if tick-budget['window_start']>=60:budget['remaining']=100;budget['window_start']=tick
    start,end=state['work_window'];day=tick%86400;on_shift=start<=day<end if start<end else day>=start or day<end
    witness={'causal_observations':sorted(causes),'on_work_schedule':on_shift,'needs':copy.deepcopy(candidate['needs']),'budget_before':budget['remaining'],'cost':0,'physical_validation':'NOT_RUN'}
    if context['pending_trip']:action={'type':'continue_travel'};cost=1
    elif context.get('interaction') is not None:
        interaction=context['interaction'];fields(interaction,('id','kind','partner'));identity(interaction['id']);identity(interaction['partner'])
        need(interaction['kind']=='ride_request' and interaction['partner'] in context['nearby'],'INTERACTION','admitted nearby requester required')
        duty_cost=state['traits']['duty']//15+(4 if on_shift else 0)
        game=solve_2x2([[6-duty_cost,-1-duty_cost],[2,1]],[[5,0],[-2,2]])
        probability=game['selected']['row_probability_0'];p=F(probability['numerator'],probability['denominator'])
        draw=F(int(digest([state['npc_id'],tick,interaction['id']]),16),2**256)
        action={'type':'respond_ride','partner':interaction['partner'],'decision':'offer' if draw<p else 'decline','proposal_only':True}
        witness['game']=game;witness['sample_method']='deterministic identity/tick hash; expected strategy witness is distinct from this realized action';cost=5
    else:
        if candidate['needs']['fatigue']>=800:purpose='rest';destination=state['roles']['home']
        elif on_shift:purpose='work';destination=state['roles']['work']
        elif candidate['needs']['company']>=650 or state['traits']['sociability']>70:purpose='socialize';destination=state['roles']['social']
        else:purpose='rest';destination=state['roles']['home']
        belief=candidate['beliefs'].get(destination)
        if not nodes[destination]['ready'] or belief and tick-belief['tick']<=300 and belief['value']=='closed':
            action={'type':'wait'};cost=1;witness['refusal']='destination_unready' if not nodes[destination]['ready'] else 'destination_observed_closed'
        elif context['node']!=destination:action={'type':'travel','destination':destination,'purpose':purpose};cost=3
        else:action={'type':purpose,'destination':destination};cost=2 if purpose!='rest' else 1
    if budget['remaining']<cost:action={'type':'wait'};witness['refusal']='decision_budget_exhausted';cost=0
    budget['remaining']-=cost;candidate['decision_count']+=1;witness['cost']=cost;_validate(candidate,nodes)
    return {'schema':'dark.npc-proposal/1','npc_id':state['npc_id'],'tick':tick,'world_revision':context['world_revision'],
      'precondition_digest':digest({'state':state,'actual':context,'node_readiness':{k:nodes[k]['ready'] for k in sorted(set(state['roles'].values()))}}),
      'action':action,'candidate_state':candidate,'witness':witness,'authority_granted':False,'durable_commit_performed':False}
def propose(state,context,nodes):
    try:return _propose(state,context,nodes)
    except (KeyError,TypeError,ValueError,OverflowError,RecursionError,AttributeError) as exc:raise DecisionRefused('MALFORMED','invalid state or actual context') from exc
