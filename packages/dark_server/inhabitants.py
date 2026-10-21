"""World realization/demotion of bounded source-cohort NPCs through the C# ledger."""
import copy
from .population_runtime import PopulationRuntime,PopulationRefused,capability


def initialize(content):
    if content.get('population')!='wb2024':return {}
    from .world import require
    slots=content.get('population_spawns')
    require(isinstance(slots,list) and 1<=len(slots)<=256 and len(slots)==len(set(slots)) and
        all(isinstance(s,str) and s in content['nodes'] and content['nodes'][s]['ready'] for s in slots),'POPULATION_SPAWNS','explicit local fictional spawn nodes required')
    try:return {'population':PopulationRuntime.create().snapshot(),'population_archive':{}}
    except PopulationRefused as exc:raise_error(exc)


def raise_error(exc):
    from .world import Refused
    raise Refused('POPULATION_'+exc.code,exc.witness,'HD-28') from exc


def observe(state):
    if 'population' not in state:return None
    return {'metrics':copy.deepcopy(state['population']['metrics']),'source_epoch':2024,
        'authored_cast_outside_demographic_ledger':sum(a['controller']=='npc' and 'population_identity' not in a for a in state['actors'].values()),
        'realization':'bounded synthetic source-cohort NPCs; no real-person coordinate claim',
        'residual':'WLD_UNASSIGNED remains nonspatial','global_street_coverage_complete':False}


def act(world,state,principal,operation,args):
    from .world import World,require,actor_record,distance_m,identifier
    from .mechanics import nodes
    from .geography import GeographyService,GeographyRefused
    World._fields(args,('key',) if operation=='encounter_population' else ('identity',))
    require('population' in state,'POPULATION_UNAVAILABLE','no source-backed population admitted in this world')
    actor=state['actors'][principal['actor']];chart=nodes(state)
    require(not state.get('plate_transition'),'TRANSITION_BUSY','finish admitted chart transport first')
    try:
        if world._population_geography is None:world._population_geography=GeographyService(world.resource_root)
        country=world._population_geography.country(actor['position']['lat'],actor['position']['lon'])
        runtime=PopulationRuntime.restore(state['population'])
        target=None;node=None
        if operation=='encounter_population':
            identifier(args['key']);op='encounter';caps=['population:encounter']
            existing=next((r for r in state['population']['encounters'].values() if r['owner']==actor['id'] and r['key']==args['key']),None)
            if existing:
                stored=state['actors'].get(existing['world_actor_id']) or state['population_archive'].get(existing['world_actor_id'])
                require(stored is not None,'POPULATION_CONTINUITY','introduced actor must retain detailed state')
                node=stored['node']
            else:
                available=[(distance_m(actor['position'],chart[n]),n) for n in state['content']['population_spawns']
                    if not any(distance_m(a['position'],chart[n])<1.2 for a in state['actors'].values())]
                nearby=sorted((d,n) for d,n in available if d<=25)
                require(bool(nearby),'POPULATION_SPAWN_BUSY','no free admitted nearby population slot')
                node=nearby[0][1]
                require(world._population_geography.country(chart[node]['lat'],chart[node]['lon'])==country,'POPULATION_BORDER','spawn must resolve to the same source economy')
        else:
            identity=args['identity'];record=state['population']['encounters'].get(identity)
            require(record is not None and record['owner']==actor['id'],'POPULATION_OWNER','only an owned introduced identity')
            op='demote' if operation=='dismiss_population' else 'promote';caps=[capability(identity,op)]
            target=state['actors'].get(record['world_actor_id']) or state['population_archive'].get(record['world_actor_id'])
            require(target is not None,'POPULATION_CONTINUITY','detailed actor state must exist')
            node=target['node']
            if op=='demote':
                require(not target['vehicle'] and target['id'] not in state['journeys'] and not target.get('manual'),'POPULATION_BUSY','no active movement or attachment may be demoted')
                require(not any(a['controller']!='npc' and distance_m(a['position'],target['position'])<=60 for a in state['actors'].values()),'POPULATION_OBSERVED','leave all participant interest regions before demotion')
            else:require(node in chart and not any(distance_m(a['position'],target['position'])<1.2 for a in state['actors'].values()),'POPULATION_SPAWN_BUSY','prior admitted placement must be free')
        context={'actor':actor['id'],'tick':state['tick'],'country':country,
            'position':copy.deepcopy(chart[node]) if op=='encounter' else actor['position'],
            'spawn_ready':node in chart and chart[node]['ready'],'capabilities':caps,'safe_to_demote':op=='demote'}
        context['position']={k:context['position'].get(k,0) for k in ('lat','lon','alt')}
        result=runtime.apply(context,{'request_id':'world:'+str(state['revision']),'expected_revision':runtime.revision,'operation':op,'arguments':args})
        if result['spawn']:
            require(len(state['actors'])<256,'ACTIVE_BUDGET','active actor budget')
            spawn=result['spawn'];key=spawn['world_actor_id']
            require(key not in state['actors'] and key not in state['vehicles'],'IDENTITY_COLLISION','source-cohort actor identity collision')
            if op=='promote':
                saved=state['population_archive'].pop(key);state['actors'][key]=saved
                # Dormant detailed time is not silently simulated. Resume the
                # retained policy at the current host tick, with explicit gap.
                saved['dormant_seconds']=state['tick']-saved['npc_logic']['tick'];saved['npc_logic']['tick']=state['tick']
            else:
                seed=int(spawn['policy_seed'],16)
                state['actors'][key]=actor_record(key,{'node':node,'controller':'npc','sociability':(seed%61+20)/100,
                    'duty':((seed//61)%61+20)/100,'goal':'explore'},chart)
                state['actors'][key]['population_identity']=spawn['identity']
        if result['retire']:
            key=result['retire']['world_actor_id'];state['population_archive'][key]=state['actors'].pop(key)
        state['population']=runtime.snapshot()
        return {'witness':result['witness'],'person':result['person'],'metrics':result['metrics'],
            'spawn':result['spawn'],'retire':result['retire'],'source_person_position':None}
    except PopulationRefused as exc:raise_error(exc)
    except GeographyRefused as exc:
        from .world import Refused
        raise Refused('GEOGRAPHY_'+exc.code,exc.witness) from exc
