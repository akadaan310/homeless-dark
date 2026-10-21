# Tampa source-to-math fixture v1

`data/geography/derived/tampa-two-plate-fixture.json` is a bounded mathematical test input, not an accepted HD-091 scene. It reuses the existing pinned OSM acquisition without network access. Export it with `python3 tools/geography/tampa_fixture.py`; compare byte-for-byte without replacing it with `python3 tools/geography/tampa_fixture.py --check`.

The actual sourced graph contains 17 nodes and 16 undirected adjacencies. Each adjacency carries one or more original OSM way IDs, consecutive ordered node pairs and verbatim way tags. OSM node IDs and geographic coordinates survive unchanged. Every node is at most three graph hops from shared junction node 1603574189, considering only ways whose name is exactly North Dale Mabry Highway or West Spruce Street. Other roads and beyond-hop connections are omitted explicitly. This subset does not establish citywide connectivity or permission to travel.

Both shared carriageway junctions are recorded: node 1603574189 at latitude 27.9594638, longitude -82.5054865 and node 2057042478 at latitude 27.9594647, longitude -82.5056527. Neither is a validated safe spawn. The source is the existing 467,198-byte OSM response, SHA256 `55bd28406a5cf22063eba5d456e46f4cd7f1b590c9288bc4808ad9ff1a27e86a`. Historical snapshot requested, database timestamp and retrieval time are kept as distinct fields. Derived OSM content retains ODbL attribution and provenance; it is not relabeled as original CC0 art.

| JSON field | Consumer contract |
| --- | --- |
| `source_graph` | Factual coordinates and actual consecutive source adjacencies; unchanged by the fictional rewrite. |
| `plate_world.revision` | Initial mathematical revision 0. |
| `plate_world.plates[]` | `id`, `center_xyz_m`, `angle_degrees`; map to `Dark.World.Plate`. |
| `plate_world.nodes[]` | `id`, `plate_id`, `local_xyz_m`; map to `PlateNode`. |
| `plate_world.edges[]` | Canonical ordinal `a`, `b`; map to simple undirected `Edge`. |
| `plate_world.occupants[]` | Synthetic point entities with `id`, `node_id`, `boundary_straddler`; map to `Occupant`. |
| `rewrite_request` | Common `RewriteRequest` fields in snake_case. Add `policy` and `destinations` from a policy case. The authority witness string grants no effect authority. |
| `policy_cases[]` | Exact enum names `RigidCarriage`, `WitnessedRelocation`, `RefuseWhileOccupied`; destinations and expected mathematical result. These are test expectations until the C# consumer executes them. |
| `topology_reference` | Executed Python edge-set projection and reachability oracle; not execution of the C# policy or physical model. |
| `embedding` | WGS84 ellipsoid to local ENU, reordered to X=east, Y=up, Z=north. Source height is unknown; assumed ellipsoid height 0 only defines this mathematical chart. Coordinates rounded to 0.000001 m. |
| `observation_cases` | Stale-route and authored-view scenarios for later consumers; no running observer subsystem is claimed. |
| `physical_semantics` | Missing geometry/physical predicates and explicit NOT_RUN / NOT_ACCEPTED statuses. |

The fictional partition removes the main junction conceptually, then assigns the west and east Spruce branches to one moving plate (10 nodes) and the remaining branches to a fixed plate (7 nodes). The moving plate has two disconnected source components. It is not asserted to be a physical land parcel. The initial fictional world closes the real anchor-to-east adjacency. Its single rewrite opens that adjacency, closes the real anchor-to-west adjacency, and requests a +90-degree rotation about the shared chart origin. Original latitudes/longitudes remain the source of provenance, not the rotated world coordinates. Each fictional graph has 15 edges. The graph change makes the west probe unreachable from the anchor and the east probe reachable; this says nothing about omitted roads in Tampa.

The fixed probe is `osm/node/1603574189`, west probe is `osm/node/2057042478`, and east probe is `osm/node/4520926406`. There are two moving point occupants and one fixed point occupant. Rigid carriage expects their node memberships to persist. Witnessed relocation expects both moving entities to be assigned to the fixed anchor node, purely as a mathematical destination. Refuse-while-occupied expects refusal. None establishes clearance, body continuity, attachment safety, drivable roads, walkable sidewalks, or transport safety. The exporter does not execute inverse/rollback operations.

`topology_projection()` is deliberately only an edge-set replay oracle. It refuses stale revisions and invalid edge preconditions; it does not authenticate authority, execute occupant policies or validate the rest of the plate rewrite contract. Tests exercise source membership, shared nodes, connectivity, graph replay/stale refusal, deterministic export, chart axes/scale, bounded kernel shape and preservation of missing physical semantics. C# kernel execution and native/device acceptance remain separate evidence.
