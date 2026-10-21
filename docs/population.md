# Local inhabitant snapshot persistence

`Dark.Population.FileInhabitantStore` persists the existing `Inhabitant` model: exact ID, two personality parameters, task ID and ordered observations (`eventId`, source actor, act, simulation tick and cell). It preserves the ride decision and its witness across a real process reload. This is a bounded local operator facility; it does not allocate a demographic population, authenticate an actor, grant a role, or implement ACSP transport.

```csharp
var store = new FileInhabitantStore(snapshotPath, expectedActorId: live.Id);
var saved = store.Save(live, FileInhabitantStore.Genesis); // first publication only
if (!saved.Succeeded) { /* retain live; inspect saved.Code */ }
// Retain saved.Digest in a separately trusted checkpoint.

// In a later process, bind the slot to its already-known identity.
var restored = store.Restore(live, trustedDigest);
if (restored.Succeeded) live = restored.State;
// Otherwise State is the identical prior live object; files are not repaired or replaced.

// Subsequent saves require the prior receipt, preventing a stale writer from overwriting it.
var next = store.Save(live, saved.Digest);
```

The caller supplies the expected identity and trusted receipt. A valid checksum alone cannot substitute a different inhabitant. An incorrect receipt refuses replay of an older snapshot. SHA-256 supports corruption/tamper detection relative to that trusted receipt; an operator able to rewrite both the file and checkpoint remains trusted. Store files contain no account credentials, founder role or capabilities.

The caller must pause mutation of the actor while capturing its `Snapshot()`, publish a returned replacement into the live registry only after success, and coordinate the receipt with its durable checkpoint. The existing `Inhabitant` API remains unchanged. It still admits observations only from a caller-supplied local sensor result; restoring a trusted snapshot preserves that recorded knowledge, without proving camera visibility or authenticating new observations.

Schema 1 has a 256 KiB file limit, 256 observations, 1–128 byte strict UTF-8 canonical identifier fields, finite personality values in `[0,1]`, nonnegative observation ticks in preserved nondecreasing order, unique observation event IDs and a positive signed 64-bit checkpoint generation. Generation exhaustion refuses further saves. Unknown schema versions refuse; no migration or random fallback occurs. The binary layout is:

| Field | Encoding |
|---|---|
| Magic | Eight bytes `DARKNPC\0` |
| Schema | Unsigned big-endian 16-bit integer, currently 1 |
| Generation | Positive big-endian signed 64-bit integer |
| Identity | Length-prefixed identifier |
| Sociability, duty | Exact IEEE-754 binary64 bits, big-endian |
| Task | Length-prefixed identifier |
| Observation count | Unsigned big-endian 16-bit integer, at most 256 |
| Each observation | Event ID, actor ID, act ID, signed 64-bit tick, cell ID |
| Checksum / receipt | SHA-256 of all preceding bytes, 32 bytes; receipt uses lowercase hexadecimal |

Identifier lengths are unsigned big-endian 16-bit byte counts. Trailing bytes, malformed UTF-8, oversized fields, duplicate events and invalid memory order refuse even when the checksum is valid. No general object deserialization executes file-supplied types or code.

Saves use a retained empty `.lock` file for cooperative exclusive writers, verify the previous snapshot/digest, flush a same-directory temporary file, then publish with `File.Move` for creation or `File.Replace` for replacement. Restore is read-only and creates no lock or snapshot. Temporary cleanup is attempted on failed publication. Missing/corrupt/truncated/foreign/stale inputs leave the prior live object and existing snapshot bytes unchanged. Use one canonical path per identity and have every writer cooperate with this store; external writers and path aliases bypass its coordination.

This has passed ordinary disk write/reopen and separate-process tests on the current .NET/Linux host. It is not a coordinated two-file snapshot/receipt transaction, directory-metadata fsync, backup service, power-loss proof, Android lifecycle test or Unity compilation result. There is no location/vehicle/inventory schema, global identity registry, cohort scheduler, migration ledger or planetary allocation here.

Run the dependency-free suite:

```sh
DOTNET_CLI_TELEMETRY_OPTOUT=1 /tmp/homeless-dotnet/dotnet run --project tests/Dark.Population.Tests
```

The child-process fixture uses `DARK_DOTNET` if supplied, otherwise this session's `/tmp/homeless-dotnet/dotnet`. See `evidence/population/report.md` for executed results and remaining gates.
