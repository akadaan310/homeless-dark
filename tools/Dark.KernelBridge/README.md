# Portable kernel process bridge

This executable calls the existing `Dark.World.PlateWorld` and `Dark.Population.PopulationLedger` implementations. It is a deterministic computation adapter. It does not authenticate users, grant capabilities, commit world events, accept native physics, or replace the Python server's transaction authority.

Build and test:

```sh
/tmp/homeless-dotnet/dotnet build tools/Dark.KernelBridge --configuration Release --nologo
python3 -m unittest discover -s tests/server -p test_kernel.py -v
```

The executable reads one JSON object from stdin and writes one JSON object plus newline to stdout, then exits. It bounds input and output at 1 MiB and terminates after ten seconds. Its parser rejects duplicate object keys, excessive depth, unknown fields, malformed shape and non-finite numbers. The Python `dark_server.kernel.KernelBridge` runs the DLL with an argument vector and no shell, reads stdout/stderr incrementally under a combined 1 MiB budget, enforces a deadline of at most ten seconds, and kills the process group on failure. Build is a separate operator step with a 120-second deadline. The wrapper requires Linux/POSIX process and selector support.

Request envelope:

```json
{"schema":"dark.kernel-request/1","operation":"describe","arguments":{}}
```

Every response has `schema: dark.kernel-result/1`, the echoed operation, `status`, `authority_granted: false`, and `physical_validation: NOT_RUN`. Valid statuses are `OK`, `VALID`, `ADMITTED`, and `REFUSED`. For plate operations, admission means mathematical admission by the bounded kernel. It is never an authority or collision grant.

## Plate operations

`plate_fixture` takes an empty object and returns `fixture`. This is the exact pinned sourced Tampa fixture, SHA-256 `8abae87f2866dd3a43106c9c77f8f65613245c691d2111949b1b53339ec6bfef`. Its original OSM source hash is `55bd28406a5cf22063eba5d456e46f4cd7f1b590c9288bc4808ad9ff1a27e86a`. Its synthetic plate split is not a physical survey. The source license/provenance remains embedded in the fixture; copying it into build output does not change its rights.

`plate_validate` and `plate_apply` accept:

```json
{
  "world": {
    "revision": 0,
    "plates": [{"id":"...","center_xyz_m":[0,0,0],"angle_degrees":0}],
    "nodes": [{"id":"...","plate_id":"...","local_xyz_m":[0,0,0]}],
    "edges": [{"a":"...","b":"..."}],
    "occupants": [{"id":"...","node_id":"...","boundary_straddler":false}]
  },
  "request": {
    "expected_revision":0,"plate_id":"...",
    "remove":{"a":"...","b":"..."},"add":{"a":"...","b":"..."},
    "rotation_degrees":90,"policy":"RigidCarriage",
    "authority_witness_id":"server-event-reference",
    "start_tick":100,"duration_ticks":120,"operation_budget":100000,
    "destinations":{}
  }
}
```

The abbreviated arrays above are schema examples; a real call needs exactly two plates, 2–256 valid nodes, at most 512 edges and 256 occupants. Obtain a runnable initial object from `plate_fixture`, add `policy` and `destinations` to its `rewrite_request`, and preserve the IDs. The policy names are `RigidCarriage`, `WitnessedRelocation`, and `RefuseWhileOccupied`.

Both operations evaluate `PlateWorld.Rewrite` on a fresh immutable input snapshot. Validation returns `VALID`; apply returns `ADMITTED`. Both return identical proposed `next_state`, `revision`, `witness`, and `source_projection`. They set `activation_requires_revalidation: true` and `durable_commit_performed: false`. The server must independently authorize, compare the current world revision, account for the operation, and transactionally commit the returned state/witness. A kernel refusal preserves the supplied world under `next_state`, returns the unchanged revision and a null witness. Invalid schema input may be refused before a world can be reconstructed and then has no next-state field.

The witness records reachability/embedding changes, work bound, affected IDs, source/destination nodes, policy, authority-reference string, start/end ticks, and five actual kernel samples at normalized times 0, 0.25, 0.5, 0.75 and 1. It also exposes complete analytic curve parameters:

- `rigid_rotation_y`: for normalized time `t`, set `theta = (start_angle_degrees + rotation_degrees*t)*pi/180`; `x = center.x + local.x*cos(theta) - local.z*sin(theta)`, `y = center.y + local.y`, `z = center.z + local.x*sin(theta) + local.z*cos(theta)`.
- `linear_relocation`: interpolate `start_xyz_m` and `end_xyz_m` linearly with `t`.

These reproduce `TransportWitness.At(t)`; samples are evidence, not the only supported times. This rotation convention must be translated explicitly into any Unity rotation API. The adapter does not establish collision clearance, support, velocity preservation, terrain alignment, or continuity of finite-volume actors. Straddlers remain rejected by the kernel. IDs of actors and attached objects must be supplied without shortening or relabeling; every returned `entity_id` maps exactly back to the server-owned identity.

`source_projection` retains original source latitude/longitude separately from proposed synthetic coordinates. For recognized fixture nodes within the 10 km chart, world XYZ is transformed through the existing WGS84 ENU kernel at the source anchor. Unknown source heights are explicitly represented as unknown, with the chart's zero-ellipsoid-height assumption disclosed. Arbitrary nonfixture node sets do not receive fabricated source coordinates. A mathematical inverse across separate processes is not exposed: the existing inverse requires a retained actual after-state object, and no unauthenticated serialized witness is promoted to that object here.

## Population operations

The build embeds the exact 2024 World Bank allocation TSV, SHA-256 `770cbf8e33263680074c1bc60a5af540ac2f55db991389bfeabebc762c528e11`, under its existing attribution terms. It represents 217 source economies plus the explicit unassigned world residual. It does not infer street density.

`population_resolve` accepts `person_id` and optional `snapshot`, `promote` boolean, `demote` boolean, `fact` string, and `commitment` string. With no snapshot it starts the source-backed virtual ledger. Resolve without promotion does not persist an untouched virtual identity. Promotion realizes stored state; facts/commitments are bounded and preserved across demotion. Example person ID: `wb2024/USA/7`.

`population_move` accepts `person_id`, `destination` source-shard code, `request_id`, `expected_revision`, `migration` boolean, and optional `snapshot`. It invokes the ledger's real trip/migration transition, including exact retry and conflict checks. Trips change present population; migration also changes residence. Identity origin stays fixed.

Both return the next checksummed `snapshot`, person view, revision, source/allocation hashes, count reconciliation for the person's current residence/presence, and separate virtual/stored/active/focused/visible/voiced metrics. No renderer or voice is created. The bridge bounds stored individuals at 1024, active individuals at 256, and retained movement events at 2048. These are process budgets, not claimed crowd performance limits. Facts/commitments are capped by the underlying ledger. Snapshot checksums detect corruption; they do not authenticate a hostile operator. The world server must own storage and transaction boundaries.

`population_inspect` accepts a `snapshot` and `person_ids` array with at most 1024 unique IDs. It restores the real ledger once, returns `persons` in request order plus unchanged snapshot, revision and metrics, and does not realize untouched identities. The same process, byte and time limits apply. The World candidate adapter uses it to reconcile every restored encounter's actual fidelity and present country in one process call.

### Python population candidate contract

`dark_server.population_runtime.PopulationRuntime.create(max_active=256)` starts with zero stored or active people and the exact 2024 estimate of 8,140,897,523. `restore(snapshot)` verifies the checksummed candidate, bounded complete retry history, source hashes and actual C# ledger. `snapshot()` returns a detached copy. A checksum is corruption detection, not a signature; the host must persist candidates inside its authenticated transaction history.

`apply(context, request)` receives host-owned context with `actor`, monotonic `tick`, exact source-economy `country`, `position: {lat, lon, alt}`, boolean `spawn_ready`, and current `capabilities`. These values are never accepted as client geography or authority. Requests contain `request_id`, adapter `expected_revision`, `operation`, and `arguments`. Supported operations are `encounter {key}`, `promote {identity}`, `demote {identity}`, `remember {identity, fact}`, `travel {identity}` and `migrate {identity}`. Encounter requires `population:encounter`; other operations require the exact string returned by `capability(identity, operation)`. Existing identities remain bound to the owner/key that introduced them.

New encounters deterministically select a synthetic identity inside the actual source economy. Initial placement requires an existing host-admitted ready spawn node and is explicitly fictional. Promotion requires the owner within 25 metres of the retained placement and a ready host placement. Demotion additionally requires host `safe_to_demote: true`; the host must exclude ongoing journeys, vehicle attachments and observed interactions. Remembered player reports are labelled as reports. Travel/migration additionally require host `arrival: {identity, from_country, to_country, tick, event_id, migration_authorized}` matching actual arrival and current country; migration requires explicit admission. No client destination or coordinate changes population.

Results contain `status: PROPOSED`, adapter `revision`, actual ledger `person`, `metrics` and affected-country `counts`, optional `spawn`/`retire`, and a `witness` with `base_population_revision`, ledger revision and source hashes. A spawn includes `world_actor_id`, position, country, deterministic policy seed, `fictional_placement: true`, `source_person_position: null`, and `requires_world_admission: true`. Results always set `authority_granted: false`, `durable_commit_performed: false`, and `physical_validation: NOT_RUN`. The World host owns the transaction, detailed NPC state, physical admission, archive and eventual rendering.

The candidate bounds active realization at 256, introduced records at 1024, retained requests at 512, and encoded snapshots at 1 MiB. Exhaustion is explicit; histories are never silently discarded. Exact retries still require current scope. Country totals come exclusively from the C# ledger. Source-cohort identity is a fictional demographic allocation, not an identified or geocoded real person. The explicit WLD_UNASSIGNED residual cannot supply spatial encounters.

## Verification scope

`evidence/tests-red.log` captures the initial missing-bridge failure. `evidence/tests.log` records executed bridge integration tests, including actual plate policies, graph revision/refusals, continuous witnesses, source population accounting and snapshots, malformed JSON, input/output budgets, subprocess timeout, and protocol errors. These checks establish portable behavior only. Native Unity physics, collision, screenshots, device performance and whole-commission acceptance remain unverified.
