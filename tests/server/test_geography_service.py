import importlib
import json
import math
from pathlib import Path
import random
import sys
import unittest
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'packages'))

class GeographyServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m=importlib.import_module('dark_server.geography');cls.service=cls.m.GeographyService(ROOT)
    def test_actual_land_admin_population_and_declared_resolution(self):
        result=self.service.view(27.9594638,-82.5054865,width=5,span_m=1000,population_id='wb2024/USA/7')
        self.assertEqual(result['schema'],'dark.geography-view/1');self.assertEqual(result['environmental_state'],'land')
        usa=next(c for c in result['administrative'] if c['code']=='USA');self.assertEqual(usa['population_2024'],340003797)
        self.assertEqual(result['population']['identity']['id'],'wb2024/USA/7');self.assertEqual(result['population']['identity']['cohort'],7)
        self.assertEqual(result['population']['world_estimate_2024'],8140897523)
        self.assertEqual(result['resolution']['terrain_spacing_degrees'],.1);self.assertEqual(result['resolution']['cartographic_scale'],'1:10,000,000')
        self.assertIn('not WGS84 ellipsoidal',result['height_datum']);self.assertFalse(result['native_collision_ready']);self.assertFalse(result['street_precision'])
    def test_country_resolves_unique_source_mapping_without_grid_or_ocean_invention(self):
        from unittest.mock import patch
        with patch.object(self.service.terrain,'height',side_effect=AssertionError('country lookup must not sample heights')):
            self.assertEqual(self.service.country(27.9594638,-82.5054865),'USA')
            with self.assertRaises(self.m.GeographyRefused):self.service.country(0,-140)
    def test_ocean_bathymetry_is_not_water_surface(self):
        result=self.service.view(0,-140,width=3)
        self.assertEqual(result['environmental_state'],'ocean');self.assertLess(result['center']['terrain_height_m_msl'],0)
        self.assertEqual(result['water']['surface_height_m_msl'],0);self.assertTrue(result['water']['surface_is_rendering_assumption'])
        self.assertFalse(result['administrative'])
    def test_bounded_33_grid_actual_heights_and_center(self):
        result=self.service.view(27.9594638,-82.5054865,width=33,span_m=10000);g=result['grid']
        self.assertEqual(len(g['heights_m_msl']),1089);self.assertEqual(len(g['latitudes']),1089);self.assertEqual(len(g['longitudes']),1089)
        self.assertEqual(g['heights_m_msl'][544],result['center']['terrain_height_m_msl'])
        self.assertAlmostEqual(g['latitudes'][544],27.9594638);self.assertAlmostEqual(g['longitudes'][544],-82.5054865)
        self.assertEqual(g['step_m'],312.5);self.assertLess(len(json.dumps(result).encode()),262144)
        for index in [0,44,544,1088]:
            expected=self.service.terrain.height(g['latitudes'][index],g['longitudes'][index])['height_m_msl']
            self.assertEqual(g['heights_m_msl'][index],expected)
    def test_date_line_equivalence_and_grid_wrap(self):
        a=self.service.view(10,180,width=5,span_m=10000);b=self.service.view(10,-180,width=5,span_m=10000)
        self.assertEqual(a,b);self.assertTrue(any(lon<0 for lon in a['grid']['longitudes']));self.assertTrue(any(lon>0 for lon in a['grid']['longitudes']))
    def test_pole_longitude_canonical_and_finite_grid(self):
        for lat in [-90,90]:
            a=self.service.view(lat,10,width=5);b=self.service.view(lat,-120,width=5)
            self.assertEqual(a,b);self.assertEqual(a['center']['longitude'],0)
            self.assertTrue(all(math.isfinite(h) for h in a['grid']['heights_m_msl']))
            self.assertTrue(all(-90<=v<=90 for v in a['grid']['latitudes']))
            self.assertTrue(all(-180<=v<180 for v in a['grid']['longitudes']))
    def test_bad_coordinates_and_budget_refuse(self):
        cases=[(float('nan'),0,{}),(0,float('inf'),{}),(91,0,{}),(0,181,{}),(True,0,{}),(10**1000,0,{}),(0,0,{'width':34}),(0,0,{'width':4}),(0,0,{'width':True}),(0,0,{'span_m':10001}),(0,0,{'span_m':0})]
        for lat,lon,args in cases:
            with self.subTest(lat=str(lat)[:20],args=args):
                with self.assertRaises(self.m.GeographyRefused):self.service.view(lat,lon,**args)
    def test_population_bounds_residual_and_no_spatial_invention(self):
        for identity in ['wb2024/USA/340003797','wb2024/USA/01','wb2023/USA/1','wb2024/UNKNOWN/0',{},'wb2024/USA/-1']:
            with self.assertRaises(self.m.GeographyRefused):self.service.population_identity(identity)
        residual=self.service.population_identity('wb2024/WLD_UNASSIGNED/23412898')
        self.assertEqual(residual['origin'],'WLD_UNASSIGNED');self.assertIsNone(residual['position']);self.assertFalse(residual['realized'])
        self.assertEqual(self.service.population_region('USA')['population_2024'],340003797)
        with self.assertRaises(self.m.GeographyRefused):self.service.population_region('XXX')
    def test_random_world_positions_have_real_finite_samples(self):
        rng=random.Random(89)
        for _ in range(15):
            result=self.service.view(rng.uniform(-90,90),rng.uniform(-180,180),width=3,span_m=1000)
            self.assertTrue(all(-11000<=v<=9000 for v in result['grid']['heights_m_msl']))
            self.assertEqual(result['population']['realized_individuals'],0)
    def test_returned_views_cannot_mutate_loaded_allocation(self):
        result=self.service.view(28,-82,width=3,population_id='wb2024/USA/7');result['population']['identity']['origin']='fake'
        self.assertEqual(self.service.population_identity('wb2024/USA/7')['origin'],'USA')
    def test_cheap_height_cache_is_canonical_bounded_and_source_checked(self):
        from unittest.mock import patch
        self.service._height_cache.clear()
        with patch.object(self.service.terrain,'height',wraps=self.service.terrain.height) as height:
            a=self.service.sample_height(10,180);b=self.service.sample_height(10,-180)
            self.assertEqual(a,b);self.assertEqual(height.call_count,1)
        for index in range(513):self.service.sample_height(20,index/100)
        self.assertEqual(len(self.service._height_cache),512)
        with patch.object(self.service,'_signature',return_value=('changed',)):
            with self.assertRaises(self.m.GeographyRefused):self.service.sample_height(20,1)
    def test_tangent_grid_distances_remain_bounded_at_poles_and_seam(self):
        for lat,lon in [(90,0),(-90,0),(0,-180),(89.999,179.999)]:
            for east,north in [(-5000,-5000),(5000,5000),(0,5000)]:
                p,q=self.m.tangent_point(lat,lon,east,north)
                phi1,phi2=math.radians(lat),math.radians(p);dl=math.radians(q-lon)
                value=math.sin((phi2-phi1)/2)**2+math.cos(phi1)*math.cos(phi2)*math.sin(dl/2)**2
                distance=2*self.m.RADIUS*math.asin(math.sqrt(max(0,min(1,value))))
                self.assertAlmostEqual(distance,math.hypot(east,north),places=5)

if __name__=='__main__':unittest.main()
