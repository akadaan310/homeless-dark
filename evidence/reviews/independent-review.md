# Independent review: initial HOMELESS / Dark increment

Reviewed 2026-10-21. This is code review of the initial subsets described by `docs/implementation-plan.md`, not product acceptance or a finding that the full commission is complete. Primary review input: `/tmp/homeless-review.diff`; inspected corresponding C# portable package, test programs, Unity adapters/project settings, source-art importer/recipe and the relevant constitutional requirements. Some root edits continued during review; references below identify the original reviewed behavior. No repository edits or git mutations performed.

## Findings, ordered by priority

### R1 — P1: effect callers can rewind the authentication clock and reuse an expired session

- Location: `packages/com.homeless.dark/Runtime/Core/LocalAuthority.cs:47–60`, called from `Runtime/Core/SignWorld.cs:34,39`.
- `Authenticate` accepts an issue time but does not retain it. `IsValid` tests only the supplied `now` against expiry. `SetSign` passes the effect's own proposed tick as that time. Neither authority nor world stores an independently advancing authoritative clock. Checking a session at its expiration does not invalidate it for later calls that supply an older tick. The world's nondecreasing committed-event tick does not protect a quiet world whose last event predates expiry.
- Executed reproduction using the existing compiled portable assembly: create a member scoped to `sign/cafe`, authenticate at tick 100 with expiration 110; a first write at tick 0 is admitted. `IsValid(session, 110)` returns false; a second write at tick 1, revision 1, is admitted. Exact probe is `/tmp/homeless-review-probe/Program.cs` and runs with `/tmp/homeless-dotnet/dotnet run --project /tmp/homeless-review-probe/Probe.csproj`.
- Consequence: expiry does not provide the advertised authority boundary, and events can be committed before the credential's issue time. Relevant requirements: HD-015, HD-029, HD-095.
- Minimal fix: retain issue tick, check it, and separate a trusted monotonic authority clock from proposed event timestamps. Advance that clock only through the simulation/operator boundary; authenticate and admit against it. Reject backwards time at that boundary; never let a remote effect caller choose authentication time. Add regressions for pre-issue effects, expiry followed by older requests, and an idle world advancing beyond expiry. Keep deterministic clock injection rather than adding uncontrolled wall-clock reads to the kernel.

### R2 — P2: corrupted journal UTF-8 escapes the typed write-refusal path

- Location: `packages/com.homeless.dark/Runtime/History/EventJournal.cs:87–88`, with incomplete exception normalization at `Runtime/Core/SignWorld.cs:49`.
- `StreamReader` uses the strict UTF-8 decoder. A malformed byte is rejected before `JournalEvent.Decode` can normalize malformed data to `JournalException`. `SignWorld` catches IO, access, and journal exceptions but not the resulting `DecoderFallbackException`.
- Executed reproduction: write bytes `FF 0A` to the sink path, create `SignWorld` with that `FileEventSink`, then submit a valid scoped write. Actual result: `System.Text.DecoderFallbackException` escapes instead of an `EffectResult` with `storage_failed`. Revision remains zero, so there is no false in-memory commit. This reproduction is included in the probe above.
- Consequence: corrupted saves can abort the calling workflow rather than returning the existing typed recoverable storage diagnostic. HD-078/095 require corrupted-save diagnostics and safe failure.
- Minimal fix: normalize decoding failures inside `FileEventSink` to `JournalException`, or narrowly include `DecoderFallbackException` in the storage refusal boundary. Preserve the original file and unchanged in-memory state; test that both are unchanged. Do not add a catch-all that hides programming errors.

### R3 — P2: walking off the finite review scene leaves the operator falling permanently

- Location: `unity/Assets/HOMELESS/Editor/SourceSceneBuilder.cs:60,73` and `unity/Assets/HOMELESS/Runtime/ReviewWalker.cs:39–40` in the original snapshot (movement is at lines 43–44 after the concurrent mouse-input adjustment).
- The street occupies only x=-20..32, z=-28..-3.1; the café and apron are also finite. The controller applies gravity indefinitely and has no outer barrier, fall recovery, reset button, or safe-spawn operation. Starting at z=-2.5, walking backward for roughly 10 seconds reaches the open z=-28 edge and falls below all collision. Pause/resume cannot return the visitor to the inspection surface.
- Consequence: ordinary inspection movement makes the proposed art-review build unusable until it is restarted. This is a defect in the limited review tool itself, independent of the missing full-world streaming and gameplay features.
- Minimal fix: record the review spawn, provide an operator reset and/or bounded fall recovery that resets controller position and vertical velocity safely; optionally add scene boundary collision. Native movement/respawn verification remains required. This is a source-level finding; Unity execution was unavailable, so no native reproduction is claimed.

## Smaller observations

- `SurfaceImporter.cs:23,40` does not set trilinear filtering or anisotropy 4, despite those being the proposed initial settings in `tools/art/UNITY_IMPORT_SPEC.md`. Explicitly apply the same settings to source/derived textures, or revise the contract to match the intended profile. This is not evidence of measured shimmer or performance failure.
- `docs/unity-build.md` names `python3 tools/art/acquire.py --help`, but the actual supplied tool is `tools/art/fetch_materials.py`. The later reference to the import specification points at the correct commands; remove the broken example.

## Scope compliance and evidence assessment

The portable domain is deliberately narrow, and its annotations generally represent that scope accurately. The compiler admits one registered sign-write schema and rejects unsupported syntax/predicates; it is not represented as a general constitution compiler. Sign history uses canonical framing and a separately trusted head; it explicitly does not claim protection against the operator. NPC memory is local admitted-observation state and a two-parameter ride policy, not measured intelligence or field-of-view awareness. Graph rewrites retain exact snapshots and mathematical carriage witnesses while explicitly marking physical validation NOT_RUN. Geodesy, exact allocation, integer converse, and contextual reading code have meaningful literal/property/refusal fixtures. I found no additional substantive algorithmic defect in those reviewed mathematical subsets.

Do not interpret these observations as full HD-005/012/013/029/030/060/069/078 completion. In particular, the journal is not a crash-recovery transaction with a durably coordinated trusted head; an incomplete tail is refused rather than repaired. The NPC snapshot is an in-process object, not a versioned disk save format. Those remain implementation limitations and must remain visible in the ledger. The existing successful journal test is a write/reload test, not process-kill or power-loss evidence.

Unity import/build/adapter compilation and device execution remain NOT_RUN. I inspected API usage and checked the public `UniversalRenderPipelineAsset.Create(ScriptableRendererData)` implementation in Unity's [6000.1 graphics source](https://raw.githubusercontent.com/Unity-Technologies/Graphics/6000.1/staging/Packages/com.unity.render-pipelines.universal/Runtime/Data/UniversalRenderPipelineAsset.cs); its use is supported in Editor builds. I did not identify a definite C# compilation error in the reviewed adapters. Source inspection cannot certify package resolution, OBJ group/material names, imported axis/scale, door clearance, collision cooking, URP appearance, touch behavior, or APK startup. The `BuildAndroid` gameplay refusal and the separate art-review entry point correctly preserve that distinction.

Asset safety: `python3 tools/art/fetch_materials.py --verify` was executed during review and verified all 14 committed source maps across the three assets. Reviewed acquisition code restricts HTTPS hosts/redirects, locks bytes/digests, bounds archive expansion and selects declared texture names; source provenance and saved license documents are present. Megacity evidence is explicitly metadata/pointer inspection, not fetched LFS artwork or native gameplay. No false Unity/device PASS or completed hero-art claim was found in the reviewed material. This is a code/provenance inspection, not a new legal determination or visual acceptance.

## Verification and exclusions

- Focused standalone repro ran successfully and printed: pre-issue write `True`; validity at expiry `False`; subsequent backdated write `True`; malformed journal escaped as `System.Text.DecoderFallbackException` with revision `0`.
- Source art hash verification passed for 5 Asphalt024A, 4 Concrete034, and 5 Bricks059 maps.
- Did not rerun the entire already-reported 12-group core / 21-group mathematical suites or claim a fresh full test count.
- Did not execute Unity, Android builds, native EditMode tests, device benchmarks or captures.
- CLI implementation and commission/evidence generator added after the snapshot are excluded. Geographic ingestion received no full independent review in this assignment. Changes made after the reviewed snapshot require targeted regression/review; this report does not automatically approve them.
