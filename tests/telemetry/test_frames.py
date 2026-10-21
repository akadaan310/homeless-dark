import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('frame_analysis', ROOT/'tools/telemetry/frames.py')
frames = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(frames)


class FrameTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def fixture(self, durations, kind='synthetic'):
        stream = io.StringIO(newline='')
        writer = csv.writer(stream, lineterminator='\n')
        writer.writerow(['frame_index', 'elapsed_end_ns', 'frame_time_ns'])
        elapsed = 0
        for index, duration in enumerate(durations):
            elapsed += duration
            writer.writerow([index, elapsed, duration])
        raw = stream.getvalue().encode()
        trace = self.root/'frames.csv'
        trace.write_bytes(raw)
        metadata = {
            'schema': 'dark.frame-capture/1', 'evidence_kind': kind,
            'build_commit': 'a'*40, 'artifact_sha256': 'b'*64,
            'trace_sha256': hashlib.sha256(raw).hexdigest(),
            'device': {'manufacturer': 'Samsung', 'model': 'SM-A165F',
                       'target_family': 'Galaxy A16', 'os': 'Android test value',
                       'gpu': 'test GPU', 'ram_bytes': 4*1024**3},
            'profile': {'name': 'test', 'width': 1080, 'height': 2340,
                        'thermal_start': 'test', 'thermal_end': 'test',
                        'cache_state': 'warm', 'network_condition': 'offline'},
            'scenario': 'Explicit synthetic test; never native evidence',
            'capture_started_utc': '2026-10-21T00:00:00+00:00',
            'excluded_frames': 0,
        }
        manifest = self.root/'capture.json'
        manifest.write_text(json.dumps(metadata))
        return trace, manifest, metadata

    def test_nearest_rank_quantiles_and_hitches_use_all_frames(self):
        trace, manifest, _ = self.fixture([10_000_000]*94 + [40_000_000]*5 + [100_000_000])
        report = frames.analyze(trace, manifest)
        self.assertEqual(report['metrics']['frame_count'], 100)
        self.assertEqual(report['metrics']['p95_ms'], 40)
        self.assertEqual(report['metrics']['p99_ms'], 40)
        self.assertEqual(report['metrics']['maximum_ms'], 100)
        self.assertEqual(report['metrics']['frames_over_33_3_ms'], 6)
        self.assertEqual(report['frame_pacing_thresholds'], 'FAIL')

    def test_full_synthetic_trace_can_pass_arithmetic_but_never_device_gate(self):
        trace, manifest, _ = self.fixture([30_000_000]*40_000)
        report = frames.analyze(trace, manifest)
        self.assertEqual(report['metrics']['duration_seconds'], 1200)
        self.assertEqual(report['frame_pacing_thresholds'], 'PASS')
        self.assertEqual(report['native_device_acceptance'], 'NOT_RUN')
        self.assertFalse(report['release_accepted'])

    def test_claimed_native_trace_still_requires_origin_and_scenario_review(self):
        trace, manifest, _ = self.fixture([30_000_000]*40_000, 'native_android_capture')
        self.assertEqual(frames.analyze(trace, manifest)['native_device_acceptance'], 'REVIEW_REQUIRED')

    def test_exact_33_3_threshold_is_not_rounded_into_a_pass(self):
        trace, manifest, _ = self.fixture([33_333_333]*36_001)
        report = frames.analyze(trace, manifest)
        self.assertGreater(report['metrics']['duration_seconds'], 1200)
        self.assertEqual(report['frame_pacing_thresholds'], 'FAIL')
        self.assertFalse(report['criteria']['p95_at_most_33_3_ms'])

    def test_hash_mismatch_refuses_before_statistics(self):
        trace, manifest, _ = self.fixture([30_000_000])
        trace.write_bytes(trace.read_bytes()+b'corrupt')
        with self.assertRaisesRegex(ValueError, 'hash'):
            frames.analyze(trace, manifest)

    def mutate_trace(self, replacement):
        trace, manifest, metadata = self.fixture([30_000_000, 30_000_000])
        raw = replacement.encode()
        trace.write_bytes(raw)
        metadata['trace_sha256'] = hashlib.sha256(raw).hexdigest()
        manifest.write_text(json.dumps(metadata))
        return trace, manifest

    def test_gaps_duplicates_nonfinite_zero_and_filtered_hitches_refuse(self):
        header = 'frame_index,elapsed_end_ns,frame_time_ns\n'
        cases = ['0,30000000,30000000\n2,60000000,30000000\n',
                 '0,30000000,30000000\n0,60000000,30000000\n',
                 '0,NaN,30000000\n', '0,0,0\n',
                 '0,30000000,30000000\n1,100000000,30000000\n',
                 '0,30000000,30000000,extra\n', '']
        for body in cases:
            with self.subTest(body=body), self.assertRaises(ValueError):
                frames.analyze(*self.mutate_trace(header+body))

    def test_metadata_exclusions_missing_profile_and_duplicate_keys_refuse(self):
        trace, manifest, original = self.fixture([30_000_000])
        for key, value in [('excluded_frames', 1), ('excluded_frames', False),
                           ('profile', {}), ('evidence_kind', 'desktop'), ('build_commit', 'unknown')]:
            with self.subTest(key=key, value=value):
                modified = dict(original, **{key: value})
                manifest.write_text(json.dumps(modified))
                with self.assertRaises(ValueError): frames.analyze(trace, manifest)
        manifest.write_text('{"schema": "dark.frame-capture/1", "schema": "different"}')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            frames.analyze(trace, manifest)

    def test_resource_limits_are_refusals(self):
        trace, manifest, _ = self.fixture([1]*4)
        with self.assertRaisesRegex(ValueError, 'count'):
            frames.analyze(trace, manifest, max_frames=3)
        with self.assertRaisesRegex(ValueError, 'byte'):
            frames.analyze(trace, manifest, max_bytes=4)

    def test_nonfinite_metadata_is_not_a_json_measurement(self):
        trace, manifest, _ = self.fixture([30_000_000])
        manifest.write_text(manifest.read_text()[:-1]+', "extra": NaN}')
        with self.assertRaisesRegex(ValueError, 'Nonfinite'):
            frames.analyze(trace, manifest)


if __name__ == '__main__':
    unittest.main()
