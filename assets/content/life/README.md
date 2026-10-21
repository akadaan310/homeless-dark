# Compact Life candidate runtime

`packages/dark_server/life.py` implements six shared deterministic policies with persistent identity, traits, memory, observations, relations, dynamics, budgets and immutable source provenance. The six CC0 definitions in `entities.json` are authored fictional fixtures, including the star's synthetic coordinates. They do not establish worldwide populated intelligence or native physics.

```python
from dark_server.life import LifeRegistry, capability
life = LifeRegistry.create(definitions)  # entities.json["entities"]
request = {"request_id": "r1", "expected_revision": life.revision,
           "entity_id": "cup:counter", "ability": "nudge",
           "arguments": {"dx": 0.1, "dz": 0}}
result = life.apply("member", [capability("cup:counter", "nudge")], request, 0)
candidate = life.snapshot()
continued = LifeRegistry.restore(candidate)
```

The host supplies the authenticated actor, **currently admitted exact scopes**, a monotonic trusted simulation tick and validated observations. `apply` changes only the candidate registry. The host must commit its snapshot through the existing World transaction; this module does not grant authority, write storage or run a background simulation. A failure raises `LifeRefused(code, witness)` and preserves the previous snapshot. Exact retries require current authorization and return the original response; changed request content is refused. `inspect(id)`, `ids()`, and `snapshot()` return detached state. Snapshots are trusted operator data with structural validation and causal history hashes, not authenticated signatures against a malicious storage operator.

| Kind | Executable behavior |
|---|---|
| building | Bounded light changes; observed entry requests allow or decline according to welcoming trait and actual capacity |
| tree | A weather observation changes moisture once; bounded glow uses expressiveness |
| cup | A nudge updates a bounded synthetic offset using responsiveness |
| car | An observed ride request offers or declines from helpfulness, duty and energy; signal state changes |
| star | Bounded brightness expression preserves source coordinates |
| group | Self opt-in memberships, explicit exclusive conflicts, cycle refusal, and proposals requiring each member's own scope |

`observe` receives `{"observation":{"id":"o1","kind":"weather","subject":"tree:oak","tick":0,"payload":{"rain":0.8,"heat":0.2}}}` for a tree. Buildings accept `entry_request` with visitor; cars accept `ride_request` with requester and destination. Observations retain actor and admission tick and are marked caller-reported. Agentic decisions require a matching observation no more than 300 ticks old. Ride offers and group patterns are proposals; they do not take player control or mutate other members. These are tested rules, not claims of emergent intelligence.

The limits are 4096 entities, 1 MiB snapshots, 1024 events/request records, 64 memories and 64 observations per entity, 128 members per group and 16 groups per entity. The simulation budget is 100 abstract units per 60 ticks with explicit per-ability costs and cooldowns. These units are not CPU or GPU measurements. Full persistent history refuses new work rather than silently evicting memory. No one-MonoBehaviour-per-entity requirement is introduced.

`subject_contracts()` exposes all 18 §12 fields with executable method references, exact argument grammar, capabilities, clocks, budgets, witnesses and migration refusal. The registry corresponds to the metastratum; inspection/effect projections to epistratum; caller admission to superstratum; typed policy machine to substratum; event history to hyposubstratum; Python and serialized state to infrasubstratum; explicit deterministic traits and original fixture construction to cryptosubstratum. This is the project adapter mapping, not a claim of natural universality.

Validation: `python3 -m unittest discover -s tests/server -p test_life.py -v`. Eighteen tests cover real state changes, both decision outcomes, scoped refusals, cooldown/resource/history exhaustion, stale observations, consumed weather deduplication, snapshot continuation, source mutation refusal, group conflicts/cycles and deterministic replay. `evidence/` retains initial red logs, the final run, code hashes, a real candidate transition and the complete adapter contracts. Native rendering, collision and measured player experience are outside this portable result.
