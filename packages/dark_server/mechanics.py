"""Learned, witnessed synthetic topology mechanics using the actual C# kernel.

Authority belongs to World transactions. The bridge grants no rights. Source
coordinates stay immutable; this adapter animates a separate synthetic chart.
Rigid bodies, collision meshes and native straddler handling remain unverified.
"""
import copy
import hashlib
import json
import math
from pathlib import Path
import random

ROOT=Path(__file__).resolve().parents[2]
ANCHOR='osm/node/1603574189'
MOVING='fictional/tampa/spruce-branches'
WEST='osm/node/2057042478'
EAST='osm/node/4520926406'
FIXTURE_HASH='8abae87f2866dd3a43106c9c77f8f65613245c691d2111949b1b53339ec6bfef'


def fixture():
    raw=(ROOT/'data/geography/derived/tampa-two-plate-fixture.json').read_bytes()
    if hashlib.sha256(raw).hexdigest()!=FIXTURE_HASH:raise ValueError('pinned plate fixture changed')
    return json.loads(raw)


def node_key(value):return value.replace('/',':')
def kernel_key(value):return value.replace('osm:node:','osm/node/') if value else None


def initialize(content):
    if content.get('mechanics')!='tampa-plate/1':return {}
    f=fixture();plate=copy.deepcopy(f['plate_world']);plate['occupants']=[]
    if not all(node_key(n['id']) in content['nodes'] for n in plate['nodes']):raise ValueError('plate nodes missing')
    return {'plate':plate,'plate_transition':None,'synthetic_nodes':{},'learning':{},'topology_witnesses':[]}


def nodes(state):
    return {key:dict(value,**state.get('synthetic_nodes',{}).get(key,{})) for key,value in state['content']['nodes'].items()}


def edges(state):
    if 'plate' not in state:return state['content']['edges']
    plate_nodes={node_key(n['id']) for n in state['plate']['nodes']}
    rest=[e for e in state['content']['edges'] if not (e['a'] in plate_nodes and e['b'] in plate_nodes)]
    modes=['walk','guided','drive','taxi','bus','bike','scooter','motorcycle']
    return rest+[{'id':'synthetic:'+str(i),'a':node_key(e['a']),'b':node_key(e['b']),'modes':modes,
                  'factuality':'admitted synthetic topology'} for i,e in enumerate(state['plate']['edges'])]


def xyz_geodetic(xyz):
    """WGS84 ECEF/ENU conversion at the pinned source chart, h=0 assumption."""
    lat,lon=math.radians(27.9594638),math.radians(-82.5054865)
    a=6378137.;e2=1-(1-1/298.257223563)**2
    radius=a/math.sqrt(1-e2*math.sin(lat)**2)
    base=(radius*math.cos(lat)*math.cos(lon),radius*math.cos(lat)*math.sin(lon),radius*(1-e2)*math.sin(lat))
    east,up,north=xyz
    x=base[0]-math.sin(lon)*east-math.sin(lat)*math.cos(lon)*north+math.cos(lat)*math.cos(lon)*up
    y=base[1]+math.cos(lon)*east-math.sin(lat)*math.sin(lon)*north+math.cos(lat)*math.sin(lon)*up
    z=base[2]+math.cos(lat)*north+math.sin(lat)*up
    p=math.hypot(x,y);phi=math.atan2(z,p*(1-e2))
    for _ in range(10):
        n=a/math.sqrt(1-e2*math.sin(phi)**2)
        phi=math.atan2(z+e2*n*math.sin(phi),p)
    n=a/math.sqrt(1-e2*math.sin(phi)**2);h=p/math.cos(phi)-n
    return {'lat':math.degrees(phi),'lon':math.degrees(math.atan2(y,x)),'alt':h}


def sample(curve,t):
    if curve['kind']=='linear_relocation':
        return [a+(b-a)*t for a,b in zip(curve['start_xyz_m'],curve['end_xyz_m'])]
    theta=math.radians(curve['start_angle_degrees']+curve['rotation_degrees']*t)
    x,y,z=curve['local_xyz_m'];cx,cy,cz=curve['center_xyz_m']
    return [cx+x*math.cos(theta)-z*math.sin(theta),cy+y,cz+x*math.sin(theta)+z*math.cos(theta)]


def learn(state,actor,args):
    from .world import require,digest
    require(set(args)=={'lesson','answer'} and args['lesson']=='spruce-quarter-turn' and 'plate' in state,
            'LESSON','unknown operative lesson','HD-067')
    path=[node_key(WEST),node_key(ANCHOR),'osm:node:8066816959']
    require(set(path)<=set(actor['knowledge']),'UNOBSERVED_PATTERN','walk both branches and return before learning','HD-067')
    require(args['answer']=='quarter-turn-left','PATTERN_REFUSED','the authored chart target is a positive 90-degree XZ rotation','HD-067')
    # This lesson teaches an explicit coordinate correspondence to an authored
    # chart of the SAME sourced path. It does not claim a discovered second city.
    table={n['id']:n['local_xyz_m'] for n in fixture()['plate_world']['nodes']}
    points=[table[kernel_key(p)] for p in path]
    vectors=[[b[0]-a[0],b[2]-a[2]] for a,b in zip(points,points[1:])]
    target=[[-v[1],v[0]] for v in vectors]
    rotated=[[-v[1],v[0]] for v in vectors]
    scale=sum(math.hypot(*v) for v in vectors)
    residual=sum(math.dist(a,b) for a,b in zip(target,rotated))/scale
    lengths=[math.hypot(*v) for v in vectors]
    turn=math.atan2(vectors[0][0]*vectors[1][1]-vectors[0][1]*vectors[1][0],sum(a*b for a,b in zip(*vectors)))
    rng=random.Random(672025);null=[]
    for _ in range(32):
        angle=rng.uniform(-math.pi,math.pi)
        transformed=[[x*math.cos(angle)-z*math.sin(angle),x*math.sin(angle)+z*math.cos(angle)] for x,z in vectors]
        null.append(sum(math.dist(a,b) for a,b in zip(target,transformed))/scale)
    witness={'source_path':path,'source_fixture_sha256':FIXTURE_HASH,'plate_revision':state['plate']['revision'],
             'transform':'positive 90-degree XZ rotation','target_factuality':'authored chart of same sourced path',
             'signature':{'turn_radians':turn,'length_ratio':lengths[1]/lengths[0],
                 'junction_degrees':[sum(p in (node_key(e['a']),node_key(e['b'])) for e in fixture()['source_graph']['edges']) for p in path]},
             'residual':residual,'null_model':'32 seeded uniformly rotated charts; diagnostic lesson baseline, not a statistical discovery',
             'null_scores':null,'false_matches_under_0_01':sum(v<.01 for v in null),'units':'dimensionless normalized Euclidean residual'}
    witness['digest']=digest(witness)
    state['learning'][actor['id']]=witness
    if 'plate-rewrite' not in actor['skills']:actor['skills'].append('plate-rewrite')
    return {'skill':'plate-rewrite','witness':witness}


def rewrite(state,actor,args):
    from .world import Refused,require
    from .kernel import KernelBridge,KernelError
    require(set(args)=={'direction','policy'},'ARGUMENTS','direction and policy required')
    require('plate-rewrite' in actor['skills'] and actor['id'] in state.get('learning',{}),
            'UNLEARNED','a witnessed lesson is required','HD-067')
    require(not state.get('plate_transition') and not state['journeys'],'TRANSITION_BUSY','finish current journeys first','HD-065')
    require(args['direction'] in ('forward','inverse') and args['policy'] in ('RigidCarriage','WitnessedRelocation','RefuseWhileOccupied'),
            'REWRITE_POLICY','registered direction and occupant policy required','HD-065')
    plate=copy.deepcopy(state['plate']);is_forward=plate['revision']%2==0
    require((args['direction']=='forward')==is_forward,'REWRITE_DIRECTION','only the corresponding forward or inverse operation is available','HD-064')
    require(actor['node'] and kernel_key(actor['node']) in {n['id'] for n in plate['nodes']},'REWRITE_RANGE','stand on this chart')
    plate_nodes={n['id']:n for n in plate['nodes']};occupants=[]
    for kind in ('actors','vehicles'):
        for entity in state[kind].values():
            node=kernel_key(entity['node'])
            if node in plate_nodes:
                require(not entity.get('manual'),'MOVING_OCCUPANT','stop manual input before rewriting','HD-065')
                occupants.append({'id':entity['id'],'node_id':node,'boundary_straddler':False})
            elif entity['node'] is None:
                raise Refused('OCCUPANCY_UNRESOLVED','between-node entities need a supported footprint before rewriting','HD-065')
    plate['occupants']=occupants
    request=copy.deepcopy(fixture()['rewrite_request'])
    request.update(expected_revision=plate['revision'],policy=args['policy'],start_tick=state['tick'],duration_ticks=8,operation_budget=10000,
                   authority_witness_id='world:'+str(state['revision']+1)+':actor:'+actor['id'])
    if not is_forward:
        request['remove'],request['add']=request['add'],request['remove'];request['rotation_degrees']=-90
    request['destinations']={o['id']:ANCHOR for o in occupants if plate_nodes[o['node_id']]['plate_id']==MOVING} if args['policy']=='WitnessedRelocation' else {}
    try:result=KernelBridge().call('plate_apply',{'world':plate,'request':request})
    except KernelError as exc:raise Refused(exc.code,str(exc),'HD-063') from exc
    require(result['status']=='ADMITTED','KERNEL_REFUSED',result.get('reason','kernel refused'),'HD-064')
    require(result['authority_granted'] is False,'KERNEL_PROTOCOL','mathematical adapter cannot grant authority')
    state['plate']=result['next_state']
    state['plate_transition']={'start':state['tick'],'end':state['tick']+8,'transports':result['witness']['transports'],
        'before_plate':plate,'projection':result['source_projection'],'rotation':request['rotation_degrees'],
        'physical_validation':'NOT_RUN'}
    state['topology_witnesses']=(state['topology_witnesses']+[result['witness']])[-32:]
    return {'witness':result['witness'],'plate_revision':result['revision'],'native_collision_validation':'NOT_RUN',
            'source_coordinates_unchanged':True,'transport_finishes_at_tick':state['tick']+8}


def advance(state):
    pending=state.get('plate_transition')
    if not pending:return
    t=max(0,min(1,(state['tick']-pending['start'])/(pending['end']-pending['start'])))
    before=pending['before_plate'];plates={p['id']:p for p in before['plates']}
    for node in before['nodes']:
        plate=plates[node['plate_id']]
        curve={'kind':'rigid_rotation_y','center_xyz_m':plate['center_xyz_m'],
               'start_angle_degrees':plate['angle_degrees'],'rotation_degrees':pending['rotation'] if plate['id']==MOVING else 0,
               'local_xyz_m':node['local_xyz_m']}
        state['synthetic_nodes'][node_key(node['id'])]=xyz_geodetic(sample(curve,t))
    for transport in pending['transports']:
        entity=state['actors'].get(transport['entity_id']) or state['vehicles'].get(transport['entity_id'])
        if entity is None:raise ValueError('committed transport entity missing')
        entity['position']=xyz_geodetic(sample(transport['curve'],t))
        if t==1:entity['node']=node_key(transport['destination_node'])
    if t==1:state['plate_transition']=None


def observation(state):
    if 'plate' not in state:return None
    pending=state['plate_transition']
    return {'revision':state['plate']['revision'],'transition':{k:pending[k] for k in ('start','end','rotation','physical_validation')} if pending else None,
            'synthetic_nodes':state['synthetic_nodes'],
            'lesson':{'id':'spruce-quarter-turn','required_places':[node_key(WEST),node_key(ANCHOR),'osm:node:8066816959'],
                      'prompt':'Walk the west branch and the north branch. Match a quarter-turn left in the authored chart.',
                      'affordance':'a witnessed rewrite of this fictional street connection'},
            'source_geography_unchanged':True,'physical_validation':'NOT_RUN'}
