// Global Earth services for the browser: Natural Earth land/country rasters (0.1°),
// GEBCO 2025 terrain tiles streamed through TerrainTileCache, and the cell resolver.
// Rasters stay as ImageBitmaps; pixels are read per region on demand (mobile memory).
import { TerrainTileCache, tileKeyFor, sampleTile, resolveCell, normalizeLon, type GlobalRasters, type DetailedRegion, type TileKey, type WorldCellManifest } from '@dark/geo';
import { parseAirports, type AirportRecord } from '@dark/travel';
import { url, loadJSON } from './assets';

const W = 3600, H = 1800;

export class Globe implements GlobalRasters {
  private land: ImageBitmap | null = null;
  private countries: ImageBitmap | null = null;
  private names: Record<string, { name: string; iso: string }> = {};
  private ctx: OffscreenCanvasRenderingContext2D;
  private patch: { x0: number; y0: number; w: number; h: number; land: Uint8ClampedArray; ctry: Uint8ClampedArray } | null = null;
  readonly terrain: TerrainTileCache;
  airports: AirportRecord[] = [];
  readonly detailed: DetailedRegion[] = [{ id: 'osm-tampa-dale-mabry-spruce', lat: 27.9594638, lon: -82.5054865, radiusM: 900, source: 'OpenStreetMap fixture (data/geography/tampa-dale-mabry-spruce.geojson)', license: 'ODbL-1.0' }];
  private ready: Promise<void> | null = null;

  constructor() {
    const c = new OffscreenCanvas(64, 64);
    this.ctx = c.getContext('2d', { willReadFrequently: true })!;
    this.terrain = new TerrainTileCache(async (k: TileKey, signal) => {
      const r = await fetch(url(`data/terrain/${k.south}_${k.west}.i16`), { signal });
      if (!r.ok) throw new Error(`terrain ${k.south}_${k.west}: HTTP ${r.status}`);
      return r.arrayBuffer();
    }, { maxBytes: 3 * 101 * 101 * 2 * 12, maxConcurrent: 3 });
  }

  load(): Promise<void> {
    this.ready ??= (async () => {
      const bmp = async (p: string) => createImageBitmap(await (await fetch(url(p))).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const [land, countries, names, airports] = await Promise.all([bmp('data/landmask.png'), bmp('data/countries.png'), loadJSON<Record<string, { name: string; iso: string }>>('data/countries.json'), loadJSON<{ airports: (string | number | null)[][] }>('data/airports.json')]);
      this.land = land; this.countries = countries; this.names = names; this.airports = parseAirports(airports);
    })();
    return this.ready;
  }

  /** Extract raster pixels around a coordinate so per-vertex lookups are cheap. */
  preparePatch(lat: number, lon: number, halfDeg: number) {
    if (!this.land || !this.countries) return;
    const [cx, cy] = px(lat, lon);
    const r = Math.ceil(halfDeg * 10) + 2;
    const x0 = Math.max(0, cx - r), y0 = Math.max(0, cy - r), w = Math.min(W - x0, 2 * r + 1), h = Math.min(H - y0, 2 * r + 1);
    const canvas = this.ctx.canvas;
    if (canvas.width < w || canvas.height < h) { canvas.width = Math.max(canvas.width, w); canvas.height = Math.max(canvas.height, h); }
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.drawImage(this.land, x0, y0, w, h, 0, 0, w, h);
    const land = this.ctx.getImageData(0, 0, w, h).data;
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.drawImage(this.countries, x0, y0, w, h, 0, 0, w, h);
    const ctry = this.ctx.getImageData(0, 0, w, h).data;
    this.patch = { x0, y0, w, h, land, ctry };
  }

  private pixel(lat: number, lon: number): { land: number; ctry: number } | null {
    const [x, y] = px(lat, lon);
    const p = this.patch;
    if (p && x >= p.x0 && x < p.x0 + p.w && y >= p.y0 && y < p.y0 + p.h) {
      const i = ((y - p.y0) * p.w + (x - p.x0)) * 4;
      return { land: p.land[i]!, ctry: p.ctry[i]! * 256 + p.ctry[i + 1]! };
    }
    if (!this.land || !this.countries) return null;
    this.ctx.clearRect(0, 0, 1, 1); this.ctx.drawImage(this.land, x, y, 1, 1, 0, 0, 1, 1);
    const l = this.ctx.getImageData(0, 0, 1, 1).data[0]!;
    this.ctx.clearRect(0, 0, 1, 1); this.ctx.drawImage(this.countries, x, y, 1, 1, 0, 0, 1, 1);
    const c = this.ctx.getImageData(0, 0, 1, 1).data;
    return { land: l, ctry: c[0]! * 256 + c[1]! };
  }

  isLand(lat: number, lon: number): boolean | null { const p = this.pixel(lat, lon); return p ? p.land > 127 : null; }
  country(lat: number, lon: number): string | null { const p = this.pixel(lat, lon); return p && p.ctry ? this.names[String(p.ctry)]?.name ?? null : null; }
  height(lat: number, lon: number): number | null { const t = this.terrain.peek(tileKeyFor(lat, lon)); return t ? sampleTile(t, lat, lon) : null; }

  async resolve(lat: number, lon: number): Promise<WorldCellManifest> {
    await this.load();
    await this.terrain.request(tileKeyFor(lat, lon));
    this.preparePatch(lat, lon, 0.3);
    return resolveCell(lat, normalizeLon(lon), this, this.detailed);
  }
}

function px(lat: number, lon: number): [number, number] {
  const x = Math.min(W - 1, Math.max(0, Math.floor((normalizeLon(lon) + 180) * 10)));
  const y = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) * 10)));
  return [x, y];
}

export const globe = new Globe();
