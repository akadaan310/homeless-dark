// BILLBOARDSTRATUM: signs as world entities with a typed layout grammar.
// [K] angular size / visual acuity (20/20 ≈ 5 arcmin per letter height),
//     WCAG 2.3.1 three-flashes threshold.
// [C] SignGrammar classes, layout fit heuristics, legibility objective.

export type SignClass = 'traffic_sign' | 'building_name' | 'shopfront' | 'transit_departures' | 'flight_board' | 'digital_ad' | 'wayfinding' | 'museum' | 'artist_mural' | 'diegetic_interface';

export interface SignEntity {
  entityId: string;
  class: SignClass;
  text: string;
  language: string; // BCP-47
  script: 'Latn' | 'Cyrl' | 'Grek' | 'Hani' | 'Jpan' | 'Hang' | 'Deva';
  fontLicense: string;
  owner: string;
  fictional: boolean;
  bounds: { width: number; height: number }; // metres
  preferredReadDistance: number; // metres
  emission: { hue: number; chroma: number; lightness: number; brightness: number };
  schedule?: { onHour: number; offHour: number };
  pulseHz: number;
  revision: number;
}

export interface LayoutResult {
  lines: string[];
  fontSize: number; // metres (cap-to-baseline approximated as em)
  overflow: boolean;
  legibleAt: number; // metres at which the letter height subtends 5 arcmin ×3 (comfortable reading)
  warnings: string[];
}

/** Average advance of Latin glyphs ≈ 0.55 em; CJK ≈ 1.0 em. */
const ADVANCE: Record<SignEntity['script'], number> = { Latn: 0.56, Cyrl: 0.58, Grek: 0.58, Hani: 1, Jpan: 1, Hang: 1, Deva: 0.62 };

export function layoutSign(text: string, bounds: { width: number; height: number }, script: SignEntity['script'] = 'Latn', margin = 0.08, maxLines = 3): LayoutResult {
  const w = bounds.width * (1 - 2 * margin), h = bounds.height * (1 - 2 * margin);
  const adv = ADVANCE[script];
  const words = script === 'Hani' || script === 'Jpan' ? [...text] : text.split(/\s+/).filter(Boolean);
  const warnings: string[] = [];
  let best: LayoutResult | null = null;
  for (let n = 1; n <= maxLines; n++) {
    const lines = wrap(words, n, script === 'Hani' || script === 'Jpan' ? '' : ' ');
    const longest = Math.max(...lines.map((l) => [...l].length));
    const byWidth = w / Math.max(1, longest * adv);
    const byHeight = h / (n * 1.25);
    const size = Math.min(byWidth, byHeight);
    if (!best || size > best.fontSize) best = { lines, fontSize: size, overflow: false, legibleAt: 0, warnings: [] };
  }
  const r = best!;
  const minSize = 0.04;
  if (r.fontSize < minSize) { r.overflow = true; warnings.push(`font ${r.fontSize.toFixed(3)} m below minimum ${minSize} m`); }
  if (text.normalize('NFC') !== text) warnings.push('text not NFC-normalized (combining marks)');
  // Letter height subtending 15 arcmin (3× acuity limit) → comfortable reading distance.
  r.legibleAt = (r.fontSize * 0.7) / Math.tan(((15 / 60) * Math.PI) / 180);
  r.warnings = warnings;
  return r;
}

function wrap(words: string[], lines: number, sep: string): string[] {
  if (lines <= 1 || words.length <= 1) return [words.join(sep)];
  const total = words.join(sep).length;
  const target = total / lines;
  const out: string[] = [];
  let cur: string[] = [];
  for (const wd of words) {
    if (cur.length && (cur.join(sep) + sep + wd).length > target * 1.15 && out.length < lines - 1) { out.push(cur.join(sep)); cur = []; }
    cur.push(wd);
  }
  if (cur.length) out.push(cur.join(sep));
  return out;
}

/** WCAG 2.3.1: no more than three flashes in any one-second period; DARK limits sign pulses to ≤ 1 Hz. */
export function flashSafe(pulseHz: number, reducedMotion: boolean): { ok: boolean; effectiveHz: number; reason: string } {
  if (reducedMotion) return { ok: true, effectiveHz: 0, reason: 'reduced-motion: pulsing disabled' };
  if (pulseHz > 3) return { ok: false, effectiveHz: 0, reason: 'exceeds WCAG 2.3.1 three flashes per second' };
  if (pulseHz > 1) return { ok: true, effectiveHz: 1, reason: 'clamped to DARK comfort ceiling 1 Hz' };
  return { ok: true, effectiveHz: pulseHz, reason: 'within comfort ceiling' };
}

/** Angular letter height (arcmin) from a viewer at distance d and incidence angle θ to the sign normal. */
export function angularLetterHeight(fontSizeM: number, distanceM: number, incidenceDeg = 0): number {
  const h = fontSizeM * 0.7 * Math.cos((incidenceDeg * Math.PI) / 180);
  return ((2 * Math.atan(h / 2 / Math.max(0.01, distanceM))) * 180 * 60) / Math.PI;
}

export function signOn(s: SignEntity, hour: number): boolean {
  if (!s.schedule) return true;
  const { onHour, offHour } = s.schedule;
  return onHour <= offHour ? hour >= onHour && hour < offHour : hour >= onHour || hour < offHour;
}

// ---------------------------------------------------------------- departures board
export interface BoardRow { time: string; flight: string; destination: string; gate: string; status: string }

/** Fixed-width rows for a flight board; truncates destinations deterministically, never overflows. */
export function formatBoard(rows: BoardRow[], columns = { dest: 14 }): string[] {
  return rows.map((r) => `${r.time.padEnd(6)}${r.flight.padEnd(8)}${truncate(r.destination, columns.dest).padEnd(columns.dest + 1)}${r.gate.padEnd(4)}${r.status}`);
}
function truncate(s: string, n: number) { return [...s].length <= n ? s : [...s].slice(0, n - 1).join('') + '…'; }
