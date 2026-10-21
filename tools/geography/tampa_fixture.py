#!/usr/bin/env python3
"""Export a bounded OSM-anchored Tampa graph and an explicitly fictional two-plate case.

Run from any directory: python3 tools/geography/tampa_fixture.py [--check].
No downloads. No physical, routing, effect-authority or native admission is performed.
"""
import argparse
from collections import defaultdict, deque
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile

import pipeline

ROOT = Path(__file__).resolve().parents[2]
ROAD_NAMES = ("North Dale Mabry Highway", "West Spruce Street")
SOURCE_ID = "tampa-dale-mabry-spruce"
SOURCE_SHA256 = "55bd28406a5cf22063eba5d456e46f4cd7f1b590c9288bc4808ad9ff1a27e86a"
MAX_SOURCE_BYTES = 12 * 1024 * 1024
MAX_EXPORT_BYTES = 1024 * 1024
MAX_HOPS = 3
FIXED = "fictional/tampa/fixed"
MOVING = "fictional/tampa/spruce-branches"


def encode(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def node_id(value):
    return f"osm/node/{value}"


def pair(a, b):
    return tuple(sorted((a, b)))


def edge_record(edge):
    return {"a": edge[0], "b": edge[1]}


def adjacency(edges):
    result = defaultdict(set)
    for edge in edges:
        a, b = edge["a"], edge["b"]
        result[a].add(b)
        result[b].add(a)
    return result


def reachable(edges, origin, destination):
    graph = adjacency(edges)
    seen, queue = {origin}, deque([origin])
    while queue:
        current = queue.popleft()
        if current == destination:
            return True
        for other in sorted(graph[current] - seen):
            seen.add(other)
            queue.append(other)
    return False


def topology_projection(revision, edges, request):
    """Reference oracle ONLY for an edge-set replay, not PlateWorld admission.

    It checks stale revision and edge preconditions. It does not authorize a rewrite,
    apply occupant policies, rotate geometry, or assess any physical predicate.
    """
    if type(revision) is not int or revision != request["expected_revision"]:
        raise ValueError("stale topology revision")
    pairs = {pair(e["a"], e["b"]) for e in edges}
    remove = pair(request["remove"]["a"], request["remove"]["b"])
    add = pair(request["add"]["a"], request["add"]["b"])
    vertices = {v for e in pairs for v in e}
    if (len(edges) > 512 or len(pairs) != len(edges) or any(a == b for a, b in pairs)
            or remove not in pairs or add in pairs or add[0] == add[1] or not set(add) <= vertices):
        raise ValueError("edge-set precondition failed")
    return revision + 1, [edge_record(p) for p in sorted((pairs - {remove}) | {add})]


def ecef(latitude, longitude):
    """WGS84 at ASSUMED ellipsoid height zero; this is not measured elevation."""
    a, f = 6378137.0, 1.0 / 298.257223563
    e2 = f * (2 - f)
    lat, lon = math.radians(latitude), math.radians(longitude)
    n = a / math.sqrt(1 - e2 * math.sin(lat)**2)
    return (n * math.cos(lat) * math.cos(lon), n * math.cos(lat) * math.sin(lon),
            n * (1 - e2) * math.sin(lat))


def chart_position(latitude, longitude, anchor):
    """C# LocalEnuFrame E,N,U reordered to Plate XYZ = E,U,N, rounded to 1 um."""
    lat, lon = math.radians(anchor["latitude_deg"]), math.radians(anchor["longitude_deg"])
    origin = ecef(anchor["latitude_deg"], anchor["longitude_deg"])
    dx, dy, dz = (v - o for v, o in zip(ecef(latitude, longitude), origin))
    east = -math.sin(lon)*dx + math.cos(lon)*dy
    north = -math.sin(lat)*math.cos(lon)*dx - math.sin(lat)*math.sin(lon)*dy + math.cos(lat)*dz
    up = math.cos(lat)*math.cos(lon)*dx + math.cos(lat)*math.sin(lon)*dy + math.sin(lat)*dz
    return [round(v, 6) if abs(v) >= 0.0000005 else 0.0 for v in (east, up, north)]


def load_source(base):
    base = Path(base).resolve()
    lock_path = base / "sources.lock.json"
    if lock_path.stat().st_size > MAX_EXPORT_BYTES:
        raise ValueError("source lock exceeds bound")
    lock = json.loads(lock_path.read_bytes())
    matches = [s for s in lock["sources"] if s["id"] == SOURCE_ID]
    if len(matches) != 1:
        raise ValueError("one Tampa source lock required")
    record = matches[0]
    path = (base / record["path"]).resolve()
    if not path.is_relative_to(base) or path.stat().st_size > MAX_SOURCE_BYTES:
        raise ValueError("source path or length exceeds bound")
    payload = path.read_bytes()
    if len(payload) != record["bytes"]:
        raise ValueError("source length mismatch")
    digest = hashlib.sha256(payload).hexdigest()
    if digest != SOURCE_SHA256 or digest != record["sha256"]:
        raise ValueError("source checksum mismatch")
    # Reuse the strict, bounded parser: duplicate keys, malformed tags, missing refs,
    # nonfinite values, booleans as coordinates, and Overpass error bodies are refused.
    collection = pipeline.import_osm(payload)
    return collection, record


def build_fixture(base):
    collection, record = load_source(base)
    roads = [f for f in collection["features"] if f["properties"].get("layer") == "road"
             and f["properties"]["tags"].get("name") in ROAD_NAMES]
    anchors = pipeline.intersections(collection, *ROAD_NAMES)
    if [a["osm_node_id"] for a in anchors] != [1603574189, 2057042478]:
        raise ValueError("pinned shared-junction contract changed")
    anchor = anchors[0]
    root = anchor["osm_node_id"]
    positions, graph, segments = {}, defaultdict(set), defaultdict(list)
    for road in roads:
        props = road["properties"]
        refs = props["node_ids"]
        positions.update(zip(refs, road["geometry"]["coordinates"]))
        for a, b in zip(refs, refs[1:]):
            if a == b:
                raise ValueError("source self-edge unsupported")
            graph[a].add(b)
            graph[b].add(a)
            segments[pair(a, b)].append({"osm_way_id": props["osm_way_id"],
                                        "from_osm_node_id": a, "to_osm_node_id": b,
                                        "tags": props["tags"]})
    hops, queue = {root: 0}, deque([root])
    while queue:
        n = queue.popleft()
        if hops[n] == MAX_HOPS:
            continue
        for other in sorted(graph[n]):
            if other not in hops:
                hops[other] = hops[n] + 1
                queue.append(other)
    selected = set(hops)
    if not 2 <= len(selected) <= 256:
        raise ValueError("kernel node budget exceeded")
    spruce_neighbors = {n for n in graph[root] if any(s["tags"]["name"] == ROAD_NAMES[1]
                         for s in segments[pair(root, n)])}
    west = [n for n in spruce_neighbors if positions[n][0] < positions[root][0]]
    east = [n for n in spruce_neighbors if positions[n][0] > positions[root][0]]
    if len(west) != 1 or len(east) != 1:
        raise ValueError("unambiguous source Spruce boundary pair required")
    west, east = west[0], east[0]

    def component(start):
        seen, pending = {start}, [start]
        while pending:
            for n in sorted((graph[pending.pop()] & selected) - {root} - seen):
                seen.add(n)
                pending.append(n)
        return seen

    west_component, east_component = component(west), component(east)
    if west_component & east_component:
        raise ValueError("source subset contains alternate connection; fictional swap would not isolate branch")
    moving = west_component | east_component
    source_nodes = [{"id": node_id(n), "osm_node_id": n, "longitude_deg": positions[n][0],
                     "latitude_deg": positions[n][1], "ellipsoid_height_m": None,
                     "source_hops_from_anchor": hops[n]} for n in sorted(selected, key=node_id)]
    source_edges = []
    for (a, b), refs in segments.items():
        if a in selected and b in selected:
            source_edges.append({**edge_record(pair(node_id(a), node_id(b))),
                                 "source_segments": sorted(refs, key=lambda s: (s["osm_way_id"], s["from_osm_node_id"], s["to_osm_node_id"]))})
    source_edges.sort(key=lambda e: (e["a"], e["b"]))
    remove, add = edge_record(pair(node_id(root), node_id(west))), edge_record(pair(node_id(root), node_id(east)))
    before_edges = [{"a": e["a"], "b": e["b"]} for e in source_edges if (e["a"], e["b"]) != (add["a"], add["b"])]
    world_nodes = [{"id": n["id"], "plate_id": MOVING if n["osm_node_id"] in moving else FIXED,
                    "local_xyz_m": chart_position(n["latitude_deg"], n["longitude_deg"], anchor)} for n in source_nodes]
    occupants = [{"id": "fixture/person-fixed", "node_id": node_id(root), "boundary_straddler": False},
                 {"id": "fixture/person-west", "node_id": node_id(west), "boundary_straddler": False},
                 {"id": "fixture/point-object-west", "node_id": node_id(west), "boundary_straddler": False}]
    request = {"expected_revision": 0, "plate_id": MOVING, "remove": remove, "add": add,
               "rotation_degrees": 90, "authority_witness_id": "fixture-only/not-an-authority-grant",
               "start_tick": 100, "duration_ticks": 120,
               "operation_budget": len(world_nodes)**2 + len(before_edges)*4 + len(occupants)*8 + 40}
    after_revision, after_edges = topology_projection(0, before_edges, request)
    if (not reachable(before_edges, node_id(root), node_id(west))
            or reachable(before_edges, node_id(root), node_id(east))
            or reachable(after_edges, node_id(root), node_id(west))
            or not reachable(after_edges, node_id(root), node_id(east))):
        raise ValueError("source-anchored reachability probe contract failed")
    world = {"revision": 0,
             "plates": [{"id": p, "center_xyz_m": [0.0, 0.0, 0.0], "angle_degrees": 0} for p in (FIXED, MOVING)],
             "nodes": world_nodes, "edges": before_edges, "occupants": occupants}
    policies = [{"policy": "RigidCarriage", "destinations": {}, "expected_mathematical_admission": True,
                 "expected_occupant_nodes": {o["id"]: o["node_id"] for o in occupants}},
                {"policy": "WitnessedRelocation",
                 "destinations": {"fixture/person-west": node_id(root), "fixture/point-object-west": node_id(root)},
                 "expected_mathematical_admission": True,
                 "expected_occupant_nodes": {o["id"]: node_id(root) for o in occupants}},
                {"policy": "RefuseWhileOccupied", "destinations": {}, "expected_mathematical_admission": False,
                 "expected_refusal": "HD-065:occupied"}]
    omitted = [{"from_node_id": node_id(a), "to_source_node_id": node_id(b)}
               for a in sorted(selected, key=node_id) for b in sorted(graph[a] - selected, key=node_id)]
    return {
        "schema_version": "homeless.tampa-two-plate/v1",
        "purpose": "Source-anchored mathematical fixture for Dark.World; HD-091 native acceptance remains outstanding.",
        "provenance": {
            "source_id": SOURCE_ID, "source_path": "data/geography/" + record["path"],
            "source_bytes": record["bytes"], "source_sha256": record["sha256"],
            "source_snapshot_requested": record["snapshot_requested"],
            "source_database_timestamp": collection["source_database_timestamp"],
            "retrieved_at": record["retrieved_at"], "source_url": record["url"],
            "source_query": record["query"], "source_bbox_south_west_north_east": record["bbox_south_west_north_east"],
            "attribution": record["attribution"], "source_license": record["license"],
            "license_url": record["license_url"], "copyright_url": "https://www.openstreetmap.org/copyright",
            "license_scope": "OSM-derived coordinates, topology and way tags remain ODbL-derived; no CC0 reclassification.",
            "recipe": "Select exact named highway ways, shared junction with smallest numeric OSM ID, undirected BFS <=3 hops; retain every consecutive selected source pair; sort IDs ordinally. No downloads."
        },
        "geographic_anchors": [{**a, "node_id": node_id(a["osm_node_id"]),
                                "role": "shared named-road centerline junction", "safe_spawn_validated": False} for a in anchors],
        "probe_nodes": {"intersection": node_id(root), "west": node_id(west), "east": node_id(east)},
        "source_graph": {"factuality": "sourced_geometry", "road_name_filter": list(ROAD_NAMES), "maximum_hops": MAX_HOPS,
                         "nodes": source_nodes, "edges": source_edges, "omitted_named_road_boundary_connections": omitted,
                         "coverage": "Local named-road centerline subset; other roads and all beyond-hop connections omitted. No citywide connectivity claim."},
        "travel_modes": {"mathematical_graph": "undirected_adjacency_only",
                         "source_direction_convention": "source_segments from/to preserve OSM way order; oneway=yes follows that order, -1 opposes it. No restrictions or permissions are resolved.",
                         "modes": [{"id": m, "route_validity": "NOT_VALIDATED"} for m in ("walk", "bicycle", "motor_vehicle")],
                         "limits": ["Raw highway/oneway/access/foot/bicycle/vehicle and other way tags retained verbatim, when present.",
                                    "Missing tags are unknown here, not permission grants.", "Turn restrictions, crossings, sidewalk links, lane geometry and live conditions are not imported."]},
        "embedding": {"coordinate_reference": "WGS84 latitude/longitude", "anchor_node_id": node_id(root),
                      "method": "WGS84 ECEF at assumed h=0 -> local ENU -> XYZ(E,U,N), 6 decimal places in meters",
                      "axis_order": ["east", "up", "north"], "assumed_ellipsoid_height_m": 0,
                      "ground_height_validity": "UNKNOWN", "local_radius_limit_m": 10000,
                      "semimajor_axis_m": 6378137, "inverse_flattening": 298.257223563,
                      "rotation_convention": "Dark.World: x'=x*cos-z*sin; z'=x*sin+z*cos; y unchanged.",
                      "source_geographic_coordinates_change": False},
        "fictional_model": {"factuality": "authored_fiction", "rule": "boundary-edge-replace/v1",
                            "partition": "Remove anchor from selected source graph. Put west and east Spruce components on moving plate; all other nodes on fixed plate.",
                            "moving_plate_source_component_count": 2,
                            "partition_is_physical_land_plate": False,
                            "initial_authored_closure": add,
                            "rewrite": "Replace west boundary by east boundary while rotating moving plate +90 degrees around common chart origin.",
                            "real_road_closure_claim": False,
                            "point_occupants": "Synthetic fixture entities only; no identity, population, attachment, body extent or safe occupancy inference.",
                            "authority": "The witness ID is only a fixture provenance label; no authenticated effect authority is supplied.",
                            "physical_plate_boundary_geometry": "MISSING"},
        "plate_world": world,
        "rewrite_request": request,
        "policy_cases": policies,
        "policy_case_execution": "EXPECTED_ONLY; consumer must execute Dark.World kernel independently",
        "topology_reference": {"scope": "Python edge-set projection only; not policy, geometry or authority admission",
                               "after_revision": after_revision, "after_edges": after_edges,
                               "expected_after_moving_angle_degrees": 90,
                               "probes": [{"from": node_id(root), "to": node_id(west), "before": True, "after": False},
                                          {"from": node_id(root), "to": node_id(east), "before": False, "after": True}],
                               "same_request_replay_expected_refusal": "stale topology revision"},
        "observation_cases": {
            "stale_observation": {"observed_revision": 0, "current_revision": 1,
                                  "remembered_path": [node_id(root), node_id(west)], "current_path_valid": False,
                                  "required_behavior": "Reject stale rewrite revision; retain observation provenance."},
            "authored_divergence": {"factuality": "authored_fiction", "observer_view_revision": 0,
                                    "world_revision": 1, "deliberately_retained_view": "West branch remains believed reachable.",
                                    "technical_staleness_is_authored_divergence": False,
                                    "runtime_observer_implementation": "NOT_RUN"}},
        "physical_semantics": {
            "native_unity": "NOT_RUN", "collision": "NOT_RUN", "spawn_safety": "NOT_RUN",
            "walkability": "NOT_RUN", "vehicle_clearance": "NOT_RUN", "occupied_physical_transport": "NOT_RUN",
            "collision_meshes": "MISSING", "ground_surface": "MISSING", "body_extents": "MISSING",
            "boundary_straddler_support": "UNSUPPORTED_BY_MATH_KERNEL", "effect_authority_authentication": "NOT_PROVIDED",
            "inverse_and_rollback": "NOT_EXECUTED_BY_THIS_EXPORTER", "hd_091_acceptance": "NOT_ACCEPTED"}
    }


def write_atomic(path, payload):
    if len(payload) > MAX_EXPORT_BYTES:
        raise ValueError("export exceeds 1 MiB bound")
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".part", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def export(base, destination, check=False):
    fixture = build_fixture(base)
    payload = encode(fixture)
    if len(payload) > MAX_EXPORT_BYTES:
        raise ValueError("export exceeds 1 MiB bound")
    if check:
        path = Path(destination)
        if path.stat().st_size != len(payload) or path.read_bytes() != payload:
            raise ValueError("published fixture differs from deterministic regeneration")
    else:
        write_atomic(destination, payload)
    return fixture, payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Read-only byte comparison against regenerated fixture")
    args = parser.parse_args()
    destination = ROOT / "data/geography/derived/tampa-two-plate-fixture.json"
    fixture, payload = export(ROOT / "data/geography", destination, args.check)
    report = {"status": "PASS", "command": "python3 tools/geography/tampa_fixture.py" + (" --check" if args.check else ""),
              "fixture_path": str(destination.relative_to(ROOT)), "fixture_bytes": len(payload),
              "fixture_sha256": hashlib.sha256(payload).hexdigest(), "source_sha256": fixture["provenance"]["source_sha256"],
              "exporter_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "source_nodes": len(fixture["source_graph"]["nodes"]), "source_edges": len(fixture["source_graph"]["edges"]),
              "fictional_before_edges": len(fixture["plate_world"]["edges"]),
              "fictional_after_edges": len(fixture["topology_reference"]["after_edges"]),
              "plate_node_counts": {p["id"]: sum(n["plate_id"] == p["id"] for n in fixture["plate_world"]["nodes"])
                                    for p in fixture["plate_world"]["plates"]},
              "native_execution": "NOT_RUN", "policy_case_execution": "EXPECTED_ONLY",
              "physical_semantics": fixture["physical_semantics"], "network_requests": 0}
    if not args.check:
        write_atomic(ROOT / "evidence/geography/tampa-fixture-report.json", encode(report))
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
