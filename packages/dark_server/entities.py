"""Life admission in the sole World transaction; no independent effect authority."""
import copy
import hashlib
import json
from .life import LifeRegistry,LifeRefused,capability


def initialize(content):
    if 'life' not in content:return {}
    from .world import require,finite
    spec=content['life']
    require(isinstance(spec,dict) and set(spec)=={'definitions','placements','public_abilities'},'LIFE_CONTENT','typed Life content required')
    try:registry=LifeRegistry.create(spec['definitions'])
    except LifeRefused as exc:raise_error(exc)
    require(set(spec['placements'])==set(registry.ids()) and set(spec['public_abilities'])<=set(registry.ids()),'LIFE_CONTENT','complete placements required')
    for entity,place in spec['placements'].items():
        require(isinstance(place,dict) and set(place) in ({'node','radius_m'},{'vehicle','radius_m'}),'LIFE_PLACEMENT','node or vehicle required')
        require(finite(place['radius_m']) and 0<place['radius_m']<=25,'LIFE_RADIUS','local interaction radius maximum25m')
        require(place.get('node') in content['nodes'] if 'node' in place else place.get('vehicle') in content.get('vehicles',{}),'LIFE_PLACEMENT','known location')
        abilities=spec['public_abilities'].get(entity,[])
        require(isinstance(abilities,list) and len(abilities)<=16 and all(isinstance(a,str) and a in registry.inspect(entity)['affordances'] and a not in ('observe','decide_entry','decide_ride','join','leave') for a in abilities),'LIFE_CAPABILITY','bounded public interactive abilities only')
    return {'life':registry.snapshot()}


def raise_error(exc):
    from .world import Refused
    raise Refused('LIFE_'+exc.code,exc.witness,'HD-11') from exc


def location(state,entity):
    from .mechanics import nodes
    place=state['content']['life']['placements'][entity]
    return copy.deepcopy(state['vehicles'][place['vehicle']]['position'] if 'vehicle' in place else nodes(state)[place['node']])


def observe(state,actor):
    from .world import distance_m,position
    if 'life' not in state:return {}
    result={}
    for key,life in state['life']['entities'].items():
        pos=position(location(state,key))
        if distance_m(actor['position'],pos)>60:continue
        place=state['content']['life']['placements'][key]
        # Participant identities, memories and ride destinations are private.
        public=copy.deepcopy(life['state'])
        for field in ('occupants','last_offer','members'):public.pop(field,None)
        result[key]={'id':key,'kind':life['kind'],'state':public,'position':pos,
            'abilities':state['content']['life']['public_abilities'].get(key,[])}
        if 'vehicle' in place:result[key]['vehicle']=place['vehicle']
        if len(result)==32:break
    return result


def act(state,principal,operation,args):
    from .world import require,canonical,distance_m,identifier,World
    from .mechanics import nodes
    required=('entity','ability','input') if operation=='entity_action' else ('entity','destination') if operation=='request_vehicle_ride' else ('entity',)
    World._fields(args,required);entity=identifier(args['entity'])
    require('life' in state and entity in state['life']['entities'],'LIFE_MISSING','no active entity at this identity')
    actor=state['actors'][principal['actor']];spec=state['content']['life'];place=spec['placements'][entity]
    require(distance_m(actor['position'],location(state,entity))<=place['radius_m'],'LIFE_RANGE','interaction outside admitted local range')
    registry=LifeRegistry.restore(state['life'])
    def apply(ability,arguments,scopes):
        request_id=hashlib.sha256(canonical([state['revision'],principal['actor'],registry.revision,operation,args,ability]).encode()).hexdigest()
        return registry.apply(actor['id'],scopes,{'request_id':request_id,'expected_revision':registry.revision,
            'entity_id':entity,'ability':ability,'arguments':arguments},state['tick'])
    try:
        if operation=='entity_action':
            ability=args['ability']
            require(isinstance(ability,str) and ability not in ('observe','decide_entry','decide_ride','join','leave'),'LIFE_ADAPTER','causal observations and self-membership require their host adapter')
            scopes=json.loads(principal['scopes'])
            if ability in spec['public_abilities'].get(entity,[]):scopes.append(capability(entity,ability))
            result=apply(ability,args['input'],scopes)
        else:
            kind='entry_request' if operation=='request_entry' else 'ride_request'
            ability='decide_entry' if operation=='request_entry' else 'decide_ride'
            expected='building' if operation=='request_entry' else 'car'
            require(registry.inspect(entity)['kind']==expected,'LIFE_KIND','request does not match entity type')
            payload={'visitor':actor['id']} if kind=='entry_request' else {'requester':actor['id'],'destination':identifier(args['destination'])}
            if kind=='ride_request':require(args['destination'] in nodes(state) and nodes(state)[args['destination']]['ready'],'DESTINATION_UNREADY','known route destination required')
            observation={'id':'world:'+str(state['revision'])+':'+str(registry.revision),'kind':kind,'subject':actor['id'],'tick':state['tick'],'payload':payload}
            # Only the admitted authenticated request creates this observation.
            apply('observe',{'observation':observation},[capability(entity,'observe')])
            result=apply(ability,{'visitor' if kind=='entry_request' else 'requester':actor['id']},[capability(entity,ability)])
        state['life']=registry.snapshot()
        return {'entity':entity,'witness':result['witness'],'host_causal_source':'authenticated local World action',
            'physical_validation':'NOT_RUN','control_transferred':False}
    except LifeRefused as exc:raise_error(exc)
