"""Compact shared Life policies. Deterministic simulation, not independent intelligence.

No storage, renderer, network, wall clock, source-coordinate edits, or authentication.
The caller must admit capabilities/observations and commit snapshots in World transactions.
"""
import copy
import hashlib
import json
import math
import re

MAX_BYTES=1024*1024
MAX_ENTITIES=4096
MAX_EVENTS=1024
LIFE_FIELDS={'entity_id','kind','state','traits','memory','observations','relations','affordances','policy','capabilities','dynamics','schedule','budget','provenance'}

class LifeRefused(Exception):
    def __init__(self,code,witness):self.code=code;self.witness=str(witness);super().__init__(code+': '+self.witness)
    def as_dict(self):return {'status':'REFUSED','code':self.code,'witness':self.witness,'physical_validation':'NOT_RUN'}

def require(ok,code,witness):
    if not ok:raise LifeRefused(code,witness)

def canonical(value):
    try:return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
    except (ValueError,TypeError,RecursionError) as exc:raise LifeRefused('ENCODING','finite bounded JSON required') from exc

def encoded(value):
    try:return canonical(value).encode('utf-8')
    except UnicodeError as exc:raise LifeRefused('ENCODING','valid UTF-8 required') from exc

def digest(value):return hashlib.sha256(encoded(value)).hexdigest()

def name(value):
    require(isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9_:/.-]{1,128}',value),'IDENTITY','bounded explicit identity required')
    return value

def token(value):
    require(isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9_-]{1,64}',value),'TOKEN','bounded request or ability name required')
    return value

def finite(value,low,high):return type(value) in (int,float) and low<=value<=high and math.isfinite(value)

def fields(value,required=(),optional=()):
    require(isinstance(value,dict) and set(required)<=set(value)<=set(required)|set(optional),'FIELDS','unexpected or missing fields')

def capability(entity,ability):return 'life:'+name(entity)+':'+token(ability)

# argument descriptions are inspectable grammar; executable validators below enforce them.
_ABILITIES={
 'building':{'set_light':('reactive',2,5,{'level':'number 0..1'}),'decide_entry':('agentic',3,1,{'visitor':'actor ID'})},
 'tree':{'react_weather':('reactive',2,10,{}),'glow':('expressive',1,1,{'level':'number 0..0.2'})},
 'cup':{'nudge':('reactive',1,1,{'dx':'number -0.25..0.25 metres','dz':'number -0.25..0.25 metres'})},
 'car':{'decide_ride':('agentic',3,2,{'requester':'actor ID'}),'signal':('expressive',1,1,{'direction':'left|right|hazard|off'})},
 'star':{'twinkle':('expressive',1,1,{'magnitude_offset':'number -0.2..0.2'})},
 'group':{'join':('reactive',1,1,{'member':'self identity','role':'participant|observer'}),'leave':('reactive',1,1,{'member':'self identity'}),'propose_pattern':('agentic',2,2,{'pattern':'welcome|quiet'})},
}
_OBSERVATIONS={'building':{'entry_request':{'visitor':'id'}},'tree':{'weather':{'rain':'unit','heat':'unit'}},'cup':{},'car':{'ride_request':{'requester':'id','destination':'id'}},'star':{},'group':{}}
_DEFAULT_STATE={'building':{'light':0.,'door':'closed','capacity':10,'occupants':[]},'tree':{'moisture':.4,'glow':0.},'cup':{'offset_xz_m':[0.,0.]},
 'car':{'signal':'off','energy':1.,'last_offer':None},'star':{'magnitude_offset':0.},'group':{'members':{},'last_pattern':None}}
_DEFAULT_TRAITS={'building':{'welcoming':.6},'tree':{'expressiveness':.4},'cup':{'responsiveness':.5},'car':{'helpfulness':.5,'duty':.5},'star':{'expressiveness':.5},'group':{'exclusive':True}}

def subject_contracts():
    """Executable adapters expose every §12 field; method references are local, not arbitrary code."""
    result={}
    for kind,abilities in _ABILITIES.items():
        grammar={ability:dict(args) for ability,(_,_,_,args) in abilities.items()}
        grammar['observe']={'observation':'typed kind/subject/tick/payload with causal ID'}
        result[kind]={'id':'dark.life.'+kind,'version':1,'alphabet':sorted(grammar),'state':copy.deepcopy(_DEFAULT_STATE[kind]),'grammar':grammar,
          'contextual_ranking':{'method':'explicit deterministic rules','implementation':'LifeRegistry._effect','no_equilibrium_or_intelligence_claim':True},
          'denotation':{'layer':'synthetic simulation only','source_geometry':'immutable'},'transition':'LifeRegistry.apply',
          'projections':{'inspection':'LifeRegistry.inspect','effect':'result.witness.effect'},
          'invariants':['stable identity','source geometry unchanged','bounded memory/observations/events','monotonic trusted simulation tick','exact scoped authority'],
          'dependencies':['dark.life-state/1','caller-owned World transaction authority'],'effect_types':sorted({a[0] for a in abilities.values()}),
          'capability_requirements':'exact life:<entity-id>:<ability>; caller supplies currently admitted scopes',
          'clock':{'source':'caller authoritative simulation tick','wall_clock_reads':False},
          'resource_budget':{'entities':MAX_ENTITIES,'snapshot_bytes':MAX_BYTES,'events':MAX_EVENTS,'memory_per_entity':64,'observations_per_entity':64,'units_per_60_ticks':100,
            'abilities':{a:{'cost':v[1],'cooldown_ticks':v[2]} for a,v in abilities.items()}},
          'verifier':'LifeRegistry._validate_snapshot and typed ability validators','witness':'causal event with revision, actor, capability, prior hash, observation IDs and effect',
          'migration':{'schema':'dark.life-state/1','unsupported_schema':'typed refusal; no reseed'}}
    return result

class LifeRegistry:
    def __init__(self,state):self._state=state
    @classmethod
    def create(cls,definitions):
        require(isinstance(definitions,list) and 1<=len(definitions)<=MAX_ENTITIES,'ENTITY_BUDGET','1..4096 definitions')
        entities={}
        for definition in definitions:
            fields(definition,('id','kind','provenance'),('traits','state'))
            identifier=name(definition['id']);kind=definition['kind']
            require(isinstance(kind,str) and kind in _ABILITIES and identifier not in entities,'ARCHETYPE','known kind and unique identity required')
            traits=copy.deepcopy(_DEFAULT_TRAITS[kind]);overrides=definition.get('traits',{})
            require(isinstance(overrides,dict) and set(overrides)<=set(traits),'TRAITS','unsupported trait')
            traits.update(overrides)
            for key,value in traits.items():require(type(value) is bool if key=='exclusive' else finite(value,0,1),'TRAITS','trait outside domain')
            state=copy.deepcopy(_DEFAULT_STATE[kind]);initial=definition.get('state',{})
            # Only initial capacity can be configured; active state is generated by admitted effects.
            fields(initial,(),('capacity',) if kind=='building' else ())
            if 'capacity' in initial:
                require(type(initial['capacity']) is int and 1<=initial['capacity']<=64,'CAPACITY','capacity 1..64');state['capacity']=initial['capacity']
            provenance=copy.deepcopy(definition['provenance'])
            fields(provenance,('source_id','source_geometry','geometry_status'))
            require(isinstance(provenance['source_id'],str) and isinstance(provenance['geometry_status'],str) and len(encoded(provenance))<=4096,'PROVENANCE','bounded explicit provenance required')
            provenance['source_geometry_sha256']=digest(provenance['source_geometry'])
            abilities=_ABILITIES[kind]
            entities[identifier]={'entity_id':identifier,'kind':kind,'state':state,'traits':traits,'memory':[],'observations':[],'relations':{'member_of':[]},
              'affordances':sorted(list(abilities)+['observe']),'policy':'dark.life.'+kind+'/1','capabilities':sorted({a[0] for a in abilities.values()}),
              'dynamics':{'next_allowed':{},'consumed_observations':[]},'schedule':{'phase':'coarse synthetic; no uncomputed detailed life'},
              'budget':{'remaining':100,'window_start':0,'limit':100,'window_ticks':60},'provenance':provenance}
        state={'schema':'dark.life-state/1','revision':0,'tick':0,'entities':dict(sorted(entities.items())),'events':[],'requests':{},'head':digest({'entities':entities,'schema':'dark.life-genesis/1'})}
        state['genesis']=state['head'];result=cls(state);result._validate_snapshot();return result
    @classmethod
    def restore(cls,state):
        require(isinstance(state,dict),'SNAPSHOT','snapshot object required')
        require(len(encoded(state))<=MAX_BYTES,'STATE_BUDGET','maximum1MiB')
        try:
            result=cls(copy.deepcopy(state));result._validate_snapshot()
        except (KeyError,TypeError,ValueError,OverflowError,AttributeError,RecursionError) as exc:raise LifeRefused('SNAPSHOT','malformed state fields') from exc
        return result
    @property
    def revision(self):return self._state['revision']
    def ids(self):return tuple(sorted(self._state['entities']))
    def inspect(self,entity):
        name(entity);require(entity in self._state['entities'],'ENTITY_MISSING',entity)
        return copy.deepcopy(self._state['entities'][entity])
    def snapshot(self):return copy.deepcopy(self._state)
    def _validate_snapshot(self):
        state=self._state;fields(state,('schema','revision','tick','entities','events','requests','head','genesis'))
        require(state['schema']=='dark.life-state/1' and type(state['revision']) is int and type(state['tick']) is int and state['revision']>=0 and state['tick']>=0,'SNAPSHOT_SCHEMA','version or clock')
        require(len(encoded(state))<=MAX_BYTES,'STATE_BUDGET','maximum1MiB')
        require(isinstance(state['entities'],dict) and 1<=len(state['entities'])<=MAX_ENTITIES and isinstance(state['events'],list) and len(state['events'])<=MAX_EVENTS and isinstance(state['requests'],dict) and len(state['requests'])<=MAX_EVENTS,'STATE_BUDGET','entity/history limits')
        for key,life in state['entities'].items():
            name(key);require(isinstance(life,dict) and set(life)==LIFE_FIELDS and life['entity_id']==key and isinstance(life['kind'],str) and life['kind'] in _ABILITIES,'ENTITY_SCHEMA','identity or life fields')
            kind=life['kind'];typed=life['state'];traits=life['traits']
            require(isinstance(typed,dict) and set(typed)==set(_DEFAULT_STATE[kind]) and isinstance(traits,dict) and set(traits)==set(_DEFAULT_TRAITS[kind]),'ARCHETYPE_STATE','known state and trait fields')
            for trait,value in traits.items():require(type(value) is bool if trait=='exclusive' else finite(value,0,1),'TRAITS','valid stable trait')
            if kind=='building':
                require(finite(typed['light'],0,1) and typed['door'] in ('open','closed') and type(typed['capacity']) is int and 1<=typed['capacity']<=64 and isinstance(typed['occupants'],list) and len(typed['occupants'])<=typed['capacity'] and len(set(typed['occupants']))==len(typed['occupants']),'BUILDING_STATE','bounded capacity and light')
            elif kind=='tree':require(finite(typed['moisture'],0,1) and finite(typed['glow'],0,.2),'TREE_STATE','moisture/glow domain')
            elif kind=='cup':require(isinstance(typed['offset_xz_m'],list) and len(typed['offset_xz_m'])==2 and all(finite(v,-1,1) for v in typed['offset_xz_m']) and math.hypot(*typed['offset_xz_m'])<=1,'CUP_STATE','bounded synthetic offset')
            elif kind=='car':require(typed['signal'] in ('left','right','hazard','off') and finite(typed['energy'],0,1) and (typed['last_offer'] is None or isinstance(typed['last_offer'],dict)),'CAR_STATE','signal/energy domain')
            elif kind=='star':require(finite(typed['magnitude_offset'],-.2,.2),'STAR_STATE','bounded synthetic expression')
            elif kind=='group':
                require(isinstance(typed['members'],dict) and len(typed['members'])<=128 and typed['last_pattern'] in (None,'welcome','quiet'),'GROUP_STATE','bounded membership/pattern')
                for member,role in typed['members'].items():
                    require(member in state['entities'] and role in ('participant','observer') and key in state['entities'][member]['relations']['member_of'],'MEMBERSHIP','reciprocal member relation')
            fields(life['dynamics'],('next_allowed','consumed_observations'))
            require(isinstance(life['dynamics']['next_allowed'],dict) and all(k in life['affordances'] and type(v) is int and v>=0 for k,v in life['dynamics']['next_allowed'].items()) and isinstance(life['dynamics']['consumed_observations'],list) and len(life['dynamics']['consumed_observations'])<=64,'DYNAMICS','bounded cooldown/causal state')
            budget=life['budget'];fields(budget,('remaining','window_start','limit','window_ticks'))
            require(all(type(v) is int for v in budget.values()) and budget['limit']==100 and budget['window_ticks']==60 and 0<=budget['remaining']<=100 and 0<=budget['window_start']<=state['tick'],'RESOURCE_BUDGET','valid source-independent simulation budget')
            require(digest(life['provenance']['source_geometry'])==life['provenance']['source_geometry_sha256'],'SOURCE_MUTATION','source geometry fingerprint mismatch')
            require(isinstance(life['memory'],list) and len(life['memory'])<=64 and isinstance(life['observations'],list) and len(life['observations'])<=64,'MEMORY_BUDGET','bounded causal history')
            observed=set()
            for observation in life['observations']:
                fields(observation,('id','kind','subject','tick','payload','admitted_by','admission_tick','source_kind'))
                identifier=name(observation['id']);name(observation['subject']);name(observation['admitted_by'])
                require(identifier not in observed and isinstance(observation['kind'],str) and observation['kind'] in _OBSERVATIONS[kind],'OBSERVATION_KIND','unique supported typed observations')
                observed.add(identifier)
                require(type(observation['tick']) is int and type(observation['admission_tick']) is int and 0<=observation['tick']<=observation['admission_tick']<=state['tick'] and observation['source_kind']=='caller_reported; World must validate provenance','OBSERVATION_TIME','admitted causal time and source')
                grammar=_OBSERVATIONS[kind][observation['kind']];fields(observation['payload'],grammar)
                for field,domain in grammar.items():
                    if domain=='id':name(observation['payload'][field])
                    else:require(finite(observation['payload'][field],0,1),'OBSERVATION_VALUE','unit interval required')
                if observation['kind'] in ('entry_request','ride_request'):
                    require(observation['subject']==observation['payload']['visitor' if observation['kind']=='entry_request' else 'requester'],'OBSERVATION_SUBJECT','participant mismatch')
            for memory in life['memory']:
                fields(memory,('event','revision','ability','causal_observations'))
                require(isinstance(memory['event'],str) and re.fullmatch('[0-9a-f]{64}',memory['event']) and type(memory['revision']) is int and 1<=memory['revision']<=state['revision'] and isinstance(memory['ability'],str) and memory['ability'] in _ABILITIES[kind] and isinstance(memory['causal_observations'],list) and all(c in observed for c in memory['causal_observations']),'MEMORY','valid causal event references')
            require(all(isinstance(c,str) and c in observed for c in life['dynamics']['consumed_observations']) and len(set(life['dynamics']['consumed_observations']))==len(life['dynamics']['consumed_observations']),'DYNAMICS','unique consumed observation references')
            require(life['policy']=='dark.life.'+life['kind']+'/1','POLICY','shared policy required')
            require(isinstance(life['relations'],dict) and set(life['relations'])=={'member_of'} and len(life['relations']['member_of'])<=16,'RELATION_BUDGET','sparse memberships')
            for group_id in life['relations']['member_of']:
                require(group_id in state['entities'] and state['entities'][group_id]['kind']=='group' and key in state['entities'][group_id]['state']['members'],'MEMBERSHIP','reciprocal group relation required')
        previous=state['genesis']
        for index,event in enumerate(state['events'],1):
            fields(event,('revision','tick','actor','entity_id','ability','request_id','capability','causal_observations','effect','cost','previous','source_geometry_sha256','hash'))
            require(event.get('revision')==index and event.get('previous')==previous,'HISTORY','event sequence')
            unsigned={k:v for k,v in event.items() if k!='hash'}
            require(digest(unsigned)==event.get('hash'),'HISTORY','event hash');previous=event['hash']
        require(len(state['events'])==state['revision'] and previous==state['head'],'HISTORY','head/revision mismatch')
        require(len(state['requests'])==state['revision'],'HISTORY','one cached request per transition')
        for key,cached in state['requests'].items():
            require(isinstance(key,str),'REQUEST_CACHE','cache key');fields(cached,('request_hash','response'))
            require(isinstance(cached['request_hash'],str) and re.fullmatch('[0-9a-f]{64}',cached['request_hash']),'REQUEST_CACHE','request digest')
            response=cached['response'];fields(response,('status','revision','witness','authority_granted','physical_validation','durable_commit_performed'))
            revision=response['revision'];require(type(revision) is int and 1<=revision<=state['revision'] and response['witness']==state['events'][revision-1] and response['status']=='PROPOSED' and response['authority_granted'] is False and response['durable_commit_performed'] is False and response['physical_validation']=='NOT_RUN','REQUEST_CACHE','cached response matches event')
    def apply(self,actor,capabilities,request,tick):
        actor=name(actor);fields(request,('request_id','expected_revision','entity_id','ability','arguments'))
        request_id=token(request['request_id']);entity=name(request['entity_id']);ability=token(request['ability'])
        require(type(tick) is int and tick>=self._state['tick'],'CLOCK','trusted tick cannot go backwards')
        require(type(request['expected_revision']) is int and request['expected_revision']>=0 and isinstance(request['arguments'],dict),'REQUEST','revision and arguments')
        require(len(encoded(request))<=8192,'REQUEST_BUDGET','maximum8192UTF8bytes')
        require(isinstance(capabilities,(list,tuple,set)) and len(capabilities)<=256 and all(isinstance(c,str) and len(c)<=256 for c in capabilities),'CAPABILITIES','bounded admitted scopes')
        required=capability(entity,ability);require(required in capabilities,'CAPABILITY','exact current scope required')
        key=canonical([actor,request_id]);fingerprint=digest(request)
        prior=self._state['requests'].get(key)
        if prior:
            require(prior['request_hash']==fingerprint,'REQUEST_CONFLICT','request ID reused with changed input')
            return copy.deepcopy(prior['response'])
        require(request['expected_revision']==self.revision,'STALE_REVISION','revalidate current Life state')
        require(entity in self._state['entities'],'ENTITY_MISSING',entity)
        require(len(self._state['events'])<MAX_EVENTS,'HISTORY_BUDGET','archive through world operator before additional history')
        proposal=copy.deepcopy(self._state);life=proposal['entities'][entity];kind=life['kind']
        require(ability=='observe' or ability in _ABILITIES[kind],'UNSUPPORTED_ABILITY','typed ability unavailable')
        _,cost,cooldown,_=('reactive',1,0,{}) if ability=='observe' else _ABILITIES[kind][ability]
        require(tick>=life['dynamics']['next_allowed'].get(ability,0),'COOLDOWN','ability not ready')
        budget=life['budget']
        if tick-budget['window_start']>=budget['window_ticks']:
            budget['remaining']=budget['limit'];budget['window_start']=tick
        require(budget['remaining']>=cost,'RESOURCE_BUDGET','insufficient simulation units')
        effect,causes=self._effect(proposal,life,actor,ability,request['arguments'],tick)
        budget['remaining']-=cost;life['dynamics']['next_allowed'][ability]=tick+cooldown
        revision=proposal['revision']+1
        event={'revision':revision,'tick':tick,'actor':actor,'entity_id':entity,'ability':ability,'request_id':request_id,'capability':required,
               'causal_observations':causes,'effect':effect,'cost':cost,'previous':proposal['head'],'source_geometry_sha256':life['provenance']['source_geometry_sha256']}
        event['hash']=digest(event)
        if ability!='observe':
            require(len(life['memory'])<64,'MEMORY_BUDGET','persistent memory full; no silent eviction')
            life['memory'].append({'event':event['hash'],'revision':revision,'ability':ability,'causal_observations':causes})
        proposal['revision']=revision;proposal['tick']=tick;proposal['events'].append(event);proposal['head']=event['hash']
        response={'status':'PROPOSED','revision':revision,'witness':event,'authority_granted':False,'physical_validation':'NOT_RUN','durable_commit_performed':False}
        proposal['requests'][key]={'request_hash':fingerprint,'response':response}
        candidate=LifeRegistry(proposal);candidate._validate_snapshot();self._state=proposal
        return copy.deepcopy(response)
    @staticmethod
    def _recent(life,kind,tick,field=None,value=None):
        items=[o for o in life['observations'] if o['kind']==kind and (field is None or o['payload'].get(field)==value)]
        require(bool(items),'NO_CAUSAL_OBSERVATION','permitted matching observation required')
        result=max(items,key=lambda o:(o['tick'],o['admission_tick'],o['id']))
        require(tick-result['tick']<=300,'OBSERVATION_STALE','causal observation older than300ticks')
        return result
    @staticmethod
    def _effect(world,life,actor,ability,args,tick):
        kind=life['kind'];state=life['state'];traits=life['traits'];causes=[]
        if ability=='observe':
            fields(args,('observation',));observation=copy.deepcopy(args['observation'])
            fields(observation,('id','kind','subject','tick','payload'));name(observation['id']);name(observation['subject'])
            require(isinstance(observation['kind'],str) and observation['kind'] in _OBSERVATIONS[kind],'OBSERVATION_KIND','unsupported typed observation')
            require(type(observation['tick']) is int and 0<=observation['tick']<=tick,'OBSERVATION_TIME','future or invalid observation')
            grammar=_OBSERVATIONS[kind][observation['kind']];fields(observation['payload'],grammar)
            for key,domain in grammar.items():
                if domain=='id':name(observation['payload'][key])
                else:require(finite(observation['payload'][key],0,1),'OBSERVATION_VALUE','unit interval required')
            if observation['kind'] in ('entry_request','ride_request'):
                person=observation['payload']['visitor' if observation['kind']=='entry_request' else 'requester']
                require(observation['subject']==person,'OBSERVATION_SUBJECT','request source subject must match participant')
            require(not any(o['id']==observation['id'] for o in life['observations']),'OBSERVATION_DUPLICATE','causal event already recorded')
            require(len(life['observations'])<64,'OBSERVATION_BUDGET','observation history full; no silent eviction')
            observation['admitted_by']=actor;observation['admission_tick']=tick;observation['source_kind']='caller_reported; World must validate provenance'
            life['observations'].append(observation)
            return {'type':'recorded_observation','observation_id':observation['id']},[observation['id']]
        grammar=_ABILITIES[kind][ability][3];fields(args,grammar)
        if kind=='building' and ability=='set_light':
            require(finite(args['level'],0,1),'LIGHT','level0..1');state['light']=args['level'];return {'type':'synthetic_light','level':state['light']},causes
        if kind=='building' and ability=='decide_entry':
            visitor=name(args['visitor']);require(visitor==actor,'CONSENT','visitor must act for self')
            observation=LifeRegistry._recent(life,'entry_request',tick,'visitor',visitor);causes=[observation['id']]
            already=visitor in state['occupants'];allowed=already or traits['welcoming']>=.5 and len(state['occupants'])<state['capacity']
            if allowed and not already:state['occupants'].append(visitor)
            state['door']='open' if allowed else 'closed'
            return {'type':'entry_decision','visitor':visitor,'decision':'allow' if allowed else 'decline','reason':'already_present' if already else 'capacity_and_policy' if allowed else 'capacity_or_private_policy','fictional_permission_only':True},causes
        if kind=='tree' and ability=='react_weather':
            observation=LifeRegistry._recent(life,'weather',tick);payload=observation['payload'];causes=[observation['id']]
            require(observation['id'] not in life['dynamics']['consumed_observations'],'OBSERVATION_CONSUMED','weather event already applied')
            life['dynamics']['consumed_observations'].append(observation['id'])
            state['moisture']=max(0.,min(1.,state['moisture']+.3*payload['rain']-.01*payload['heat']))
            return {'type':'moisture_response','moisture':state['moisture']},causes
        if kind=='tree' and ability=='glow':
            require(finite(args['level'],0,.2),'GLOW','level0..0.2');state['glow']=args['level']*(.5+.5*traits['expressiveness']);return {'type':'synthetic_canopy_glow','level':state['glow']},causes
        if kind=='cup':
            dx,dz=args['dx'],args['dz'];require(finite(dx,-.25,.25) and finite(dz,-.25,.25) and math.hypot(dx,dz)<=.25,'NUDGE','bounded local displacement')
            offset=[state['offset_xz_m'][0]+dx*traits['responsiveness'],state['offset_xz_m'][1]+dz*traits['responsiveness']];require(math.hypot(*offset)<=1,'OFFSET_BUDGET','maximum1m fictional offset')
            state['offset_xz_m']=offset;return {'type':'synthetic_kinematic_offset','offset_xz_m':offset,'collision_validated':False},causes
        if kind=='car' and ability=='decide_ride':
            requester=name(args['requester']);require(requester==actor,'CONSENT','requester must act for self')
            observation=LifeRegistry._recent(life,'ride_request',tick,'requester',requester);causes=[observation['id']]
            offer=traits['helpfulness']>traits['duty'] and state['energy']>=.2
            state['last_offer']={'requester':requester,'destination':observation['payload']['destination'],'decision':'offer' if offer else 'decline'}
            return dict(state['last_offer'],type='ride_proposal',proposal_only=True,player_control_changed=False,reason='bounded utility and energy policy'),causes
        if kind=='car' and ability=='signal':
            require(args['direction'] in ('left','right','hazard','off'),'SIGNAL','known signal');state['signal']=args['direction'];return {'type':'vehicle_signal','direction':state['signal']},causes
        if kind=='star':
            require(finite(args['magnitude_offset'],-.2,.2),'TWINKLE','small synthetic apparent offset');state['magnitude_offset']=args['magnitude_offset']*traits['expressiveness'];return {'type':'synthetic_star_expression','magnitude_offset':state['magnitude_offset'],'astrometry_changed':False},causes
        if kind=='group' and ability in ('join','leave'):
            member=name(args['member']);require(member==actor and member in world['entities'] and member!=life['entity_id'],'GROUP_CONSENT','self opt-in registered identity required')
            other=world['entities'][member];groups=other['relations']['member_of'];group_id=life['entity_id']
            if ability=='leave':
                require(member in state['members'],'NOT_MEMBER','cannot leave absent membership');del state['members'][member];groups.remove(group_id)
                return {'type':'group_departure','member':member},causes
            require(args['role'] in ('participant','observer'),'GROUP_ROLE','supported role required')
            require(member not in state['members'] and len(state['members'])<128 and len(groups)<16,'MEMBERSHIP_BUDGET','unique sparse bounded membership')
            require(not any(world['entities'][g]['traits']['exclusive'] or traits['exclusive'] for g in groups),'GROUP_CONFLICT','exclusive membership already held')
            # Groups can contain groups, but never introduce a membership cycle.
            pending=[member];seen=set()
            while pending:
                current=pending.pop();require(current!=group_id,'GROUP_CYCLE','cyclic membership refused')
                if current in seen:continue
                seen.add(current);require(len(seen)<=MAX_ENTITIES,'GROUP_BUDGET','bounded traversal')
                candidate=world['entities'][current]
                if candidate['kind']=='group':pending.extend(candidate['state']['members'])
            state['members'][member]=args['role'];groups.append(group_id);groups.sort()
            return {'type':'group_membership','member':member,'role':args['role']},causes
        if kind=='group' and ability=='propose_pattern':
            require(args['pattern'] in ('welcome','quiet'),'GROUP_PATTERN','known shared pattern');state['last_pattern']=args['pattern']
            proposals=[{'member':member,'pattern':args['pattern'],'requires_individual_scope':True} for member in sorted(state['members']) if state['members'][member]=='participant']
            return {'type':'group_proposal','pattern':args['pattern'],'proposals':proposals,'members_mutated':False},causes
        raise LifeRefused('UNSUPPORTED_ABILITY','no executable rule')
