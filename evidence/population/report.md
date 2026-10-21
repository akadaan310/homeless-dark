# Inhabitant disk continuity increment — 2026-10-21

**PASS:** 15 population persistence behavioral groups on .NET SDK 8.0.426, ARM64 Linux. The suite writes a real NPC snapshot in a child writer process, terminates that process normally, and starts a separate reader process that restores the same identity, personality, task and ordered causal memories and makes the same ride decision. This is normal process-reload evidence, not process-kill, power-loss or Android lifecycle evidence.

Commands run from repository root:

```sh
DOTNET_CLI_TELEMETRY_OPTOUT=1 /tmp/homeless-dotnet/dotnet run --project tests/Dark.Population.Tests
DOTNET_CLI_TELEMETRY_OPTOUT=1 /tmp/homeless-dotnet/dotnet run --project tests/Dark.Core.Tests
DOTNET_CLI_TELEMETRY_OPTOUT=1 /tmp/homeless-dotnet/dotnet run --project tests/Dark.Math.Tests
```

Population results are in [final-tests.log](final-tests.log). Initial interface-only execution produced 12 expected failures before implementation ([RED](red.log)); the first implementation passed those 12 groups ([initial GREEN](green.log)). Additional malformed-wire and boundary cases expanded the final suite to 15. Existing Core **20/20** and math **21/21** compatibility results are retained in [integration-core.log](integration-core.log) and [integration-math.log](integration-math.log). Source/fixture/log digests are recorded in `verification.json` after final execution.

## Delivered behavior and clause scope

- **HD-028/030/032/078/089:** actual existing `Inhabitant` fields are persisted, not replaced by a new random seed. ID, task, personality, memory order, observation source actor/event/act/tick/cell and decision witness survive restart. Rebuilt event-ID membership refuses an already observed greeting after reload. Remote-cell and backdated observations still refuse; a later admitted local observation can be saved and reloaded as a second checkpoint.
- **HD-028/029/095:** constructor-bound expected identity and caller's live identity are checked independently of the file's serialized ID. Restore requires a separately trusted SHA-256 receipt. An internally valid foreign snapshot, stale receipt or changed payload cannot replace the live actor. Persistence confers no account role or capability and contains no founder authentication data.
- **HD-078/095:** missing files, checksum corruption, truncation, unsupported schema, malformed UTF-8/length fields, trailing data, invalid personality, noncanonical identifiers, negative/out-of-order ticks, duplicate observation IDs, excessive memory count and oversized files return typed refusal. Every refusal result returns the identical input `State`. Tests also verify exact corrupt bytes remain unchanged and a failed first publication removes its temporary file while preserving the existing destination directory.
- **HD-078/095:** optimistic previous-digest comparison prevents stale writers from overwriting a later checkpoint; exclusive cooperative file locks refuse a simultaneous writer. Generation is monotonic and refuses signed 64-bit exhaustion. Saves capture/validate immutable snapshots before disk publication; they do not mutate the live actor.
- **HD-069:** restore is read-only, with no hidden file/lock creation. This store supplies a local versioned checkpoint building block, not a verified ACSP, PURL or SEURL adapter. It defines no invented network endpoint or external protocol compatibility claim.
- **HD-031:** the existing two-parameter ride utility policy is preserved and tested. This does not constitute game-theoretic equilibrium or intelligence evidence.

## Interfaces and limits

`FileInhabitantStore(path, expectedActorId)` exposes `Save(current, expectedPreviousDigest)` and `Restore(current, trustedDigest)`. Use `Genesis` only when creating a missing snapshot. Results expose `Succeeded`, `Code`, `State`, `Generation` and `Digest`; successful save retains the original live object, while successful restore returns a new fully validated actor. Caller swaps the live reference only after success. Existing `Inhabitant`, Core and authority APIs were preserved.

Schema 1 uses at most 256 KiB, 256 observations and 128-byte identifier fields. Doubles are exact binary64 fields but must be finite and within the existing policy domain. Unknown versions refuse rather than guessing a migration. The decoder bounds bytes before allocating/reading and parses only explicitly registered primitive fields; it does not execute an arbitrary object deserializer. Full format and usage are in [docs/population.md](../../docs/population.md).

File data is flushed before same-directory `Move`/`Replace`. All writers must use the same canonical path and cooperative lock; arbitrary external writes, path aliases and remote storage semantics are outside this guarantee. Actor mutation must be paused while taking its snapshot. The store does not atomically coordinate the returned receipt with a separate trusted head, fsync parent directory metadata, repair a damaged file, provide backup restoration or certify power-loss durability. A file plus its receipt controlled by the same malicious operator is not an authenticated historical proof.

## Population and remaining acceptance

This lane persists a single synthetic fixture identity per tested checkpoint; fixtures and temporary stores are removed after tests. It does not choose a demographic source/epoch, allocate a global population, provide global ID uniqueness, reconcile migration, schedule cohorts or measure active/visible/voiced populations. There is no planetary population completion claim. The maximum 256-memory fixture tests retention bounds, not population scale.

Location, beliefs/uncertainty fields, relationships, needs/resources, vehicle/inventory state, observation authority provenance, generalized NPC planning and discourse state remain absent from the current `Inhabitant` schema. A cell in a memory is historical observation scope, not a saved authoritative current location. The greeting event and decision witness remain recognizable; this is not native world travel, rendered awareness or physical embodiment evidence.

**NOT_RUN:** forced kill during snapshot replacement, multi-host concurrency, distributed checkpoint coordination, Unity compilation/import, Android save/resume, native safe spawn, device rendering and full HD-089 population acceptance. No UI, Unity, ledger, shared Core, git index, commit or push changes were made by this lane. Parent integration may expose this stable store through local CLI commands; those callsites are outside the lane's source ownership.
