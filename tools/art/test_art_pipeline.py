import hashlib,io,json,math,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
import fetch_materials as f
class Response(io.BytesIO):
 def __init__(self,data,status=200,headers=None,url='https://ambientcg.com/get?file=test.zip'):
  super().__init__(data);self.status=status;self.headers=headers or {};self.url=url
class FetchSafety(unittest.TestCase):
 def test_unapproved_and_non_https_urls_refused(self):
  for url in ['http://ambientcg.com/a','https://example.com/a','https://ambientcg.com.evil.invalid/a','https://user:pass@ambientcg.com/a','https://ambientcg.com:444/a']:
   with self.assertRaises(ValueError):f.check_url(url)
 def test_zip_traversal_and_symlink_refused(self):
  for name in ['../outside.jpg','/outside.jpg','a\\outside.jpg']:
   buf=io.BytesIO()
   with zipfile.ZipFile(buf,'w') as z:z.writestr(name,b'abc')
   with zipfile.ZipFile(buf) as z:
    with self.assertRaises(ValueError):f.safe_members(z)
  buf=io.BytesIO();entry=zipfile.ZipInfo('link');entry.external_attr=0o120777<<16
  with zipfile.ZipFile(buf,'w') as z:z.writestr(entry,'outside')
  with zipfile.ZipFile(buf) as z:
   with self.assertRaises(ValueError):f.safe_members(z)
 def test_corrupted_existing_archive_is_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'x.zip';p.write_bytes(b'wrong')
   with self.assertRaises(ValueError):f.fetch('https://ambientcg.com/get?file=test.zip',p,5,hashlib.sha256(b'right').hexdigest())
 def test_downloaded_wrong_hash_is_not_promoted(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'x.zip'
   with patch('urllib.request.OpenerDirector.open',return_value=Response(b'wrong')):
    with self.assertRaises(ValueError):f.fetch('https://ambientcg.com/get?file=test.zip',p,5,hashlib.sha256(b'right').hexdigest())
   self.assertFalse(p.exists())
 def test_network_oversize_never_promotes_archive(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'x.zip'
   with patch('urllib.request.OpenerDirector.open',return_value=Response(b'123456')):
    with self.assertRaises(ValueError):f.fetch('https://ambientcg.com/get?file=test.zip',p,5)
   self.assertFalse(p.exists())
 def test_interrupted_download_resumes_with_range_and_hash(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'x.zip';p.with_suffix('.zip.part').write_bytes(b'ab')
   with patch('urllib.request.OpenerDirector.open',return_value=Response(b'cde',206,{'Content-Range':'bytes 2-4/5'})) as op:
    f.fetch('https://ambientcg.com/get?file=test.zip',p,5,hashlib.sha256(b'abcde').hexdigest())
   self.assertEqual(p.read_bytes(),b'abcde');self.assertEqual(op.call_args[0][0].get_header('Range'),'bytes=2-')
 def test_server_ignoring_range_restarts_without_duplicate_bytes(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'x.zip';p.with_suffix('.zip.part').write_bytes(b'ab')
   with patch('urllib.request.OpenerDirector.open',return_value=Response(b'abcde')):
    f.fetch('https://ambientcg.com/get?file=test.zip',p,5,hashlib.sha256(b'abcde').hexdigest())
   self.assertEqual(p.read_bytes(),b'abcde')
 def test_bad_resumed_range_refused(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'x.zip';p.with_suffix('.zip.part').write_bytes(b'ab')
   with patch('urllib.request.OpenerDirector.open',return_value=Response(b'cde',206,{'Content-Range':'bytes 1-3/5'})):
    with self.assertRaises(ValueError):f.fetch('https://ambientcg.com/get?file=test.zip',p,5)
   self.assertFalse(p.exists())
 def test_obj_geometry_indices_normals_bounds_and_material_paths(self):
  root=f.ROOT/'unity/Assets/HOMELESS/Art/Architecture/FictionalCafe';vertices=[];normals=[];triangles=0
  for line in (root/'FictionalCafe.obj').read_text().splitlines():
   parts=line.split()
   if not parts:continue
   if parts[0]=='v':vertices.append([float(x) for x in parts[1:]]);self.assertTrue(all(math.isfinite(v) for v in vertices[-1]))
   if parts[0]=='vn':normals.append([float(x) for x in parts[1:]]);self.assertAlmostEqual(sum(v*v for v in normals[-1]),1,places=5)
   if parts[0]=='f':
    self.assertEqual(len(parts),4);triangles+=1
    for token in parts[1:]:self.assertTrue(0<int(token.split('/')[0])<=len(vertices))
  self.assertEqual(triangles,json.loads((root/'geometry.json').read_text())['triangles'])
  self.assertGreater(triangles,5000)
  for line in (root/'FictionalCafe.mtl').read_text().splitlines():
   if line.startswith('map_Kd '):self.assertTrue((root/line.split(' ',1)[1]).is_file())
if __name__=='__main__':unittest.main(verbosity=2)
