# Persistent gameplay runtime

The Python World service owns gameplay state, admission and one SQLite transaction boundary. The C# kernel admits plate rewrites and population transitions. The Unity client sends actions over the PURL-shaped HTTP adapter and interpolates authoritative observations. A JavaScript worker returns proposals with no direct world, filesystem or network access. This is a running integration; native visual, physical and Android acceptance remain separate.

Use a fresh world path. Creation never replaces an existing world. Token files are private local credentials and must stay outside version control.

```sh
export DARK_DOTNET=/tmp/homeless-dotnet/dotnet
"$DARK_DOTNET" build tools/Dark.KernelBridge
python3 tools/build_gameplay_content.py
python3 tools/darkctl.py --world artifacts/my-world.sqlite3 init
python3 tools/darkctl.py --world artifacts/my-world.sqlite3 register player-one --token-file /tmp/homeless-private/player-one.token --scope author/fictional:cafe-apron
python3 tools/darkctl.py --world artifacts/my-world.sqlite3 join --token-file /tmp/homeless-private/player-one.token
python3 tools/darkctl.py --world artifacts/my-world.sqlite3 serve --port 8765
```

The last command stays in the foreground and advances one simulation second per real second, with at most five seconds of catch-up. Restarting does not invent detailed offline activity. This provisions an ordinary player; it does not assign the commissioner's reserved founder role.

From another shell, `observe --token-file /tmp/homeless-private/player-one.token` returns the current revision. Then `invoke talk --arguments '{"target":"mira","act":"greeting"}' --request-id greeting-1 --revision REVISION --token-file /tmp/homeless-private/player-one.token` submits one exact request. Use `validate` with the same arguments for admission without commit. Preserve the exact ID and request after an unknown network outcome. Refresh and consciously revise stale intentions; silently rebasing could change their meaning.

Discovery is `GET /.well-known/purl` and `GET /r/world/manifest`; reads have no gameplay effects. Authenticated actions use `POST /r/world/ops/{operation}` with `Bearer`, `Idempotency-Key`, and `{expected_version: revision+1, input: arguments}`. Authenticated `/r/world/events` exposes only the caller's commands. `/r/world/terrain?lat=...&lon=...&width=33&span=2000` supplies bounded actual global terrain samples and source metadata. It limits each actor to one request per second and one concurrent terrain query. The server binds loopback; remote deployment needs a separately configured authenticated TLS service.

Walking, guided travel, vehicle boarding, explicit driver control, autonomous-trip consent, pause/resume, local speech, scoped signs, plate learning/rewrite and entity actions share the transaction boundary. Source coordinates remain distinct from the fictional navigation and plate layers. NPC schedules propose actual travel to content-defined places; needs follow committed activity. The small strategic model uses exact rational two-player/two-action equilibrium witnesses, with explicit model utilities and baseline regrets. It is not a general human-behavior model.

`entity_action` accepts `{entity, ability, input}`. Entry and ride requests use dedicated adapters that derive their causal participant from the authenticated session. Public observations omit entity memories, occupants and private ride destinations. `prepare_cell`, `activate_cell`, `cancel_cell` and `retire_cell` accept `{cell}`. Preparation checks actual files and records portable readiness; activation rechecks host position, route, expiry, catalog and bytes. The small café apron volume is a source-derived authored clearance envelope, not evidence of a Unity collider or a safe airport scene.

The QuickJS worker is built with `python3 tools/workers/build.py`. `script --source program.js --outbox /tmp/homeless-private/outbox.sqlite3 --token-file ...` computes bounded proposals and stores exact pending requests. `flush --outbox ... --token-file ...` dispatches those requests; `reconcile --outbox ... --after 0 --token-file ...` matches them against authenticated committed receipts. Cancellation cannot recall an attempt already dispatched. Unknown expired outcomes remain explicitly unresolved until reconciled. The finite `seurl` CLI parses or seals application descriptions; a sealed URL grants no authority and installs no OS URL scheme.

Run a complete source-backed headless session with a new output directory:

```sh
python3 tools/gameplay_session.py --output artifacts/session-new --report evidence/server/session-new.json
```

The session uses three actual HTTP test clients, source-backed Tampa roads and airports, scripted authoring, entity effects, staged assets, operative learned topology, persistence, taxi/helicopter/aircraft travel and a global terrain query. It preserves the database and sanitized transcript. It does not establish human attendance, an LLM participant, native physics or native rendering. The separate subprocess test kills and reopens the actual CLI server during a journey.

World snapshots, events and session hashes trust the local database operator. Hash chains detect corruption relative to the retained head; they cannot prevent an operator replacing every trust anchor. The active snapshot cap is8MiB; entity and staging histories also have explicit bounded budgets. The current event log retains full state snapshots and needs measured long-session compaction work. No command here claims a release APK, worldwide detailed streets, natural multilingual speech or a device benchmark.
