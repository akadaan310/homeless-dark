"""Read-only source-backed global overview for an authenticated World consumer.

The host authenticates requests; this helper grants no authority and never moves
or realizes an actor. Sampling a dense mesh does not improve the source's coarse
resolution. MSL-like relief is not WGS84 ellipsoidal height or native collision.
"""
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import sys
import threading
from collections import OrderedDict

ROOT=Path(__file__).resolve().parents[2]
PINNED={'overview.sqlite':'fc707bf2487d5099de9aa7c715a751d623b2d61c264c5c44d4c252ee7a3a9765',
        'population-allocation.json':'6c6343252d49bed0238cf82e0599a36b93b1aa95ed29fcb5dd46a425e51d03bb',
        'terrain/heights.i16':'5851f3715c7a937d95c016940447525758e37b8eb821b37e99078f90d443a0ae'}
RADIUS=6371008.8
_MODULE_LOCK=threading.Lock()

class GeographyRefused(Exception):
    def __init__(self,code,witness):self.code=code;self.witness=str(witness);super().__init__(code+': '+self.witness)
    def as_dict(self):return {'status':'REFUSED','code':self.code,'witness':self.witness,'native_collision_ready':False}
def require(ok,code,witness):
    if not ok:raise GeographyRefused(code,witness)
def bounded(value,low,high):return type(value) in (int,float) and low<=value<=high and math.isfinite(value)
def coordinates(lat,lon):
    require(bounded(lat,-90,90) and bounded(lon,-180,180),'COORDINATE','finite WGS84 latitude/longitude required')
    return float(lat),0. if abs(lat)==90 else -180. if lon==180 else float(lon)
def load_module(path,name):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def tangent_point(latitude,longitude,east,north):
    """Spherical exponential map with a canonical pole frame; no cos(lat) division."""
    radius=math.hypot(east,north)
    if radius==0:return coordinates(latitude,longitude)
    lat,lon=math.radians(latitude),math.radians(longitude);delta=radius/RADIUS
    origin=(math.cos(lat)*math.cos(lon),math.cos(lat)*math.sin(lon),math.sin(lat))
    e=(-math.sin(lon),math.cos(lon),0.)
    n=(-math.sin(lat)*math.cos(lon),-math.sin(lat)*math.sin(lon),math.cos(lat))
    point=[origin[i]*math.cos(delta)+(e[i]*east+n[i]*north)/radius*math.sin(delta) for i in range(3)]
    latitude=math.degrees(math.atan2(point[2],math.hypot(point[0],point[1])))
    longitude=(math.degrees(math.atan2(point[1],point[0]))+180)%360-180
    return coordinates(latitude,longitude)

class GeographyService:
    """Load/hash pinned installed data once; view() performs only bounded local reads.

    Public response defaults to33² samples over2km. Host HTTP layer must bind
    access to an authenticated session and enforce request rate/output limits.
    Current migrations/individual memories belong to the authoritative population
    ledger; these optional identities describe immutable initial allocation only.
    """
    def __init__(self,repo_root=ROOT):
        self.root=Path(repo_root).resolve();self.data=self.root/'data/geography/global';self._lock=threading.Lock();self._files={};self._height_cache=OrderedDict();self._environment_cache=OrderedDict()
        try:
            for name,expected in PINNED.items():
                path=self.data/name;sha=hashlib.sha256()
                with path.open('rb') as source:
                    for block in iter(lambda:source.read(1024*1024),b''):sha.update(block)
                require(sha.hexdigest()==expected,'SOURCE_INTEGRITY','pinned '+name+' changed');self._files[name]=self._signature(path)
            self.layers=load_module(self.root/'tools/geography/global_layers.py','dark_global_layers_service')
            # Existing standalone terrain tool imports its sibling by name.
            # Bind it only while loading, under one process-local import lock.
            with _MODULE_LOCK:
                previous=sys.modules.get('global_layers');sys.modules['global_layers']=self.layers
                try:terrain=load_module(self.root/'tools/geography/global_terrain.py','dark_global_terrain_service')
                finally:
                    if previous is None:sys.modules.pop('global_layers',None)
                    else:sys.modules['global_layers']=previous
            self.terrain=terrain.Terrain(self.data/'terrain')
            require(self.terrain.meta['runtime_file']['sha256']==PINNED['terrain/heights.i16'],'SOURCE_INTEGRITY','terrain manifest fingerprint')
            require(self.terrain.meta['grid']['step_degrees']==.1 and self.terrain.meta['gaussian_full_width_km']==32,'SOURCE_RESOLUTION','pinned derivative resolution')
            self.allocation=json.loads((self.data/'population-allocation.json').read_bytes());self.shards={s['code']:s for s in self.allocation['shards']}
            require(self.allocation['epoch']==2024 and self.allocation['demographic_estimate']==8140897523,'POPULATION_SOURCE','pinned common epoch allocation')
            require(sum(s['population'] for s in self.shards.values())==self.allocation['demographic_estimate'],'POPULATION_CONSERVATION','exact shard conservation')
            self._files['terrain/metadata.json']=self._signature(self.data/'terrain/metadata.json')
        except GeographyRefused:raise
        except (OSError,ValueError,KeyError,TypeError) as exc:raise GeographyRefused('SOURCE_UNAVAILABLE','installed verified global data required') from exc
    @staticmethod
    def _signature(path):
        value=path.stat();return value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns
    def _unchanged(self):
        try:
            for name,signature in self._files.items():require(self._signature(self.data/name)==signature,'SOURCE_CHANGED','reload and verify changed source before serving')
        except OSError as exc:raise GeographyRefused('SOURCE_UNAVAILABLE','installed source missing') from exc
    def population_region(self,code):
        require(isinstance(code,str) and code in self.shards,'POPULATION_REGION','known exact source economy or explicit WLD_UNASSIGNED required')
        shard=self.shards[code]
        return {'code':code,'name':shard['name'],'region':shard['region'],'population_2024':shard['population'],
                'allocation_epoch':2024,'range_start':shard['range_start'],'range_end_exclusive':shard['range_end_exclusive'],
                'cohort_count':shard['cohort_count'],'spatial_assignment':None,'factuality':'source estimate allocated to synthetic non-spatial virtual members'}
    def sample_height(self,latitude,longitude):
        """Return approximate MSL relief as float;512-entry canonical coordinate cache."""
        point=coordinates(latitude,longitude)
        with self._lock:
            self._unchanged()
            if point in self._height_cache:
                self._height_cache.move_to_end(point);return self._height_cache[point]
            try:value=self.terrain.height(*point)['height_m_msl']
            except (OSError,ValueError,KeyError,TypeError) as exc:raise GeographyRefused('SOURCE_QUERY','verified height query failed') from exc
            self._height_cache[point]=value
            if len(self._height_cache)>512:self._height_cache.popitem(last=False)
            return value
    def _environment(self,latitude,longitude):
        point=(latitude,longitude)
        if point in self._environment_cache:
            self._environment_cache.move_to_end(point);return self._environment_cache[point]
        result=self.layers.resolve(self.data/'overview.sqlite',latitude,longitude)
        self._environment_cache[point]=result
        if len(self._environment_cache)>128:self._environment_cache.popitem(last=False)
        return result
    def country(self,latitude,longitude):
        """Exact unique NaturalEarth code present in WDI; no invented ocean/unknown country."""
        point=coordinates(latitude,longitude)
        with self._lock:
            self._unchanged()
            try:environment=self._environment(*point)
            except (OSError,ValueError,KeyError,TypeError) as exc:raise GeographyRefused('SOURCE_QUERY','verified country query failed') from exc
            self._unchanged()
        codes={item.split(':',1)[0] for item in environment['countries']}
        require(len(codes)==1,'COUNTRY_AMBIGUOUS','no unique administrative source code at coordinate')
        code=next(iter(codes));require(code in self.shards and code!='WLD_UNASSIGNED','COUNTRY_UNMAPPED','source code has no exact WDI economy mapping')
        return code
    def population_identity(self,identity):
        require(isinstance(identity,str) and re.fullmatch(r'wb2024/[A-Z0-9_]{3,32}/(?:0|[1-9][0-9]{0,12})',identity),'POPULATION_ID','canonical wb2024/source-code/ordinal required')
        _,code,text=identity.split('/');shard=self.population_region(code);ordinal=int(text)
        require(ordinal<shard['population_2024'],'POPULATION_RANGE','ordinal outside source allocation')
        return {'id':identity,'origin':code,'ordinal':ordinal,'global_ordinal':shard['range_start']+ordinal,'cohort':ordinal%shard['cohort_count'],
                'allocation_epoch':2024,'position':None,'realized':False,'history_lookup':'not performed; immutable allocation only',
                'real_person_identity':False}
    def view(self,latitude,longitude,width=33,span_m=2000,population_id=None,economy_code=None):
        latitude,longitude=coordinates(latitude,longitude)
        require(type(width) is int and 3<=width<=33 and width%2==1,'GRID_BUDGET','odd width3..33 required')
        require(bounded(span_m,1,10000),'REGION_BUDGET','region side length1..10000metres required')
        identity=self.population_identity(population_id) if population_id is not None else None
        region=self.population_region(economy_code) if economy_code is not None else None
        with self._lock:
            self._unchanged()
            try:
                environment=self._environment(latitude,longitude)
                center_height=self.terrain.height(latitude,longitude)['height_m_msl']
                latitudes=[];longitudes=[];heights=[];step=span_m/(width-1)
                for row in range(width):
                    for column in range(width):
                        lat,lon=tangent_point(latitude,longitude,-span_m/2+column*step,-span_m/2+row*step)
                        latitudes.append(lat);longitudes.append(lon);heights.append(self.terrain.height(lat,lon)['height_m_msl'])
            except (OSError,ValueError,KeyError,TypeError) as exc:raise GeographyRefused('SOURCE_QUERY','verified source query failed') from exc
            self._unchanged()
        administrative=[]
        require(len(environment['countries'])<=16,'ADMIN_BUDGET','too many overlapping source administrative claims')
        for item in environment['countries']:
            code,name=item.split(':',1)
            administrative.append({'code':code,'name':name,'population_2024':self.shards[code]['population'] if code in self.shards else None,
                                   'population_mapping':'exact source economy code' if code in self.shards else 'no exact economy mapping; no population inferred'})
        result={'schema':'dark.geography-view/1','center':{'latitude':latitude,'longitude':longitude,'terrain_height_m_msl':center_height},
                'grid':{'width':width,'height':width,'span_m':span_m,'step_m':step,'ordering':'south-to-north rows; west-to-east columns',
                        'horizontal_construction':'spherical tangent exponential map, mean Earth radius6371008.8m','heights_m_msl':heights,'latitudes':latitudes,'longitudes':longitudes},
                'environmental_state':environment['state'],'administrative':administrative,
                'water':{'classification_at_center':environment['state'],'surface_height_m_msl':0 if environment['state']=='ocean' else None,
                         'surface_is_rendering_assumption':environment['state']=='ocean','terrain_contains_bathymetry':True,'grid_water_mask':None},
                'height_datum':self.terrain.meta['height_datum'],'horizontal_crs':'WGS84 geographic latitude/longitude',
                'rendering_vertical_reference':{'assumed_geoid_offset_m':0,'ellipsoid_conversion_performed':False,'scope':'explicit visual approximation only; preserve source MSL separately'},
                'resolution':{'terrain_spacing_degrees':.1,'terrain_latitude_spacing_m':math.radians(.1)*RADIUS,'terrain_longitude_spacing_m_at_center':math.radians(.1)*RADIUS*abs(math.cos(math.radians(latitude))),
                              'gaussian_full_width_km':32,'cartographic_scale':'1:10,000,000','requested_mesh_spacing_adds_source_detail':False},
                'sources':{'natural_earth_revision':self.layers.PIN,'overview_sha256':PINNED['overview.sqlite'],
                           'terrain_release':self.terrain.meta['source']['release'],'terrain_source_sha256':self.terrain.meta['source']['sha256'],
                           'terrain_runtime_sha256':PINNED['terrain/heights.i16'],'population_allocation_sha256':PINNED['population-allocation.json'],
                           'attribution':['Natural Earth public domain','GEBCO2025; GMT6arcminute filtered derivative','World Bank WDI SP.POP.TOTL2024, CC BY4.0']},
                'population':{'world_estimate_2024':self.allocation['demographic_estimate'],'observed_economy_total_2024':self.allocation['observed_economy_total'],
                              'unassigned_residual_2024':self.shards['WLD_UNASSIGNED']['population'],'realized_individuals':0,'identity':identity,'requested_region':region,
                              'spatial_precision':'country/economy totals and non-spatial cohorts; no density raster or local resident count'},
                'native_collision_ready':False,'street_precision':False,'authority_granted':False,'world_mutation_performed':False,
                'limitations':['Complete coarse source coverage; source gaps/boundary ambiguity remain explicit.',
                               'Center land/water/admin classification is not a per-vertex shoreline mask.',
                               'MSL-like heights lack geoid conversion; relative visual relief does not certify surveyed altitude.',
                               'No detailed roads/buildings, native terrain collision, navigation or realized population are inferred.']}
        require(len(json.dumps(result,separators=(',',':'),allow_nan=False).encode())<=262144,'OUTPUT_BUDGET','maximum256KiB geography response')
        return result
