"""Bounded local resource preparation; the existing World owns every durable effect.

No network fetching, arbitrary player paths, engine objects or GPU measurements.
Portable AABB readiness is explicitly distinct from native physics validation.
"""
import copy
import hashlib
import io
import itertools
import json
import math
import os
from pathlib import Path
import re
import stat
import time
import wave

MAX_BYTES=1048576
MAX_EVENTS=512
MAX_TICK=2**63-1
# A terminal event adds its event, cached response/witness and request key.
# With ASCII IDs<=128, clocks<=19 digits and the fixed cleanup effects, their
# combined encoded growth is below4096bytes, including cell/metric counters.
CLEANUP_BYTES_PER_EVENT=4096
DEFAULT_LIMITS={'cells':32,'assets':128,'resident_bytes':64*1024*1024,'per_actor_cells':4,'admissions_per_60_ticks':4}
TERMINAL={'RETIRED','CANCELLED','EXPIRED','FAILED'}
GATES={'OBSERVE','PREDICT','ADMIT','STAGE','VERIFY','RESERVE','ACTIVATE','RETIRE','RETIRED','CANCELLED','EXPIRED','FAILED'}
LIFECYCLES={'requested','fetching','verified','decoded','instantiated','collision_ready','active','retiring','cached','cancelled','expired','failed'}

class StageRefused(Exception):
    def __init__(self,code,witness):self.code=code;self.witness=str(witness);super().__init__(code+': '+self.witness)
    def as_dict(self):return {'status':'REFUSED','code':self.code,'witness':self.witness,'physical_validation':'NOT_RUN'}
def require(value,code,why):
    if not value:raise StageRefused(code,why)
def finite(value,lo,hi):return type(value) in (int,float) and lo<=value<=hi and math.isfinite(value)
def fields(value,required,optional=()):require(isinstance(value,dict) and set(required)<=set(value)<=set(required)|set(optional),'FIELDS','unexpected or missing fields')
def name(value):
    require(isinstance(value,str) and re.fullmatch(r'[A-Za-z0-9_:.-]{1,128}',value),'IDENTITY','bounded explicit ID required');return value
def encode(value):
    try:return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False,ensure_ascii=False).encode('utf-8')
    except (TypeError,ValueError,UnicodeError,RecursionError) as exc:raise StageRefused('ENCODING','finite bounded JSON required') from exc
def digest(value):return hashlib.sha256(encode(value)).hexdigest()
def scope(cell,action):
    require(action in ('prepare','activate'),'CAPABILITY','known scope kind');return 'staging:'+name(cell)+':'+action
def expiry_tick(cell):
    return min(cell['expires_tick'],(cell.get('reservation') or {}).get('expires_tick',cell['expires_tick']))
def cleanup_events(cells):
    # Every live cell must retain enough history capacity to release resources.
    # Active cells require RETIRE then CACHE; all other live gates need one.
    return sum(2 if cell['gate']=='ACTIVATE' else 1 for cell in cells.values() if cell['gate'] not in TERMINAL)
def vector(value):return isinstance(value,list) and len(value)==3 and all(finite(v,-1e8,1e8) for v in value)
def inside(point,shape):return vector(point) and all(shape['min'][i]<=point[i]<=shape['max'][i] for i in range(3))
def relative(path):
    require(isinstance(path,str) and len(path)<=512 and not path.startswith('/') and '\\' not in path and all(ord(ch)>=32 for ch in path) and all(p not in ('','.','..') for p in path.split('/')),'ASSET_PATH','canonical relative paths without traversal required');return path

def estimate_time(observation,tick):
    """Conservative heuristic, never a probability or permission to move an actor."""
    fields(observation,('path','speed_mps','speed_confidence','wait_ticks','observed_tick','anticipated_tick','visible','mode'),('assets','path_revision','ttl_ticks'))
    path=observation['path'];require(isinstance(path,list) and 2<=len(path)<=256 and all(vector(p) for p in path),'PATH','2..256 finite local points')
    require(type(tick) is int and type(observation['observed_tick']) is int and 0<=observation['observed_tick']<=tick and tick-observation['observed_tick']<=300,'STALE_PATH','path must be at most300ticks old')
    speed=observation['speed_mps'];confidence=observation['speed_confidence'];wait=observation['wait_ticks']
    require(finite(speed,0,400) and finite(confidence,0,1) and finite(wait,0,3600) and type(observation['visible']) is bool and observation['mode'] in ('walk','drive','fly','sail','portal'),'PREDICTION','bounded explicit mode/speed/wait/confidence')
    anticipated=observation['anticipated_tick'];require(anticipated is None or type(anticipated) is int and tick<=anticipated<=tick+3600,'ANTICIPATION','bounded current scheduled anticipation')
    distance=sum(math.dist(a,b) for a,b in zip(path,path[1:]));age=tick-observation['observed_tick']
    if speed<.1 or confidence<.1:
        basis='scheduled' if anticipated is not None else 'visible_anticipation' if observation['visible'] else 'unknown'
        eta=anticipated-tick if anticipated is not None else 0 if observation['visible'] else None
    else:basis='path_speed_wait_age';eta=max(0,distance/(speed*confidence)+wait-age)
    return {'path_distance_m':distance,'time_to_use_ticks':eta,'basis':basis,'state_age_ticks':age,'score_is_probability':False,'tick_duration_seconds':1}

def _allocation_items(items,budget):
    require(isinstance(items,list) and len(items)<=16 and type(budget) is int and 0<=budget<=64*1024*1024,'ALLOCATION','at most16 items and bounded budget')
    seen=set()
    for item in items:
        fields(item,('id','bytes','benefit','required'));identifier=name(item['id'])
        require(identifier not in seen and type(item['bytes']) is int and 1<=item['bytes']<=64*1024*1024 and type(item['benefit']) is int and 0<=item['benefit']<=1000000 and type(item['required']) is bool,'ALLOCATION','unique IDs/positive byte costs/nonnegative heuristic benefit');seen.add(identifier)
    return sorted(items,key=lambda i:i['id'])
def compare_allocations(items,budget):
    items=_allocation_items(items,budget);required=[i for i in items if i['required']];optional=[i for i in items if not i['required']]
    require(sum(i['bytes'] for i in required)<=budget,'REQUIRED_BUDGET','immediate required resources exceed budget')
    def result(selected):return {'ids':sorted(i['id'] for i in selected),'bytes':sum(i['bytes'] for i in selected),'benefit':sum(i['benefit'] for i in selected)}
    selected=list(required);remaining=budget-sum(i['bytes'] for i in selected)
    from functools import cmp_to_key
    def compare(a,b):
        cross=a['benefit']*b['bytes']-b['benefit']*a['bytes']
        return -1 if cross>0 else 1 if cross<0 else -1 if a['id']<b['id'] else 1 if a['id']>b['id'] else 0
    for item in sorted(optional,key=cmp_to_key(compare)):
        if item['bytes']<=remaining:selected.append(item);remaining-=item['bytes']
    greedy=result(selected);exact=result(required)
    for count in range(len(optional)+1):
        for subset in itertools.combinations(optional,count):
            candidate=result(required+list(subset))
            if candidate['bytes']<=budget and (-candidate['benefit'],candidate['bytes'],candidate['ids'])<(-exact['benefit'],exact['bytes'],exact['ids']):exact=candidate
    return {'greedy':greedy,'exact':exact,'missed_benefit':exact['benefit']-greedy['benefit'],'unused_bytes':budget-greedy['bytes'],'score_is_probability':False}

class Staging:
    def __init__(self,root,manifest,state):self.root=Path(root).resolve();self.manifest=copy.deepcopy(manifest);self.assets={a['id']:a for a in self.manifest['assets']};self._state=state
    @classmethod
    def create(cls,root,manifest,limits=None):
        fields(manifest,('schema','version','assets'));name(manifest['version'])
        require(manifest['schema']=='dark.stage-manifest/1' and isinstance(manifest['assets'],list) and 1<=len(manifest['assets'])<=128,'MANIFEST','versioned bounded local manifest')
        seen=set()
        for asset in manifest['assets']:
            fields(asset,('id','path','bytes','sha256','kind','decoder'));identifier=name(asset['id']);relative(asset['path'])
            require(identifier not in seen and type(asset['bytes']) is int and 1<=asset['bytes']<=32*1024*1024 and isinstance(asset['sha256'],str) and re.fullmatch('[0-9a-f]{64}',asset['sha256']),'MANIFEST','unique ID,1..32MiB and SHA256');seen.add(identifier)
            require(asset['kind'] in ('voice','animation','mesh','material','music','ambience','collision','program') and asset['decoder'] in ('opaque_bytes','json','pcm_wave','collision_aabb'),'DECODER','supported typed local resource')
            require((asset['kind']=='collision')==(asset['decoder']=='collision_aabb'),'COLLISION','collision resources need portable AABB decoder')
        configured=dict(DEFAULT_LIMITS);fields(limits or {},(),DEFAULT_LIMITS);configured.update(limits or {})
        require(all(type(v) is int and 1<=v<=DEFAULT_LIMITS[k] for k,v in configured.items()),'LIMITS','positive limits within hard caps')
        require(Path(root).is_dir(),'ROOT','trusted resource root directory')
        state={'schema':'dark.staging-state/1','manifest_sha256':digest(manifest),'limits':configured,'revision':0,'tick':0,'cells':{},'cache':{},'admissions':{},'events':[],'requests':{},'head':'0'*64,
               'metrics':{'actual_bytes_read':0,'read_elapsed_ns':0,'wasted_stage_bytes':0,'reserved_unique_bytes':0,'activation_count':0}}
        state['checksum']=digest(state);return cls(root,manifest,state)
    @classmethod
    def restore(cls,root,manifest,snapshot):
        result=cls.create(root,manifest)
        try:
            require(isinstance(snapshot,dict) and len(encode(snapshot))<=MAX_BYTES,'SNAPSHOT','bounded object');result._state=copy.deepcopy(snapshot);result._validate()
        except (KeyError,TypeError,ValueError,AttributeError,OverflowError,RecursionError) as exc:raise StageRefused('SNAPSHOT','malformed state') from exc
        return result
    @property
    def revision(self):return self._state['revision']
    def snapshot(self):return copy.deepcopy(self._state)
    def inspect(self,cell):
        name(cell);require(cell in self._state['cells'],'CELL_MISSING',cell);return copy.deepcopy(self._state['cells'][cell])
    def _validate(self):
        s=self._state;fields(s,('schema','manifest_sha256','limits','revision','tick','cells','cache','admissions','events','requests','head','metrics','checksum'))
        require(s['schema']=='dark.staging-state/1' and s['manifest_sha256']==digest(self.manifest) and digest({k:v for k,v in s.items() if k!='checksum'})==s['checksum'],'SNAPSHOT_INTEGRITY','manifest/checksum mismatch')
        require(type(s['revision']) is int and 0<=s['revision']<=MAX_EVENTS and type(s['tick']) is int and 0<=s['tick']<=MAX_TICK and len(encode(s))<=MAX_BYTES,'SNAPSHOT','clock/revision/size')
        fields(s['limits'],DEFAULT_LIMITS);require(all(type(v) is int and 1<=v<=DEFAULT_LIMITS[k] for k,v in s['limits'].items()),'LIMITS','hard caps')
        fields(s['metrics'],('actual_bytes_read','read_elapsed_ns','wasted_stage_bytes','reserved_unique_bytes','activation_count'))
        require(all(type(v) is int and 0<=v<=MAX_TICK for v in s['metrics'].values()),'METRICS','bounded resource counters')
        require(s['metrics']['wasted_stage_bytes']<=MAX_EVENTS*DEFAULT_LIMITS['resident_bytes'],'METRICS','bounded retained waste counter')
        require(isinstance(s['cells'],dict) and len(s['cells'])<=s['limits']['cells'] and isinstance(s['cache'],dict) and len(s['cache'])<=s['limits']['assets'],'STATE_BUDGET','cell/cache limits')
        for key,c in s['cells'].items():
            name(key);fields(c,('owner','gate','lifecycle','assets','observation','prediction','expires_tick','changed_tick','staged_bytes','decoded','instance','reservation','generation'))
            name(c['owner']);require(c['gate'] in GATES and c['lifecycle'] in LIFECYCLES and isinstance(c['assets'],list) and 1<=len(c['assets'])<=16 and len(set(c['assets']))==len(c['assets']) and all(a in self.assets for a in c['assets']),'CELL_SCHEMA','gate, lifecycle or resource binding')
            require(all(type(c[k]) is int and c[k]>=0 for k in ('expires_tick','changed_tick','staged_bytes','generation')) and isinstance(c['decoded'],dict),'CELL_SCHEMA','bounded clocks and decoded summaries')
            require(c['expires_tick']<=MAX_TICK and c['changed_tick']<=MAX_TICK,'CELL_SCHEMA','signed64-bit cell clocks')
            require(c['staged_bytes']<=sum(self.assets[a]['bytes'] for a in c['assets']),'CELL_SCHEMA','staged bytes bounded by declared assets')
        require(s['revision']+cleanup_events(s['cells'])<=MAX_EVENTS,'CLEANUP_BUDGET','retain mandatory terminal cleanup history capacity')
        require(len(encode(s))+cleanup_events(s['cells'])*CLEANUP_BYTES_PER_EVENT<=MAX_BYTES,'CLEANUP_BYTES','retain serialized terminal cleanup capacity')
        for key,c in s['cache'].items():
            require(key in self.assets,'CACHE','unknown asset');fields(c,('sha256','bytes','last_tick'))
            require(c['sha256']==self.assets[key]['sha256'] and c['bytes']==self.assets[key]['bytes'] and type(c['last_tick']) is int and 0<=c['last_tick']<=s['tick'],'CACHE','verified local asset binding')
        require(sum(c['bytes'] for c in s['cache'].values())<=s['limits']['resident_bytes'],'CACHE_BUDGET','bounded local cache accounting')
        require(isinstance(s['events'],list) and isinstance(s['requests'],dict) and len(s['events'])==len(s['requests'])==s['revision'],'HISTORY','complete bounded event/request sequence')
        prior='0'*64
        for i,event in enumerate(s['events'],1):
            fields(event,('revision','tick','actor','cell_id','operation','effect','previous','hash'))
            require(event['revision']==i and event['previous']==prior and event['hash']==digest({k:v for k,v in event.items() if k!='hash'}),'HISTORY','event integrity');prior=event['hash']
        require(prior==s['head'],'HISTORY','event head')
        for cached in s['requests'].values():
            fields(cached,('fingerprint','response'));r=cached['response'];fields(r,('status','revision','effect','witness','authority_granted','durable_commit_performed','physical_validation'))
            require(type(r['revision']) is int and 1<=r['revision']<=s['revision'] and r['witness']==s['events'][r['revision']-1],'HISTORY','cached witness')
    def _read(self,asset,state):
        """openat with O_NOFOLLOW for every component, including final regular file."""
        started=time.perf_counter_ns();fds=[]
        try:
            directory=os.open(self.root,os.O_RDONLY|os.O_DIRECTORY);fds.append(directory)
            parts=relative(asset['path']).split('/')
            for part in parts[:-1]:directory=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=directory);fds.append(directory)
            fd=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory);fds.append(fd);info=os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_size==asset['bytes'],'ASSET_SIZE','regular file with exact manifest size required')
            chunks=[];count=0;sha=hashlib.sha256()
            while True:
                block=os.read(fd,min(65536,asset['bytes']+1-count))
                if not block:break
                count+=len(block);require(count<=asset['bytes'],'ASSET_SIZE','file grew during read');sha.update(block);chunks.append(block)
            require(count==asset['bytes'] and sha.hexdigest()==asset['sha256'],'ASSET_HASH','exact local content hash required')
            state['metrics']['actual_bytes_read']+=count;state['metrics']['read_elapsed_ns']+=time.perf_counter_ns()-started
            return b''.join(chunks)
        except OSError as exc:raise StageRefused('ASSET_IO','safe local file unavailable') from exc
        finally:
            for fd in reversed(fds):os.close(fd)
    def _decode(self,asset,data):
        decoder=asset['decoder']
        if decoder=='opaque_bytes':return {'decoder':decoder,'bytes':len(data),'semantic_decode':'UNSUPPORTED','native_instantiation':'NOT_RUN'}
        if decoder=='pcm_wave':
            try:
                with wave.open(io.BytesIO(data),'rb') as wav:
                    require(wav.getcomptype()=='NONE' and 1<=wav.getnchannels()<=2 and wav.getsampwidth() in (1,2,3,4) and 8000<=wav.getframerate()<=96000,'AUDIO','bounded PCM format')
                    frames=wav.getnframes();require(frames<=96000*600,'AUDIO','maximum600seconds');payload=wav.readframes(frames)
                    require(len(payload)==frames*wav.getnchannels()*wav.getsampwidth(),'AUDIO','complete PCM frames')
                    return {'decoder':decoder,'frames':frames,'channels':wav.getnchannels(),'rate_hz':wav.getframerate(),'duration_seconds':frames/wav.getframerate(),'decoded_pcm_bytes':len(payload)}
            except (wave.Error,EOFError) as exc:raise StageRefused('DECODE','malformed PCM wave') from exc
        def pairs(items):
            result={}
            for key,value in items:require(key not in result,'DECODE','duplicate JSON key');result[key]=value
            return result
        require(len(data)<=MAX_BYTES,'DECODE','JSON decode maximum1MiB')
        try:value=json.loads(data.decode('utf-8'),object_pairs_hook=pairs,parse_constant=lambda _: (_ for _ in ()).throw(StageRefused('DECODE','nonfinite JSON')))
        except (ValueError,UnicodeError,RecursionError) as exc:raise StageRefused('DECODE','finite bounded UTF8 JSON required') from exc
        if decoder=='json':return {'decoder':decoder,'root_type':type(value).__name__,'canonical_sha256':digest(value),'semantic_validation':'NOT_CLAIMED'}
        fields(value,('schema','min','max','spawn'))
        require(value['schema']=='dark.collision-aabb/1' and all(vector(value[k]) for k in ('min','max','spawn')) and all(value['min'][i]<value['max'][i] for i in range(3)) and inside(value['spawn'],value),'SPAWN','nondegenerate portable safe-volume fixture with contained spawn required')
        return dict(value,decoder=decoder,physics_engine_validation='NOT_RUN')
    def apply(self,actor,capabilities,request,tick,actual=None):
        actor=name(actor);fields(request,('request_id','expected_revision','cell_id','operation','arguments'));request_id=name(request['request_id']);cell_id=name(request['cell_id']);op=request['operation'];args=request['arguments']
        require(isinstance(op,str) and op in GATES|{'DECODE','INSTANTIATE','COLLISION_READY','CACHE','CANCEL','EXPIRE','FAIL'},'OPERATION','supported lifecycle operation')
        require(type(tick) is int and self._state['tick']<=tick<=MAX_TICK and type(request['expected_revision']) is int and isinstance(args,dict) and len(encode(request))<=32768,'REQUEST','bounded request and monotonic trusted tick')
        require(isinstance(capabilities,(list,tuple,set)) and len(capabilities)<=128 and all(isinstance(c,str) and len(c)<=256 for c in capabilities) and scope(cell_id,'activate' if op=='ACTIVATE' else 'prepare') in capabilities,'CAPABILITY','current exact scope required')
        key=encode([actor,request_id]).decode();fingerprint=digest(request);prior=self._state['requests'].get(key)
        if prior:
            require(prior['fingerprint']==fingerprint,'REQUEST_CONFLICT','request ID content changed');return copy.deepcopy(prior['response'])
        require(request['expected_revision']==self.revision,'STALE_REVISION','revalidate current candidate')
        require(self.revision<MAX_EVENTS,'HISTORY_BUDGET','no silent request/history eviction')
        s=copy.deepcopy(self._state);cells=s['cells'];c=cells.get(cell_id)
        if op=='OBSERVE':
            fields(args,('assets','path','path_revision','mode','speed_mps','speed_confidence','wait_ticks','observed_tick','anticipated_tick','visible','ttl_ticks'))
            require(c is None or c['owner']==actor and c['gate'] in TERMINAL and tick-c['changed_tick']>=5,'HYSTERESIS','only owner may reopen terminal cell after5ticks')
            require(c is not None or len(cells)<s['limits']['cells'],'CELL_BUDGET','bounded stable cell slots')
            require(isinstance(args['assets'],list) and 1<=len(args['assets'])<=16 and all(isinstance(a,str) and a in self.assets for a in args['assets']) and len(set(args['assets']))==len(args['assets']),'ASSETS','unique manifest-bound resource IDs')
            require(type(args['path_revision']) is int and args['path_revision']>=0 and type(args['ttl_ticks']) is int and 1<=args['ttl_ticks']<=300,'CLOCK','source path revision and bounded expiry')
            require(tick<=MAX_TICK-args['ttl_ticks'],'CLOCK','preparation expiry must fit signed64-bit ticks')
            estimate_time(args,tick)
            c={'owner':actor,'gate':'OBSERVE','lifecycle':'requested','assets':sorted(args['assets']),'observation':copy.deepcopy(args),'prediction':None,'expires_tick':tick+args['ttl_ticks'],'changed_tick':tick,'staged_bytes':0,'decoded':{},'instance':None,'reservation':None,'generation':1 if c is None else c['generation']+1};cells[cell_id]=c
            effect={'type':'observed_intent','world_position_changed':False}
        else:
            require(c is not None and c['owner']==actor,'CELL_OWNER','known cell owned by actor')
            require(tick<c['expires_tick'] or op in ('EXPIRE','RETIRE','CACHE','CANCEL','FAIL'),'EXPIRED','preparation expired')
            effect=self._transition(s,c,cell_id,actor,op,args,tick,actual)
            c['changed_tick']=tick
        active_assets={a for cell in cells.values() if cell['gate'] not in TERMINAL|{'OBSERVE','PREDICT'} for a in cell['assets']}
        s['metrics']['reserved_unique_bytes']=sum(self.assets[a]['bytes'] for a in active_assets)
        revision=s['revision']+1;event={'revision':revision,'tick':tick,'actor':actor,'cell_id':cell_id,'operation':op,'effect':effect,'previous':s['head']};event['hash']=digest(event)
        s['revision']=revision;s['tick']=tick;s['events'].append(event);s['head']=event['hash']
        response={'status':'PROPOSED','revision':revision,'effect':effect,'witness':event,'authority_granted':False,'durable_commit_performed':False,'physical_validation':'NOT_RUN'}
        s['requests'][key]={'fingerprint':fingerprint,'response':response};s['checksum']=digest({k:v for k,v in s.items() if k!='checksum'})
        candidate=Staging(self.root,self.manifest,s);candidate._validate();self._state=s;return copy.deepcopy(response)
    def _transition(self,s,c,cell_id,actor,op,args,tick,actual):
        fields(args,('reason',) if op=='FAIL' else ())
        gate=c['gate'];phase=c['lifecycle'];effect={'type':'prepared_resource_state','gate':op,'world_position_changed':False}
        if op=='PREDICT':
            require(gate=='OBSERVE','ORDER','OBSERVE before PREDICT');c['prediction']=estimate_time(c['observation'],tick);c['gate']=op;effect['prediction']=copy.deepcopy(c['prediction'])
        elif op=='ADMIT':
            require(gate=='PREDICT','ORDER','PREDICT before ADMIT');estimate_time(c['observation'],tick)
            admissions=[t for t in s['admissions'].get(actor,[]) if tick-t<60]
            require(len(admissions)<s['limits']['admissions_per_60_ticks'],'ACTOR_RATE','cancellations retain rolling admission cost')
            live=[x for x in s['cells'].values() if x['gate'] not in TERMINAL|{'OBSERVE','PREDICT'}]
            require(sum(x['owner']==actor for x in live)<s['limits']['per_actor_cells'],'ACTOR_QUOTA','bounded concurrent preparations')
            assets=set(c['assets'])|{a for x in live for a in x['assets']}
            require(sum(self.assets[a]['bytes'] for a in assets)<=s['limits']['resident_bytes'],'RESIDENT_BUDGET','deduplicated planned bytes exceed budget')
            admissions.append(tick);s['admissions'][actor]=admissions;c['gate']=op;c['lifecycle']='fetching'
        elif op in ('STAGE','VERIFY','DECODE'):
            require((op=='STAGE' and gate=='ADMIT' and phase=='fetching') or (op=='VERIFY' and gate=='STAGE' and phase=='fetching') or (op=='DECODE' and gate=='VERIFY' and phase=='verified'),'ORDER','stage, verify and decode are distinct gates')
            require(sum(self.assets[a]['bytes'] for a in c['assets'])<=s['limits']['resident_bytes'],'IO_BUDGET','bounded bytes per operation')
            for identifier in c['assets']:
                asset=self.assets[identifier];data=self._read(asset,s)
                if op=='DECODE':c['decoded'][identifier]=self._decode(asset,data)
                s['cache'][identifier]={'sha256':asset['sha256'],'bytes':asset['bytes'],'last_tick':tick}
            pinned={a for other in s['cells'].values() if other['gate'] not in TERMINAL|{'OBSERVE','PREDICT'} for a in other['assets']}
            for identifier in sorted(list(s['cache']),key=lambda a:(s['cache'][a]['last_tick'],a)):
                if len(s['cache'])<=s['limits']['assets'] and sum(a['bytes'] for a in s['cache'].values())<=s['limits']['resident_bytes']:break
                if identifier not in pinned:del s['cache'][identifier]
            if op=='STAGE':c['gate']=op;c['staged_bytes']=sum(self.assets[a]['bytes'] for a in c['assets'])
            elif op=='VERIFY':c['gate']=op;c['lifecycle']='verified'
            else:c['lifecycle']='decoded'
            effect['verified_bytes']=sum(self.assets[a]['bytes'] for a in c['assets'])
        elif op=='INSTANTIATE':
            require(gate=='VERIFY' and phase=='decoded','ORDER','decoded resources required');c['instance']={'id':cell_id+':'+str(c['generation']),'resource_ids':list(c['assets']),'adapter':'portable metadata/AABB','native_instantiation':'NOT_RUN'};c['lifecycle']='instantiated'
        elif op=='COLLISION_READY':
            require(gate=='VERIFY' and phase=='instantiated','ORDER','instantiation required')
            require(any(d['decoder']=='collision_aabb' for d in c['decoded'].values()),'COLLISION_NOT_READY','portable spawn-checked volume required; opaque mesh is insufficient');c['lifecycle']='collision_ready'
        elif op=='RESERVE':
            require(gate=='VERIFY' and phase=='collision_ready','ORDER','collision and spawn validation required');c['gate']=op;c['reservation']={'owner':actor,'path_revision':c['observation']['path_revision'],'catalog_version':self.manifest['version'],'expires_tick':min(c['expires_tick'],tick+30)}
        elif op=='ACTIVATE':
            require(gate=='RESERVE' and phase=='collision_ready' and tick<c['reservation']['expires_tick'],'RESERVATION','live reservation required')
            fields(actual,('actor','path_revision','catalog_version','position','observed_tick'))
            require(actual['actor']==actor and type(actual['path_revision']) is int and actual['path_revision']==c['reservation']['path_revision'] and actual['catalog_version']==self.manifest['version'] and type(actual['observed_tick']) is int and 0<=actual['observed_tick']<=tick and tick-actual['observed_tick']<=5,'ACTUAL_PRECONDITION','fresh actual World actor/path/catalog required')
            require(any(d['decoder']=='collision_aabb' and inside(actual['position'],d) for d in c['decoded'].values()),'ACTUAL_POSITION','actor must already be in verified portable safe volume')
            for identifier in c['assets']:self._read(self.assets[identifier],s)
            c['gate']=op;c['lifecycle']='active';s['metrics']['activation_count']+=1;effect['type']='cell_activation_candidate';effect['actual_position']=copy.deepcopy(actual['position']);effect['requires_world_commit']=True
        elif op=='RETIRE':require(gate=='ACTIVATE' and phase=='active','ORDER','active cell required');c['gate']=op;c['lifecycle']='retiring'
        elif op=='CACHE':require(gate=='RETIRE' and phase=='retiring','ORDER','retiring cell required');c['gate']='RETIRED';c['lifecycle']='cached';c['instance']=None
        elif op in ('CANCEL','EXPIRE','FAIL'):
            require(gate not in TERMINAL|{'ACTIVATE','RETIRE'},'ORDER','only inactive preparation may cancel/expire/fail')
            if op=='EXPIRE':require(tick>=expiry_tick(c),'NOT_EXPIRED','preparation or reservation expiry has not arrived')
            if op=='FAIL':require(isinstance(args['reason'],str) and 1<=len(args['reason'])<=128,'FAILURE','bounded diagnostic reason');effect['reason']=args['reason']
            c['gate']={'CANCEL':'CANCELLED','EXPIRE':'EXPIRED','FAIL':'FAILED'}[op];c['lifecycle']={'CANCEL':'cancelled','EXPIRE':'expired','FAIL':'failed'}[op];c['reservation']=None;c['instance']=None;s['metrics']['wasted_stage_bytes']+=c['staged_bytes']
        else:raise StageRefused('OPERATION','gate name is not an invocable operation')
        return effect

def bootstrap_manifest(repo_root):
    """Operator-only bootstrap from this fixed allowlist; no player-supplied path."""
    known=[('hero-mesh','unity/Assets/HOMELESS/Content/Characters/Citizen.fbx','mesh','opaque_bytes'),
           ('hero-materials','unity/Assets/HOMELESS/Content/Characters/materials.json','material','json'),
           ('hero-skin','unity/Assets/HOMELESS/Content/Characters/Textures/young_lightskinned_male_diffuse.png','material','opaque_bytes'),
           ('arrival-music','unity/Assets/HOMELESS/Audio/original_arrival_motif.wav','music','pcm_wave'),
           ('rain-audio','unity/Assets/HOMELESS/Audio/synthetic_rain_wind_loop.wav','ambience','pcm_wave'),
           ('greeting-voice','unity/Assets/HOMELESS/Content/Speech/a9263fd7099a3fa59e458fdf5d33ac88c395cc40ec3fe7e267aa20d3faca2a44.wav','voice','pcm_wave')]
    assets=[];root=Path(repo_root).resolve()
    for identifier,path,kind,decoder in known:
        target=root/path;require(target.is_file() and not target.is_symlink() and target.resolve().is_relative_to(root),'BOOTSTRAP','known local original/CC0 content required')
        size=target.stat().st_size;require(1<=size<=32*1024*1024,'BOOTSTRAP','bounded file')
        with target.open('rb') as source:data=source.read(size+1)
        require(len(data)==size,'BOOTSTRAP','file changed while reading')
        assets.append({'id':identifier,'path':path,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'kind':kind,'decoder':decoder})
    return {'schema':'dark.stage-manifest/1','version':'local-bootstrap-v1','assets':assets}
