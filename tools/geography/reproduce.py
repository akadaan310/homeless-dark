#!/usr/bin/env python3
"""Verify source pins and regenerate deterministic geography in a temporary stage.

Default: compare regenerated outputs without replacing them. --write publishes
verified outputs. --fetch retrieves missing/corrupt pinned inputs, with strict
hash checks. OSM response envelopes can change upstream even for a dated query;
the committed exact response bytes are the reproducibility input in that case.
"""
import argparse
from collections import Counter
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

from pipeline import fetch_atomic, import_airports, import_osm, intersections, sha256, write_json_atomic

MAX_LANE_BYTES = 150 * 1024 * 1024


def _within(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or path == root.resolve():
        raise ValueError("Source path escapes geography directory")
    return path


def rebuild(root, write=False, fetch=False):
    root = Path(root).resolve()
    lock_path = root / "sources.lock.json"
    if lock_path.stat().st_size > 1024 * 1024:
        raise ValueError("Oversized source lock")
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    sources = lock["sources"]
    if not isinstance(sources, list) or not 1 <= len(sources) <= 16:
        raise ValueError("Invalid source count")
    sizes = [s["max_bytes"] for s in sources]
    if any(not isinstance(n, int) or not 0 < n <= 32 * 1024 * 1024 for n in sizes):
        raise ValueError("Invalid source bound")
    current = sum(p.stat().st_size for p in root.rglob("*") if p.is_file())
    reserve = 3 * sum(sizes)
    if current + reserve > MAX_LANE_BYTES or shutil.disk_usage(root).free < reserve:
        raise ValueError("150 MiB lane budget or temporary disk reserve exceeded")
    ids, parsed = set(), []
    for source in sources:
        source_id = source["id"]
        if not re.fullmatch(r"[a-z0-9-]+", source_id) or source_id in ids:
            raise ValueError("Invalid or duplicate source ID")
        ids.add(source_id)
        path = _within(root, source["path"])
        if fetch:
            fetch_atomic(source["url"], path, source["max_bytes"], source["sha256"])
        if not path.is_file() or path.stat().st_size > source["max_bytes"] or sha256(path) != source["sha256"]:
            raise ValueError(f"Missing, excessive or corrupt source: {source_id}")
        if source["kind"] not in {"airports", "osm"}:
            raise ValueError("Unsupported importer")
        parsed.append((source, path))
    with tempfile.TemporaryDirectory(dir=root, prefix=".rebuild-") as temporary:
        stage = Path(temporary)
        regions, anchors = [], []
        for source, path in parsed:
            source_id = source["id"]
            if source["kind"] == "airports":
                coverage = import_airports(path.read_bytes(), stage / "ourairports.sqlite3")
                write_json_atomic(stage / "ourairports-coverage.json", coverage)
                continue
            collection = import_osm(path.read_bytes())
            collection["snapshot_requested"] = source.get("snapshot_requested")
            write_json_atomic(stage / f"{source_id}.geojson", collection)
            regions.append({"id": source_id, "source_sha256": source["sha256"],
                            "source_database_timestamp": collection["source_database_timestamp"],
                            "snapshot_requested": source.get("snapshot_requested"),
                            "requested_bbox_south_west_north_east": source.get("bbox_south_west_north_east"),
                            "feature_counts": dict(sorted(Counter(f["properties"]["layer"] for f in collection["features"]).items())),
                            "geometry_extent_note": "Ways are complete source ways intersecting the box; referenced nodes may lie outside it",
                            "scope": source.get("scope", "Bounded development fixture, not global coverage")})
            if source_id == "tampa-dale-mabry-spruce":
                points = intersections(collection, "North Dale Mabry Highway", "West Spruce Street")
                if not points:
                    raise ValueError("Source no longer verifies Tampa intersection")
                anchors.append({"id": source_id, "kind": "sourced_road_intersection_nodes", "points": points,
                                "note": "Divided carriageways produce multiple shared nodes; no pedestrian spawn, altitude or collision readiness inferred"})
            if source_id == "marina-del-rey":
                points = [f for f in collection["features"] if f["properties"].get("layer") == "place" and f["properties"]["tags"].get("name") == "Marina del Rey"]
                if not points:
                    raise ValueError("Source no longer verifies Marina del Rey place")
                anchors.append({"id": source_id, "kind": "sourced_named_place_point", "points": points,
                                "note": "Place label reference only; harbor geometry, navigability and safe spawn are unverified"})
        write_json_atomic(stage / "regional-coverage.json", {"regions": regions, "global_coverage_complete": False})
        write_json_atomic(stage / "anchors.json", {"factuality": "sourced_geometry", "anchors": anchors, "fictional_world_state": "Stored separately; none encoded here"})
        outputs = []
        for path in sorted(stage.iterdir()):
            destination = root / path.name
            digest = sha256(path)
            matches = destination.is_file() and sha256(destination) == digest
            outputs.append({"path": path.name, "sha256": digest, "bytes": path.stat().st_size, "matches_existing": matches})
        actual = sum(p.stat().st_size for p in root.rglob("*") if p.is_file())
        if actual > MAX_LANE_BYTES:
            raise ValueError("Lane byte budget exceeded")
        if not write and any(not item["matches_existing"] for item in outputs):
            raise ValueError("Derived outputs are absent or differ; inspect source/tool changes before --write")
        if write:
            for path in sorted(stage.iterdir()):
                os.replace(path, root / path.name)
    return {"status": "PASS", "verified_sources": len(sources), "outputs": outputs,
            "data_bytes": sum(p.stat().st_size for p in root.rglob("*") if p.is_file()),
            "global_coverage_complete": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2] / "data/geography")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--fetch", action="store_true")
    args = parser.parse_args()
    print(json.dumps(rebuild(args.root, write=args.write, fetch=args.fetch), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
