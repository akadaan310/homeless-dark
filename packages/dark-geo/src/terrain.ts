// Global coarse terrain streaming over the GEBCO 2025 6-arcminute grid split into
// 10-degree gridline tiles (see tools/web/build_data.py). [K] bilinear sampling;
// [C] request budget / memory quota / cancellation policy of this engine.
//
// The grid is an ocean-and-land relief MODEL (~11 km spacing, 32 km Gaussian
// filter). It cannot certify street topography, coastline position or safe
// navigation; every sample carries that status.

import { normalizeLon } from './wgs84';

export const TILE_DEG = 10;
export const TILE_SAMPLES = 101;
export const STEP_DEG = 0.1;

export interface TileKey { south: number; west: number }

export function tileKeyFor(lat: number, lon: number): TileKey {
  const lo = normalizeLon(lon);
  let south = Math.floor(lat / TILE_DEG) * TILE_DEG;
  if (south >= 90) south = 80; // the +90 row lives in the last tile row (gridline registration)
  if (south < -90) south = -90;
  let west = Math.floor(lo / TILE_DEG) * TILE_DEG;
  if (west >= 180) west = 170;
  return { south, west };
}

export const tileId = (k: TileKey) => `${k.south}_${k.west}`;

export interface TerrainTile { key: TileKey; heights: Int16Array; bytes: number }

/** Bilinear height (metres, approx. MSL; negative = sea floor) inside one tile. */
export function sampleTile(tile: TerrainTile, lat: number, lon: number): number {
  const lo = normalizeLon(lon);
  const fx = Math.min(TILE_SAMPLES - 1, Math.max(0, (lo - tile.key.west) / STEP_DEG));
  const fy = Math.min(TILE_SAMPLES - 1, Math.max(0, (lat - tile.key.south) / STEP_DEG));
  const x0 = Math.min(TILE_SAMPLES - 2, Math.floor(fx)), y0 = Math.min(TILE_SAMPLES - 2, Math.floor(fy));
  const tx = fx - x0, ty = fy - y0;
  const h = (x: number, y: number) => tile.heights[y * TILE_SAMPLES + x]!;
  return (h(x0, y0) * (1 - tx) + h(x0 + 1, y0) * tx) * (1 - ty) + (h(x0, y0 + 1) * (1 - tx) + h(x0 + 1, y0 + 1) * tx) * ty;
}

export type TileState = 'absent' | 'loading' | 'ready' | 'failed' | 'cancelled';
export type TileFetcher = (key: TileKey, signal: AbortSignal) => Promise<ArrayBuffer>;

export interface TileCacheOptions {
  maxBytes: number; // memory quota
  maxConcurrent: number; // async request budget
}

export interface TileCacheStats { ready: number; bytes: number; inflight: number; requests: number; evictions: number; failures: number; cancellations: number; duplicatesAvoided: number }

/**
 * LRU terrain tile cache with a concurrency budget, request de-duplication,
 * cancellation, observable failures and a byte quota.
 */
export class TerrainTileCache {
  private ready = new Map<string, TerrainTile>();
  private inflight = new Map<string, { promise: Promise<TerrainTile>; ctrl: AbortController }>();
  private queue: { key: TileKey; resolve: (t: TerrainTile) => void; reject: (e: unknown) => void; ctrl: AbortController }[] = [];
  private active = 0;
  private states = new Map<string, TileState>();
  readonly stats: TileCacheStats = { ready: 0, bytes: 0, inflight: 0, requests: 0, evictions: 0, failures: 0, cancellations: 0, duplicatesAvoided: 0 };

  constructor(private fetcher: TileFetcher, private opts: TileCacheOptions = { maxBytes: 4 * 1024 * 1024, maxConcurrent: 3 }) {}

  state(key: TileKey): TileState { return this.states.get(tileId(key)) ?? 'absent'; }
  peek(key: TileKey): TerrainTile | undefined {
    const id = tileId(key);
    const t = this.ready.get(id);
    if (t) { this.ready.delete(id); this.ready.set(id, t); } // LRU touch
    return t;
  }

  request(key: TileKey): Promise<TerrainTile> {
    const id = tileId(key);
    const hit = this.peek(key);
    if (hit) return Promise.resolve(hit);
    const pending = this.inflight.get(id);
    if (pending) { this.stats.duplicatesAvoided++; return pending.promise; }
    const ctrl = new AbortController();
    const promise = new Promise<TerrainTile>((resolve, reject) => {
      this.queue.push({ key, resolve, reject, ctrl });
    });
    this.inflight.set(id, { promise, ctrl });
    this.states.set(id, 'loading');
    this.stats.inflight = this.inflight.size;
    this.pump();
    return promise;
  }

  cancel(key: TileKey): boolean {
    const id = tileId(key);
    const p = this.inflight.get(id);
    if (!p) return false;
    p.ctrl.abort();
    return true;
  }

  cancelAll(): void { for (const p of this.inflight.values()) p.ctrl.abort(); }

  private pump(): void {
    while (this.active < this.opts.maxConcurrent && this.queue.length) {
      const job = this.queue.shift()!;
      const id = tileId(job.key);
      if (job.ctrl.signal.aborted) { this.finishCancel(id, job.reject); continue; }
      this.active++;
      this.stats.requests++;
      this.fetcher(job.key, job.ctrl.signal)
        .then((buf) => {
          if (job.ctrl.signal.aborted) throw new DOMExceptionLike('aborted');
          if (buf.byteLength !== TILE_SAMPLES * TILE_SAMPLES * 2) throw new Error(`tile ${id}: ${buf.byteLength} bytes, expected ${TILE_SAMPLES * TILE_SAMPLES * 2}`);
          const tile: TerrainTile = { key: job.key, heights: new Int16Array(buf.slice(0)), bytes: buf.byteLength };
          this.ready.set(id, tile);
          this.states.set(id, 'ready');
          this.stats.bytes += tile.bytes;
          this.evict();
          job.resolve(tile);
        })
        .catch((e) => {
          if (job.ctrl.signal.aborted) return this.finishCancel(id, job.reject);
          this.stats.failures++;
          this.states.set(id, 'failed');
          job.reject(e);
        })
        .finally(() => {
          this.active--;
          this.inflight.delete(id);
          this.stats.inflight = this.inflight.size;
          this.stats.ready = this.ready.size;
          this.pump();
        });
    }
  }

  private finishCancel(id: string, reject: (e: unknown) => void) {
    this.stats.cancellations++;
    this.states.set(id, 'cancelled');
    this.inflight.delete(id);
    reject(new DOMExceptionLike('cancelled'));
  }

  private evict(): void {
    while (this.stats.bytes > this.opts.maxBytes && this.ready.size > 1) {
      const [oldest, tile] = this.ready.entries().next().value as [string, TerrainTile];
      this.ready.delete(oldest);
      this.states.set(oldest, 'absent');
      this.stats.bytes -= tile.bytes;
      this.stats.evictions++;
    }
    this.stats.ready = this.ready.size;
  }
}

export class DOMExceptionLike extends Error {
  constructor(msg: string) { super(msg); this.name = 'AbortError'; }
}

/** Grid of heights (metres) around an origin, sampled across tile seams. Returns null until every needed tile is ready. */
export function sampleGrid(cache: TerrainTileCache, lat0: number, lon0: number, halfSpanDeg: number, n: number): Float32Array | null {
  const out = new Float32Array(n * n);
  const cosLat = Math.max(0.05, Math.cos((lat0 * Math.PI) / 180));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const lat = Math.max(-90, Math.min(90, lat0 + ((j / (n - 1)) * 2 - 1) * halfSpanDeg));
      const lon = normalizeLon(lon0 + (((i / (n - 1)) * 2 - 1) * halfSpanDeg) / cosLat);
      const t = cache.peek(tileKeyFor(lat, lon));
      if (!t) return null;
      out[j * n + i] = sampleTile(t, lat, lon);
    }
  }
  return out;
}

/** Tiles required for sampleGrid (handles antimeridian and pole clamping). */
export function tilesForSpan(lat0: number, lon0: number, halfSpanDeg: number): TileKey[] {
  const keys = new Map<string, TileKey>();
  const cosLat = Math.max(0.05, Math.cos((lat0 * Math.PI) / 180));
  for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) {
    const lat = Math.max(-90, Math.min(90, lat0 + ((j / 8) * 2 - 1) * halfSpanDeg));
    const lon = normalizeLon(lon0 + (((i / 8) * 2 - 1) * halfSpanDeg) / cosLat);
    const k = tileKeyFor(lat, lon);
    keys.set(tileId(k), k);
  }
  return [...keys.values()];
}
