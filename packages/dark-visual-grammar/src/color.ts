// Chromastratum color science reference math. [K] throughout:
//  - sRGB transfer function, IEC 61966-2-1 (piecewise, NOT gamma 2.2)
//  - linear sRGB ↔ CIE XYZ (D65), CIE 1976 L*a*b*, CIEDE2000
//  - OKLab / OKLCH (Björn Ottosson 2020; W3C CSS Color Level 4 matrices)
//  - WCAG 2.2 relative luminance and contrast ratio
// Physics (lighting, BRDF, blending) happens in scene-linear sRGB; OKLCH is the
// perceptual DESIGN space only. Never compute irradiance in OKLCH.

export type RGB = [number, number, number];

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function linearToSrgb(l: number): number {
  return l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055;
}
export const decodeSrgb = (c: RGB): RGB => [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
export const encodeSrgb = (c: RGB): RGB => [linearToSrgb(c[0]), linearToSrgb(c[1]), linearToSrgb(c[2])];

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`bad hex ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function rgbToHex(c: RGB): string {
  return '#' + c.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('');
}

// Linear sRGB → XYZ (D65), IEC 61966-2-1 / CSS Color 4.
const M_RGB_XYZ = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const M_XYZ_RGB = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const mul = (m: number[][], v: RGB): RGB => [
  m[0]![0]! * v[0] + m[0]![1]! * v[1] + m[0]![2]! * v[2],
  m[1]![0]! * v[0] + m[1]![1]! * v[1] + m[1]![2]! * v[2],
  m[2]![0]! * v[0] + m[2]![1]! * v[1] + m[2]![2]! * v[2],
];
export const linearToXyz = (c: RGB): RGB => mul(M_RGB_XYZ, c);
export const xyzToLinear = (c: RGB): RGB => mul(M_XYZ_RGB, c);

const D65: RGB = [0.95047, 1.0, 1.08883];
export function xyzToLab(c: RGB): RGB {
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(c[0] / D65[0]), fy = f(c[1] / D65[1]), fz = f(c[2] / D65[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 colour difference (Sharma, Wu, Dalal 2005). */
export function deltaE2000(l1: RGB, l2: RGB): number {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
  const D = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (b: number, a: number) => { const x = Math.atan2(b, a) / D; return x < 0 ? x + 360 : x; };
  const h1p = h(b1, a1p), h2p = h(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = C1p * C2p === 0 ? 0 : h2p - h1p;
  if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * D);
  const Lpm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2;
  let hpm = h1p + h2p;
  if (C1p * C2p !== 0) hpm = Math.abs(h1p - h2p) > 180 ? (h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2) : (h1p + h2p) / 2;
  const T = 1 - 0.17 * Math.cos((hpm - 30) * D) + 0.24 * Math.cos(2 * hpm * D) + 0.32 * Math.cos((3 * hpm + 6) * D) - 0.2 * Math.cos((4 * hpm - 63) * D);
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2), Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTheta * D) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

// OKLab (Ottosson 2020) from LINEAR sRGB.
export function linearToOklab(c: RGB): RGB {
  const l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
  const m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
  const s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function oklabToLinear(c: RGB): RGB {
  const l = (c[0] + 0.3963377774 * c[1] + 0.2158037573 * c[2]) ** 3;
  const m = (c[0] - 0.1055613458 * c[1] - 0.0638541728 * c[2]) ** 3;
  const s = (c[0] - 0.0894841775 * c[1] - 1.291485548 * c[2]) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

export interface OKLCH { l: number; c: number; h: number }
export function linearToOklch(c: RGB): OKLCH {
  const [L, a, b] = linearToOklab(c);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { l: L, c: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
}
export function oklchToLinear(o: OKLCH): RGB {
  const r = (o.h * Math.PI) / 180;
  return oklabToLinear([o.l, o.c * Math.cos(r), o.c * Math.sin(r)]);
}

export const inGamut = (c: RGB, eps = 1e-6) => c.every((x) => x >= -eps && x <= 1 + eps);

export interface GamutResult { linear: RGB; clipped: boolean; chromaReducedFrom?: number; method: 'in-gamut' | 'oklch-chroma-bisection' }

/** CSS Color 4–style gamut mapping: reduce OKLCH chroma at fixed L,h until in sRGB gamut. */
export function oklchToSrgbGamut(o: OKLCH): GamutResult {
  const direct = oklchToLinear(o);
  if (inGamut(direct)) return { linear: direct, clipped: false, method: 'in-gamut' };
  let lo = 0, hi = o.c;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (inGamut(oklchToLinear({ ...o, c: mid }))) lo = mid; else hi = mid; }
  const lin = oklchToLinear({ ...o, c: lo }).map((x) => Math.min(1, Math.max(0, x))) as RGB;
  return { linear: lin, clipped: true, chromaReducedFrom: o.c, method: 'oklch-chroma-bisection' };
}

/** WCAG 2.2 relative luminance of an sRGB-encoded colour. */
export function relativeLuminance(srgb: RGB): number {
  const [r, g, b] = decodeSrgb(srgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
export const WCAG = { textAA: 4.5, largeTextAA: 3, nonTextAA: 3 } as const;

/** Colour witness recorded with a screenshot sample. */
export interface ColorWitness {
  sampleId: string;
  sceneLinear: RGB;
  displayEncoded: RGB;
  exposure: number;
  transfer: 'srgb-iec61966-2-1';
  toneMapping: 'AgX' | 'ACESFilmic' | 'Neutral' | 'none';
  gamut: 'srgb';
  whitePoint: 'D65';
  pixel?: [number, number];
  imageHash?: string;
}
