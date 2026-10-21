"""HD-017/018/021/036/043/095: real import and failure preservation contracts."""
import csv
import hashlib
import http.server
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "geography"))
import pipeline


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        payload = b"source-data"
        if self.path == "/oversize":
            payload = b"x" * 100
        self.send_response(200)
        self.send_header("Content-Type", "text/html" if self.path == "/html" else "text/plain")
        if self.path != "/unbounded":
            self.send_header("Content-Length", str(len(payload) + (5 if self.path == "/truncated" else 0)))
        self.end_headers()
        self.wfile.write(payload)
        self.close_connection = True

    def log_message(self, *args):
        pass


class DownloadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_verified_download_replaces_existing_file_and_pinned_cache_needs_no_network(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "source.txt"
            target.write_bytes(b"old")
            digest = hashlib.sha256(b"source-data").hexdigest()
            result = pipeline.fetch_atomic(self.base + "/valid", target, 64, digest)
            self.assertEqual(target.read_bytes(), b"source-data")
            self.assertEqual(result["bytes"], 11)
            self.assertEqual(result["sha256"], digest)
            cached = pipeline.fetch_atomic("https://does-not-exist.invalid/data", target, 64, digest)
            self.assertTrue(cached["reused"])

    def test_failure_keeps_previous_bytes_and_cleans_partial_files(self):
        for path, limit, digest in [("/oversize", 32, None), ("/unbounded", 4, None),
                                    ("/truncated", 64, None), ("/html", 64, None),
                                    ("/valid", 64, "0" * 64)]:
            with self.subTest(path=path), tempfile.TemporaryDirectory() as folder:
                target = Path(folder) / "source.txt"
                target.write_bytes(b"previous-good")
                with self.assertRaises((ValueError, OSError)):
                    pipeline.fetch_atomic(self.base + path, target, limit, digest)
                self.assertEqual(target.read_bytes(), b"previous-good")
                self.assertEqual(sorted(p.name for p in Path(folder).iterdir()), ["source.txt"])

    def test_non_https_remote_and_nonpositive_limit_refused_before_mutation(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "bad"
            for url, limit in [("http://example.com/x", 10), ("file:///etc/passwd", 10),
                               (self.base, 0)]:
                with self.assertRaises(ValueError):
                    pipeline.fetch_atomic(url, target, limit)
            self.assertFalse(target.exists())


def airport_csv(rows):
    data = io.StringIO(newline="")
    writer = csv.writer(data)
    writer.writerow(["id", "ident", "type", "name", "latitude_deg", "longitude_deg",
                     "elevation_ft", "continent", "iso_country", "iso_region",
                     "municipality", "scheduled_service"])
    writer.writerows(rows)
    return data.getvalue().encode()


AIRPORTS = [
    [3, "WEST", "small_airport", "West", -16, -179.8, -5, "OC", "FJ", "FJ-W", "Town", "no"],
    [1, "EAST", "large_airport", "East", -16, 179.8, 50, "OC", "FJ", "FJ-E", "Town", "yes"],
    [2, "ZERO", "heliport", "Zero", 0, 0, "", "AF", "GH", "GH-AA", "Town", "no"],
]


class AirportTests(unittest.TestCase):
    def test_index_is_order_independent_and_antimeridian_query_finds_both_sides(self):
        with tempfile.TemporaryDirectory() as folder:
            a, b = Path(folder) / "a.sqlite", Path(folder) / "b.sqlite"
            report = pipeline.import_airports(airport_csv(AIRPORTS), a)
            pipeline.import_airports(airport_csv(reversed(AIRPORTS)), b)
            self.assertEqual(a.read_bytes(), b.read_bytes())
            self.assertEqual(report["records"], 3)
            self.assertEqual(report["countries"], {"FJ": 2, "GH": 1})
            self.assertEqual(report["scheduled_service_records"], 1)
            self.assertEqual([r["ident"] for r in pipeline.query_airports(a, -17, 179, -15, -179)],
                             ["EAST", "WEST"])
            self.assertEqual([r["ident"] for r in pipeline.query_airports(a, -1, -1, 1, 1)], ["ZERO"])
            with sqlite3.connect(a) as db:
                self.assertEqual(db.execute("SELECT elevation_m FROM airports WHERE ident='WEST'").fetchone(), (-1.524,))

    def test_bad_csv_is_refused_without_replacing_existing_database(self):
        invalid = []
        for field, value in [(4, "NaN"), (4, 91), (5, -181), (0, "2.5"), (11, "maybe")]:
            row = AIRPORTS[0].copy()
            row[field] = value
            invalid.append(airport_csv([row]))
        invalid.extend([airport_csv([AIRPORTS[0], AIRPORTS[0]]), b"id,id\n1,2\n"])
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "airports.sqlite"
            target.write_bytes(b"previous-good")
            for payload in invalid:
                with self.subTest(payload=payload), self.assertRaises(ValueError):
                    pipeline.import_airports(payload, target)
                self.assertEqual(target.read_bytes(), b"previous-good")

    def test_record_bound_and_query_coordinate_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "airports.sqlite"
            with self.assertRaises(ValueError):
                pipeline.import_airports(airport_csv(AIRPORTS), target, max_records=2)
            pipeline.import_airports(airport_csv(AIRPORTS), target)
            for bbox in [(1, 0, -1, 1), (-91, 0, 1, 1), (0, float("nan"), 1, 2)]:
                with self.assertRaises(ValueError):
                    pipeline.query_airports(target, *bbox)


def osm_fixture():
    return {"osm3s": {"timestamp_osm_base": "2026-10-20T00:00:00Z"}, "elements": [
        {"type": "node", "id": 1, "lat": 27.95, "lon": -82.5},
        {"type": "node", "id": 2, "lat": 27.96, "lon": -82.5},
        {"type": "node", "id": 3, "lat": 27.96, "lon": -82.49},
        {"type": "node", "id": 4, "lat": 27.95, "lon": -82.49},
        {"type": "way", "id": 11, "nodes": [1, 2], "tags": {"highway": "primary", "name": "North Dale Mabry Highway"}},
        {"type": "way", "id": 12, "nodes": [2, 3], "tags": {"highway": "secondary", "name": "West Spruce Street"}},
        {"type": "way", "id": 13, "nodes": [1, 2, 3, 4, 1], "tags": {"building": "yes"}},
    ]}


class OsmTests(unittest.TestCase):
    def test_real_node_topology_drives_source_anchor_and_polygon(self):
        result = pipeline.import_osm(json.dumps(osm_fixture()).encode())
        anchors = pipeline.intersections(result, "North Dale Mabry Highway", "West Spruce Street")
        self.assertEqual(anchors, [{"osm_node_id": 2, "longitude_deg": -82.5, "latitude_deg": 27.96}])
        self.assertEqual(result["features"][2]["geometry"]["type"], "Polygon")
        self.assertEqual(result["source_license"], "ODbL-1.0")
        self.assertEqual(result["factuality"], "sourced_geometry")

    def test_missing_references_nonfinite_coordinates_duplicates_and_server_remark_refused(self):
        broken = osm_fixture()
        broken["elements"] = broken["elements"][1:]
        nan = osm_fixture()
        nan["elements"][0]["lat"] = float("nan")
        duplicate = osm_fixture()
        duplicate["elements"].append(duplicate["elements"][0])
        for payload in [json.dumps(broken).encode(), json.dumps(nan).encode(),
                        json.dumps(duplicate).encode(), b'{"remark":"runtime error","elements":[]}',
                        b'{"elements":[],"elements":[]}', b'{"osm3s":[],"elements":[]}',
                        b'{"elements":[{"type":"node","id":1,"lat":true,"lon":1}]}']:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                pipeline.import_osm(payload)

    def test_import_stable_under_element_order_and_no_invented_intersections(self):
        fixture = osm_fixture()
        first = pipeline.import_osm(json.dumps(fixture).encode())
        fixture["elements"].reverse()
        second = pipeline.import_osm(json.dumps(fixture).encode())
        self.assertNotEqual(first.pop("input_sha256"), second.pop("input_sha256"))
        self.assertEqual(first, second)
        self.assertEqual(pipeline.intersections(first, "Not a street", "West Spruce Street"), [])


if __name__ == "__main__":
    unittest.main()
