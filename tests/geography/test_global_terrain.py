import hashlib
import ctypes as C
import importlib.util
import json
from pathlib import Path
import random
import struct
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/geography'))
import global_terrain as t

class GlobalTerrainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.terrain=t.Terrain()

    def test_source_grid_and_decoded_integrity(self):
        meta=self.terrain.meta;grid=meta['grid']
        self.assertEqual((grid['width'],grid['height']),(3601,1801))
        self.assertEqual(grid['step_degrees'],.1)
        self.assertEqual(grid['registration'],'gridline')
        self.assertEqual(t.digest(self.terrain.dest/'earth_gebco_06m_g.grd'),meta['source']['sha256'])
        self.assertEqual(t.digest(self.terrain.path),meta['runtime_file']['sha256'])
        self.assertFalse(meta['street_scale_precision'])
        self.assertFalse(meta['native_collision_ready'])

    def test_source_terrain_ocean_mountain_polar_character(self):
        terrain=self.terrain
        self.assertLess(terrain.height(0,-140)['height_m_msl'],-2000)
        self.assertGreater(terrain.height(28,86.8)['height_m_msl'],3000)
        self.assertGreater(terrain.height(-89,0)['height_m_msl'],1000)
        self.assertLess(terrain.height(89,0)['height_m_msl'],0)
        self.assertGreater(terrain.height(-16,-68)['height_m_msl'],2000)

    def test_seams_poles_and_global_finite_samples_seed_17026(self):
        terrain=self.terrain;rng=random.Random(17026)
        for lat in [-90,-89.9,-70,-20,0,15,80,89.9,90]:
            self.assertEqual(terrain.height(lat,-180),terrain.height(lat,180))
        for lat in [-90,90]:self.assertEqual(terrain.height(lat,-77),terrain.height(lat,111))
        for _ in range(1000):
            sample=terrain.height(rng.uniform(-90,90),rng.uniform(-180,180))
            self.assertGreaterEqual(sample['height_m_msl'],terrain.grid['min_height_m'])
            self.assertLessEqual(sample['height_m_msl'],terrain.grid['max_height_m'])

    def test_node_sampling_matches_raw_source_array_and_bilinear_center(self):
        terrain=self.terrain;width=terrain.grid['width'];scale=terrain.grid['scale_factor'];offset=terrain.grid['add_offset']
        with terrain.path.open('rb') as f:
            for iy,ix in [(100,100),(900,1800),(1294,772),(1580,2668)]:
                f.seek(2*(iy*width+ix));a,b=struct.unpack('<hh',f.read(4));f.seek(2*((iy+1)*width+ix));c,d=struct.unpack('<hh',f.read(4))
                self.assertAlmostEqual(terrain.height(-90+iy*.1,-180+ix*.1)['height_m_msl'],a*scale+offset,places=6)
                self.assertAlmostEqual(terrain.height(-90+(iy+.5)*.1,-180+(ix+.5)*.1)['height_m_msl'],(a+b+c+d)*.25*scale+offset,places=6)

    def test_invalid_addresses_and_corrupt_grid_refused(self):
        for lat,lon in [(float('nan'),0),(0,float('inf')),(91,0),(0,181),(True,0),('0',0)]:
            with self.assertRaises(ValueError):self.terrain.height(lat,lon)
        with tempfile.TemporaryDirectory() as d:
            dest=Path(d);meta=json.loads(json.dumps(self.terrain.meta));meta['runtime_file']['path']='bad.i16'
            (dest/'metadata.json').write_text(json.dumps(meta));(dest/'bad.i16').write_bytes(b'bad')
            with self.assertRaises(ValueError):t.Terrain(dest)

    def test_scalar_attributes_reject_vectors_before_native_read(self):
        class FakeLibrary:
            reads=0
            def nc_inq_attlen(self,ncid,var,name,length):
                C.cast(length,C.POINTER(C.c_size_t))[0]=2
                return 0
            def nc_get_att_double(self,*args):
                self.reads+=1
                raise AssertionError('vector must not be copied into scalar storage')
        lib=FakeLibrary()
        with self.assertRaises(ValueError):t.scalar_attribute(lib,0,0,'scale_factor',1)
        self.assertEqual(lib.reads,0)

    def test_runtime_metadata_rejects_wrong_shape_step_and_path(self):
        for field,value in [('width',True),('width',4000),('step_degrees',0),('scale_factor',float('nan'))]:
            with tempfile.TemporaryDirectory() as d:
                dest=Path(d);meta=json.loads(json.dumps(self.terrain.meta));meta['grid'][field]=value
                (dest/'metadata.json').write_text(json.dumps(meta))
                with self.assertRaises(ValueError):t.Terrain(dest)
        with tempfile.TemporaryDirectory() as d:
            dest=Path(d);meta=json.loads(json.dumps(self.terrain.meta));meta['runtime_file']['path']='../elsewhere'
            (dest/'metadata.json').write_text(json.dumps(meta))
            with self.assertRaises(ValueError):t.Terrain(dest)

if __name__=='__main__':unittest.main()
