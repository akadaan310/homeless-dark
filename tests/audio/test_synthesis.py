"""HD-051/052/053/055/092: decoded samples and explicit score observables."""
import io
from pathlib import Path
import sys
import unittest
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/audio"))
import synthesize


class SynthesisTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.clips = synthesize.generate()

    def test_actual_pcm_is_nonzero_bounded_mono_and_correct_duration(self):
        frames = {
            "synthetic_rain_wind_loop.wav": 384000,
            "synthetic_footstep_left.wav": 11520,
            "synthetic_footstep_right.wav": 12960,
            "original_arrival_motif.wav": 153600,
        }
        self.assertEqual(set(self.clips), set(frames))
        for name, payload in self.clips.items():
            with self.subTest(name=name), wave.open(io.BytesIO(payload)) as audio:
                self.assertEqual(audio.getnchannels(), 1)
                self.assertEqual(audio.getsampwidth(), 2)
                self.assertEqual(audio.getframerate(), 48000)
                self.assertEqual(audio.getnframes(), frames[name])
                self.assertEqual(audio.getcomptype(), "NONE")
            stats = synthesize.measure(payload)
            self.assertGreater(stats["nonzero_samples"], frames[name] // 8)
            self.assertGreater(stats["rms_full_scale"], 0.001)
            self.assertLessEqual(stats["peak_pcm"], 8191)
            self.assertEqual(stats["clipped_samples"], 0)
            self.assertLessEqual(abs(stats["dc_mean_full_scale"]), 0.002)
        self.assertLess(sum(map(len, self.clips.values())), 10 * 1024 * 1024)

    def test_seeded_regeneration_is_byte_identical_and_foot_variants_differ(self):
        self.assertEqual(self.clips, synthesize.generate())
        self.assertNotEqual(self.clips["synthetic_footstep_left.wav"], self.clips["synthetic_footstep_right.wav"])

    def test_promised_loop_has_zero_boundary_jump_and_near_zero_slope_jump(self):
        stats = synthesize.measure(self.clips["synthetic_rain_wind_loop.wav"])
        self.assertEqual(stats["loop_boundary_jump_pcm"], 0)
        self.assertLessEqual(stats["loop_boundary_slope_mismatch_pcm"], 1)

    def test_one_shots_start_and_end_at_zero(self):
        for name in ("synthetic_footstep_left.wav", "synthetic_footstep_right.wav", "original_arrival_motif.wav"):
            with self.subTest(name=name):
                stats = synthesize.measure(self.clips[name])
                self.assertEqual(stats["first_pcm"], 0)
                self.assertEqual(stats["last_pcm"], 0)

    def test_time_translation_commutes_under_explicit_note_schedule_observable(self):
        original = {"kind": "arrival_committed", "region": "street", "at_frame": 0}
        moved = {"kind": "arrival_committed", "region": "street", "at_frame": 24000}
        self.assertEqual(synthesize.score(moved), synthesize.shift_score(synthesize.score(original), 24000))
        self.assertEqual(synthesize.score(moved)[0], (57, 24000, 14400))

    def test_region_change_is_counterexample_to_unchanged_music(self):
        street = synthesize.score({"kind": "arrival_committed", "region": "street", "at_frame": 0})
        harbor = synthesize.score({"kind": "arrival_committed", "region": "harbor", "at_frame": 0})
        self.assertEqual(street[0][0], 57)
        self.assertEqual(harbor[0][0], 52)
        self.assertNotEqual(street, synthesize.shift_score(harbor, 0))

    def test_invalid_event_and_negative_time_refused(self):
        for event in [
            {"kind": "grant_founder", "region": "street", "at_frame": 0},
            {"kind": "arrival_committed", "region": "unknown", "at_frame": 0},
            {"kind": "arrival_committed", "region": "street", "at_frame": -1},
            {"kind": "arrival_committed", "region": "street", "at_frame": True},
        ]:
            with self.subTest(event=event), self.assertRaises(ValueError):
                synthesize.score(event)


if __name__ == "__main__":
    unittest.main()
