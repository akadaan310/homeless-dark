#!/usr/bin/env python3
"""Original deterministic PCM source experiments, not recordings or native proof.

HD-051–055/092. Signal generation uses integer arithmetic, a literal sine table
and xorshift32; no model, external sample, voice, protected composition or SDK.
"""
import argparse
from array import array
import hashlib
import io
import json
import math
import os
from pathlib import Path
import platform
import sys
import tempfile
import wave

RATE = 48000
SINE = (0, 6393, 12539, 18204, 23170, 27245, 30273, 32137,
        32767, 32137, 30273, 27245, 23170, 18204, 12539, 6393,
        0, -6393, -12539, -18204, -23170, -27245, -30273, -32137,
        -32767, -32137, -30273, -27245, -23170, -18204, -12539, -6393, 0)
FREQUENCY_MILLIHZ = {52: 164814, 55: 195998, 57: 220000, 59: 246942,
                    60: 261626, 64: 329628, 69: 440000}
SEEDS = {"rain_wind": 0x5EED5101, "left": 0x5EED5201, "right": 0x5EED5202}


def _noise(seed):
    state = seed
    while True:
        state ^= (state << 13) & 0xFFFFFFFF
        state ^= state >> 17
        state ^= (state << 5) & 0xFFFFFFFF
        state &= 0xFFFFFFFF
        yield (state & 0xFFFF) - 32768


def _sine(phase):
    phase &= 0xFFFFFFFF
    index = phase >> 27
    fraction = phase & ((1 << 27) - 1)
    return SINE[index] + ((SINE[index + 1] - SINE[index]) * fraction >> 27)


def _finish(values, peak, edge_frames):
    """Remove integer DC, smooth both boundaries to zero, then peak-normalize."""
    dc = sum(values) // len(values)
    result = []
    for index, value in enumerate(values):
        edge = min(index, len(values) - index - 1, edge_frames)
        t = edge * 32768 // edge_frames
        gain = (t * t >> 15) * (98304 - 2 * t) >> 15
        result.append((value - dc) * gain >> 15)
    largest = max(abs(value) for value in result)
    if largest == 0:
        raise ValueError("Unexpected silent generated signal")
    return [value * peak // largest for value in result]


def _wav(values):
    pcm = array("h", values)
    if sys.byteorder != "little":
        pcm.byteswap()
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(RATE)
        audio.writeframes(pcm.tobytes())
    return output.getvalue()


def _rain_wind():
    count, wind, rain = RATE * 8, 0, 0
    noise = _noise(SEEDS["rain_wind"])
    values = []
    for index in range(count):
        white = next(noise)
        wind += (white - wind) // 96
        rain += (white - rain) // 3
        gust = 24576 + _sine(index * (1 << 33) // count) // 4
        values.append((wind * 6 + rain // 4) * gust >> 15)
    # A 30 ms quiet dip at each boundary is deliberate, not proven perceptually seamless.
    return _finish(values, peak=2400, edge_frames=1440)


def _footstep(side):
    count = 11520 if side == "left" else 12960
    noise, low, phase, values = _noise(SEEDS[side]), 0, 0, []
    for index in range(count):
        low += (next(noise) - low) // 6
        frequency = 80 + (160 * (count - index) // count)
        phase += frequency * (1 << 32) // RATE
        remaining = (count - index - 1) * 32768 // count
        decay = ((remaining * remaining >> 15) * remaining) >> 15
        attack = min(32768, index * 32768 // 96)
        envelope = decay * attack >> 15
        values.append((low * 2 + _sine(phase)) * envelope >> 15)
    return _finish(values, peak=7000, edge_frames=96)


def score(event):
    """F: an already committed arrival event -> (MIDI pitch, onset, frames).

    This is presentation data only. It does not commit events or grant abilities.
    Region changes are authored musical transposition, not sourced regional music.
    """
    frame = event.get("at_frame")
    if (event.get("kind") != "arrival_committed" or event.get("region") not in {"street", "harbor"}
            or isinstance(frame, bool) or not isinstance(frame, int) or not 0 <= frame <= 2**53):
        raise ValueError("Unsupported arrival event or sample time")
    transpose = -5 if event["region"] == "harbor" else 0
    return tuple((pitch + transpose, frame + start, duration) for pitch, start, duration in
                 ((57, 0, 14400), (64, 20160, 14400), (60, 40320, 14400), (69, 60480, 43200)))


def shift_score(program, delta):
    if isinstance(delta, bool) or not isinstance(delta, int) or any(start + delta < 0 for _, start, _ in program):
        raise ValueError("Invalid score time translation")
    return tuple((pitch, start + delta, duration) for pitch, start, duration in program)


def _motif():
    values = [0] * 153600
    program = score({"kind": "arrival_committed", "region": "street", "at_frame": 0})
    for pitch, start, duration in program:
        increment = FREQUENCY_MILLIHZ[pitch] * (1 << 32) // (RATE * 1000)
        for offset in range(duration):
            attack = min(32768, offset * 32768 // 384)
            release = min(32768, (duration - offset - 1) * 32768 // 8640)
            envelope = attack * release >> 15
            phase = increment * offset
            tone = (_sine(phase) * 4 + _sine(phase * 2)) // 5
            values[start + offset] += tone * envelope >> 15
    dry = values.copy()
    for delay, divisor in ((2640, 7), (5280, 13)):
        for index in range(delay, len(values)):
            values[index] += dry[index - delay] // divisor
    # No DC subtraction: preserve the authored trailing silence exactly.
    largest = max(abs(value) for value in values)
    return [value * 5000 // largest for value in values]


def generate():
    return {
        "synthetic_rain_wind_loop.wav": _wav(_rain_wind()),
        "synthetic_footstep_left.wav": _wav(_footstep("left")),
        "synthetic_footstep_right.wav": _wav(_footstep("right")),
        "original_arrival_motif.wav": _wav(_motif()),
    }


def measure(payload):
    with wave.open(io.BytesIO(payload), "rb") as audio:
        if audio.getsampwidth() != 2 or audio.getnchannels() != 1 or audio.getcomptype() != "NONE":
            raise ValueError("Measurement expects mono PCM16")
        count, rate = audio.getnframes(), audio.getframerate()
        samples = array("h", audio.readframes(count))
    if sys.byteorder != "little":
        samples.byteswap()
    if len(samples) != count or count < 2:
        raise ValueError("Missing or truncated PCM")
    peak = max(abs(sample) for sample in samples)
    rms = math.sqrt(sum(sample * sample for sample in samples) / count) / 32768
    return {"encoding": "signed little-endian PCM16", "channels": 1, "sample_rate_hz": rate,
            "frames": count, "duration_seconds": count / rate, "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(), "peak_pcm": peak,
            "peak_full_scale": peak / 32768, "peak_dbfs": 20 * math.log10(peak / 32768) if peak else None,
            "rms_full_scale": rms, "rms_dbfs": 20 * math.log10(rms) if rms else None,
            "dc_mean_full_scale": sum(samples) / count / 32768,
            "nonzero_samples": sum(sample != 0 for sample in samples),
            "clipped_samples": sum(sample in {-32768, 32767} for sample in samples),
            "first_pcm": samples[0], "last_pcm": samples[-1],
            "loop_boundary_jump_pcm": abs(samples[0] - samples[-1]),
            "loop_boundary_slope_mismatch_pcm": abs((samples[1] - samples[0]) - (samples[-1] - samples[-2])),
            "largest_adjacent_jump_pcm": max(abs(right - left) for left, right in zip(samples, samples[1:]))}


def _atomic(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, suffix=".part", delete=False) as output:
            temp = Path(output.name)
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp, path)
        temp = None
    finally:
        if temp is not None:
            temp.unlink(missing_ok=True)


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Compare generated bytes with delivered WAV files")
    args = parser.parse_args()
    clips = generate()
    if sum(map(len, clips.values())) > 10 * 1024 * 1024:
        raise ValueError("Audio source budget exceeded")
    assets = root / "unity/Assets/HOMELESS/Audio"
    measurements = []
    for name, payload in sorted(clips.items()):
        destination = assets / name
        if args.check:
            if not destination.is_file() or destination.read_bytes() != payload:
                raise ValueError(f"Delivered WAV differs: {name}")
        else:
            _atomic(destination, payload)
        measurements.append({"path": str(destination.relative_to(root)), **measure(payload)})
    original = {"kind": "arrival_committed", "region": "street", "at_frame": 0}
    shifted = dict(original, at_frame=24000)
    harbor = dict(original, region="harbor")
    report = {"schema_version": 1, "evidence_kind": "Decoded PCM signal measurements only",
              "python_version": platform.python_version(), "generator": "tools/audio/synthesize.py",
              "generator_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "source_kind": "Original integer procedural synthesis; no external audio inputs",
              "seeds": SEEDS, "license": "CC0-1.0 for these generated audio bytes",
              "license_file": "unity/Assets/HOMELESS/Audio/ORIGINAL_AUDIO_LICENSE.txt",
              "files": measurements, "total_bytes": sum(map(len, clips.values())),
              "loop_policy": "Only synthetic_rain_wind_loop.wav promises zero sample/slope discontinuity; 30 ms smooth fades deliberately create a quiet boundary dip. Perceptual seamlessness is unreviewed.",
              "world_music_fixture": {"observable": "Ordered (MIDI pitch, onset sample frame, duration frames) tuples at 48000 Hz; exact integer equality",
                                      "F": "score: already committed arrival event to authored notes",
                                      "positive_R": "Translate event at_frame by +24000",
                                      "positive_M": "Translate all note onset frames by +24000",
                                      "positive_equal": score(shifted) == shift_score(score(original), 24000),
                                      "positive_expected_first_note": [57, 24000, 14400],
                                      "counterexample_R": "Change street to harbor without moving time",
                                      "counterexample_M": "Identity music transform",
                                      "counterexample_equal": score(harbor) == score(original),
                                      "counterexample_first_pitches": [57, 52],
                                      "limit": "This small fixture neither establishes a universal correspondence nor implements the full MATHEMATIC engine."},
              "acceptance": {"source_bytes_generated": "PASS", "decoded_signal_metrics": "PASS",
                             "human_audition": "NOT_RUN", "unity_import": "NOT_RUN",
                             "native_playback": "NOT_RUN", "spatial_audio": "NOT_RUN", "cinematic_audio": "NOT_RUN",
                             "natural_speech": "NOT_APPLICABLE"},
              "limitations": ["Synthesized rain/wind and impacts are experiments, not field recordings or measured material sounds",
                              "RMS and peak are signal metrics, not perceptual loudness or LUFS certification",
                              "No voice, real-person imitation, protected composition, private recording or third-party sample used",
                              "Signal analysis does not establish Android decoding, spatial hearing, masking, atmosphere or cinematic quality"]}
    if not args.check:
        _atomic(root / "evidence/audio/report.json", (json.dumps(report, sort_keys=True, indent=2) + "\n").encode())
    print(json.dumps({"status": "PASS", "mode": "verify" if args.check else "generate",
                      "files": len(clips), "bytes": report["total_bytes"],
                      "native_playback": "NOT_RUN"}, sort_keys=True))


if __name__ == "__main__":
    main()
