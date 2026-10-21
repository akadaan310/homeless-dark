# Focused extension review — 2026-10-21

Reviewer: independent `final_extension_review` agent. Scope: new local inhabitant persistence and CLI integration, the pinned Tampa mathematical fixture exporter, and the synthetic/native frame-trace arithmetic tool. Existing engine, authority and mathematical production code were not broadly re-reviewed. No production source, git index, commit or remote changes were made by this reviewer.

## Findings

No actionable correctness or security blocker was found within the declared local scope. This is a review of an intermediate portable/source increment, not acceptance of HD-069, HD-078, HD-081/082, HD-089, HD-091 or HD-095 in full.

The persistence codec bounds input before decoding, uses explicit fields rather than arbitrary object deserialization, checks identity independently, validates the existing actor invariants, and requires an independently retained digest. Refusal paths preserve live object identity and file bytes. The CLI exposes a structured refusal instead of replacing a failed load with its temporary `unloaded` object.

The Tampa exporter consumes the exact pinned source hash and preserves OSM identifiers, way directions/tags and attribution. Its two-plate partition, closure and rotation are explicitly fictional. The exporter labels its policy cases as expectations, its topology oracle as edge-set projection only, and all physical/native semantics as unrun. These boundaries are consistent with the inspected implementation.

The frame analyzer verifies source-byte correspondence, canonical contiguous integer timing, explicit zero exclusions and bounded resources. Its nearest-rank quantiles and literal 33.3 ms comparison are correct for the stated arithmetic. Synthetic results cannot become native acceptance, and declared-native inputs still require independent evidence review. Metadata and CSV authenticity cannot be inferred from their hashes; this limit is explicitly disclosed.

## Executed verification

Commands run from the repository root on ARM64 Linux with .NET SDK 8.0.426:

```sh
DARK_DOTNET=/tmp/homeless-dotnet/dotnet /tmp/homeless-dotnet/dotnet run --project tests/Dark.Population.Tests --no-restore
python3 -m unittest discover -s tests/telemetry -v
python3 -m unittest discover -s tests/geography -p test_tampa_fixture.py -v
```

Observed: population **15 passed, 0 failed**; telemetry **9 passed**; Tampa Python **8 passed**.

Additional independent temporary-file/process probes:

- **68 mutation/truncation cases:** started with a real CLI NPC snapshot; made 60 seeded bit mutations and recomputed each payload checksum, plus eight truncated variants. Replayed through a separate `darkctl replay-npc` process using the independently retained original receipt. Every case returned exit 2 and a structured refusal; every input file remained byte-identical.
- **12 cross-process contention rounds:** four independent writer processes raced to publish the same missing snapshot with the genesis receipt. Exactly one succeeded per round (48 total writers), and a separate reader process restored the winner in all 12 rounds. This checks cooperative local-process contention on this host, not distributed filesystems or crash recovery.

## Limits and remaining acceptance

The population report and usage documentation explicitly disclose that file flushing and same-directory replacement do not fsync the parent directory or atomically commit the separately trusted receipt. Normal writer exit and later process restore are tested; forced kill, power loss, Android lifecycle recovery, backup repair and multi-host coordination are not. These are scoped missing features, not hidden successful recovery claims.

No Unity import/compile, Android build, physical collision/navigation, camera perception, real Galaxy A16 trace, worldwide population allocation or full gameplay was executed in this review. A valid mathematical fixture does not establish embodied plate acceptance. The frame analyzer is not a recorder and cannot establish representative gameplay from supplied metadata alone.

## Reviewed source digests

| Path | SHA-256 |
|---|---|
| `packages/com.homeless.dark/Runtime/Population/FileInhabitantStore.cs` | `cf856e0e5a4ca668d96e09aa4ead8137111ca278ec41c2c3ee51de6c3ff50f2a` |
| `packages/com.homeless.dark/Runtime/Population/InhabitantSnapshotCodec.cs` | `b0082dfbcfd939a6bb39eb4117850ef08ee28391c97c2b479b654e6cf59ccb0d` |
| `tools/Dark.Cli/Program.cs` | `944417ca5e4e86aa7117f4372db53aa69cbb6c0f9e7622226facd3a8b3ffde6c` |
| `tools/geography/tampa_fixture.py` | `fc134d627f2fc0eaf70101332db2f859b619aef204e219ea25e3cb476605c0b6` |
| `tools/telemetry/frames.py` | `16767b8e8a560ed7fd4298cd105a2465a46d44920b198234e7f64652402edbea` |

## C# Tampa consumer addendum

After the consumer was written, reviewed `tests/Dark.Geography.Tests/Program.cs` and its project file, then independently executed the built Release harness:

```sh
/tmp/homeless-dotnet/dotnet tests/Dark.Geography.Tests/bin/Release/net8.0/Dark.Geography.Tests.dll
```

Observed **10 PASS, 0 FAIL**. The JSON-to-`PlateWorld` and `RewriteRequest` mappings preserve the fixture fields. The C# WGS84 check independently confirms Python's E,U,N axis reorder. All three policies execute through the production mathematical kernel, with literal occupancy expectations, all-pairs graph checks, independent rotation midpoint/end coordinates, inverse state hashes, and stale/invalid refusal checks. The full sourced graph has 17 nodes and 16 edges; the fictional boundary replacement changes the anchor-connected component from 14 to 10 nodes while preserving 15 edges. Both admitted inverse cases restore the same content hash at a new revision. No mapping error or blocker was found.

Reviewed test source SHA-256: `b3789d8ce989d56813bceb4ca552590e8707b1d9c4e6544f48cf5ac2d270b9c0`; project SHA-256: `701cdf7fbbe7206f804e732b31176e8a36c66c232cc7524ee6eece24ce4e3565`. Fixture SHA-256: `8abae87f2866dd3a43106c9c77f8f65613245c691d2111949b1b53339ec6bfef`.

The actual C# results supersede the exporter's expectation-only status for these mathematical policy cases. They do not implement the runtime observer's authored divergence, physical transport, collision, safe spawn or native HD-091 acceptance. The harness correctly retains `NOT_RUN`/`NOT_ACCEPTED` for those gates.
