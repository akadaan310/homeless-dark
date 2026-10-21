"""Behavioral checks against the pinned OSM bytes and the bounded math projection."""
import copy
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/geography"))
import tampa_fixture as tf


class TampaFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = tf.build_fixture(ROOT / "data/geography")
        cls.raw = json.loads((ROOT / "data/geography/sources/tampa-dale-mabry-spruce.osm.json").read_bytes())

    def test_every_node_and_edge_has_real_source_membership(self):
        nodes = {e["id"]: e for e in self.raw["elements"] if e["type"] == "node"}
        ways = {e["id"]: e for e in self.raw["elements"] if e["type"] == "way"}
        graph = self.fixture["source_graph"]
        self.assertEqual(len(graph["nodes"]), 17)
        self.assertEqual(len(graph["edges"]), 16)
        for n in graph["nodes"]:
            source = nodes[n["osm_node_id"]]
            self.assertEqual(n["id"], f"osm/node/{source['id']}")
            self.assertEqual((n["latitude_deg"], n["longitude_deg"]), (source["lat"], source["lon"]))
            self.assertIsNone(n["ellipsoid_height_m"])
        for edge in graph["edges"]:
            self.assertTrue(edge["source_segments"])
            for segment in edge["source_segments"]:
                way = ways[segment["osm_way_id"]]
                pair = (segment["from_osm_node_id"], segment["to_osm_node_id"])
                self.assertIn(pair, list(zip(way["nodes"], way["nodes"][1:])))
                self.assertEqual(sorted([f"osm/node/{n}" for n in pair]), [edge["a"], edge["b"]])
                self.assertEqual(segment["tags"], way["tags"])

    def test_anchor_is_actual_shared_named_road_node(self):
        anchors = self.fixture["geographic_anchors"]
        self.assertEqual([a["osm_node_id"] for a in anchors], [1603574189, 2057042478])
        for anchor in anchors:
            names = {w.get("tags", {}).get("name") for w in self.raw["elements"]
                     if w["type"] == "way" and anchor["osm_node_id"] in w["nodes"]}
            self.assertTrue(set(tf.ROAD_NAMES) <= names)
            self.assertFalse(anchor["safe_spawn_validated"])

    def test_real_connectivity_and_fictional_reachability_swap(self):
        f = self.fixture
        root, west, east = (f["probe_nodes"][k] for k in ("intersection", "west", "east"))
        source_edges = f["source_graph"]["edges"]
        before = f["plate_world"]["edges"]
        after = f["topology_reference"]["after_edges"]
        for n in f["source_graph"]["nodes"]:
            self.assertTrue(tf.reachable(source_edges, root, n["id"]))
        self.assertTrue(tf.reachable(before, root, west))
        self.assertFalse(tf.reachable(before, root, east))
        self.assertFalse(tf.reachable(after, root, west))
        self.assertTrue(tf.reachable(after, root, east))
        source_pairs = {(e["a"], e["b"]) for e in source_edges}
        for edges in (before, after):
            self.assertTrue({(e["a"], e["b"]) for e in edges} < source_pairs)
        self.assertEqual(len(before), 15)
        self.assertEqual(len(after), 15)

    def test_plate_partition_and_request_match_bounded_kernel_contract(self):
        f = self.fixture
        world, request = f["plate_world"], f["rewrite_request"]
        plates = {p["id"] for p in world["plates"]}
        nodes = {n["id"]: n for n in world["nodes"]}
        self.assertEqual(len(plates), 2)
        self.assertLessEqual(len(nodes), 256)
        self.assertLessEqual(len(world["edges"]), 512)
        for node in nodes.values():
            self.assertIn(node["plate_id"], plates)
            self.assertLess(math.sqrt(sum(x*x for x in node["local_xyz_m"])), 10000)
        for edge in (request["remove"], request["add"]):
            self.assertNotEqual(nodes[edge["a"]]["plate_id"], nodes[edge["b"]]["plate_id"])
            self.assertIn(f["probe_nodes"]["intersection"], (edge["a"], edge["b"]))
        self.assertEqual(request["operation_budget"], len(nodes)**2 + len(world["edges"])*4 + len(world["occupants"])*8 + 40)
        self.assertEqual({p["policy"] for p in f["policy_cases"]}, {"RigidCarriage", "WitnessedRelocation", "RefuseWhileOccupied"})
        affected = {o["id"] for o in world["occupants"] if nodes[o["node_id"]]["plate_id"] == request["plate_id"]}
        relocation = next(p for p in f["policy_cases"] if p["policy"] == "WitnessedRelocation")
        self.assertEqual(set(relocation["destinations"]), affected)
        self.assertTrue(set(relocation["destinations"].values()) <= nodes.keys())

    def test_local_chart_axes_scale_and_synthetic_height_are_explicit(self):
        f = self.fixture
        nodes = {n["id"]: n for n in f["plate_world"]["nodes"]}
        root, west, east = (f["probe_nodes"][k] for k in ("intersection", "west", "east"))
        self.assertEqual(nodes[root]["local_xyz_m"], [0.0, 0.0, 0.0])
        self.assertAlmostEqual(nodes[west]["local_xyz_m"][0], -16.35, delta=0.1)
        self.assertAlmostEqual(nodes[east]["local_xyz_m"][0], 17.79, delta=0.1)
        self.assertEqual(f["embedding"]["axis_order"], ["east", "up", "north"])
        self.assertEqual(f["embedding"]["assumed_ellipsoid_height_m"], 0)
        self.assertEqual(f["embedding"]["ground_height_validity"], "UNKNOWN")

    def test_deterministic_export_and_topology_replay_reject_stale_revision(self):
        f = self.fixture
        first = tf.encode(f)
        second = tf.encode(tf.build_fixture(ROOT / "data/geography"))
        self.assertEqual(first, second)
        self.assertEqual(first, (ROOT / "data/geography/derived/tampa-two-plate-fixture.json").read_bytes())
        world, request = f["plate_world"], f["rewrite_request"]
        original = copy.deepcopy(world)
        result = tf.topology_projection(world["revision"], world["edges"], request)
        self.assertEqual(result, tf.topology_projection(world["revision"], world["edges"], request))
        self.assertEqual(result, (f["topology_reference"]["after_revision"], f["topology_reference"]["after_edges"]))
        self.assertEqual(world, original)
        with self.assertRaisesRegex(ValueError, "stale"):
            tf.topology_projection(*result, request)

    def test_bad_source_or_missing_edge_refused_without_output_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            (base / "sources").mkdir()
            (base / "sources.lock.json").write_bytes((ROOT / "data/geography/sources.lock.json").read_bytes())
            source = base / "sources/tampa-dale-mabry-spruce.osm.json"
            source.write_bytes(b"tampered")
            output = base / "fixture.json"
            output.write_bytes(b"previous-good")
            with self.assertRaisesRegex(ValueError, "checksum|length"):
                tf.export(base, output)
            self.assertEqual(output.read_bytes(), b"previous-good")
        request = self.fixture["rewrite_request"]
        with self.assertRaisesRegex(ValueError, "edge"):
            tf.topology_projection(0, [], request)

    def test_source_travel_tags_and_physical_limits_survive_export(self):
        f = self.fixture
        tags = [s["tags"] for e in f["source_graph"]["edges"] for s in e["source_segments"]]
        self.assertIn("yes", [t.get("oneway") for t in tags])
        self.assertEqual(f["travel_modes"]["mathematical_graph"], "undirected_adjacency_only")
        for mode in f["travel_modes"]["modes"]:
            self.assertEqual(mode["route_validity"], "NOT_VALIDATED")
        self.assertEqual(f["physical_semantics"]["hd_091_acceptance"], "NOT_ACCEPTED")
        for key in ("native_unity", "collision", "spawn_safety", "walkability", "vehicle_clearance", "occupied_physical_transport"):
            self.assertEqual(f["physical_semantics"][key], "NOT_RUN")
        raw = (ROOT / "data/geography/sources/tampa-dale-mabry-spruce.osm.json").read_bytes()
        self.assertEqual(f["provenance"]["source_sha256"], hashlib.sha256(raw).hexdigest())


if __name__ == "__main__":
    unittest.main()
