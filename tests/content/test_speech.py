import importlib.util, pathlib, tempfile, unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('speech',ROOT/'tools/content/speech.py')
speech=importlib.util.module_from_spec(spec);spec.loader.exec_module(speech)

class SpeechTests(unittest.TestCase):
    def test_unknown_effect_cannot_be_realized(self):
        with self.assertRaises(ValueError):speech.realize({'act':'grant_founder','speaker':'npc:ana','language':'en','slots':{}})
    def test_grounded_slots_require_known_entities(self):
        with self.assertRaises(ValueError):speech.realize({'act':'offer_ride','speaker':'npc:ana','language':'en','slots':{'destination':'unknown'}})
    def test_canonical_key_ignores_dictionary_order(self):
        a={'event_id':'evt:1','speaker':'npc:ana','language':'en','act':'continue_task','slots':{}}
        self.assertEqual(speech.cache_key(a),speech.cache_key(dict(reversed(list(a.items())))))
    def test_event_identity_and_language_change_key(self):
        a={'event_id':'evt:1','speaker':'npc:ana','language':'en','act':'continue_task','slots':{}}
        self.assertNotEqual(speech.cache_key(a),speech.cache_key(dict(a,event_id='evt:2')))
        self.assertNotEqual(speech.cache_key(a),speech.cache_key(dict(a,language='ar')))
    def test_cancel_before_commit_never_commits(self):
        s=speech.Conversation();s.predict('a','npc:ana');s.cancel('a')
        with self.assertRaises(ValueError):s.commit('a')
        self.assertEqual(s.states['a'],'canceled')
    def test_speaker_interrupts_only_own_audio(self):
        s=speech.Conversation()
        for e,p in [('a','npc:ana'),('b','npc:bo')]:s.predict(e,p);s.synthesized(e);s.fetched(e);s.commit(e);s.start(e)
        s.interrupt_speaker('npc:ana')
        self.assertEqual(s.states,{'a':'interrupted','b':'playing'})
    def test_predicted_does_not_mean_committed_or_heard(self):
        s=speech.Conversation();s.predict('a','npc:ana')
        with self.assertRaises(ValueError):s.start('a')
        self.assertNotIn('heard',[x['state'] for x in s.events])
    def test_actual_synthesis_decodes_and_caches(self):
        with tempfile.TemporaryDirectory() as tmp:
            a={'event_id':'evt:test','speaker':'npc:ana','language':'en','act':'continue_task','slots':{}}
            first=speech.synthesize(a,pathlib.Path(tmp));second=speech.synthesize(a,pathlib.Path(tmp))
            self.assertEqual(first['sha256'],second['sha256']);self.assertGreater(first['duration_seconds'],.2)
            self.assertGreater(first['pcm_rms'],.001);self.assertTrue(second['cache_hit'])
    def test_corrupt_cached_audio_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            a={'event_id':'evt:test','speaker':'npc:ana','language':'en','act':'continue_task','slots':{}}
            r=speech.synthesize(a,pathlib.Path(tmp));(pathlib.Path(tmp)/r['filename']).write_bytes(b'corrupt')
            with self.assertRaises(ValueError):speech.synthesize(a,pathlib.Path(tmp))

if __name__=='__main__':unittest.main()
