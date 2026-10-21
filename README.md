# homeless-dark
HOMELESS — Dark. Abed-driven Codex workspace.

The [constitution](HOMELESS_DARK_STANDALONE_CONSTITUTION.md) is the sole governing commission. This repository currently contains an **initial source and portable-engine increment**, not an accepted game or a playable Android release.

## Run the portable increment

Install the pinned .NET 8 SDK (see `global.json`) and use Python 3.10+; no NuGet or pip packages are required for the portable tests.

```sh
dotnet run --project tools/Dark.Cli -- describe
dotnet run --project tools/Dark.Cli -- demo /tmp/homeless-demo-new
python3 tools/run_checks.py
```

The demo requires a new or empty directory. It commits two scoped sign changes to a real disk journal, rejects a stale write, handles an exact retry once, replays the history, saves and restores an NPC's memory, and shows that NPC refusing a ride. It is a local operator fixture with an ordinary member identity; it does not authenticate Obex Den or connect to a live world. `darkctl replay <journal> <trusted-head>` checks the recorded history. `darkctl replay-npc <snapshot> <expected-actor-id> <trusted-digest>` restores the saved inhabitant in a separate process. The demo's adjacent receipt files are convenient recovery data, not independent protection from a malicious operator; sign and NPC stores are not one atomic world transaction.

On the inspected ARM host, the verified SDK is `/tmp/homeless-dotnet/dotnet`; run checks with `DARK_DOTNET=/tmp/homeless-dotnet/dotnet python3 tools/run_checks.py`. The SDK directory is an environment tool, not a committed dependency or permanent hosted service.

## Source deliverables

- `packages/com.homeless.dark`: Unity-independent C# authority, bounded policy compiler, sign journal, versioned NPC disk snapshots/decisions, WGS84/ENU, exact population allocation, grammar and two-plate mathematical kernels.
- `unity`: Unity 6000.1.0f1 / URP 17.1.0 source project, import tooling, native art-review controller, proposed Android ARM64 build route and unrun Editor tests. [Build procedure and limitations](docs/unity-build.md).
- `assets/selection.lock.json`: three acquired CC0 material sets with original 2K maps and source hashes; a reproducibly authored fictional café, explicit missing hero families and unrun native states.
- `data/geography`: pinned global airport data/index, bounded Tampa OSM geometry, a source-anchored fictional two-plate fixture and Marina del Rey place reference. These do not provide worldwide terrain, routes, buildings or population realization. [Data provenance and reproduction](data/geography/README.md).
- `tools/audio`: four original reproducible PCM sound experiments with decoded signal measurements; native playback and listening review are unrun. `tools/telemetry` supplies a strict frame-trace calculator; it contains no actual device benchmark.
- `evidence`: actual test logs, failed cases, source licenses/hashes, host facts, reviews and the clause-by-clause requirement ledger. [Checkpoint](docs/checkpoint.md) and [task queue](evidence/task-queue.json) preserve remaining work.

## Native acceptance remains blocked

The inspected Linux ARM64 host has no supported Unity Editor, activated license, Android toolchain or connected Samsung Galaxy A16. No Unity import, adapter compilation, native render, APK/AAB, gameplay capture or device benchmark has run. A compatible, already available zero-new-cost build worker is required. Realistic rigged humans/motions, traffic, speech, global ingestion and substantial game systems also remain incomplete. The source-art review is explicitly separate from commissioned third-person gameplay.

No paid asset, hosted service, metered dependency or chargeable worker has been activated. There is no release acceptance or percentage-complete claim.
