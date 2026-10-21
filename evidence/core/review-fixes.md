# R1/R2 targeted review fixes — 2026-10-21

**PASS:** Core 20 groups, mathematical kernel 21 groups, CLI 3 tests; CLI build has zero warnings/errors. The independent review's original clock and UTF-8 reproductions were executed before edits, converted to failing behavioral tests, and corrected. This report covers R1/R2 only. Unity findings and other CLI/geography review work remain with their assigned owners.

## Reproduction and test-first evidence

- [Original unchanged review probe](review-original-repro.log): a session issued at tick 100 accepted a tick-0 effect, remained reusable with a backdated tick after the expiry check, and corrupt journal bytes escaped as `DecoderFallbackException`.
- [Initial regression RED](review-regression-red.log): original 12 Core groups passed; five new R1/R2 groups failed for those exact behaviors.
- [Additional clock RED](review-clock-red.log): a proposed future tick was also admitted under the old caller-selected authentication time; 12 groups passed, six failed.
- [R1 corrected, R2 still RED](review-r1-green.log): 16 groups passed; only the two malformed journal cases remained red.
- [Both corrected](review-regression-green.log): 18 groups passed.
- [Final Core run](review-core-final.log): 20 groups passed, including further monotonic-clock and renewed-session retry checks.
- [API-adapted original probe](review-fixed-repro.log): pre-issue and expired backdated writes both refused; corrupt journal returned `storage_failed`, revision zero, original corrupt bytes preserved.

## R1 — trusted simulation time

The root cause was the reuse of a proposed event timestamp as the authentication clock, together with failure to retain session issue time. New code takes no wall-clock time and never advances simulation time from an effect request.

The explicit operator API is:

```csharp
var clock = new SimulationClock(initialTick: 100);
var authority = new LocalAuthority(clock); // or (clock, founderId, founderKey)
authority.RegisterMember("member", credential, "sign/cafe");
var session = authority.Authenticate("member", credential, expires: 110);
clock.AdvanceTo(101); // trusted simulation/operator boundary only
world.SetSign(session, "request", expectedRevision: 0, tick: 101,
              target: "sign/cafe", value: "Welcome");
```

- `SimulationClock` requires a nonnegative initial tick and rejects backwards advancement. Repeating the same tick is allowed.
- `LocalAuthority` requires an injected clock. The former no-clock constructors, `Authenticate(..., now, expires)`, `IsValid(..., now)` and `CanWrite(..., now)` APIs were removed. No compatibility overload silently trusts request time.
- `ActorSession.IssuedAt` is taken from the actual clock at authentication. Validity is the half-open interval `[IssuedAt, Expires)`, plus membership in this authority's live session set.
- Authentication and scope validation read the current injected clock. `SignWorld` serializes clock advancement with authentication, sink append and in-memory application, so an external simulation step cannot advance between the time check and commit.
- New effects require the proposed tick to equal authoritative current time; mismatches return `noncurrent_tick` under HD-015. An idle world advancing beyond expiry rejects writes regardless of the last committed event's tick.
- A retry authenticates at **current** time first, then resolves the original request digest before matching the proposed event tick against the current clock. Thus an unexpired or renewed same-actor session may retrieve an already committed result with the original tick, while an expired or revoked session cannot retrieve it through the write API. Changed retry payloads still return `idempotency_conflict`; retries never append a second event.
- CLI demo callsites now explicitly create an operator clock and advance it to 1, 2 and 3 before new effects. Pure describe/validate/replay behavior is unchanged by this API migration.

The operator must own clock initialization/advancement. Player/NPC effect handlers must not receive its mutation capability. This remains a trusted local-process authority model: it does not sandbox arbitrary code running inside the same process or implement a persisted/network-distributed simulation clock. Restoring a durable clock/checkpoint remains a separate integration requirement.

## R2 — malformed UTF-8 journal

The root cause was strict UTF-8 decoding during `StreamReader.EndOfStream`/`ReadLine`, before `JournalEvent.Decode` could normalize the error. `FileEventSink.Append` now catches only `DecoderFallbackException` around the read phase and converts it to `JournalException("Malformed journal UTF-8")`. Existing `SignWorld` storage handling returns `storage_failed`; no broad exception catch was added.

Tests verify both direct sink diagnostics and the authoring workflow. The sink refuses raw `FF 0A` bytes without changing them. A world with an existing committed sign/event then encounters an appended malformed byte; the refused write preserves the exact corrupt file bytes, prior revision, event count, trusted head and sign value. Failure happens before any append or in-memory apply. No automatic repair, truncation, byte replacement or recovery success is asserted.

## Final commands and observed results

All .NET commands used `/tmp/homeless-dotnet/dotnet` SDK 8.0.426 with `DOTNET_CLI_TELEMETRY_OPTOUT=1`:

| Command | Result | Evidence |
|---|---|---|
| `dotnet run --project tests/Dark.Core.Tests` | Exit 0; 20 pass, 0 fail | [Core log](review-core-final.log) |
| `dotnet run --project tests/Dark.Math.Tests` | Exit 0; 21 pass, 0 fail | [Math log](review-math-final.log) |
| `dotnet build tools/Dark.Cli/Dark.Cli.csproj` | Exit 0; 0 warnings, 0 errors | [Build log](review-cli-build.log) |
| `python3 -m unittest discover -s tests -p test_cli.py -v` | Exit 0; 3 pass | [CLI log](review-cli-final.log) |
| API-adapted review probe | Exit 0; both clock attempts refused; typed storage refusal | [Probe log](review-fixed-repro.log) |

Changed files are limited to `Core/LocalAuthority.cs`, `Core/SignWorld.cs`, `History/EventJournal.cs`, the Core test runner and CLI clock/auth callsites. Evidence files use the `evidence/core/review-*` prefix. No git index, commit, push or Unity file changes were performed by this fix lane. These targeted results do not certify native/device execution or the remaining commission.
