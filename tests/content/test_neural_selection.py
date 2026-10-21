import copy,json,pathlib,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/content'))
import select_neural_speech as selection
class NeuralSelectionTests(unittest.TestCase):
    def setUp(self):
        self.report_path=ROOT/'evidence/content/silma/offer_ride-ref-en-unvowelled.json'
        self.report=json.loads(self.report_path.read_text());self.wav=self.report_path.with_suffix('.wav')
        self.lock=ROOT/'evidence/content/silma/sources.lock.json'
        self.base=next(e for e in json.loads((ROOT/'unity/Assets/HOMELESS/Content/Speech/speech.json').read_text())['entries'] if e['canonical_act']['act']=='offer_ride' and e['canonical_act']['language']=='ar')
    def test_actual_decoded_clip_selection_keeps_quality_unreviewed(self):
        result=selection.promoted(self.base,self.report,self.wav,self.lock)
        self.assertEqual(result['sha256'],self.report['audio_sha256']);self.assertGreater(result['frames'],0)
        self.assertFalse(result['automated_asr']['human_quality_acceptance']);self.assertEqual(result['human_intelligibility_review'],'NOT_RUN')
        self.assertEqual(result['caption'],self.base['caption'])
    def test_caption_event_and_threshold_disagreement_refuse(self):
        for patch in ({'caption':'invented words'},{'act':'work'},{'normalized_wer':.5},{'voice_imitation_requested':True}):
            report=dict(self.report,**patch)
            with self.assertRaises(ValueError):selection.promoted(self.base,report,self.wav,self.lock)
    def test_changed_audio_bytes_refuse_even_with_passing_asr_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'changed.wav';path.write_bytes(self.wav.read_bytes()+b'changed')
            with self.assertRaises(ValueError):selection.promoted(self.base,self.report,path,self.lock)
if __name__=='__main__':unittest.main()
