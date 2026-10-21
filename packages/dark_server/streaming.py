"""World-owned adapter for local staged resources; portable/native gates stay distinct."""
import copy
import hashlib
import math
from .staging import Staging,StageRefused,scope,TERMINAL,expiry_tick


def initialize(root,content):
    if 'streaming' not in content:return {}
    from .world import require
    spec=content['streaming']
    require(isinstance(spec,dict) and set(spec)=={'manifest','cells'} and isinstance(spec['cells'],dict) and 1<=len(spec['cells'])<=16,'STREAMING_CONTENT','bounded catalog and named cells required')
    try:stage=Staging.create(root,spec['manifest'])
    except StageRefused as exc:raise_error(exc)
    for cell,definition in spec['cells'].items():
        from .world import identifier
        identifier(cell)
        require(isinstance(definition,dict) and set(definition)=={'node','assets','portable_collision'} and definition['node'] in content['nodes'] and type(definition['portable_collision']) is bool,'STREAMING_CELL','known anchor and explicit portable collision readiness')
        require(isinstance(definition['assets'],list) and 1<=len(definition['assets'])<=16 and all(isinstance(a,str) and a in stage.assets for a in definition['assets']),'STREAMING_ASSETS','manifest IDs required')
    return {'staging':stage.snapshot()}


def raise_error(exc):
    from .world import Refused
    raise Refused('STAGING_'+exc.code,exc.witness,'HD-71') from exc


def local(point,anchor):
    # Portable tangent approximation limited to the local preparation radius.
    return [math.radians((point['lon']-anchor['lon']+180)%360-180)*6371008.8*math.cos(math.radians(anchor['lat'])),
            point.get('alt',0)-anchor.get('alt',0),math.radians(point['lat']-anchor['lat'])*6371008.8]


def plan_version(state,actor):
    from .world import canonical
    trip=state['journeys'].get(actor['vehicle'] or actor['id'])
    intent=actor.get('manual')
    plan={'vehicle':actor['vehicle'],'route':trip['route'] if trip else None,'mode':trip['mode'] if trip else None,
          'paused':trip['paused'] if trip else None,'manual':intent}
    return int(hashlib.sha256(canonical(plan).encode()).hexdigest()[:12],16)


def cell_key(actor,cell):return 'cell:'+hashlib.sha256((actor+'\n'+cell).encode()).hexdigest()


def expire(root,state):
    if 'staging' not in state:return
    expired=[(key,cell['owner']) for key,cell in state['staging']['cells'].items()
        if cell['gate'] not in TERMINAL|{'ACTIVATE','RETIRE'} and expiry_tick(cell)<=state['tick']]
    if not expired:return
    try:
        stage=Staging.restore(root,state['content']['streaming']['manifest'],state['staging'])
        for key,owner in sorted(expired):
            stage.apply(owner,[scope(key,'prepare')],{'request_id':'expiry:'+str(state['tick'])+':'+str(stage.revision),
                'expected_revision':stage.revision,'cell_id':key,'operation':'EXPIRE','arguments':{}},state['tick'])
        state['staging']=stage.snapshot()
    except StageRefused as exc:raise_error(exc)


def observe(state,actor):
    if 'staging' not in state:return {'cells':{}}
    cells={}
    for name,definition in state['content']['streaming']['cells'].items():
        candidate=state['staging']['cells'].get(cell_key(actor['id'],name))
        cells[name]={'node':definition['node'],'gate':candidate['gate'] if candidate else 'UNREQUESTED',
            'lifecycle':candidate['lifecycle'] if candidate else 'unrequested',
            'native_collision':'NOT_RUN','scope':'local bytes and portable metadata',
            'expires_tick':expiry_tick(candidate) if candidate else None}
    return {'cells':cells,'metrics':copy.deepcopy(state['staging']['metrics'])}


def act(root,state,principal,operation,args):
    from .world import World,require,identifier,distance_m,SPEEDS
    from .mechanics import nodes
    World._fields(args,('cell',));name=identifier(args['cell'])
    require('staging' in state and name in state['content']['streaming']['cells'],'STREAMING_CELL','unknown prepared place')
    actor=state['actors'][principal['actor']];spec=state['content']['streaming'];definition=spec['cells'][name]
    anchor=nodes(state)[definition['node']]
    if operation in ('prepare_cell','activate_cell'):
        require(distance_m(actor['position'],anchor)<=2000,'PREPARATION_RANGE','local preparation maximum2km')
    key=cell_key(actor['id'],name)
    try:
        stage=Staging.restore(root,spec['manifest'],state['staging'])
        def apply(op,arguments=None,actual=None):
            return stage.apply(actor['id'],[scope(key,'activate' if op=='ACTIVATE' else 'prepare')],
                {'request_id':'world:'+str(state['revision'])+':'+str(stage.revision),'expected_revision':stage.revision,
                 'cell_id':key,'operation':op,'arguments':arguments or {}},state['tick'],actual=actual)
        if operation=='prepare_cell':
            trip=state['journeys'].get(actor['vehicle'] or actor['id'])
            mode=trip['mode'] if trip else 'walk';speed=SPEEDS[mode] if trip else 0
            stage_mode='fly' if mode in ('aircraft','helicopter') else 'sail' if mode in ('boat','ferry') else 'walk' if mode in ('walk','guided') else 'drive'
            apply('OBSERVE',{'assets':definition['assets'],'path':[local(actor['position'],anchor),[0,0,0]],
                'path_revision':plan_version(state,actor),'mode':stage_mode,'speed_mps':speed,'speed_confidence':.8 if trip else 0.,
                'wait_ticks':0,'observed_tick':state['tick'],'anticipated_tick':None,'visible':distance_m(actor['position'],anchor)<=60,'ttl_ticks':120})
            for op in ('PREDICT','ADMIT','STAGE','VERIFY','DECODE','INSTANTIATE'):result=apply(op)
            if definition['portable_collision']:
                for op in ('COLLISION_READY','RESERVE'):result=apply(op)
        elif operation=='activate_cell':
            require(not actor['vehicle'] and actor['id'] not in state['journeys'] and not actor.get('manual') and not state.get('plate_transition'),
                'ACTIVATION_BUSY','stationary pedestrian required for portable activation')
            result=apply('ACTIVATE',actual={'actor':actor['id'],'path_revision':plan_version(state,actor),
                'catalog_version':spec['manifest']['version'],'position':local(actor['position'],anchor),'observed_tick':state['tick']})
        elif operation=='retire_cell':
            apply('RETIRE');result=apply('CACHE')
        else:result=apply('CANCEL')
        state['staging']=stage.snapshot()
        return {'cell':name,'witness':result['witness'],'world_position_changed':False,'native_collision':'NOT_RUN',
            'scope':'portable metadata admission; no Unity activation claim'}
    except StageRefused as exc:raise_error(exc)
