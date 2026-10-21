// Global world-cell addressing and the reality contract. [C] DARK construction.
// Every coordinate on Earth resolves to a cell with explicit per-layer data
// status; nothing missing is ever reported as verified.

import { normalizeLon, validGeodetic, geodeticToEnu, enuToGeodetic, type Geodetic, type Vec3 } from './wgs84';
import { tileKeyFor, tileId } from './terrain';

export type DataStatus = 'verified' | 'derived' | 'authored' | 'unavailable';

export interface LayerStatus { layer: string; status: DataStatus; source: string | null; note: string }

export interface WorldCellManifest {
  cellId: string; // 0.1-degree cell, stable global id
  tileId: string; // terrain tile
  bounds: { south: number; west: number; north: number; east: number };
  center: { lat: number; lon: number };
  surface: 'land' | 'ocean' | 'inland-water' | 'unknown';
  country: string | null;
  layers: LayerStatus[];
  collisionReady: boolean;
  activeNpcBudget: number;
  qualityTier: 'detailed-street' | 'coarse-terrain' | 'open-water';
}

export const CELL_DEG = 0.1;

export function cellIdFor(lat: number, lon: number): string {
  const lo = normalizeLon(lon);
  const r = Math.min(1799, Math.floor((lat + 90) / CELL_DEG));
  const c = Math.min(3599, Math.floor((lo + 180) / CELL_DEG));
  return `c01/${r}/${c}`;
}

export function cellBounds(cellId: string) {
  const m = /^c01\/(\d+)\/(\d+)$/.exec(cellId);
  if (!m) throw new Error(`bad cell id ${cellId}`);
  const r = Number(m[1]), c = Number(m[2]);
  const south = -90 + r * CELL_DEG, west = -180 + c * CELL_DEG;
  return { south, west, north: south + CELL_DEG, east: west + CELL_DEG };
}

/** Raster lookups are injected so the resolver stays pure and testable. */
export interface GlobalRasters {
  isLand(lat: number, lon: number): boolean | null; // Natural Earth land minus lakes; null = not loaded
  country(lat: number, lon: number): string | null;
  height(lat: number, lon: number): number | null; // GEBCO model metres
}

export interface DetailedRegion { id: string; lat: number; lon: number; radiusM: number; source: string; license: string }

export function resolveCell(lat: number, lon: number, rasters: GlobalRasters, detailed: DetailedRegion[] = []): WorldCellManifest {
  if (!validGeodetic(lat, lon)) throw new RangeError(`invalid coordinate ${lat},${lon}`);
  const cellId = cellIdFor(lat, lon);
  const bounds = cellBounds(cellId);
  const land = rasters.isLand(lat, lon);
  const h = rasters.height(lat, lon);
  const country = rasters.country(lat, lon);
  const surface: WorldCellManifest['surface'] = land === null ? 'unknown' : land ? 'land' : h !== null && h > 0 ? 'inland-water' : 'ocean';
  const street = detailed.find((d) => {
    const v = geodeticToEnu({ lat, lon, h: 0 }, { lat: d.lat, lon: d.lon, h: 0 });
    return Math.hypot(v[0], v[1]) <= d.radiusM;
  });
  const layers: LayerStatus[] = [
    { layer: 'land-sea', status: land === null ? 'unavailable' : 'verified', source: 'Natural Earth 1:10m (public domain) @ca96624a', note: 'cartographic generalization; small islands/coast detail can be absent' },
    { layer: 'terrain', status: h === null ? 'unavailable' : 'derived', source: 'GEBCO 2025 6-arcminute GMT derivative (public domain)', note: '~11 km grid, 32 km filter, approx. MSL; not street topography or navigation data' },
    { layer: 'roads-buildings', status: street ? 'verified' : 'unavailable', source: street?.source ?? null, note: street ? `bounded OSM fixture ${street.id} (${street.license})` : 'no road/building source ingested for this cell' },
    { layer: 'near-detail', status: street ? 'authored' : surface === 'ocean' ? 'unavailable' : 'authored', source: 'HOMELESS author-composed', note: 'façades, interiors, props and residents are fictional compositions' },
    { layer: 'admin-label', status: country ? 'verified' : 'unavailable', source: country ? 'Natural Earth admin-0' : null, note: 'label only, not a political determination' },
  ];
  return {
    cellId, tileId: tileId(tileKeyFor(lat, lon)), bounds, center: { lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2 },
    surface, country, layers,
    collisionReady: h !== null, activeNpcBudget: street ? 8 : surface === 'land' ? 2 : 0,
    qualityTier: street ? 'detailed-street' : surface === 'ocean' ? 'open-water' : 'coarse-terrain',
  };
}

/**
 * Floating origin: authoritative positions stay geodetic doubles; the render and
 * physics frame is a local ENU tangent plane that is rebased when the focus moves
 * beyond `threshold` metres, so float32 GPU coordinates stay small.
 */
export class FloatingOrigin {
  origin: Geodetic;
  rebases = 0;
  constructor(origin: Geodetic, public threshold = 2000) { this.origin = { ...origin }; }
  toLocal(g: Geodetic): Vec3 { return geodeticToEnu(g, this.origin); }
  toGeodetic(v: Vec3): Geodetic { return enuToGeodetic(v, this.origin); }
  /** Returns the new origin's offset if a rebase happened (caller shifts scene/physics by -delta). */
  maybeRebase(focusLocal: Vec3): { delta: Vec3; previous: Geodetic } | null {
    if (Math.hypot(focusLocal[0], focusLocal[1]) < this.threshold) return null;
    const previous = this.origin;
    const g = this.toGeodetic(focusLocal);
    this.origin = { lat: g.lat, lon: g.lon, h: previous.h };
    this.rebases++;
    // delta expressed in the NEW frame: old-frame points p map to toLocal(prevGeodetic(p)).
    return { delta: focusLocal, previous };
  }
  /** Re-express a local point of the previous frame in the current frame (exact, via geodetic). */
  reexpress(p: Vec3, previous: Geodetic): Vec3 {
    return geodeticToEnu(enuToGeodetic(p, previous), this.origin);
  }
}
