"""Source-lock refusal must precede replacement of derived geography."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/geography"))
import reproduce


class ReproductionTests(unittest.TestCase):
    def test_source_escape_and_tamper_refused_without_touching_published_output(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            marker = root / "previous.geojson"
            marker.write_bytes(b"previous-good")
            (root / "source.json").write_bytes(b"altered")
            for path in ["../outside.json", "source.json"]:
                lock = {"sources": [{"id": "example", "kind": "osm", "path": path,
                                     "sha256": "0" * 64, "max_bytes": 1024}]}
                (root / "sources.lock.json").write_text(json.dumps(lock))
                with self.assertRaises(ValueError):
                    reproduce.rebuild(root, write=True)
                self.assertEqual(marker.read_bytes(), b"previous-good")


if __name__ == "__main__":
    unittest.main()
