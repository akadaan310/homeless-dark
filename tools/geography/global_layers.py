#!/usr/bin/env python3
"""Pinned, bounded global overview ingestion; no claim of street-scale reconstruction."""
import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'data/geography/global'
PIN = 'ca96624a56bd078437bca8184e78163e5039ad19'
EPOCH = 2024
LIMIT = 350 * 1024 * 1024
SOURCES = {
    'land': f'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{PIN}/geojson/ne_10m_land.geojson',
    'coastline': f'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{PIN}/geojson/ne_10m_coastline.geojson',
    'ocean': f'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{PIN}/geojson/ne_10m_ocean.geojson',
    'lakes': f'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{PIN}/geojson/ne_10m_lakes.geojson',
    'countries': f'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{PIN}/geojson/ne_10m_admin_0_countries.geojson',
    'rivers': f'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{PIN}/geojson/ne_10m_rivers_lake_centerlines.geojson',
    'population': 'https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?date=2024&source=2&format=json&per_page=400',
    'economies': 'https://api.worldbank.org/v2/country?format=json&per_page=400',
    'population_metadata': 'https://api.worldbank.org/v2/indicator/SP.POP.TOTL?format=json&source=2',
}


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        tmp = Path(f.name)
        try:
            f.write(value)
            f.flush()
            os.fsync(f.fileno())
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
    os.replace(tmp, path)


def fetch(url, path, max_bytes=80 * 1024 * 1024):
    """No credentials; response validation and hard streaming size bound."""
    request = urllib.request.Request(url, headers={'User-Agent': 'HOMELESS-source-ingestion/1'})
    with urllib.request.urlopen(request, timeout=90) as response:
        if response.status != 200:
            raise ValueError('source HTTP status')
        body = bytearray()
        while True:
            chunk = response.read(min(1024 * 1024, max_bytes + 1 - len(body)))
            if not chunk:
                break
            body.extend(chunk)
            if len(body) > max_bytes:
                raise ValueError('source exceeds budget')
    json.loads(body)  # malformed / HTML responses never become source files
    atomic(path, body)
    return len(body)


def api_rows(value):
    if not isinstance(value, list) or len(value) != 2 or not isinstance(value[0], dict) or not isinstance(value[1], list):
        raise ValueError('invalid World Bank response')
    meta, rows = value
    if int(meta.get('pages', 0)) != 1 or int(meta.get('page', 0)) != 1 or int(meta.get('total', -1)) != len(rows):
        raise ValueError('incomplete World Bank pagination')
    return rows


def allocate_population(population, economies):
    """Preserve each observed count; never scale countries to an aggregate total."""
    countries = {}
    for row in api_rows(economies):
        if row.get('region', {}).get('id') == 'NA':
            continue  # aggregate group, not an additional population
        code = row['id']
        if code in countries:
            raise ValueError('duplicate economy')
        countries[code] = row
    rows = []
    missing = set(countries)
    seen = set()
    world = None
    for row in api_rows(population):
        if row.get('date') != str(EPOCH) or row.get('indicator', {}).get('id') != 'SP.POP.TOTL':
            raise ValueError('mixed source epoch or indicator')
        code = row['countryiso3code']
        row_key = code or ('aggregate:' + row['country']['id'])
        if row_key in seen:
            raise ValueError('duplicate population')
        seen.add(row_key)
        value = row['value']
        if code == 'WLD':
            world = value
        if code not in countries or value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError('non-integer demographic estimate')
        country = countries[code]
        rows.append({'code': code, 'name': country['name'], 'region': country['region']['id'], 'region_name': country['region']['value'], 'population': value})
        missing.discard(code)
    rows.sort(key=lambda r: r['code'])
    economy_total = sum(r['population'] for r in rows)
    economy_count = len(rows)
    if world is not None and (isinstance(world, bool) or not isinstance(world, int) or world < 0):
        raise ValueError('invalid world aggregate estimate')
    residual = None if world is None else world - economy_total
    if residual is not None and residual > 0:
        rows.append({'code': 'WLD_UNASSIGNED', 'name': 'World aggregate residual; regional placement unknown',
                     'region': 'UNASSIGNED', 'region_name': 'Unassigned source residual', 'population': residual,
                     'derivation': 'World aggregate minus sum of observed non-aggregate economies; no country or spatial inference'})
        rows.sort(key=lambda r: r['code'])
    total = sum(r['population'] for r in rows)
    offset = 0
    regions = {}
    for row in rows:
        row['range_start'] = offset
        row['range_end_exclusive'] = offset + row['population']
        row['identity_prefix'] = f"wb2024/{row['code']}/"
        row['cohort_count'] = 64
        row['cohort_allocation'] = 'ordinal modulo 64; floor(N/64) plus one for cohort < N mod 64; non-spatial'
        offset += row['population']
        regions[row['region']] = regions.get(row['region'], 0) + row['population']
    return {'schema': 'dark.population-allocation/1', 'source': 'World Bank WDI SP.POP.TOTL', 'epoch': EPOCH,
            'source_last_updated': population[0].get('lastupdated'), 'demographic_estimate': total,
            'observed_economy_count': economy_count, 'observed_economy_total': economy_total,
            'world_aggregate_estimate': world, 'sum_minus_world_aggregate': None if world is None else economy_total - world,
            'unassigned_world_residual': max(0, residual) if residual is not None else None,
            'allocated_virtual_members': total, 'realized_individuals': 0, 'stored_individual_histories': 0,
            'active_actors': 0, 'visible_characters': 0, 'voiced_characters': 0,
            'regions': regions, 'shards': rows,
            'missing_source_economies': [{'code': code, 'name': countries[code]['name']} for code in sorted(missing)],
            'limitations': ['Country/economy totals are demographic estimates, not identifiable real people.',
                           'Non-spatial virtual cohorts preserve totals; no raster density or street assignment is inferred.',
                           'Membership belongs to synthetic stable identities. Attributes and histories are lazy; detailed lives are not precomputed.',
                           'Source revisions, omissions and geopolitical definitions can cause a country-sum/world-aggregate difference. A positive residual receives an explicitly unassigned range, never a fabricated country or coordinate.',
                           'A negative or unavailable world residual is disclosed and is not repaired by scaling source estimates.']}


def positions(coords):
    if isinstance(coords, list) and len(coords) >= 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in coords[:2]):
        lon, lat = coords[:2]
        if not math.isfinite(lon) or not math.isfinite(lat) or not -180.000001 <= lon <= 180.000001 or not -90.000001 <= lat <= 90.000001:
            raise ValueError('invalid source coordinate')
        yield lon, lat
    elif isinstance(coords, list):
        for child in coords:
            yield from positions(child)
    else:
        raise ValueError('invalid geometry coordinates')


def geometry_parts(geometry):
    kind = geometry['type']
    coords = geometry['coordinates']
    if kind in ('Polygon', 'LineString', 'Point'):
        return [geometry]
    singular = {'MultiPolygon': 'Polygon', 'MultiLineString': 'LineString', 'MultiPoint': 'Point'}.get(kind)
    if singular is None:
        raise ValueError('unsupported source geometry')
    return [{'type': singular, 'coordinates': part} for part in coords]


def build_index(raw_dir, output):
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=output.parent)
    os.close(fd)
    connection = sqlite3.connect(name)
    report = {}
    try:
        connection.executescript('''CREATE TABLE parts(id INTEGER PRIMARY KEY, layer TEXT NOT NULL, source_feature INTEGER NOT NULL,
             country_code TEXT, name TEXT, geometry TEXT NOT NULL);
             CREATE VIRTUAL TABLE bounds USING rtree(id,min_lon,max_lon,min_lat,max_lat);
             CREATE INDEX layer_idx ON parts(layer);''')
        serial = 0
        for layer in ('land', 'coastline', 'ocean', 'lakes', 'countries', 'rivers'):
            value = json.loads((Path(raw_dir) / (layer + '.json')).read_bytes())
            if value.get('type') != 'FeatureCollection':
                raise ValueError('not a feature collection')
            count = points = 0
            for feature_index, feature in enumerate(value['features']):
                prop = feature.get('properties') or {}
                for geom in geometry_parts(feature['geometry']):
                    vertices = list(positions(geom['coordinates']))
                    if not vertices:
                        raise ValueError('empty geometry')
                    lons, lats = zip(*vertices)
                    serial += 1
                    count += 1
                    points += len(vertices)
                    code = prop.get('WB_A3') or prop.get('ADM0_A3')
                    connection.execute('INSERT INTO parts VALUES (?,?,?,?,?,?)', (serial, layer, feature_index, code, prop.get('ADMIN') or prop.get('name'), canonical(geom).decode().rstrip()))
                    connection.execute('INSERT INTO bounds VALUES (?,?,?,?,?)', (serial, min(lons), max(lons), min(lats), max(lats)))
            report[layer] = {'source_features': len(value['features']), 'indexed_parts': count, 'vertices': points, 'scale': '1:10,000,000', 'street_precision': False}
        connection.commit()
        if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('index integrity failure')
        connection.close()
        os.replace(name, output)
    except BaseException:
        connection.close()
        Path(name).unlink(missing_ok=True)
        raise
    return report


def inside_ring(lon, lat, ring):
    inside = False
    previous = ring[-1]
    for current in ring:
        x1, y1 = previous[:2]
        x2, y2 = current[:2]
        # Boundary is included. Ocean/land source overlaps remain disclosed.
        cross = (lon-x1)*(y2-y1) - (lat-y1)*(x2-x1)
        if abs(cross) < 1e-12 and min(x1,x2)-1e-12 <= lon <= max(x1,x2)+1e-12 and min(y1,y2)-1e-12 <= lat <= max(y1,y2)+1e-12:
            return True
        if (y1 > lat) != (y2 > lat) and lon < (x2-x1)*(lat-y1)/(y2-y1)+x1:
            inside = not inside
        previous = current
    return inside


def contains(geometry, lon, lat):
    if geometry['type'] != 'Polygon':
        return False
    rings = geometry['coordinates']
    return bool(rings) and inside_ring(lon,lat,rings[0]) and not any(inside_ring(lon,lat,r) for r in rings[1:])


def resolve(index, latitude, longitude):
    for v in (latitude, longitude):
        if isinstance(v, bool) or not isinstance(v, (int,float)) or not math.isfinite(v):
            raise ValueError('coordinate must be finite numeric')
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise ValueError('coordinate outside WGS84')
    # Seam has a canonical address. At a pole longitude is physically immaterial.
    lon = -180.0 if longitude == 180 else longitude
    if abs(latitude) == 90:
        lon = 0.0
    con = sqlite3.connect(f'file:{Path(index).resolve()}?mode=ro', uri=True)
    try:
        rows = con.execute('SELECT p.layer,p.country_code,p.name,p.geometry FROM bounds b JOIN parts p ON p.id=b.id WHERE b.min_lon<=? AND b.max_lon>=? AND b.min_lat<=? AND b.max_lat>=? AND p.layer IN (\'land\',\'ocean\',\'lakes\',\'countries\')', (lon,lon,latitude,latitude))
        matched = [(layer,code,name) for layer,code,name,geometry in rows if contains(json.loads(geometry),lon,latitude)]
    finally:
        con.close()
    layers = {m[0] for m in matched}
    state = 'inland_water' if 'lakes' in layers else 'land' if 'land' in layers else 'ocean' if 'ocean' in layers else 'unclassified_source_gap'
    return {'schema': 'dark.environmental-state/1', 'latitude': latitude, 'longitude': lon,
            'state': state, 'source_scale': '1:10,000,000', 'source_revision': PIN,
            'countries': sorted({(code or '')+':'+(name or '') for layer,code,name in matched if layer == 'countries'}),
            'ground_route': 'unavailable', 'height_m': None, 'collision_ready': False,
            'limitations': ['Global cartographic overview only; small features may be omitted or generalized.',
                           'No street, terrain height, collision, weather or local demographic precision is inferred.']}


def reproduce(dest=DEST):
    dest = Path(dest)
    lock = json.loads((dest / 'sources.lock.json').read_bytes())
    for row in lock['sources']:
        path = dest / row['path']
        if path.stat().st_size != row['bytes'] or digest(path) != row['sha256']:
            raise ValueError('raw source hash mismatch: '+row['path'])
    population = allocate_population(json.loads((dest/'raw/population.json').read_bytes()), json.loads((dest/'raw/economies.json').read_bytes()))
    atomic(dest/'population-allocation.json', canonical(population))
    tsv = 'code\tname\tregion\tpopulation\n' + ''.join(f"{r['code']}\t{r['name']}\t{r['region']}\t{r['population']}\n" for r in population['shards'])
    atomic(dest/'population-shards.tsv', tsv.encode())
    layers = build_index(dest/'raw',dest/'overview.sqlite')
    report = {'schema': 'dark.global-ingestion/1', 'layers': layers, 'population': {k:v for k,v in population.items() if k not in ('shards',)},
              'outputs': {name: {'bytes': (dest/name).stat().st_size, 'sha256': digest(dest/name)} for name in ('population-allocation.json','population-shards.tsv','overview.sqlite')},
              'full_street_world_coverage': False, 'full_population_spatial_fidelity': False}
    atomic(dest/'ingestion-report.json', canonical(report))
    return report


def acquire(dest=DEST):
    dest = Path(dest)
    source_rows = []
    used = 0
    for layer,url in SOURCES.items():
        path = dest/'raw'/(layer+'.json')
        used += fetch(url,path,max_bytes=min(80*1024*1024,LIMIT-used))
        source_rows.append({'id': layer, 'url': url, 'path': str(path.relative_to(dest)), 'bytes': path.stat().st_size, 'sha256': digest(path),
                            'license': 'CC BY 4.0 with World Bank additional terms' if layer.startswith('population') or layer == 'economies' else 'Public domain',
                            'revision': f'WDI 2024 acquired 2026-10-21' if layer.startswith('population') or layer == 'economies' else PIN})
        print(layer, path.stat().st_size, flush=True)
    atomic(dest/'sources.lock.json', canonical({'schema': 'dark.global-sources/1','sources': source_rows, 'raw_budget_bytes':LIMIT,'raw_bytes':used}))
    return reproduce(dest)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['acquire','reproduce','resolve'])
    p.add_argument('--dest',type=Path,default=DEST)
    p.add_argument('--lat',type=float)
    p.add_argument('--lon',type=float)
    args=p.parse_args()
    if args.command == 'resolve':
        value=resolve(args.dest/'overview.sqlite',args.lat,args.lon)
    else:
        value=acquire(args.dest) if args.command == 'acquire' else reproduce(args.dest)
    print(json.dumps(value,indent=2,ensure_ascii=False))

if __name__ == '__main__':
    main()
