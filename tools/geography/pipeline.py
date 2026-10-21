#!/usr/bin/env python3
"""Bounded, source-preserving geography imports (HD-017/018/021/036/043/095)."""
import argparse
from collections import Counter
from contextlib import closing
import csv
import hashlib
import http.client
import io
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import urllib.parse
import urllib.request

MAX_SOURCE_BYTES = 32 * 1024 * 1024
MAX_OSM_BYTES = 12 * 1024 * 1024
USER_AGENT = "HOMELESS-Dark-Geography/0.1 (+https://github.com/akadaan310/homeless-dark)"


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_url(url):
    parts = urllib.parse.urlsplit(url)
    if parts.username or parts.password or parts.fragment:
        raise ValueError("Credentials and fragments are not permitted in source URLs")
    if parts.scheme != "https" and not (parts.scheme == "http" and parts.hostname in {"127.0.0.1", "localhost", "::1"}):
        raise ValueError("Sources require HTTPS (loopback HTTP is allowed for tests)")
    if not parts.hostname:
        raise ValueError("Source URL needs a hostname")


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _safe_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_atomic(url, destination, max_bytes, expected_sha256=None):
    """Preserve previous content on any failure; reuse only a verified pinned cache.

    Content is not decoded/decompressed. Both advertised and actual byte counts
    are bounded. A fresh source requires the caller to retain the returned hash.
    """
    _safe_url(url)
    if not isinstance(max_bytes, int) or not 0 < max_bytes <= MAX_SOURCE_BYTES:
        raise ValueError("Per-source bound must be 1..32 MiB")
    if expected_sha256 is not None and not re.fullmatch(r"[0-9a-f]{64}", expected_sha256):
        raise ValueError("Expected SHA-256 must be 64 lowercase hexadecimal digits")
    destination = Path(destination)
    if expected_sha256 and destination.is_file() and destination.stat().st_size <= max_bytes:
        if sha256(destination) == expected_sha256:
            return {"url": url, "bytes": destination.stat().st_size, "sha256": expected_sha256, "reused": True}
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
    temporary = None
    try:
        with urllib.request.build_opener(_SafeRedirect()).open(request, timeout=30) as response:
            _safe_url(response.geturl())
            if response.status != 200:
                raise ValueError(f"Expected HTTP 200, got {response.status}")
            if response.headers.get_content_type() in {"text/html", "application/xhtml+xml"}:
                raise ValueError("Unexpected HTML instead of source data")
            if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                raise ValueError("Unexpected content encoding")
            declared = response.headers.get("Content-Length")
            if declared is not None:
                if not declared.isdigit() or not 0 < int(declared) <= max_bytes:
                    raise ValueError("Invalid or excessive Content-Length")
                declared = int(declared)
            digest, size = hashlib.sha256(), 0
            with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=destination.name + ".", suffix=".part", delete=False) as output:
                temporary = Path(output.name)
                while True:
                    chunk = response.read(min(65536, max_bytes - size + 1))
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > max_bytes:
                        raise ValueError("Downloaded source exceeds byte bound")
                    output.write(chunk)
                    digest.update(chunk)
                if size == 0 or (declared is not None and declared != size):
                    raise ValueError("Empty or truncated source response")
                actual = digest.hexdigest()
                if expected_sha256 and actual != expected_sha256:
                    raise ValueError("Source checksum mismatch")
                output.flush()
                os.fsync(output.fileno())
            result = {"url": url, "resolved_url": response.geturl(), "bytes": size,
                      "sha256": actual, "reused": False,
                      "content_type": response.headers.get_content_type(),
                      "last_modified": response.headers.get("Last-Modified"),
                      "etag": response.headers.get("ETag")}
        os.replace(temporary, destination)
        temporary = None
        return result
    except http.client.HTTPException as exc:
        raise ValueError(f"Incomplete HTTP source: {exc}") from exc
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def write_json_atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         suffix=".part", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _coordinate(value, limit):
    if isinstance(value, bool):
        raise ValueError("Boolean is not a coordinate")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid coordinate") from exc
    if not math.isfinite(number) or not -limit <= number <= limit:
        raise ValueError("Coordinate outside finite WGS84 range")
    return number


def _positive_id(value):
    if isinstance(value, bool) or not re.fullmatch(r"[1-9][0-9]{0,17}", str(value)):
        raise ValueError("Source ID must be a positive integer")
    return int(value)


def import_airports(payload, destination, max_records=200000):
    """Import the complete supplied CSV; failure never replaces the previous DB.

    Airport points, including closed sites and heliports, do not constitute
    routes, runway geometry, flight safety data or worldwide scene coverage.
    """
    if len(payload) > MAX_SOURCE_BYTES or not 0 < max_records <= 200000:
        raise ValueError("Airport source or record budget exceeded")
    required = {"id", "ident", "type", "name", "latitude_deg", "longitude_deg", "elevation_ft",
                "continent", "iso_country", "iso_region", "municipality", "scheduled_service"}
    try:
        reader = csv.DictReader(io.StringIO(payload.decode("utf-8-sig"), newline=""), strict=True)
        if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames) or not required <= set(reader.fieldnames):
            raise ValueError("Missing or duplicate airport CSV columns")
        rows, ids, idents = [], set(), set()
        for source in reader:
            if len(rows) >= max_records:
                raise ValueError("Airport record budget exceeded")
            if None in source or any(value is None for value in source.values()):
                raise ValueError("Ragged CSV row")
            ident, source_id = source["ident"], _positive_id(source["id"])
            if not ident or len(ident) > 128 or ident in idents or source_id in ids:
                raise ValueError("Missing or duplicate airport identifier")
            ids.add(source_id)
            idents.add(ident)
            lat, lon = _coordinate(source["latitude_deg"], 90), _coordinate(source["longitude_deg"], 180)
            elevation = float(source["elevation_ft"]) * 0.3048 if source["elevation_ft"] else None
            if elevation is not None and not math.isfinite(elevation):
                raise ValueError("Non-finite airport elevation")
            if source["scheduled_service"] not in {"yes", "no"}:
                raise ValueError("Invalid scheduled service flag")
            if not re.fullmatch(r"[A-Z]{2}", source["iso_country"]):
                raise ValueError("Invalid source country code")
            if not source["type"] or not source["name"]:
                raise ValueError("Airport type and name are required")
            rows.append((source_id, ident, source["type"], source["name"], lat, lon, elevation,
                         source["continent"], source["iso_country"], source["iso_region"],
                         source["municipality"], int(source["scheduled_service"] == "yes"),
                         min(179, math.floor(lat + 90)), min(359, math.floor(lon + 180))))
    except (UnicodeError, csv.Error, OverflowError) as exc:
        raise ValueError(f"Malformed airport CSV: {exc}") from exc
    if not rows:
        raise ValueError("Empty airport CSV")
    rows.sort(key=lambda row: row[0])
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=destination.parent, suffix=".part")
    os.close(fd)
    temporary = Path(name)
    try:
        with closing(sqlite3.connect(temporary)) as db:
            db.execute("PRAGMA journal_mode=DELETE")
            db.execute("PRAGMA user_version=1")
            db.execute("CREATE TABLE airports (id INTEGER PRIMARY KEY, ident TEXT UNIQUE NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, latitude_deg REAL NOT NULL, longitude_deg REAL NOT NULL, elevation_m REAL, continent TEXT NOT NULL, iso_country TEXT NOT NULL, iso_region TEXT NOT NULL, municipality TEXT NOT NULL, scheduled_service INTEGER NOT NULL, tile_lat INTEGER NOT NULL, tile_lon INTEGER NOT NULL)")
            db.executemany("INSERT INTO airports VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
            db.execute("CREATE INDEX airport_tile ON airports(tile_lat,tile_lon)")
            db.execute("CREATE INDEX airport_country_type ON airports(iso_country,type)")
            db.commit()
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("SQLite integrity check failed")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
        Path(str(temporary) + "-journal").unlink(missing_ok=True)
    return {"records": len(rows), "countries": dict(sorted(Counter(r[8] for r in rows).items())),
            "types": dict(sorted(Counter(r[2] for r in rows).items())),
            "continents": dict(sorted(Counter(r[7] for r in rows).items())),
            "occupied_one_degree_cells": len({(r[12], r[13]) for r in rows}),
            "scheduled_service_records": sum(r[11] for r in rows),
            "latitude_range": [min(r[4] for r in rows), max(r[4] for r in rows)],
            "longitude_range": [min(r[5] for r in rows), max(r[5] for r in rows)],
            "input_sha256": hashlib.sha256(payload).hexdigest(),
            "database_sha256": sha256(destination), "database_bytes": destination.stat().st_size,
            "sqlite_version": sqlite3.sqlite_version,
            "elevation_datum": "Source elevation_ft converted to meters; vertical datum not established",
            "ordering": "ascending numeric source ID; physical reproducibility checked with same SQLite version"}


def query_airports(database, south, west, north, east):
    south, north = _coordinate(south, 90), _coordinate(north, 90)
    west, east = _coordinate(west, 180), _coordinate(east, 180)
    if south > north:
        raise ValueError("South must not exceed north")
    lat_tiles = (min(179, math.floor(south + 90)), min(179, math.floor(north + 90)))
    spans = [(west, east)] if west <= east else [(west, 180), (-180, east)]
    found = {}
    uri = Path(database).resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as db:
        db.row_factory = sqlite3.Row
        for left, right in spans:
            rows = db.execute("SELECT * FROM airports WHERE tile_lat BETWEEN ? AND ? AND tile_lon BETWEEN ? AND ? AND latitude_deg BETWEEN ? AND ? AND longitude_deg BETWEEN ? AND ? ORDER BY id",
                              (*lat_tiles, min(359, math.floor(left + 180)), min(359, math.floor(right + 180)), south, north, left, right))
            for row in rows:
                found[row["id"]] = dict(row)
    return [found[key] for key in sorted(found)]


def _unique_object(pairs):
    value = {}
    for key, child in pairs:
        if key in value:
            raise ValueError("Duplicate JSON object key")
        value[key] = child
    return value


def _no_constant(value):
    raise ValueError(f"Non-finite JSON token {value}")


def import_osm(payload):
    if len(payload) > MAX_OSM_BYTES:
        raise ValueError("OSM source exceeds 12 MiB bound")
    try:
        data = json.loads(payload, object_pairs_hook=_unique_object, parse_constant=_no_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ValueError(f"Malformed OSM JSON: {exc}") from exc
    if not isinstance(data, dict) or "remark" in data or not isinstance(data.get("elements"), list):
        raise ValueError("OSM response is incomplete or reports an error")
    if not isinstance(data.get("osm3s", {}), dict):
        raise ValueError("Invalid OSM metadata")
    if len(data["elements"]) > 100000:
        raise ValueError("OSM element budget exceeded")
    nodes, ways, places, seen = {}, [], [], set()
    ignored_relations = 0
    for element in data["elements"]:
        if not isinstance(element, dict) or element.get("type") not in {"node", "way", "relation"}:
            raise ValueError("Invalid OSM element")
        key = (element["type"], _positive_id(element.get("id")))
        if key in seen:
            raise ValueError("Duplicate OSM element")
        seen.add(key)
        tags = element.get("tags", {})
        if not isinstance(tags, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in tags.items()):
            raise ValueError("Invalid OSM tags")
        if key[0] == "node":
            nodes[key[1]] = [_coordinate(element.get("lon"), 180), _coordinate(element.get("lat"), 90)]
            if "place" in tags:
                places.append(element)
        elif key[0] == "way":
            ways.append(element)
        else:
            ignored_relations += 1
    features = []
    for way in sorted(ways, key=lambda item: item["id"]):
        tags = way.get("tags", {})
        if not any(key in tags for key in ("highway", "building", "waterway", "natural")):
            continue
        refs = way.get("nodes")
        if not isinstance(refs, list) or len(refs) < 2:
            raise ValueError("Way has insufficient geometry")
        refs = [_positive_id(ref) for ref in refs]
        if any(ref not in nodes for ref in refs):
            raise ValueError("Way has unresolved node references")
        coordinates = [nodes[ref] for ref in refs]
        building = "building" in tags and tags["building"] != "no"
        if building and (len(refs) < 4 or refs[0] != refs[-1]):
            raise ValueError("Building way is not a closed polygon; relation assembly is required")
        features.append({"type": "Feature", "id": f"osm/way/{way['id']}",
                         "properties": {"osm_way_id": way["id"], "node_ids": refs, "tags": tags,
                                        "layer": "building" if building else "road" if "highway" in tags else "water"},
                         "geometry": {"type": "Polygon" if building else "LineString",
                                      "coordinates": [coordinates] if building else coordinates}})
    for place in sorted(places, key=lambda item: item["id"]):
        features.append({"type": "Feature", "id": f"osm/node/{place['id']}",
                         "properties": {"osm_node_id": place["id"], "tags": place["tags"], "layer": "place"},
                         "geometry": {"type": "Point", "coordinates": nodes[place["id"]]}})
    return {"type": "FeatureCollection", "factuality": "sourced_geometry", "coordinate_reference": "WGS84 longitude,latitude; altitude unknown",
            "source_license": "ODbL-1.0", "attribution": "© OpenStreetMap contributors",
            "source_database_timestamp": data.get("osm3s", {}).get("timestamp_osm_base"),
            "input_sha256": hashlib.sha256(payload).hexdigest(),
            "ignored_relations": ignored_relations,
            "limitations": ["Way footprints only; multipolygon relations are not assembled", "Road centerlines are not validated routes, lanes, sidewalks or collision meshes", "No altitude or terrain was inferred"],
            "features": features}


def intersections(collection, first_name, second_name):
    """Find actual shared OSM nodes, without using a guessed address coordinate."""
    matches = [{}, {}]
    for feature in collection["features"]:
        props = feature["properties"]
        if props.get("layer") != "road":
            continue
        for index, name in enumerate((first_name, second_name)):
            if props["tags"].get("name") == name:
                matches[index].update(zip(props["node_ids"], feature["geometry"]["coordinates"]))
    return [{"osm_node_id": node, "longitude_deg": matches[0][node][0], "latitude_deg": matches[0][node][1]}
            for node in sorted(matches[0].keys() & matches[1].keys())]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    fetch = sub.add_parser("fetch")
    fetch.add_argument("url")
    fetch.add_argument("destination", type=Path)
    fetch.add_argument("--max-bytes", required=True, type=int)
    fetch.add_argument("--sha256")
    for kind in ("airports", "osm"):
        cmd = sub.add_parser(kind)
        cmd.add_argument("source", type=Path)
        cmd.add_argument("destination", type=Path)
    args = parser.parse_args()
    if args.command == "fetch":
        result = fetch_atomic(args.url, args.destination, args.max_bytes, args.sha256)
    else:
        limit = MAX_OSM_BYTES if args.command == "osm" else MAX_SOURCE_BYTES
        if args.source.stat().st_size > limit:
            parser.error("Source exceeds byte bound")
        payload = args.source.read_bytes()
        if args.command == "airports":
            result = import_airports(payload, args.destination)
        else:
            result = import_osm(payload)
            write_json_atomic(args.destination, result)
            result = {"features": len(result["features"]), "sha256": sha256(args.destination)}
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))


if __name__ == "__main__":
    main()
