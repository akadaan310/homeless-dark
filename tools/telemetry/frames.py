#!/usr/bin/env python3
"""Bounded frame-trace arithmetic for HD-081/082; never authenticates native evidence."""
import argparse
import csv
import datetime
import hashlib
import io
import json
from pathlib import Path
import re
import sys

MAX_BYTES = 16 * 1024 * 1024
MAX_FRAMES = 250_000


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key: '+key)
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError('Nonfinite JSON constant: '+value)


def bounded_bytes(path, maximum):
    with Path(path).open('rb') as source:
        raw = source.read(maximum+1)
    if len(raw) > maximum:
        raise ValueError('Input byte budget exceeded')
    return raw


def nonempty(value):
    return isinstance(value, str) and 0 < len(value.strip()) <= 4096


def validate_metadata(meta):
    if not isinstance(meta, dict) or meta.get('schema') != 'dark.frame-capture/1':
        raise ValueError('Unsupported capture schema')
    if meta.get('evidence_kind') not in ('synthetic', 'native_android_capture'):
        raise ValueError('Unsupported evidence kind')
    for key, length in [('build_commit', 40), ('artifact_sha256', 64), ('trace_sha256', 64)]:
        value = meta.get(key)
        if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{'+str(length)+'}', value):
            raise ValueError('Invalid '+key)
    if type(meta.get('excluded_frames')) is not int or meta['excluded_frames'] != 0:
        raise ValueError('Filtered or excluded frames cannot establish continuous pacing')
    device = meta.get('device')
    if not isinstance(device, dict) or not all(nonempty(device.get(k)) for k in ('manufacturer', 'model', 'target_family', 'os', 'gpu')):
        raise ValueError('Missing device facts')
    if type(device.get('ram_bytes')) is not int or device['ram_bytes'] <= 0:
        raise ValueError('Invalid device RAM')
    profile = meta.get('profile')
    if not isinstance(profile, dict) or not all(nonempty(profile.get(k)) for k in ('name', 'thermal_start', 'thermal_end', 'cache_state', 'network_condition')):
        raise ValueError('Missing capture profile facts')
    for key in ('width', 'height'):
        if type(profile.get(key)) is not int or not 1 <= profile[key] <= 16384:
            raise ValueError('Invalid render dimensions')
    if not nonempty(meta.get('scenario')) or not nonempty(meta.get('capture_started_utc')):
        raise ValueError('Missing scenario or capture time')
    try:
        instant = datetime.datetime.fromisoformat(meta['capture_started_utc'].replace('Z', '+00:00'))
        if instant.utcoffset() != datetime.timedelta(0):
            raise ValueError('Capture time must include UTC offset')
    except (ValueError, OverflowError) as error:
        raise ValueError('Invalid UTC capture time') from error


def unsigned_integer(value):
    if not isinstance(value, str) or not re.fullmatch(r'0|[1-9][0-9]{0,18}', value):
        raise ValueError('Trace requires canonical integer nanoseconds and indices')
    return int(value)


def analyze(trace, metadata, *, max_frames=MAX_FRAMES, max_bytes=MAX_BYTES):
    if type(max_frames) is not int or not 1 <= max_frames <= MAX_FRAMES:
        raise ValueError('Invalid frame count limit')
    if type(max_bytes) is not int or not 1 <= max_bytes <= MAX_BYTES:
        raise ValueError('Invalid byte limit')
    meta = json.loads(bounded_bytes(metadata, 65_536).decode('utf-8'), object_pairs_hook=unique_object, parse_constant=reject_constant)
    validate_metadata(meta)
    raw = bounded_bytes(trace, max_bytes)
    trace_hash = hashlib.sha256(raw).hexdigest()
    if trace_hash != meta['trace_sha256']:
        raise ValueError('Trace hash mismatch')
    reader = csv.reader(io.StringIO(raw.decode('utf-8'), newline=''), strict=True)
    if next(reader, None) != ['frame_index', 'elapsed_end_ns', 'frame_time_ns']:
        raise ValueError('Unsupported trace columns')
    durations = []
    elapsed = 0
    for row in reader:
        if len(durations) >= max_frames:
            raise ValueError('Frame count budget exceeded')
        if len(row) != 3:
            raise ValueError('Invalid frame row width')
        index, end, duration = map(unsigned_integer, row)
        if index != len(durations) or duration <= 0 or end != elapsed+duration:
            raise ValueError('Noncontinuous frame sequence or timing; gaps and filtering refused')
        durations.append(duration)
        elapsed = end
    if not durations:
        raise ValueError('Empty frame trace')
    ordered = sorted(durations)
    # [K] Empirical nearest-rank quantiles; no interpolation hides an observed hitch.
    p95 = ordered[(95*len(ordered)+99)//100-1]
    p99 = ordered[(99*len(ordered)+99)//100-1]
    criteria = {
        'at_least_20_minutes': elapsed >= 1_200_000_000_000,
        'mean_at_least_30_fps': len(durations)*1_000_000_000 >= 30*elapsed,
        'p95_at_most_33_3_ms': p95 <= 33_300_000,
        'declared_target_family': meta['device']['manufacturer'].lower() == 'samsung' and meta['device']['target_family'] == 'Galaxy A16',
    }
    return {
        'schema': 'dark.frame-analysis/1', 'evidence_kind': meta['evidence_kind'],
        'build_commit': meta['build_commit'], 'artifact_sha256': meta['artifact_sha256'],
        'trace_sha256': trace_hash, 'quantile_method': 'empirical nearest rank',
        'capture': meta,
        'metrics': {
            'frame_count': len(durations), 'duration_seconds': elapsed/1_000_000_000,
            'mean_fps': len(durations)*1_000_000_000/elapsed,
            'p95_ms': p95/1_000_000, 'p99_ms': p99/1_000_000,
            'maximum_ms': max(durations)/1_000_000,
            'frames_over_33_3_ms': sum(d > 33_300_000 for d in durations),
            'frames_over_50_ms': sum(d > 50_000_000 for d in durations),
            'frames_over_100_ms': sum(d > 100_000_000 for d in durations),
        },
        'criteria': criteria,
        'frame_pacing_thresholds': 'PASS' if all(criteria.values()) else 'FAIL',
        'native_device_acceptance': 'NOT_RUN' if meta['evidence_kind'] == 'synthetic' else 'REVIEW_REQUIRED',
        'release_accepted': False,
        'limitations': [
            'This calculator cannot authenticate capture origin, build, device or metadata.',
            'Continuous native gameplay, scenario representativeness, quality profile and thermal evidence require independent inspection.',
            'Frame pacing alone does not measure GPU cost, memory, controls, visual quality, audio or full constitutional acceptance.',
            'The literal 33.3 ms requirement is compared before rounding; 33.333333 ms fails it.',
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('trace', type=Path)
    parser.add_argument('metadata', type=Path)
    args = parser.parse_args()
    try:
        report = analyze(args.trace, args.metadata)
    except (OSError, ValueError, UnicodeError, csv.Error, RecursionError) as error:
        print(json.dumps({'schema': 'dark.frame-analysis/1', 'status': 'refused', 'reason': str(error), 'release_accepted': False}))
        return 2
    print(json.dumps(report, indent=2, allow_nan=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
