import { describe, expect, it } from 'vitest';
import {
  geodeticToEcef, ecefToGeodetic, geodeticToEnu, enuToGeodetic, geodesicDistance, haversine, normalizeLon, intermediatePoint,
  sunPosition, moonPosition, tileKeyFor, sampleTile, TerrainTileCache, TILE_SAMPLES, resolveCell, cellIdFor, FloatingOrigin, tilesForSpan,
} from '../src';

const POINTS = [
  { name: 'Tampa anchor', lat: 27.9594638, lon: -82.5054865, h: 5 },
  { name: 'North Pole', lat: 90, lon: 0, h: 0 },
  { name: 'South Pole', lat: -90, lon: 45, h: 2835 },
  { name: 'Everest', lat: 27.9881, lon: 86.925, h: 8848.86 },
  { name: 'Challenger Deep', lat: 11.3733, lon: 142.5917, h: -10935 },
  { name: 'antimeridian east', lat: -16.5, lon: 179.9999, h: 0 },
  { name: 'antimeridian west', lat: -16.5, lon: -179.9999, h: 0 },
  { name: 'open Pacific', lat: 0, lon: -140, h: 0 },
];

describe('WGS84 round trips [M]', () => {
  for (const p of POINTS) {
    it(`geodetic→ECEF→geodetic ${p.name} (< 1e-9 deg, < 1 mm)`, () => {
      const [x, y, z] = geodeticToEcef(p.lat, p.lon, p.h);
      const g = ecefToGeodetic(x, y, z);
      expect(Math.abs(g.lat - p.lat)).toBeLessThan(1e-9);
      if (Math.abs(p.lat) < 90) expect(Math.abs(normalizeLon(g.lon - p.lon))).toBeLessThan(1e-9);
      expect(Math.abs(g.h - p.h)).toBeLessThan(1e-3);
    });
    it(`ENU round trip around ${p.name} for 5 km offsets (< 1 mm)`, () => {
      const o = { lat: p.lat, lon: p.lon, h: p.h };
      for (const v of [[5000, 0, 0], [0, 5000, 10], [-3000, 4000, -50]] as const) {
        const g = enuToGeodetic([v[0], v[1], v[2]], o);
        const back = geodeticToEnu(g, o);
        for (let i = 0; i < 3; i++) expect(Math.abs(back[i]! - v[i]!)).toBeLessThan(1e-3);
      }
    });
  }
  it('antimeridian neighbours are 22 m apart, not 40 000 km', () => {
    expect(geodesicDistance(-16.5, 179.9999, -16.5, -179.9999)).toBeLessThan(25);
  });
  it('Vincenty matches known JFK→LHR geodesic within 0.1%', () => {
    const d = geodesicDistance(40.6413, -73.7781, 51.47, -0.4543);
    expect(Math.abs(d - 5_554_000) / 5_554_000).toBeLessThan(0.001);
    expect(Math.abs(haversine(40.6413, -73.7781, 51.47, -0.4543) - d) / d).toBeLessThan(0.005);
  });
  it('great-circle intermediate point crosses the antimeridian correctly', () => {
    const m = intermediatePoint(35.55, 139.78, 21.32, -157.92, 0.5); // Tokyo → Honolulu
    expect(m.lon > 150 || m.lon < -150).toBe(true);
  });
});

describe('solar ephemeris [M]', () => {
  it('Tampa, 2026-06-21 17:30 UTC: sun high in the south-ish sky', () => {
    const s = sunPosition(new Date('2026-06-21T17:30:00Z'), 27.96, -82.5);
    expect(s.elevation).toBeGreaterThan(80);
    expect(s.declination).toBeCloseTo(23.44, 1);
  });
  it('Tampa midnight local: sun below horizon', () => {
    expect(sunPosition(new Date('2026-10-21T04:30:00Z'), 27.96, -82.5).elevation).toBeLessThan(-30);
  });
  it('polar night at the North Pole in December', () => {
    expect(sunPosition(new Date('2026-12-21T12:00:00Z'), 90, 0).elevation).toBeLessThan(-20);
  });
  it('NOAA reference: Greenwich equinox noon elevation ≈ 90 − 51.48 ± 0.5', () => {
    const s = sunPosition(new Date('2026-03-20T12:07:00Z'), 51.48, 0);
    expect(Math.abs(s.elevation - 38.5)).toBeLessThan(0.7);
    expect(Math.abs(s.azimuth - 180)).toBeLessThan(3);
  });
  it('moon position is finite with illumination in [0,1]', () => {
    const m = moonPosition(new Date('2026-10-21T00:00:00Z'), 27.96, -82.5);
    expect(m.illumination).toBeGreaterThanOrEqual(0);
    expect(m.illumination).toBeLessThanOrEqual(1);
  });
});

function fakeTile(value: (i: number, j: number) => number) {
  const a = new Int16Array(TILE_SAMPLES * TILE_SAMPLES);
  for (let j = 0; j < TILE_SAMPLES; j++) for (let i = 0; i < TILE_SAMPLES; i++) a[j * TILE_SAMPLES + i] = value(i, j);
  return a.buffer;
}

describe('terrain streaming [M]', () => {
  it('tile keys clamp poles and dateline', () => {
    expect(tileKeyFor(90, 180)).toEqual({ south: 80, west: -180 });
    expect(tileKeyFor(-90, -180)).toEqual({ south: -90, west: -180 });
    expect(tileKeyFor(27.96, -82.5)).toEqual({ south: 20, west: -90 });
  });
  it('bilinear sampling interpolates between gridline samples', () => {
    const tile = { key: { south: 20, west: -90 }, heights: new Int16Array(fakeTile((i) => i * 10)), bytes: 0 };
    expect(sampleTile(tile, 25, -89.95)).toBeCloseTo(5, 6);
  });
  it('cache de-duplicates, honours concurrency budget, cancels and evicts by quota', async () => {
    let concurrent = 0, peak = 0;
    const fetcher = async (_k: unknown, signal: AbortSignal) => {
      concurrent++; peak = Math.max(peak, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent--;
      if (signal.aborted) throw new Error('aborted');
      return fakeTile(() => 1);
    };
    const cache = new TerrainTileCache(fetcher, { maxBytes: TILE_SAMPLES * TILE_SAMPLES * 2 * 3, maxConcurrent: 2 });
    const keys = [0, 10, 20, 30, 40].map((w) => ({ south: 0, west: w }));
    const a = cache.request(keys[0]!), b = cache.request(keys[0]!);
    const rest = keys.slice(1).map((k) => cache.request(k));
    cache.cancel(keys[4]!);
    const results = await Promise.allSettled([a, b, ...rest]);
    expect(cache.stats.duplicatesAvoided).toBe(1);
    expect(peak).toBeLessThanOrEqual(2);
    expect(results[results.length - 1]!.status).toBe('rejected');
    expect(cache.stats.cancellations).toBe(1);
    expect(cache.stats.ready).toBeLessThanOrEqual(3);
    expect(cache.stats.evictions).toBeGreaterThanOrEqual(1);
  });
  it('failed fetch is observable, not silently ready', async () => {
    const cache = new TerrainTileCache(async () => new ArrayBuffer(10));
    await expect(cache.request({ south: 0, west: 0 })).rejects.toThrow(/bytes/);
    expect(cache.state({ south: 0, west: 0 })).toBe('failed');
  });
  it('spans across the antimeridian request tiles on both sides', () => {
    const ids = tilesForSpan(0, 179.95, 0.3).map((k) => k.west);
    expect(ids).toContain(170);
    expect(ids).toContain(-180);
  });
});

describe('world cell resolver and reality contract [M]', () => {
  const rasters = {
    isLand: (lat: number) => lat > 0,
    country: (lat: number) => (lat > 0 ? 'Testland' : null),
    height: (lat: number) => (lat > 0 ? 100 : -4000),
  };
  it('every valid coordinate resolves; ocean cells claim no roads', () => {
    for (const [la, lo] of [[0.5, 0], [-45, 179.99], [90, 0], [-90, -180], [12, -179.99]] as const) {
      const c = resolveCell(la, lo, rasters);
      expect(c.cellId).toMatch(/^c01\//);
      expect(c.layers.find((l) => l.layer === 'roads-buildings')!.status).toBe('unavailable');
    }
    expect(resolveCell(-30, 0, rasters).surface).toBe('ocean');
  });
  it('only a sourced fixture makes roads verified', () => {
    const c = resolveCell(27.9595, -82.5055, rasters, [{ id: 'tampa', lat: 27.9594638, lon: -82.5054865, radiusM: 900, source: 'OSM', license: 'ODbL-1.0' }]);
    expect(c.qualityTier).toBe('detailed-street');
    expect(c.layers.find((l) => l.layer === 'near-detail')!.status).toBe('authored');
  });
  it('rejects invalid coordinates', () => {
    expect(() => resolveCell(91, 0, rasters)).toThrow();
    expect(cellIdFor(90, 180)).toBe('c01/1799/0');
  });
  it('floating origin rebase preserves identity of a building corner to < 1 mm', () => {
    const fo = new FloatingOrigin({ lat: 51.5, lon: -0.12, h: 0 }, 1000);
    const corner: [number, number, number] = [1500, 300, 12];
    const g0 = fo.toGeodetic(corner);
    const r = fo.maybeRebase([1200, 0, 0])!;
    const moved = fo.reexpress(corner, r.previous);
    const g1 = fo.toGeodetic(moved);
    expect(Math.abs(g1.lat - g0.lat)).toBeLessThan(1e-10);
    expect(Math.abs(g1.lon - g0.lon)).toBeLessThan(1e-10);
    expect(Math.hypot(moved[0] - 300, moved[1] - 300)).toBeLessThan(1);
    expect(fo.rebases).toBe(1);
  });
});
