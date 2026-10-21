// Division II adapters: FacadeGrammar, DistrictPaletteGrammar, StreetFurnitureGrammar.
// [C] DARK construction using Plicastratum folds (Re-Pair, [K]) for program
// signatures and promotion, and the university interval orbit ⟨k⟩ ⊆ ℤ/12 ([K]
// group theory) to cycle district hues. Output is a scene PROGRAM (tokens and
// parameters) referencing licensed PBR material sets; it invents no asset.

import { foldAll, startFold, unfoldAll, grammarSize, mulberry32, fnv1a, fingerprint } from '@dark/core';
import { oklchToSrgbGamut, encodeSrgb, type RGB } from '@dark/visual-grammar';
import { orbit } from './music';

export type MaterialSet = 'stucco' | 'plaster' | 'bricks' | 'concrete';
export type BayToken = 'plinth' | 'shopfront' | 'door' | 'awning' | 'sign' | 'window' | 'balcony' | 'blank' | 'cornice';

export interface DistrictPalette { districtId: string; k: number; hues: number[]; wall: RGB; trim: RGB; accent: RGB; awning: RGB; gamutClipped: boolean }

/** Palette from the interval orbit of k starting at the district index. Colours are linear sRGB. */
export function districtPalette(districtId: string, k = 7): DistrictPalette {
  const seed = fnv1a(districtId);
  const start = seed % 12;
  const hues = orbit(start, k).map((p) => (p * 30 + (seed % 17)) % 360);
  let clipped = false;
  const mk = (l: number, c: number, h: number) => { const r = oklchToSrgbGamut({ l, c, h }); clipped ||= r.clipped; return r.linear; };
  return {
    districtId, k, hues,
    wall: mk(0.86, 0.035, hues[0]!), trim: mk(0.95, 0.012, hues[1]!), accent: mk(0.58, 0.13, hues[2]!), awning: mk(0.5, 0.11, hues[3 % hues.length]!), gamutClipped: clipped,
  };
}

export const paletteHex = (c: RGB) => '#' + encodeSrgb(c).map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('');

export interface FacadeInput { buildingId: string; districtId: string; frontageM: number; heightM: number; ground: 'commercial' | 'residential'; seed?: number }

export interface FacadeProgram {
  buildingId: string;
  material: MaterialSet;
  floors: number;
  bayWidth: number;
  groundBays: BayToken[];
  upperBays: BayToken[];
  tokens: string[]; // full word for folding
  palette: DistrictPalette;
  signature: string;
  grammarSize: number;
  unfoldOk: boolean;
  source: 'author-composed on OSM footprint';
}

const MATERIALS: MaterialSet[] = ['stucco', 'plaster', 'bricks', 'concrete'];

/** Exact size constraints: bays 3.2–4.8 m, floors 3.0–3.6 m, shopfront only at ground. */
export function composeFacade(input: FacadeInput): FacadeProgram {
  const rnd = mulberry32(input.seed ?? fnv1a(input.buildingId));
  const floorH = 3.0 + rnd() * 0.6;
  const floors = Math.max(1, Math.min(12, Math.round(input.heightM / floorH)));
  const nBays = Math.max(1, Math.round(input.frontageM / (3.2 + rnd() * 1.6)));
  const bayWidth = input.frontageM / nBays;
  const material = MATERIALS[(fnv1a(input.districtId) + Math.floor(rnd() * 3)) % MATERIALS.length]!;
  const groundBays: BayToken[] = [];
  const doorAt = Math.floor(rnd() * nBays);
  for (let i = 0; i < nBays; i++) {
    if (input.ground === 'commercial') groundBays.push(i === doorAt ? 'door' : rnd() < 0.8 ? 'shopfront' : 'blank');
    else groundBays.push(i === doorAt ? 'door' : rnd() < 0.7 ? 'window' : 'blank');
  }
  const upperBays: BayToken[] = Array.from({ length: nBays }, () => (rnd() < 0.82 ? 'window' : rnd() < 0.5 ? 'balcony' : 'blank'));
  const tokens: string[] = ['plinth', ...groundBays.flatMap((b) => (b === 'shopfront' ? ['awning', 'sign', 'shopfront'] : [b]))];
  for (let f = 1; f < floors; f++) tokens.push('|', ...upperBays);
  tokens.push('cornice');
  const f = foldAll(startFold(tokens), 2);
  return {
    buildingId: input.buildingId, material, floors, bayWidth, groundBays, upperBays, tokens, palette: districtPalette(input.districtId),
    signature: fingerprint(tokens.join(' ') + material), grammarSize: grammarSize(f), unfoldOk: unfoldAll(f).join(' ') === tokens.join(' '),
    source: 'author-composed on OSM footprint',
  };
}

/** Diversity measure for a district: unique programs / total, and mean compression. */
export function diversity(programs: FacadeProgram[]): { unique: number; total: number; ratio: number; meanCompression: number } {
  const unique = new Set(programs.map((p) => p.signature)).size;
  const meanCompression = programs.reduce((a, p) => a + p.grammarSize / p.tokens.length, 0) / Math.max(1, programs.length);
  return { unique, total: programs.length, ratio: unique / Math.max(1, programs.length), meanCompression };
}

// ---------------------------------------------------------------- street furniture
export type FurnitureKind = 'streetlight' | 'palm' | 'bench' | 'bollard' | 'sign_post' | 'bin';
export interface FurnitureItem { kind: FurnitureKind; t: number; side: -1 | 1; offset: number }

/** Along a road polyline of length L: streetlights every 28–34 m alternating sides, palms between, benches near doors. */
export function furnishStreet(lengthM: number, seed: number, cls: string): FurnitureItem[] {
  const rnd = mulberry32(seed);
  const out: FurnitureItem[] = [];
  if (cls === 'footway' || cls === 'path' || lengthM < 12) return out;
  const spacing = 28 + rnd() * 6;
  let side: -1 | 1 = 1;
  for (let s = 6 + rnd() * 6; s < lengthM - 4; s += spacing) {
    out.push({ kind: 'streetlight', t: s / lengthM, side, offset: 0.6 });
    if (cls !== 'motorway' && cls !== 'motorway_link' && rnd() < 0.7 && s + spacing / 2 < lengthM) out.push({ kind: 'palm', t: (s + spacing / 2) / lengthM, side: (side * -1) as -1 | 1, offset: 1.4 });
    if (rnd() < 0.15) out.push({ kind: 'bench', t: (s + 3) / lengthM, side, offset: 1.6 });
    side = (side * -1) as -1 | 1;
  }
  return out;
}
