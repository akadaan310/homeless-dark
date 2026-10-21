"""Admit deterministic NPC proposals into World; policies have no independent IO."""
from . import decisions,mechanics


def initialize(actor,definition,nodes):
    from .world import require,Refused
    if actor['controller']!='npc':return
    schedule=definition.get('schedule',{})
    require(isinstance(schedule,dict) and set(schedule)<={'roles','work_window'},'NPC_SCHEDULE','bounded schedule definition')
    roles=schedule.get('roles',{k:actor['node'] for k in ('home','work','social')})
    try:
        actor['npc_logic']=decisions.initialize(actor['id'],roles,nodes,work_window=schedule.get('work_window',(28800,61200)),
            traits={'duty':round(actor['duty']*100),'sociability':round(actor['sociability']*100)})
        actor['npc_witness']=None
    except decisions.DecisionRefused as exc:raise Refused('NPC_'+exc.code,exc.witness,'HD-29') from exc


def propose(world,state,actor,interaction=None):
    from .world import distance_m,Refused
    chart=mechanics.nodes(state);trip=state['journeys'].get(actor['vehicle'] or actor['id'])
    node=actor['node'] or (trip['route'][trip['segment']] if trip else actor['npc_logic']['roles']['home'])
    nearby=sorted(a['id'] for a in state['actors'].values() if a['id']!=actor['id'] and distance_m(a['position'],actor['position'])<=25)[:32]
    observed=[]
    for place in sorted(set(actor['npc_logic']['roles'].values())):
        d=distance_m(actor['position'],chart[place]);value='open' if chart[place]['ready'] else 'closed'
        prior=actor['npc_logic']['beliefs'].get(place)
        if d<=25 and (prior is None or prior['value']!=value):
            observed.append({'id':'node:'+str(state['revision'])+':'+str(state['tick'])+':'+place,
                'kind':'node_access','node':place,'value':value,'tick':state['tick'],'distance_m':d})
    activity='travel' if trip else 'rest' if actor['stance']=='sitting' else actor['goal'] if actor['goal'] in ('rest','work','socialize') else 'idle'
    context={'tick':state['tick'],'node':node,'activity':activity,'pending_trip':bool(trip),
        'world_revision':state['revision'],'observations':observed,'nearby':nearby}
    if interaction:context['interaction']=interaction
    try:result=decisions.propose(actor['npc_logic'],context,chart)
    except decisions.DecisionRefused as exc:raise Refused('NPC_'+exc.code,exc.witness,'HD-29') from exc
    # Computation and commit run under the same World BEGIN IMMEDIATE lock.
    actor['npc_logic']=result['candidate_state'];actor['npc_witness']=result['witness']
    actor['decisions']=actor['npc_logic']['decision_count']
    actor['needs']={'rest':actor['npc_logic']['needs']['fatigue']/1000,'company':actor['npc_logic']['needs']['company']/1000}
    action=result['action'];kind=action['type']
    if kind=='travel':
        principal={'actor':actor['id'],'role':'member','scopes':'[]'}
        try:world._act(state,principal,'travel',{'destination':action['destination'],'mode':'walk'})
        except Refused as exc:actor['npc_witness']['world_admission_refused']=exc.as_dict()
        else:actor['goal']=action['purpose']
    elif kind in ('rest','work','socialize'):
        actor['goal']=kind;actor['stance']='sitting' if kind=='rest' else 'standing'
        if actor['decisions']==1 or actor['decisions']%5==0:world._say(state,actor,kind,nearby[0] if nearby else None)
    return result
