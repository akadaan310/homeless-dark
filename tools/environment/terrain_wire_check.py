#!/usr/bin/env python3
"""Parse actual global source grids in the exact Unity portable contract, including polar/dateline cases."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'packages'))
from dark_server.geography import GeographyService


def main():
    service = GeographyService(ROOT)
    with tempfile.TemporaryDirectory(prefix='homeless-terrain-wire-') as directory:
        paths = []
        for index, (latitude, longitude) in enumerate([(40.6413, -73.7781), (0, 179.9999), (90, 0)]):
            result = service.view(latitude, longitude, width=33, span_m=10000)
            path = Path(directory) / ('terrain-' + str(index) + '.json')
            path.write_text(json.dumps(result, ensure_ascii=False)); paths.append(str(path))
        command = [os.environ.get('DARK_DOTNET', '/tmp/homeless-dotnet/dotnet'), 'run', '--project',
                   'tools/environment/WorldWireTests', '--', '--terrain'] + paths
        run = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=120)
        evidence = ROOT / 'evidence/environment'
        (evidence / 'native-install-terrain-wire-tests.log').write_text(run.stdout + run.stderr)
        report = {'schema': 'dark.terrain-wire-check/1', 'status': 'PASS' if run.returncode == 0 else 'FAIL',
                  'exit_code': run.returncode, 'actual_source_grids': 3, 'samples_per_grid': 1089,
                  'scope': 'Actual Python source-backed geography -> exact C# Unity contract; no engine substitutes.',
                  'native_mesh_rendering': 'NOT_RUN', 'native_terrain_collision': 'NOT_IMPLEMENTED',
                  'vertical_reference': 'GEBCO approximate MSL rendered with explicitly assumed zero geoid offset; no ellipsoid conversion'}
        (evidence / 'native-install-terrain-wire.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report)); print(run.stdout[-3000:] + run.stderr[-2000:]); return run.returncode


if __name__ == '__main__':
    raise SystemExit(main())
