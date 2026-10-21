import hashlib,json,pathlib,unittest,wave
ROOT=pathlib.Path(__file__).resolve().parents[2]
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
class ContentIntegrityTests(unittest.TestCase):
    def test_selected_master_hashes_and_rights(self):
        lock=json.loads((ROOT/'assets/content/sources.lock.json').read_text())
        self.assertGreater(len(lock['files']),30)
        for row in lock['files']:
            p=ROOT/row['path'];self.assertEqual(p.stat().st_size,row['bytes']);self.assertEqual(digest(p),row['sha256']);self.assertEqual(row['license'],'CC0-1.0')
    def test_unity_texture_masters_unchanged(self):
        manifest=json.loads((ROOT/'unity/Assets/HOMELESS/Content/Characters/materials.json').read_text())
        for row in manifest['bindings']:
            for key in ('diffuse','normal'):
                if key in row:
                    source=ROOT/row[key]['source'];target=ROOT/'unity'/row[key]['path']
                    self.assertEqual(digest(source),digest(target));self.assertEqual(digest(target),row[key]['sha256'])
    def test_fbx_roundtrip_covers_current_actual_bytes(self):
        report=json.loads((ROOT/'evidence/content/fbx-roundtrip.json').read_text())
        paths={row['path'] for row in report['files']}
        current={str(p.relative_to(ROOT)) for p in (ROOT/'unity/Assets/HOMELESS/Content').rglob('*.fbx')}
        self.assertEqual(paths,current);self.assertGreaterEqual(len(current),10)
        for row in report['files']:
            p=ROOT/row['path'];self.assertEqual(digest(p),row['sha256']);self.assertTrue(p.read_bytes().startswith(b'Kaydara FBX Binary'))
            self.assertEqual(row['result'],'PASS');self.assertEqual(row['unweighted_vertices'],0);self.assertEqual(row['non_normalized_weights'],0)
    def test_speech_manifest_has_only_real_decodable_audio(self):
        folder=ROOT/'unity/Assets/HOMELESS/Content/Speech';manifest=json.loads((folder/'speech.json').read_text())
        self.assertEqual(len({e['event_id'] for e in manifest['entries']}),len(manifest['entries']))
        for row in manifest['entries']:
            p=folder/row['filename'];self.assertEqual(digest(p),row['sha256'])
            with wave.open(str(p),'rb') as f:self.assertEqual(f.getnframes(),row['frames']);self.assertEqual(f.getframerate(),row['sample_rate'])
    def test_asr_models_match_declared_pin(self):
        folder=ROOT/'assets/content/asr';lock=json.loads((folder/'sources.lock.json').read_text());base=json.loads((folder/'base-selection.json').read_text())
        self.assertEqual(digest(folder/'ggml-tiny.bin'),lock['model']['sha256']);self.assertEqual(digest(folder/'ggml-base-q5_1.bin'),base['sha256'])
    def test_server_static_captions_have_exact_realizations(self):
        manifest=json.loads((ROOT/'unity/Assets/HOMELESS/Content/Speech/speech.json').read_text());captions={e['caption'] for e in manifest['entries']}
        for caption in ['Hello. Good to see you.','I can help arrange a ride. Where are you going?',
          'I need to get to work. I cannot offer a ride now.','Take care. See you around.',
          'I am heading to work.','I am taking some time to talk.','Time to get back to work.',
          'It is good to have some company.','I could use a rest.']:self.assertIn(caption,captions)
    def test_seated_joints_face_forward_without_lateral_root_drift(self):
        report=json.loads((ROOT/'evidence/content/seated-source.json').read_text())
        self.assertEqual(report['source_sha256'],digest(ROOT/'assets/content/authored/CitizenSource.blend'))
        idle=report['poses']['Idle']['root']
        for action in ('Seated','EnterVehicle'):
            joints=report['poses'][action]
            for axis in (0,1):self.assertAlmostEqual(joints['root'][axis],idle[axis],places=5)
            self.assertAlmostEqual(joints['root'][2],idle[2]-.38,places=5)
            for side in ('L','R'):self.assertLess(joints['lowerleg01.'+side][1],joints['upperleg01.'+side][1]-.15)
if __name__=='__main__':unittest.main()
