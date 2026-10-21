# Acquired geographic data

This directory contains source data and deterministic development imports for
HD-017–025, HD-036, HD-043, HD-088 and HD-095. It does **not** establish worldwide
scene coverage, a complete route network, a population allocation or a playable
Unity scene.

| Acquisition | Delivered scope |
| --- | --- |
| OurAirports | Complete `airports.csv` at publisher commit `b529623d2a0b09a9be78d37fc7a7a5e1e16e3451`, dated 2026-10-16; 86,258 records, including closed airports and heliports; 247 source country codes |
| Tampa | Actual OSM ways and nodes intersecting the requested box around North Dale Mabry Highway × West Spruce Street; historical snapshot requested for 2026-10-20T00:00:00Z |
| Marina del Rey | Actual OSM named-place node only; harbor roads/buildings were not acquired after failed bounded requests |

`sources.lock.json` records the exact URLs, queries, bounds, source versions,
timestamps, byte limits and SHA-256 digests. `sources/` preserves the acquired
bytes. `regional-coverage.json`, `ourairports-coverage.json` and
`global-manifest.json` distinguish delivered records from missing layers.

`anchors.json` derives the Tampa intersection from shared road node IDs. Its two
points reflect divided carriageways. They are roadway references, **not safe
player spawn positions**. The Marina point is a place label, not a verified
harbor entrance. Neither has validated altitude, terrain, collision or walking
surfaces. No fictional geography or authored world state is embedded in these
source records.

The SQLite airport index has numeric source-ID ordering, one-degree spatial
cells, and country/type indexes. `query_airports` handles bounding boxes crossing
the antimeridian. Output includes source elevations converted from feet to
meters; the source vertical datum has not been established. Airport points do
not supply operational flight routes, airport interiors, runway geometry,
airspace, traffic or safe navigation.

From the repository root, using Python 3.10 or newer with its standard library:

```bash
python3 -m unittest discover -s tests/geography -v
python3 tools/geography/reproduce.py
```

The second command checks all pinned source hashes, regenerates outputs in a
temporary stage, and compares every generated output with the delivered bytes.
It uses no network by default. To intentionally rebuild after reviewing source
or tool changes, use `--write`. Add `--fetch` to restore missing or corrupt
sources from their pinned URLs. Download replacement is atomic and rejects
wrong hashes, HTML responses, unsupported URLs, oversized and truncated bodies.
A pinned file already in cache needs no network. No retry loop runs implicitly.

The dated OSM query can reproduce the geographic snapshot, but an upstream
response envelope or serialization may change. Strict raw-byte checksum failure
then requires inspection; it never silently adopts a new source. Committed raw
responses are the exact offline reproduction inputs. SQLite byte comparison is
verified with the recorded SQLite version; a different SQLite engine may produce
different physical bytes even when logical rows agree.

Individual source downloads are bounded to at most 32 MiB. This acquisition lane
has a 150 MiB data budget, preflight temporary-space reservation and a final
actual-size check. Full OSM planet ingestion is outside that budget: the pinned
publisher object alone is 95,380,942,829 bytes, before expansion or indexes.
The storage evidence explicitly separates observed sizes from planning
assumptions.

## Attribution and data licenses

**© OpenStreetMap contributors.** OSM source responses, derived geometry and OSM
anchor data are available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Preserve [OpenStreetMap attribution](https://www.openstreetmap.org/copyright)
and applicable database share-alike obligations in downstream use. Keep authored
fictional state distinct from the OSM-derived database.

OurAirports CSV and derived airport index use the publisher's
[public-domain data](https://ourairports.com/data/). Attribution: Data from
OurAirports. The publisher provides no accuracy or fitness guarantee.

Detailed terms evidence and the inspected, unacquired WorldPop candidate are in
`licenses.json`. WorldPop rasters and synthetic population allocations have not
been computed. All native integration, rendering, route traversal, collision
and worldwide acceptance gates remain unrun or blocked.
