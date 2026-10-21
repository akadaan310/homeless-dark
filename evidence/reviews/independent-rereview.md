# Independent scoped re-review — R1, R2, R3

Reviewed 2026-10-21. Follow-up to `/tmp/homeless-independent-review.md`; limited to the requested corrections, two smaller observations, and a source-level check of the new review audio bindings. No repository edits or git mutations. This is not product acceptance.

## Disposition

| Finding | Status | Basis |
|---|---|---|
| R1: caller-controlled authentication time | Addressed in the local-process model | `LocalAuthority` now requires `SimulationClock`; session issue time comes from it; validity reads the current clock; backwards advancement is refused. `SignWorld.SetSign` authenticates at current time and requires current tick for new events. Existing request digest lookup remains after authentication but before the new-event tick check, allowing renewed-session retries without duplicate commits. Clock advancement is locked across write admission and commit. |
| R2: malformed journal UTF-8 escapes typed refusal | Addressed | `FileEventSink.Append` narrowly normalizes `DecoderFallbackException` during reading to `JournalException`, before any file write. `SignWorld` therefore returns `storage_failed`. No broad catch or automatic truncation was introduced. |
| R3: permanently falling review visitor | Addressed at source level; native verification pending | `ReviewWalker.Update` stops movement below the spawn-relative fall threshold and shows a recovery prompt. R key and the on-screen reset both call `ResetInspection`, which disables the controller, restores the recorded spawn, clears vertical velocity, enables the controller, clears input/pause state, and resumes inspection. This resolves the lack of a recovery path in the reviewed source. |
| Trilinear/anisotropy mismatch | Addressed at source level | `SurfaceImporter` explicitly applies `FilterMode.Trilinear`, anisotropy 4 and repeat wrapping to source textures and generated masks. |
| Nonexistent art command in build docs | Addressed | The example now invokes `tools/art/fetch_materials.py --help`. |

No original finding remains unaddressed in the reviewed source. Native proof of the Unity corrections remains outstanding, as expected from the host limitation.

## Independent checks performed

Read `evidence/core/review-fixes.md`, `review-verification.json`, the changed authority/world/journal code, added regression tests, final log summaries, current `ReviewWalker`, texture setting changes, build instructions, and audio adapter/bindings.

Recomputed SHA-256 for every entry in both `files` and `logs` in `review-verification.json`: all 15 entries matched. The supplied logs record Core 20 passed / 0 failed, Math 21 passed / 0 failed, CLI 3 passed and the corrected original reproduction. Those are inspected implementation-run records; I did not independently rerun their full suites.

Independently executed a focused API-adapted probe against the current compiled portable assembly:

```
/tmp/homeless-dotnet/dotnet run --project /tmp/homeless-rereview-probe/Probe.csproj
```

Exit 0; six assertions passed:

1. Pre-issue write refused.
2. Current-time write admitted.
3. Session invalid at expiry.
4. Backdated expired write refused.
5. Renewed same-actor session retrieves the original committed result, revision stays one.
6. Invalid UTF-8 journal returns `storage_failed`, with unchanged bytes and revision zero.

Probe source is `/tmp/homeless-rereview-probe/Program.cs`. No Unity test execution is implied by these portable results.

## New audio source check

`ReviewSoundscape` requires the character controller used by the generated visitor. `Start` initializes its controller and footstep source before movement updates; optional audio references and clips are checked before use. `SourceSceneBuilder` resolves the four named clips, fails explicitly if absent, constructs the two environmental emitters, and assigns the sources. All four named WAVs exist at the specified paths. I found no obvious new null-reference or C# API-use error in this small source review.

This check does not establish Unity compilation, WAV import success, audible playback, mix quality, background/foreground behavior, spatial attenuation, collision, or reset behavior on device. Review audio remains explicitly synthetic and native quality unverified.

## Remaining limits

The simulation clock is still a trusted local-process capability; exposing `AdvanceTo` to untrusted effect handlers would violate its contract. Clock persistence/distributed authority, transactional trusted-head recovery, torn-tail repair and full NPC disk persistence remain outside these fixes. No security sandbox for arbitrary same-process code is claimed.

Unity import, adapter compilation, touch/reset interaction, collision, audio playback and Android execution remain NOT_RUN. The next compatible-worker checks should exercise walking off every scene edge, reset by keyboard and touch after falling, and continued walking/audio after reset and pause/resume. This re-review does not extend to the complete CLI/geography/evidence generator or certify the full constitutional commission.
