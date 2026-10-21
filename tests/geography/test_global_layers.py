import copy
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('global_layers',ROOT/'tools/geography/global_layers.py')
g=importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

class GlobalLayersTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base=ROOT/'data/geography/global'
        cls.population=json.loads((cls.base/'raw/population.json').read_bytes())
        cls.economies=json.loads((cls.base/'raw/economies.json').read_bytes())

    def test_actual_source_counts_and_world_reconciliation(self):
        p=g.allocate_population(self.population,self.economies)
        self.assertEqual(p['epoch'],2024)
        self.assertEqual(p['observed_economy_count'],217)
        self.assertEqual(p['observed_economy_total'],8117484624)
        self.assertEqual(p['world_aggregate_estimate'],8140897523)
        self.assertEqual(p['unassigned_world_residual'],23412899)
        self.assertEqual(p['allocated_virtual_members'],8140897523)
        self.assertEqual(p['realized_individuals'],0)
        self.assertEqual(p['missing_source_economies'],[])
        self.assertEqual(sum(r['population'] for r in p['shards']),p['demographic_estimate'])
        self.assertEqual(sum(p['regions'].values()),p['demographic_estimate'])
        self.assertEqual(p['shards'][-1]['range_end_exclusive'],p['demographic_estimate'])
        for a,b in zip(p['shards'],p['shards'][1:]):
            self.assertEqual(a['range_end_exclusive'],b['range_start'])

    def test_allocations_reproduce_committed_bytes_and_no_aggregate_double_count(self):
        p=g.allocate_population(self.population,self.economies)
        self.assertEqual(g.canonical(p),(self.base/'population-allocation.json').read_bytes())
        self.assertNotIn('WLD',[r['code'] for r in p['shards']])
        self.assertNotIn('EAS',[r['code'] for r in p['shards']])
        self.assertEqual([r['population'] for r in p['shards'] if r['code']=='USA'],[340003797])
        self.assertEqual([r['population'] for r in p['shards'] if r['code']=='TUV'],[9646])

    def test_source_refuses_partial_mixed_epoch_duplicate_and_fractional_input(self):
        value=copy.deepcopy(self.population);value[0]['pages']=2
        with self.assertRaises(ValueError):g.allocate_population(value,self.economies)
        value=copy.deepcopy(self.population);value[1][0]['date']='2023'
        with self.assertRaises(ValueError):g.allocate_population(value,self.economies)
        value=copy.deepcopy(self.population);value[1].append(value[1][-1]);value[0]['total']+=1
        with self.assertRaises(ValueError):g.allocate_population(value,self.economies)
        for invalid in (True,0.5,-1):
            value=copy.deepcopy(self.population)
            next(r for r in value[1] if r['countryiso3code']=='USA')['value']=invalid
            with self.assertRaises(ValueError):g.allocate_population(value,self.economies)

    def test_missing_estimate_stays_missing_not_zero_or_fabricated(self):
        value=copy.deepcopy(self.population)
        next(r for r in value[1] if r['countryiso3code']=='TUV')['value']=None
        p=g.allocate_population(value,self.economies)
        self.assertIn({'code':'TUV','name':'Tuvalu'},p['missing_source_economies'])
        self.assertNotIn('TUV',[r['code'] for r in p['shards']])
        self.assertEqual(p['unassigned_world_residual'],23412899+9646)

    def test_source_hashes_and_index_integrity(self):
        lock=json.loads((self.base/'sources.lock.json').read_bytes())
        for source in lock['sources']:
            path=self.base/source['path']
            self.assertEqual(path.stat().st_size,source['bytes'])
            self.assertEqual(g.digest(path),source['sha256'])
        with sqlite3.connect(self.base/'overview.sqlite') as con:
            self.assertEqual(con.execute('pragma integrity_check').fetchone()[0],'ok')
            self.assertEqual(con.execute('select count(*) from parts').fetchone()[0],19054)
            self.assertEqual(con.execute('select count(distinct layer) from parts').fetchone()[0],6)

    def test_global_environment_actual_land_ocean_lake_and_poles(self):
        cases=[(48.8566,2.3522,'land'),(27.95946,-82.5055,'land'),(0,-140,'ocean'),(44,-87,'inland_water'),(-89,0,'land'),(89,0,'ocean')]
        for lat,lon,state in cases:
            result=g.resolve(self.base/'overview.sqlite',lat,lon)
            self.assertEqual(result['state'],state,(lat,lon,result))
            self.assertIsNone(result['height_m'])
            self.assertFalse(result['collision_ready'])
            self.assertEqual(result['ground_route'],'unavailable')

    def test_antimeridian_and_polar_addresses_consistent(self):
        for lat in (-70,-16,0,40,80):
            a=g.resolve(self.base/'overview.sqlite',lat,180)
            b=g.resolve(self.base/'overview.sqlite',lat,-180)
            self.assertEqual(a,b)
        for lat in (-90,90):
            a=g.resolve(self.base/'overview.sqlite',lat,100)
            b=g.resolve(self.base/'overview.sqlite',lat,-77)
            self.assertEqual(a,b)

    def test_resolver_rejects_nan_boolean_outside_earth(self):
        for lat,lon in [(float('nan'),0),(0,float('inf')),(91,0),(0,-181),(True,0),('1',0)]:
            with self.assertRaises(ValueError):g.resolve(self.base/'overview.sqlite',lat,lon)

    def test_polygon_holes_boundary_and_geometry_validation(self):
        poly={'type':'Polygon','coordinates':[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[3,3],[7,3],[7,7],[3,7],[3,3]]]}
        self.assertTrue(g.contains(poly,1,1));self.assertTrue(g.contains(poly,0,2));self.assertFalse(g.contains(poly,5,5));self.assertFalse(g.contains(poly,-1,2))
        with self.assertRaises(ValueError):list(g.positions([[0,float('nan')]]))
        with self.assertRaises(ValueError):g.geometry_parts({'type':'Mystery','coordinates':[]})

    def test_failed_reproduction_preserves_existing_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest=Path(tmp);(dest/'raw').mkdir();(dest/'overview.sqlite').write_bytes(b'preserve')
            (dest/'sources.lock.json').write_text(json.dumps({'sources':[{'path':'raw/x.json','bytes':2,'sha256':'bad'}]}))
            (dest/'raw/x.json').write_bytes(b'{}')
            with self.assertRaises(ValueError):g.reproduce(dest)
            self.assertEqual((dest/'overview.sqlite').read_bytes(),b'preserve')

if __name__=='__main__':unittest.main()
