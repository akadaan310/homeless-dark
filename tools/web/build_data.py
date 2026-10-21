#!/usr/bin/env python3
"""Derive compact browser runtime data from the repository's pinned geography sources.

Outputs (apps/homeless-web/public/data):
  tampa-cell.json        OSM Tampa fixture (Dale Mabry Hwy & Spruce St) projected to local ENU metres
  terrain/<S>_<W>.i16    GEBCO 2025 6' grid split into 10x10 degree gridline tiles (101x101 int16 LE)
  terrain/index.json     tile manifest with per-tile SHA-256 and source provenance
  terrain/coarse.i16     1-degree decimation (361x181) for the globe view
  landmask.png           Natural Earth 1:10m land minus lakes, 0.1 degree, 1-bit
  countries.png          Natural Earth admin-0 index raster, 0.1 degree, index = R*256+G (0 = none)
  countries.json         index -> {name, iso}
  airports.json          OurAirports large/medium airports with scheduled service + all heliports? (no: large/medium only)
  data-manifest.json     every output with its source and hash

The derivations never raise resolution: tiles are a lossless split of the source grid,
rasters are 0.1 degree, and the Tampa geometry keeps OSM ids. Run: npm run data
"""
import csv
import hashlib
import json
import math
import os
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
GEO = os.path.join(ROOT, 'data', 'geography')
OUT = os.path.join(ROOT, 'apps', 'homeless-web', 'public', 'data')
os.makedirs(os.path.join(OUT, 'terrain'), exist_ok=True)
manifest = []


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def record(path, source, note):
    manifest.append({'path': os.path.relpath(path, OUT), 'bytes': os.path.getsize(path), 'sha256': sha(path), 'source': source, 'note': note})


# --------------------------------------------------------------- WGS84 / ENU
A = 6378137.0
F = 1 / 298.257223563
E2 = F * (2 - F)


def ecef(lat, lon, h=0.0):
    la, lo = math.radians(lat), math.radians(lon)
    n = A / math.sqrt(1 - E2 * math.sin(la) ** 2)
    return ((n + h) * math.cos(la) * math.cos(lo), (n + h) * math.cos(la) * math.sin(lo), (n * (1 - E2) + h) * math.sin(la))


def enu(lat, lon, lat0, lon0):
    x, y, z = ecef(lat, lon)
    x0, y0, z0 = ecef(lat0, lon0)
    dx, dy, dz = x - x0, y - y0, z - z0
    la, lo = math.radians(lat0), math.radians(lon0)
    e = -math.sin(lo) * dx + math.cos(lo) * dy
    n = -math.sin(la) * math.cos(lo) * dx - math.sin(la) * math.sin(lo) * dy + math.cos(la) * dz
    return round(e, 3), round(n, 3)


# --------------------------------------------------------------- Tampa cell
ROAD_WIDTH = {'motorway': 11.0, 'motorway_link': 7.0, 'primary': 13.0, 'primary_link': 7.0, 'secondary': 10.0, 'tertiary': 8.0,
              'residential': 7.0, 'unclassified': 6.5, 'service': 5.0, 'footway': 2.2, 'path': 1.8}


def build_tampa():
    src = os.path.join(GEO, 'tampa-dale-mabry-spruce.geojson')
    data = json.load(open(src))
    anchor = json.load(open(os.path.join(GEO, 'anchors.json')))['anchors'][0]['points'][0]
    lat0, lon0 = anchor['latitude_deg'], anchor['longitude_deg']
    roads, buildings, places = [], [], []
    for f in data['features']:
        p = f['properties']
        tags = p.get('tags', {})
        g = f['geometry']
        if p['layer'] == 'road' and g['type'] == 'LineString':
            hw = tags.get('highway', 'unclassified')
            roads.append({'id': f['id'], 'class': hw, 'name': tags.get('name'), 'width': ROAD_WIDTH.get(hw, 6.0),
                          'lanes': int(tags['lanes']) if tags.get('lanes', '').isdigit() else None, 'oneway': tags.get('oneway') == 'yes',
                          'surface': tags.get('surface'), 'pts': [enu(la, lo, lat0, lon0) for lo, la in g['coordinates']]})
        elif p['layer'] == 'building' and g['type'] == 'Polygon':
            try:
                height = float(tags['height']) if 'height' in tags else None
            except ValueError:
                height = None
            levels = tags.get('building:levels')
            hsrc = 'osm:height' if height else ('osm:levels' if levels else 'authored-default')
            if not height:
                height = float(levels) * 3.2 if levels and levels.replace('.', '').isdigit() else 7.0
            ring = [enu(la, lo, lat0, lon0) for lo, la in g['coordinates'][0]]
            buildings.append({'id': f['id'], 'kind': tags.get('building'), 'name': tags.get('name'), 'height': round(height, 2), 'heightSource': hsrc, 'ring': ring})
        elif g['type'] == 'Point':
            lo, la = g['coordinates']
            places.append({'id': f['id'], 'name': tags.get('name'), 'pos': enu(la, lo, lat0, lon0)})
    out = os.path.join(OUT, 'tampa-cell.json')
    json.dump({
        'schema': 'dark.world-cell/1', 'cellId': 'osm-tampa-dale-mabry-spruce', 'anchor': {'lat': lat0, 'lon': lon0, 'osmNode': anchor['osm_node_id']},
        'frame': 'local ENU metres (east, north) on the WGS84 ellipsoid tangent plane at the anchor; altitude unknown in source',
        'attribution': data.get('attribution'), 'license': 'ODbL-1.0', 'factuality': 'sourced_geometry (roads, building footprints); heights per heightSource',
        'roads': roads, 'buildings': buildings, 'places': places,
    }, open(out, 'w'), separators=(',', ':'))
    record(out, os.path.relpath(src, ROOT), f'{len(roads)} roads, {len(buildings)} buildings projected to ENU')


# --------------------------------------------------------------- GEBCO tiles
def build_terrain():
    meta = json.load(open(os.path.join(GEO, 'global', 'terrain', 'metadata.json')))
    g = meta['grid']
    w, h = g['width'], g['height']
    grid = np.fromfile(os.path.join(GEO, 'global', 'terrain', 'heights.i16'), dtype='<i2')
    assert grid.size == w * h, grid.size
    grid = grid.reshape(h, w)  # south-to-north rows
    tiles = []
    for s in range(-90, 90, 10):
        for wlon in range(-180, 180, 10):
            r0 = (s + 90) * 10
            c0 = (wlon + 180) * 10
            tile = np.ascontiguousarray(grid[r0:r0 + 101, c0:c0 + 101]).astype('<i2')
            name = f'{s}_{wlon}.i16'
            path = os.path.join(OUT, 'terrain', name)
            tile.tofile(path)
            tiles.append({'id': f'gebco6m/{s}/{wlon}', 'file': name, 'south': s, 'west': wlon, 'size': 101, 'sha256': sha(path),
                          'min': int(tile.min()), 'max': int(tile.max())})
    coarse = np.ascontiguousarray(grid[::10, ::10]).astype('<i2')
    cpath = os.path.join(OUT, 'terrain', 'coarse.i16')
    coarse.tofile(cpath)
    idx = os.path.join(OUT, 'terrain', 'index.json')
    json.dump({'schema': 'dark.terrain-tiles/1', 'source': meta['source'], 'datum': meta['height_datum'], 'limitations': meta['limitations'],
               'stepDegrees': 0.1, 'tileDegrees': 10, 'samplesPerSide': 101, 'ordering': 'south-to-north rows, west-to-east columns, int16 LE metres',
               'coarse': {'file': 'coarse.i16', 'width': coarse.shape[1], 'height': coarse.shape[0], 'stepDegrees': 1.0, 'sha256': sha(cpath)},
               'tiles': tiles}, open(idx, 'w'), separators=(',', ':'))
    record(idx, 'data/geography/global/terrain/heights.i16', f'{len(tiles)} lossless 10-degree tiles of GEBCO 2025 6-arcminute grid')
    record(cpath, 'data/geography/global/terrain/heights.i16', '1-degree decimation for globe view')


# --------------------------------------------------------------- Natural Earth rasters
RW, RH = 3600, 1800


def px(lon, lat):
    return ((lon + 180) * 10, (90 - lat) * 10)


def polys(geom):
    if geom['type'] == 'Polygon':
        yield geom['coordinates']
    elif geom['type'] == 'MultiPolygon':
        yield from geom['coordinates']


def build_rasters():
    land = Image.new('1', (RW, RH), 0)
    d = ImageDraw.Draw(land)
    for f in json.load(open(os.path.join(GEO, 'global', 'raw', 'land.json')))['features']:
        for poly in polys(f['geometry']):
            d.polygon([px(*c[:2]) for c in poly[0]], fill=1)
            for hole in poly[1:]:
                d.polygon([px(*c[:2]) for c in hole], fill=0)
    for f in json.load(open(os.path.join(GEO, 'global', 'raw', 'lakes.json')))['features']:
        for poly in polys(f['geometry']):
            d.polygon([px(*c[:2]) for c in poly[0]], fill=0)
    lpath = os.path.join(OUT, 'landmask.png')
    land.save(lpath, optimize=True)
    record(lpath, 'Natural Earth 10m land minus lakes (ca96624a)', '0.1-degree equirectangular raster, row 0 = 90N, 1 = land')

    cimg = Image.new('RGB', (RW, RH), (0, 0, 0))
    d = ImageDraw.Draw(cimg)
    names = {}
    feats = json.load(open(os.path.join(GEO, 'global', 'raw', 'countries.json')))['features']
    for i, f in enumerate(feats, start=1):
        p = f['properties']
        names[i] = {'name': p.get('NAME_EN') or p.get('NAME') or p.get('ADMIN'), 'iso': p.get('ISO_A3') if p.get('ISO_A3') != '-99' else p.get('ADM0_A3')}
        col = (i >> 8, i & 255, 0)
        for poly in polys(f['geometry']):
            d.polygon([px(*c[:2]) for c in poly[0]], fill=col)
    cpath = os.path.join(OUT, 'countries.png')
    cimg.save(cpath, optimize=True)
    npath = os.path.join(OUT, 'countries.json')
    json.dump(names, open(npath, 'w'), separators=(',', ':'), ensure_ascii=False)
    record(cpath, 'Natural Earth 10m admin-0 countries (ca96624a)', 'index raster R*256+G; a label, not a political determination')
    record(npath, 'Natural Earth 10m admin-0 countries (ca96624a)', 'index to name/ISO')


# --------------------------------------------------------------- Airports
def build_airports():
    src = os.path.join(GEO, 'sources', 'ourairports-airports.csv')
    out = []
    with open(src, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            keep = r['type'] == 'large_airport' or (r['type'] == 'medium_airport' and r['scheduled_service'] == 'yes' and r['iata_code'])
            if not keep:
                continue
            elev = float(r['elevation_ft']) * 0.3048 if r['elevation_ft'] else None
            out.append([r['ident'], r['iata_code'] or None, r['name'], round(float(r['latitude_deg']), 5), round(float(r['longitude_deg']), 5),
                        round(elev, 1) if elev is not None else None, r['iso_country'], r['municipality'] or None, r['type'][0]])
    path = os.path.join(OUT, 'airports.json')
    json.dump({'schema': 'dark.airports/1', 'source': 'OurAirports airports.csv (public domain, no accuracy guarantee)', 'sourceSha256': sha(src),
               'fields': ['ident', 'iata', 'name', 'lat', 'lon', 'elevation_m', 'country', 'municipality', 'type(l=large,m=medium)'],
               'limitations': 'Location and identifiers only: no terminal interiors, gates or schedules. Interiors in HOMELESS are author-composed.',
               'airports': out}, open(path, 'w'), separators=(',', ':'), ensure_ascii=False)
    record(path, os.path.relpath(src, ROOT), f'{len(out)} large/medium scheduled airports')


if __name__ == '__main__':
    build_tampa()
    build_terrain()
    build_rasters()
    build_airports()
    mpath = os.path.join(OUT, 'data-manifest.json')
    json.dump({'schema': 'dark.web-data-manifest/1', 'entries': manifest}, open(mpath, 'w'), indent=1)
    print(json.dumps([{k: m[k] for k in ('path', 'bytes')} for m in manifest if not m['path'].startswith('terrain/') or 'index' in m['path']], indent=0))
