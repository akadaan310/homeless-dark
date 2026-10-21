# Scoped independent review: transactional Python world

Review scope: `packages/dark_server/world.py` and `tests/server/test_world.py` as present on 2026-10-21. This is code/portable behavior review, not native gameplay, transport physics, world closure, or full commission acceptance. No root-owned source files were modified by this reviewer.

## Required fixes

1. **P1: actor and vehicle identities share an unchecked journey namespace.** `register` checks only `state["actors"]` (around line 233), while `_advance` chooses a vehicle first for any journey key (around line 542). Registering an ordinary actor named `car`, when a vehicle named `car` already exists, is accepted. After joining, that unboarded actor starts a walking journey. Advancing two seconds moves the driverless vehicle 2.8 m while the actor stays at the origin. This bypasses the driver/boarding contract through ordinary valid operations. Reject actor/vehicle ID collisions in both initial content and operator registration, including reserved operator `system`, or namespace journey keys so resolution is unambiguous. Add regressions for human registration and preseeded NPC/vehicle collisions.

2. **P2: valid JSON with wrong argument types escapes typed refusals.** `talk` with `target=[]`, `travel` with `destination={}`, `board` with `vehicle=[]`, and `overlay` with `destination=[]` each raise raw `TypeError: unhashable type`. The state/head remains unchanged, which is good, but callers cannot rely on the documented `Refused` contract and HTTP adapters may turn ordinary malformed input into 500 responses. Validate operation argument types/identifiers before dictionary membership or lookup. Reuse one envelope validator in `execute` and `validate`: `validate` additionally leaks `ValueError` for NaN and `UnicodeEncodeError` for invalid surrogate strings instead of `REQUEST_ENCODING`, and does not directly reject negative revisions.

## Authority concern requiring a documented trust boundary

`now` is accepted as a caller-provided parameter on every authentication path. A token issued at trusted time 100 successfully authenticates at `now=0`, because sessions store expiry but no issuance/not-before time. Backdated `now` also revives an expired token. The docstring calls this trusted operator input, so this is not an HTTP exploit unless an adapter exposes it. Prefer one injected operator clock on `World` rather than per-action caller time; store and enforce issuance time, and test that external request fields never control it. The previous portable C# authority fixed this class of issue; keep the new Python boundary equally explicit.

## Evidence and limits

`/tmp/homeless-world-review-probes.py` reproduces the namespace bug, four malformed argument exceptions, the validate encoding difference, and pre-issuance authentication. `/tmp/homeless-world-review-probes.log` records observed output. Existing test results are captured separately in `/tmp/homeless-world-review-tests.log`; those tests do not exercise these cases.

Other inspected behavior: SQLite `BEGIN IMMEDIATE` serializes writers; exact retries authenticate before returning; failed transactions leave head/state unchanged; the event digest includes actor/request/command/response/previous/state hash; a separate full-history verifier checks the chain. The database operator remains an explicit trust anchor. These properties do not establish native collision or Android recovery.
