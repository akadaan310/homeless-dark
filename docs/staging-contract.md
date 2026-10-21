# Local cell preparation and rendezvous candidates

`packages/dark_server/staging.py` implements bounded §22 cell lifecycle and §71 rendezvous gates against actual local bytes. It never moves an actor, fetches the network, creates Unity objects or writes World storage. Root World authority must admit each call and commit the resulting candidate snapshot. Preparation and activation are distinct calls.

```python
from dark_server.staging import Staging, scope, bootstrap_manifest
manifest = bootstrap_manifest(repo_root)  # operator-only fixed known file paths
staging = Staging.create(repo_root, manifest)
request = {"request_id": "r1", "expected_revision": staging.revision,
           "cell_id": "arrival", "operation": "OBSERVE", "arguments": {
    "assets": ["hero-mesh", "greeting-voice"],
    "path": [[0, 0, 0], [7, 0, 0]], "path_revision": 7, "mode": "walk",
    "speed_mps": 1.4, "speed_confidence": 0.8, "wait_ticks": 2,
    "observed_tick": 0, "anticipated_tick": None, "visible": True, "ttl_ticks": 100}}
result = staging.apply("member", [scope("arrival", "prepare")], request, 0)
candidate = staging.snapshot()
continued = Staging.restore(repo_root, manifest, candidate)
```

`inspect(cell_id)` and `snapshot()` return copies. `StageRefused(code, witness)` preserves the previous candidate. The host supplies the authenticated actor, admitted scopes and monotonic authoritative simulation tick (one second per tick in the estimator). Request IDs are actor-scoped; exact retries require current scope, return the original response and never reactivate twice. Changed retry input is refused. Read-only bootstrap/inspection does not grant capabilities.

| Operation | Rendezvous gate afterward | Cell lifecycle afterward | Actual work |
|---|---|---|---|
| OBSERVE | OBSERVE | requested | Bind manifest asset IDs, actor, explicit path/version and bounded expiry |
| PREDICT | PREDICT | requested | Sum polyline distances and derive conservative time-to-use |
| ADMIT | ADMIT | fetching | Charge rolling actor admission, concurrent preparation and deduplicated byte quotas |
| STAGE | STAGE | fetching | Read exact local regular files; verify byte count and SHA-256 |
| VERIFY | VERIFY | verified | Re-read/recheck bytes; no implicit prior verification trust |
| DECODE | VERIFY | decoded | Decode PCM/JSON/AABB, or explicitly inspect opaque bytes without semantic claims |
| INSTANTIATE | VERIFY | instantiated | Create portable metadata instance; native engine remains NOT_RUN |
| COLLISION_READY | VERIFY | collision_ready | Require a decoded portable AABB with validated contained spawn |
| RESERVE | RESERVE | collision_ready | Bind actor/path/catalog and a reservation lasting at most 30 ticks |
| ACTIVATE | ACTIVATE | active | Revalidate actual host context, authority, position, expiry and every content file |
| RETIRE | RETIRE | retiring | Retire the already active candidate |
| CACHE | RETIRED | cached | Release the portable instance; retain independently cacheable verified metadata |

`CANCEL`, `EXPIRE`, and `FAIL` apply only to inactive preparations. Expiry must actually have arrived; failure takes a bounded diagnostic `reason`. Cancelled work retains rolling admission cost. Reopening a terminal cell requires its owner and five ticks of hysteresis. Active cells retire explicitly; speculative expiry cannot secretly remove an active world resource. A stale snapshot/catalog cannot silently seed a replacement registry.

All operations except `ACTIVATE` require exact `staging:<cell>:prepare`. Activation requires exact `staging:<cell>:activate` and a separate **host-derived** `actual` argument:

```json
{"actor":"member","path_revision":7,"catalog_version":"fixture-v1",
 "position":[2,1,2],"observed_tick":0}
```

The actual observation must be at most five ticks old, match the actor/path/catalog reservation, and put the actor already inside a verified portable safe volume. The result declares `world_position_changed:false`, `authority_granted:false`, `durable_commit_performed:false` and `physical_validation:NOT_RUN`. The host must not copy untrusted client values into `actual`. AABB containment is mathematical fixture validation; Unity terrain/collider validation remains a separate integration gate. FBX or PNG byte verification cannot substitute for collision readiness. The bootstrap deliberately contains no invented collision mesh, so it can reach portable DECODE but cannot activate as terrain.

Manifests contain `schema, version, assets`; each asset has `id, path, bytes, sha256, kind, decoder`. Kinds are voice, animation, mesh, material, music, ambience, collision or program. Only fixed manifest relative paths are accepted. Every directory/file component is opened with `O_NOFOLLOW`; traversal, control bytes, final symlinks, parent symlinks, FIFOs and missing files refuse. Maximum asset size is 32 MiB and JSON is bounded to 1 MiB before parsing. PCM decoding verifies complete frames, supported channels/sample widths/rates and maximum 600 seconds. `opaque_bytes` states `semantic_decode:UNSUPPORTED`; program bytes are never executed. The operator-owned manifest is detached from caller mutation.

Default hard limits are 32 stable cell slots, 128 manifest/cache assets, 16 asset IDs per cell, 64 MiB planned unique resource bytes, four concurrent preparations per actor, four admissions per 60 ticks, 512 events/request records and 1 MiB snapshots. Limits can be reduced in `create(..., limits={...})`. Logical resource-byte accounting is not measured resident RAM; this implementation caches metadata and re-reads source files. Unpinned cache entries evict deterministically when needed. Exhausted history refuses additional work rather than forgetting idempotency. Checksums/event chains detect ordinary corruption; snapshots remain trusted operator data, not signatures against a malicious storage operator.

The predictor uses actual supplied path distance, waits, conservative speed times confidence and observation age. It rejects paths older than 300 ticks. Below 0.1 m/s or confidence 0.1 it uses explicit scheduled or visible anticipation; otherwise readiness time is unknown. Scores are explicitly not probabilities. `compare_allocations(items, byte_budget)` compares deterministic benefit-per-byte greedy allocation against an exhaustive oracle for at most 16 items. Required resources precede predictions. The persisted counterexample has budget 4: greedy selects a 3-byte benefit-5 item, while the exact oracle selects two 2-byte benefit-3 items. It reports missed benefit 1 and one unused byte instead of claiming optimality. One hundred seeded randomized fixtures compare feasibility and oracle dominance.

The fixed real bootstrap has six files totaling **33,004,281 bytes**: Citizen FBX, material JSON, diffuse skin PNG, original arrival music, original rain ambience and the actual cached English `npc:bo` socialize speech WAV. `evidence/staging/bootstrap-manifest.json` records exact paths/sizes/hashes. Five measured portable passes through OBSERVE to DECODE each read **99,012,843 bytes** because stage/verify/decode independently check contents. Median elapsed wall time was **134.151 ms**, median process CPU **104.550 ms**, and median Python tracemalloc peak **56,345,729 bytes** on this ARM VM. These are local warm-cache probes, not bandwidth or player lead-time distributions; tracemalloc excludes native allocations. No GPU measurement is claimed. Successful operations accumulate actual bytes and read wall time; failed candidate reads are not committed into state metrics.

Run `python3 -m unittest discover -s tests/server -p test_staging.py -v` for 18 tests. Reproduce actual assets/measurements with `python3 evidence/staging/probe.py "$PWD"`. Red logs, final logs, actual probe outputs, code hashes and independent review are retained in `evidence/staging/` and `evidence/content/staging-review.json`. Covered failures include stale authority/actual state, changed files after reservation, malformed manifests, unsafe paths, bad spawn, wrong lifecycle order, expiry, cancellation baiting, deduplicated quotas, retry conflict and snapshot/catalog mismatch. Native streaming, GPU upload, World transaction integration and player traversal across geographic boundaries are separate acceptance work.
