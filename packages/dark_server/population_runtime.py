"""World candidate adapter over the actual C# PopulationLedger bridge.

All totals, histories, promotions and movement conservation come from that ledger.
The host authenticates context, source-country lookup and spawn/arrival readiness.
These identities/placements are fictional, never geocoded identifiable people.
"""
import copy
import hashlib
import json
import math
from pathlib import Path
import re
from .kernel import KernelBridge,KernelError
from .geography import PINNED

ROOT=Path(__file__).resolve().parents[2]
SOURCE_HASH='770cbf8e33263680074c1bc60a5af540ac2f55db991389bfeabebc762c528e11'
WORLD_TOTAL=8140897523
MAX_BYTES=1048576

class PopulationRefused(Exception):
    def __init__(self,code,witness):self.code=code;self.witness=str(witness);super().__init__(code+': '+self.witness)
    def as_dict(self):return {'status':'REFUSED','code':self.code,'witness':self.witness,'authority_granted':False}
def require(ok,code,message):
    if not ok:raise PopulationRefused(code,message)
def fields(value,required,optional=()):require(isinstance(value,dict) and set(required)<=set(value)<=set(required)|set(optional),'FIELDS','unexpected or missing fields')
def encode(value):
    try:return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False,ensure_ascii=False).encode('utf-8')
    except (TypeError,ValueError,UnicodeError,RecursionError) as exc:raise PopulationRefused('ENCODING','finite bounded JSON required') from exc
def digest(value):return hashlib.sha256(encode(value)).hexdigest()
def name(value):
    require(isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9_:.-]{1,128}',value),'IDENTITY','bounded World identity required');return value
def person_id(value):
    require(isinstance(value,str) and re.fullmatch(r'wb2024/[A-Z0-9_]{3,32}/(?:0|[1-9][0-9]{0,12})',value),'POPULATION_ID','canonical synthetic source-cohort identity required');return value
def capability(identity,operation):
    person_id(identity);require(operation in ('promote','demote','remember','travel','migrate'),'OPERATION','known population operation');return 'population:'+identity+':'+operation
def position(value):
    fields(value,('lat','lon','alt'))
    require(all(type(value[k]) in (int,float) and low<=value[k]<=high and math.isfinite(value[k]) for k,low,high in [('lat',-90,90),('lon',-180,180),('alt',-12000,100000)]),'POSITION','bounded actual fictional placement')
    return copy.deepcopy(value)
def distance(a,b):
    p,q=math.radians(a['lat']),math.radians(b['lat']);h=math.sin((q-p)/2)**2+math.cos(p)*math.cos(q)*math.sin(math.radians(b['lon']-a['lon'])/2)**2
    return math.hypot(2*6371008.8*math.asin(math.sqrt(max(0,min(1,h)))),b['alt']-a['alt'])
def metrics(value):
    fields(value,('demographic_estimate','virtual_members','stored_individuals','stored_individual_histories','active_actors','focused_actors','visible_characters','voiced_characters'))
    require(all(type(v) is int and 0<=v<=WORLD_TOTAL for v in value.values()) and value['demographic_estimate']==WORLD_TOTAL and value['virtual_members']+value['stored_individuals']==WORLD_TOTAL and value['stored_individual_histories']==value['stored_individuals'] and value['focused_actors']<=value['active_actors']<=min(256,value['stored_individuals']) and value['visible_characters']==value['voiced_characters']==0,'CONSERVATION','exact bounded ledger metrics')
def hexhash(value):return isinstance(value,str) and re.fullmatch(r'[0-9a-f]{64}',value) is not None

class PopulationRuntime:
    def __init__(self,bridge,state,allocation):self.bridge=bridge;self._state=state;self._allocation=allocation
    @staticmethod
    def _source():
        raw=(ROOT/'data/geography/global/population-allocation.json').read_bytes()
        require(hashlib.sha256(raw).hexdigest()==PINNED['population-allocation.json'],'SOURCE','pinned allocation mismatch')
        return {s['code']:s['population'] for s in json.loads(raw)['shards']}
    @classmethod
    def create(cls,bridge=None,max_active=256):
        require(type(max_active) is int and 1<=max_active<=256,'ACTIVE_BUDGET','maximum1..256 active ledger members')
        result=cls(bridge or KernelBridge(),None,cls._source());response=result._call('population_resolve',{'person_id':'wb2024/WLD_UNASSIGNED/0'})
        state={'schema':'dark.population-runtime/1','revision':0,'tick':0,'max_active':max_active,'ledger_snapshot':response['snapshot'],'ledger_revision':response['revision'],
               'allocation_hash':response['allocation_hash'],'population_source_sha256':response['population_source_sha256'],'metrics':response['metrics'],'encounters':{},'bindings':{},'requests':{}}
        state['checksum']=digest(state);result._state=state;return result
    @classmethod
    def restore(cls,snapshot,bridge=None):
        try:
            require(isinstance(snapshot,dict) and len(encode(snapshot))<=MAX_BYTES,'SNAPSHOT','bounded population candidate')
            result=cls(bridge or KernelBridge(),copy.deepcopy(snapshot),cls._source());result._validate()
            actual=result._call('population_inspect',{'person_ids':sorted(result._state['encounters']),'snapshot':result._state['ledger_snapshot']})
            require(actual['snapshot']==snapshot['ledger_snapshot'] and actual['metrics']==snapshot['metrics'] and actual['revision']==snapshot['ledger_revision'] and actual['allocation_hash']==snapshot['allocation_hash'],'LEDGER_CONTINUITY','candidate metadata must match real restored ledger')
            for person in actual['persons']:
                record=result._state['encounters'][person['id']]
                require(person['present']==record['present_country'] and (person['fidelity']!='Persistent')==record['active'],'LEDGER_CONTINUITY','each encounter must match actual ledger location and fidelity')
                latest=max((c['response'] for c in result._state['requests'].values() if c['response']['person']['id']==person['id']),key=lambda r:r['revision'])
                require(latest['person']==person,'LEDGER_CONTINUITY','latest encounter receipt must match restored ledger person')
            return result
        except (KeyError,TypeError,ValueError,AttributeError,RecursionError) as exc:raise PopulationRefused('SNAPSHOT','malformed population state') from exc
    @property
    def revision(self):return self._state['revision']
    def snapshot(self):return copy.deepcopy(self._state)
    def _call(self,operation,args):
        try:result=self.bridge.call(operation,args)
        except KernelError as exc:raise PopulationRefused('KERNEL',str(exc)) from exc
        require(isinstance(result,dict) and result.get('status')=='OK' and result.get('authority_granted') is False,'KERNEL_REFUSED',result.get('detail',result.get('reason','real ledger refused')) if isinstance(result,dict) else 'invalid result')
        require(result['population_source_sha256']==SOURCE_HASH and result['metrics']['demographic_estimate']==WORLD_TOTAL,'SOURCE','actual pinned ledger required')
        metrics(result['metrics'])
        return result
    def _validate(self):
        state=self._state;fields(state,('schema','revision','tick','max_active','ledger_snapshot','ledger_revision','allocation_hash','population_source_sha256','metrics','encounters','bindings','requests','checksum'))
        require(state['schema']=='dark.population-runtime/1' and state['population_source_sha256']==SOURCE_HASH and digest({k:v for k,v in state.items() if k!='checksum'})==state['checksum'],'SNAPSHOT','schema/checksum/source mismatch')
        require(type(state['revision']) is int and 0<=state['revision']<=512 and type(state['tick']) is int and state['tick']>=0 and type(state['max_active']) is int and 1<=state['max_active']<=256 and len(encode(state))<=MAX_BYTES,'STATE_BUDGET','revision/tick/bounds')
        require(isinstance(state['encounters'],dict) and len(state['encounters'])<=1024 and isinstance(state['bindings'],dict) and len(state['bindings'])==len(state['encounters']) and isinstance(state['requests'],dict) and len(state['requests'])==state['revision'],'STATE_BUDGET','bounded exact encounter/request records')
        metrics(state['metrics']);require(state['metrics']['stored_individuals']==len(state['encounters']) and state['metrics']['active_actors']==sum(r.get('active') is True for r in state['encounters'].values() if isinstance(r,dict)) and state['metrics']['active_actors']<=state['max_active'],'LEDGER_CONTINUITY','encounter realization must agree exactly with ledger metrics')
        require(type(state['ledger_revision']) is int and 0<=state['ledger_revision']<=state['revision'] and hexhash(state['allocation_hash']),'LEDGER_CONTINUITY','ledger metadata shape')
        for identity,record in state['encounters'].items():
            person_id(identity);fields(record,('owner','key','world_actor_id','position','present_country','active','fictional_placement'));name(record['owner']);name(record['key']);name(record['world_actor_id']);position(record['position'])
            _,origin,ordinal=identity.split('/')
            require(origin in self._allocation and origin!='WLD_UNASSIGNED' and int(ordinal)<self._allocation[origin] and record['world_actor_id']=='population:'+origin+':'+ordinal and record['owner'] not in ('system','founder_dark','Obex_Den'),'ENCOUNTER','canonical source identity and actor binding')
            require(any(int(digest([origin,record['owner'],record['key'],salt]),16)%self._allocation[origin]==int(ordinal) for salt in range(64)),'ENCOUNTER','identity must retain original owner/key allocation')
            require(record['present_country'] in self._allocation and record['present_country']!='WLD_UNASSIGNED' and type(record['active']) is bool and record['fictional_placement'] is True and state['bindings'].get(digest([record['owner'],record['key']]))==identity,'ENCOUNTER','source-country/binding mismatch')
        revisions=set();seen=set()
        for cache_key,cached in state['requests'].items():
            fields(cached,('fingerprint','actor','request','response'));actor=name(cached['actor']);request=cached['request'];response=cached['response']
            fields(request,('request_id','expected_revision','operation','arguments'));name(request['request_id'])
            require(cache_key==digest([actor,request['request_id']]) and cached['fingerprint']==digest(request),'REPLAY','request digest and actor binding')
            fields(response,('status','revision','person','metrics','counts','spawn','retire','witness','authority_granted','durable_commit_performed','physical_validation'))
            require(response['status']=='PROPOSED' and type(response['revision']) is int and 1<=response['revision']<=state['revision'] and response['revision'] not in revisions and type(request['expected_revision']) is int and response['revision']==request['expected_revision']+1 and response['authority_granted'] is False and response['durable_commit_performed'] is False and response['physical_validation']=='NOT_RUN','REPLAY','typed unique candidate receipt')
            revisions.add(response['revision']);metrics(response['metrics']);person=response['person']
            fields(person,('id','origin','ordinal','residence','present','fidelity','policy_seed','facts','commitments','last_event_revision'));identity=person_id(person['id']);record=state['encounters'].get(identity)
            require(record is not None and record['owner']==actor and person['origin']==identity.split('/')[1] and type(person['ordinal']) is int and str(person['ordinal'])==identity.split('/')[2] and person['residence'] in self._allocation and person['present'] in self._allocation and person['fidelity'] in ('Active','Persistent') and hexhash(person['policy_seed']) and type(person['last_event_revision']) is int and 0<=person['last_event_revision']<=state['ledger_revision'],'REPLAY','person source identity and historical state')
            for entries in (person['facts'],person['commitments']):require(isinstance(entries,list) and len(entries)<=64 and all(isinstance(x,str) and len(x.encode('utf-8'))<=4096 for x in entries),'REPLAY','bounded person history')
            operation=request['operation'];require(isinstance(operation,str) and operation in ('encounter','promote','demote','remember','travel','migrate'),'REPLAY','known cached operation')
            fields(request['arguments'],('key',) if operation=='encounter' else ('identity','fact') if operation=='remember' else ('identity',))
            require(request['arguments'].get('key')==record['key'] if operation=='encounter' else request['arguments'].get('identity')==identity,'REPLAY','cached action identity')
            witness=response['witness'];fields(witness,('actor','operation','identity','base_population_revision','ledger_revision','allocation_hash','population_source_sha256','fictional_placement','actual_source_country'))
            require(witness['actor']==actor and witness['operation']==operation and witness['identity']==identity and witness['base_population_revision']==request['expected_revision'] and type(witness['ledger_revision']) is int and person['last_event_revision']<=witness['ledger_revision']<=state['ledger_revision'] and witness['allocation_hash']==state['allocation_hash'] and witness['population_source_sha256']==SOURCE_HASH and witness['fictional_placement'] is True and witness['actual_source_country'] in self._allocation,'REPLAY','receipt witness binding')
            counts=response['counts'];require(isinstance(counts,dict) and set(counts)=={person['residence'],person['present']},'REPLAY','exact affected economy counts')
            for count in counts.values():
                fields(count,('residents','present','visitors','absent_residents'));require(all(type(v) is int and 0<=v<=WORLD_TOTAL for v in count.values()) and count['residents']-count['absent_residents']+count['visitors']==count['present'],'REPLAY','conserved economy counts')
            spawn=response['spawn'];retire=response['retire']
            if spawn is not None:
                fields(spawn,('identity','world_actor_id','position','present_country','policy_seed','fictional_placement','source_person_position','role','controller','requires_world_admission','native_collision_validation'));position(spawn['position'])
                require(operation in ('encounter','promote') and spawn==self._spawn(identity,dict(record,position=spawn['position'],present_country=person['present']),person) and person['fidelity']=='Active','REPLAY','canonical fictional spawn proposal')
            if retire is not None:require(operation=='demote' and person['fidelity']=='Persistent' and retire=={'world_actor_id':record['world_actor_id'],'identity':identity,'preserve_ledger_history':True},'REPLAY','canonical retirement proposal')
            require((retire is not None)==(operation=='demote') and (operation!='promote' or spawn is not None),'REPLAY','operation proposal continuity');seen.add(identity)
            if response['revision']==state['revision']:require(response['metrics']==state['metrics'] and witness['ledger_revision']==state['ledger_revision'],'REPLAY','latest receipt agrees with ledger metadata')
        require(revisions==set(range(1,state['revision']+1)) and seen==set(state['encounters']),'REPLAY','complete bounded candidate history')
    def apply(self,context,request):
        fields(context,('actor','tick','country','position','spawn_ready','capabilities'),('arrival','safe_to_demote'))
        actor=name(context['actor']);require(actor not in ('system','founder_dark','Obex_Den'),'ACTOR','ordinary authenticated participant required')
        tick=context['tick'];require(type(tick) is int and tick>=self._state['tick'],'CLOCK','trusted monotonic tick required')
        country=context['country'];require(isinstance(country,str) and country in self._allocation and country!='WLD_UNASSIGNED','COUNTRY','exact spatial source-economy match required')
        actual_position=position(context['position']);require(type(context['spawn_ready']) is bool,'SPAWN','host readiness required')
        caps=context['capabilities'];require(isinstance(caps,(list,tuple)) and len(caps)<=128 and all(isinstance(c,str) and len(c)<=256 for c in caps),'CAPABILITIES','bounded current scopes')
        fields(request,('request_id','expected_revision','operation','arguments'));rid=name(request['request_id']);operation=request['operation'];args=request['arguments']
        require(isinstance(operation,str) and operation in ('encounter','promote','demote','remember','travel','migrate'),'OPERATION','typed population action')
        fields(args,('key',) if operation=='encounter' else ('identity','fact') if operation=='remember' else ('identity',))
        require(type(request['expected_revision']) is int and request['expected_revision']>=0 and len(encode(request))<=4096,'REQUEST','bounded request/revision')
        identity=None
        if operation=='encounter':name(args['key']);required='population:encounter'
        else:
            identity=person_id(args['identity']);require(identity in self._state['encounters'] and self._state['encounters'][identity]['owner']==actor,'ENCOUNTER_OWNERSHIP','only an owned previously introduced synthetic identity may change');required=capability(identity,operation)
        require(required in caps,'CAPABILITY','current exact admitted scope required')
        request_key=digest([actor,rid]);fingerprint=digest(request);prior=self._state['requests'].get(request_key)
        if prior:
            require(prior['fingerprint']==fingerprint,'REQUEST_CONFLICT','changed duplicate population request');return copy.deepcopy(prior['response'])
        require(request['expected_revision']==self.revision,'STALE_REVISION','revalidate current population candidate')
        require(self.revision<512,'HISTORY_BUDGET','explicit archive required; no silent request eviction')
        state=copy.deepcopy(self._state);spawn=None;retire=None;record=None
        if operation=='encounter':
            require(context['spawn_ready'],'SPAWN_NOT_READY','existing ready host spawn node required')
            binding=digest([actor,args['key']]);identity=state['bindings'].get(binding)
            if identity is None:
                require(len(state['encounters'])<1024,'ENCOUNTER_BUDGET','bounded stored encounters')
                require(state['metrics']['active_actors']<state['max_active'],'ACTIVE_BUDGET','demote safely before new realization')
                for salt in range(64):
                    ordinal=int(digest([country,actor,args['key'],salt]),16)%self._allocation[country]
                    proposed='wb2024/'+country+'/'+str(ordinal)
                    if proposed not in state['encounters']:identity=proposed;break
                require(identity is not None,'IDENTITY_COLLISION','bounded cohort allocation collision attempts exhausted')
                record={'owner':actor,'key':args['key'],'world_actor_id':'population:'+country+':'+str(ordinal),'position':actual_position,'present_country':country,'active':True,'fictional_placement':True}
                state['encounters'][identity]=record;state['bindings'][binding]=identity
                response=self._call('population_resolve',{'person_id':identity,'snapshot':state['ledger_snapshot'],'promote':True,'fact':'met:'+actor+':tick:'+str(tick)})
                spawn=self._spawn(identity,record,response['person'])
            else:
                record=state['encounters'][identity]
                require(record['active'],'DEMOTED','explicit scoped promotion required for an existing demoted identity')
                require(record['present_country']==country,'ENCOUNTER_REGION','existing encounter is in another country; no implicit relocation')
                response=self._call('population_resolve',{'person_id':identity,'snapshot':state['ledger_snapshot']})
        else:
            record=state['encounters'][identity]
            if operation in ('promote','remember'):
                require(record['present_country']==country and distance(actual_position,record['position'])<=25,'ENCOUNTER_RANGE','same source-country and nearby fictional encounter required')
            if operation=='promote':
                require(context['spawn_ready'] and not record['active'],'PROMOTION','inactive introduced identity and host-ready prior position required')
                require(state['metrics']['active_actors']<state['max_active'],'ACTIVE_BUDGET','active realization cap reached')
                response=self._call('population_resolve',{'person_id':identity,'snapshot':state['ledger_snapshot'],'promote':True});record['active']=True;spawn=self._spawn(identity,record,response['person'])
            elif operation=='demote':
                require(record['active'] and context.get('safe_to_demote') is True,'DEMOTION_BUSY','host must confirm no journey/vehicle/active interaction')
                response=self._call('population_resolve',{'person_id':identity,'snapshot':state['ledger_snapshot'],'demote':True});record['active']=False;retire={'world_actor_id':record['world_actor_id'],'identity':identity,'preserve_ledger_history':True}
            elif operation=='remember':
                require(record['active'] and isinstance(args['fact'],str) and 1<=len(args['fact'].encode('utf-8'))<=512 and '\x00' not in args['fact'],'FACT','bounded active encounter report required')
                response=self._call('population_resolve',{'person_id':identity,'snapshot':state['ledger_snapshot'],'fact':'player_report:'+actor+':'+args['fact']})
            else:
                require(record['active'],'MOVEMENT','only manifested encounters can consume actual arrival witnesses')
                arrival=context.get('arrival');fields(arrival,('identity','from_country','to_country','tick','event_id','migration_authorized'));name(arrival['event_id'])
                require(arrival['identity']==identity and arrival['from_country']==record['present_country'] and arrival['to_country']==country and type(arrival['tick']) is int and arrival['tick']==tick and type(arrival['migration_authorized']) is bool,'ARRIVAL','host actual arrival must match existing identity/region and current tick')
                require(operation!='migrate' or arrival['migration_authorized'],'MIGRATION_AUTHORITY','explicit host migration admission required')
                response=self._call('population_move',{'person_id':identity,'snapshot':state['ledger_snapshot'],'destination':country,'request_id':digest([identity,operation,arrival['event_id']]),'expected_revision':state['ledger_revision'],'migration':operation=='migrate'})
                record['position']=actual_position;record['present_country']=country
        require(response['person']['id']==identity and response['person']['present']==record['present_country'] and (response['person']['fidelity']!='Persistent')==record['active'],'LEDGER_CONTINUITY','encounter must match actual C# ledger')
        state['ledger_snapshot']=response['snapshot'];state['ledger_revision']=response['revision'];state['metrics']=response['metrics'];state['tick']=tick;state['revision']+=1
        witness={'actor':actor,'operation':operation,'identity':identity,'base_population_revision':request['expected_revision'],'ledger_revision':response['revision'],'allocation_hash':response['allocation_hash'],'population_source_sha256':SOURCE_HASH,'fictional_placement':True,'actual_source_country':country}
        result={'status':'PROPOSED','revision':state['revision'],'person':response['person'],'metrics':response['metrics'],'counts':response['counts'],'spawn':spawn,'retire':retire,'witness':witness,
                'authority_granted':False,'durable_commit_performed':False,'physical_validation':'NOT_RUN'}
        state['requests'][request_key]={'fingerprint':fingerprint,'actor':actor,'request':copy.deepcopy(request),'response':result};state['checksum']=digest({k:v for k,v in state.items() if k!='checksum'})
        candidate=PopulationRuntime(self.bridge,state,self._allocation);candidate._validate();self._state=state;return copy.deepcopy(result)
    @staticmethod
    def _spawn(identity,record,person):
        return {'identity':identity,'world_actor_id':record['world_actor_id'],'position':copy.deepcopy(record['position']),'present_country':record['present_country'],'policy_seed':person['policy_seed'],
                'fictional_placement':True,'source_person_position':None,'role':'ordinary_synthetic_npc','controller':'npc','requires_world_admission':True,'native_collision_validation':'NOT_RUN'}
