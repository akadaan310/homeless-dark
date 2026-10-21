#!/usr/bin/env python3
"""Reproduce authored gameplay content from pinned source geometry, without network.

Source coordinates retain their source identity. All route permissions, airport
links, vehicles, characters and walking regions are explicit fictional content.
Neither this importer nor its JSON asserts real-world access or safe collision.
"""
import csv
import hashlib
import json
import importlib.util
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT/'assets/content/world/opening.json'


def build():
    sys.path.insert(0,str(ROOT/'packages'))
    from dark_server.geography import GeographyService
    global_geo=GeographyService(ROOT)
    fixture_path=ROOT/'data/geography/derived/tampa-two-plate-fixture.json'
    airports_path=ROOT/'data/geography/sources/ourairports-airports.csv'
    fixture=json.loads(fixture_path.read_text())
    key=lambda v:v.replace('/',':')
    anchor=key(fixture['embedding']['anchor_node_id'])
    nodes={key(n['id']):{'lat':n['latitude_deg'],'lon':n['longitude_deg'],'alt':0.,'ready':True,
        'source_id':n['id'],'label':'Spruce junction' if key(n['id'])==anchor else 'Street '+str(n['osm_node_id']),
        'altitude_datum':'authored reference plane; source height unknown','native_collision_ready':False,
        'readiness_scope':'headless route simulation'} for n in fixture['source_graph']['nodes']}
    phi=math.radians(nodes[anchor]['lat']);e2=1-(1-1/298.257223563)**2
    prime=6378137/math.sqrt(1-e2*math.sin(phi)**2)
    apron='fictional:cafe-apron'
    nodes[apron]={'lat':nodes[anchor]['lat'],'lon':nodes[anchor]['lon']+math.degrees(14/(prime*math.cos(phi))),
        'alt':0.,'ready':True,'source_id':'authored:cafe-frontage','label':'Café entrance',
        'altitude_datum':'authored local ground=0','native_collision_ready':False,'readiness_scope':'headless authored geometry'}
    meridian=6378137*(1-e2)/(1-e2*math.sin(phi)**2)**1.5
    def authored_node(name,east,north,label,public=True):
        nodes[name]=dict(nodes[apron],lat=nodes[anchor]['lat']+math.degrees(north/meridian),
            lon=nodes[anchor]['lon']+math.degrees(east/(prime*math.cos(phi))),source_id='authored:'+name,label=label,public=public)
    authored_node('fictional:mira-place',12.6,.2,'Café greeting',False)
    authored_node('fictional:omar-place',16.4,.2,'Café work entrance',False)
    authored_node('fictional:sedan-parking',14,-2.4,'Parked sedan')
    authored_node('fictional:taxi-stop',20,-2.4,'Taxi stop')
    authored_node('fictional:air-transfer',26,-5,'Authored air transfer')
    authored_node('fictional:palm',-5,5,'Café palm',False)
    authored_node('fictional:counter-cup',17.4,8.35,'Counter cup',False)
    population_slots=[]
    for index,east in enumerate((27,30,33,36)):
        name='fictional:neighbor-place:'+str(index);population_slots.append(name)
        authored_node(name,east,1,'Neighborhood meeting place',False)
    edges=[]
    # This fictional playable street graph uses original coordinates/connectivity.
    # It deliberately does not advertise OSM access tags as verified permissions.
    for i,e in enumerate(fixture['source_graph']['edges']):
        edges.append({'id':'street:'+str(i),'a':key(e['a']),'b':key(e['b']),
            'modes':['walk','guided','drive','taxi','bus','bike','scooter','motorcycle'],
            'factuality':'fictional travel permission on sourced centreline geometry','real_access_validated':False})
    edges.append({'id':'fictional:cafe-frontage','a':apron,'b':anchor,
        'modes':['walk','guided','drive','taxi','bike','scooter','motorcycle'],
        'factuality':'authored frontage transfer; not a real measured driveway'})
    for name in ('fictional:mira-place','fictional:omar-place','fictional:sedan-parking','fictional:taxi-stop','fictional:air-transfer'):
        edges.append({'id':name+':approach','a':apron,'b':name,
            'modes':['walk','guided','drive','taxi','bike','scooter','motorcycle'],
            'factuality':'authored local approach; not a measured real-world driveway'})
    for name in population_slots:
        edges.append({'id':name+':approach','a':apron,'b':name,'modes':['walk','guided'],
            'factuality':'authored fictional population encounter approach; no real resident location is inferred'})
    selected={'KTPA','KLAX','EGLL','RJTT','YSSY','FACT','OMDB'}
    with airports_path.open() as stream:
        for row in csv.DictReader(stream):
            if row['ident'] not in selected:continue
            nodes['airport:'+row['ident']]={'lat':float(row['latitude_deg']),'lon':float(row['longitude_deg']),
                'alt':global_geo.sample_height(float(row['latitude_deg']),float(row['longitude_deg'])),'ready':True,'source_id':'ourairports:'+row['id'],'label':row['name'],
                'source_elevation_ft':row['elevation_ft'],'altitude_datum':'authored coarse GEBCO support: approximate MSL with geoid separation assumed0; source elevation retained separately',
                'native_collision_ready':False,'readiness_scope':'headless route simulation'}
    # An explicit authored helicopter transfer avoids inventing a road to the
    # airport outside the acquired OSM extract. No real flight schedule is claimed.
    edges.append({'id':'fictional:opening-air-transfer','a':'fictional:air-transfer','b':'airport:KTPA','modes':['helicopter'],
                  'factuality':'authored air corridor; not an actual scheduled or permitted flight'})
    for airport in sorted(selected-{'KTPA'}):
        edges.append({'id':'fictional:flight:'+airport,'a':'airport:KTPA','b':'airport:'+airport,
                      'modes':['aircraft'],'factuality':'authored great-circle journey; no actual airline, airspace or weather clearance'})
    actors={
        'mira':{'node':'fictional:mira-place','controller':'npc','sociability':.82,'duty':.2,'goal':'socialize'},
        'omar':{'node':'fictional:omar-place','controller':'npc','sociability':.25,'duty':.9,'goal':'work'},
        'lina':{'node':'osm:node:2057042478','controller':'npc','sociability':.7,'duty':.4,'goal':'socialize'},
        'london-resident':{'node':'airport:EGLL','controller':'npc','sociability':.5,'duty':.6,'goal':'work'}}
    actors['omar']['schedule']={'roles':{'home':'fictional:omar-place','work':'osm:node:2057042478','social':apron},'work_window':[0,28800]}
    actors['mira']['schedule']={'roles':{'home':'fictional:mira-place','work':'osm:node:8066816959','social':apron},'work_window':[14400,28800]}
    actors['lina']['schedule']={'roles':{'home':'osm:node:2057042478','work':'osm:node:8066816959','social':'osm:node:2057042478'},'work_window':[28800,61200]}
    vehicles={
        'civic-sedan':{'node':'fictional:sedan-parking','mode':'drive','capacity':4,'autonomous':False,'asset':'CivicSedan'},
        'civic-taxi':{'node':'fictional:taxi-stop','mode':'taxi','capacity':3,'autonomous':True,'asset':'CivicSedan'},
        'opening-shuttle':{'node':'fictional:air-transfer','mode':'helicopter','capacity':4,'autonomous':True,'asset':'RotorShuttle'},
        'civil-aircraft':{'node':'airport:KTPA','mode':'aircraft','capacity':8,'autonomous':False,'asset':'CivilAircraft'},
        'street-bus':{'node':'osm:node:2057042478','mode':'bus','capacity':16,'autonomous':True,'asset':'CityBus'},
        'cycle':{'node':apron,'mode':'bike','capacity':1,'autonomous':False,'asset':'Bicycle'}}
    spec=importlib.util.spec_from_file_location('cafe_clearance',ROOT/'tools/art/cafe_clearance.py')
    clearance=importlib.util.module_from_spec(spec);spec.loader.exec_module(clearance)
    clearance=clearance.derive()
    # The tiny authored apron volume is checked against the same body-clearance
    # rectangles used by the server; it certifies no native collider behavior.
    if any(b['bounds'][0]-.3 <= 14.5 and b['bounds'][2]+.3 >= 13.5 and
           b['bounds'][1]-.3 <= .5 and b['bounds'][3]+.3 >= -.5 for b in clearance['rectangles']):
        raise ValueError('authored apron safe volume intersects an expanded source blocker')
    volume_path=ROOT/'assets/content/world/cafe-apron-volume.json'
    volume_path.parent.mkdir(parents=True,exist_ok=True)
    volume_path.write_text(json.dumps({'schema':'dark.collision-aabb/1','min':[-.5,-.1,-.5],'max':[.5,2,.5],'spawn':[0,0,0]},sort_keys=True)+'\n')
    sys.path.insert(0,str(ROOT/'packages'))
    from dark_server.staging import bootstrap_manifest
    manifest=bootstrap_manifest(ROOT)
    manifest['assets'].append({'id':'apron-volume','path':volume_path.relative_to(ROOT).as_posix(),
        'bytes':volume_path.stat().st_size,'sha256':hashlib.sha256(volume_path.read_bytes()).hexdigest(),'kind':'collision','decoder':'collision_aabb'})
    manifest['version']='opening-'+hashlib.sha256(json.dumps(manifest['assets'],sort_keys=True).encode()).hexdigest()[:16]
    staged={'manifest':manifest,'cells':{'cafe-apron':{'node':apron,'assets':[a['id'] for a in manifest['assets']],'portable_collision':True}}}
    life={'definitions':[], 'placements':{},'public_abilities':{}}
    for entity,kind,node,abilities,radius in (
        ('building:cafe','building',apron,['set_light'],16),
        ('tree:palm','tree','fictional:palm',['glow'],8),
        ('cup:counter','cup','fictional:counter-cup',['nudge'],3),
        ('car:civic-taxi','car','fictional:taxi-stop',['signal'],5)):
        definition={'id':entity,'kind':kind,'provenance':{'source_id':'authored:'+entity,
            'source_geometry':{k:nodes[node][k] for k in ('lat','lon','alt')},'geometry_status':'fictional asset placement on sourced local chart'}}
        if kind=='car':definition['traits']={'helpfulness':.8,'duty':.3}
        life['definitions'].append(definition)
        life['placements'][entity]={'vehicle':'civic-taxi','radius_m':radius} if kind=='car' else {'node':node,'radius_m':radius}
        life['public_abilities'][entity]=abilities
    return {'schema':'dark.world-content/1','id':'earth-opening-v1','spawn':apron,'nodes':nodes,'edges':edges,'mechanics':'tampa-plate/1',
        'actors':actors,'vehicles':vehicles,'life':life,'streaming':staged,'physical_validation':'NOT_RUN',
        'population':'wb2024','population_spawns':population_slots,
        'walk_regions':[{'anchor':anchor,'bounds':[-80,-90,80,75],'blockers':[r['bounds'] for r in clearance['rectangles']],'synthetic':True,
                         'corridor_width_m':2,'free_rects':[[-7,-1.5,22,12]],
                         'scope':'headless authored clearance envelope; Unity collider readiness remains separate'}],
        'source_versions':{'tampa_fixture_sha256':hashlib.sha256(fixture_path.read_bytes()).hexdigest(),
            'airports_sha256':hashlib.sha256(airports_path.read_bytes()).hexdigest(),
            'OSM_attribution':'© OpenStreetMap contributors; ODbL-1.0',
            'permission_layer':'authored fiction; source tags are not silently converted into access grants'},
        'clearance_source':{'geometry_sha256':clearance['geometry_sha256'],'recipe_sha256':clearance['recipe_sha256']},
        'limitations':['No real road route outside the acquired Tampa extract.',
                       'Air links are authored travel corridors; schedules, airspace restrictions and live weather are not validated.',
                       'ready means route-simulation data exists; no native scene, collision or airport safety certification.',
                       'Route distance sums spherical source segments; driving lane curvature and local obstacles require native validation.']}


if __name__=='__main__':
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_text(json.dumps(build(),sort_keys=True,indent=2)+'\n')
    print(OUTPUT.relative_to(ROOT))
