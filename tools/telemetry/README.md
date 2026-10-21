# Frame-trace analysis

`frames.py` supplies bounded arithmetic for the proposed HD-081/082 device test. It is not a recorder, a benchmark result, or proof of native execution. All tests in this increment use explicitly synthetic data. No Galaxy A16 capture has been acquired.

```sh
python3 tools/telemetry/frames.py path/to/frames.csv path/to/capture.json
python3 -m unittest discover -s tests/telemetry -p 'test_*.py' -v
```

The trace has exactly `frame_index,elapsed_end_ns,frame_time_ns` columns. Indices start at zero and are contiguous. Times are positive integer nanoseconds: `elapsed_end_ns` is the cumulative end of each frame since the start of capture, and its difference from the previous end must equal `frame_time_ns`. Capture/export must preserve every frame, including loading hitches, rather than discard bad intervals. A missing, duplicate, filtered, malformed or empty trace is refused. The parser reads at most 16 MiB and 250,000 frames, verifies SHA-256 before computing statistics, and uses no external dependencies.

The sidecar schema is `dark.frame-capture/1`. Required fields are shown in the test fixture in `tests/telemetry/test_frames.py`. Record actual build commit and artifact hash, CSV hash, UTC start time, device manufacturer/model/OS/GPU/RAM, target family, resolution, quality profile, starting/ending thermal observations, cache/network conditions, scenario and zero excluded frames. A hash establishes correspondence to supplied bytes, not authenticity of the supplied facts.

The report gives mean FPS, nearest-rank p95 and p99, worst frame, and counts above 33.3/50/100 ms. It compares the complete trace against a 1,200-second minimum, mean ≥30 FPS and literal p95 ≤33.3 ms, without rounding into a pass. In particular, a constant 33.333333 ms trace fails the stated p95 requirement. A future commissioner change to that threshold must change the governing constitution first.

`frame_pacing_thresholds` is only the arithmetic verdict on supplied inputs. `native_device_acceptance` remains `NOT_RUN` for synthetic input or `REVIEW_REQUIRED` for input claiming native Android origin. A reviewer must verify the actual continuous footage, device, source/build match, quality profile, thermal trace and representative route. `release_accepted` is always false here. The CLI exits zero when a report is produced, even if thresholds fail; malformed or inaccessible input produces a structured refusal and exit two.

This tool does not evaluate rendering quality, frame pacing during omitted periods, audio, memory, CPU/GPU cost, touch controls or the rest of HOMELESS. The eventual native recorder/export adapter and device session remain unimplemented and unrun.
