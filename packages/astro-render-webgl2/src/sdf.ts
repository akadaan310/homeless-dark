// Signed distance field from a coverage bitmap (§050 text): exact squared Euclidean
// distance transform in two 1-D passes (lower envelope of parabolas, Felzenszwalb &
// Huttenlocher 2012), implemented for this repository. Pure: no DOM.

const INF = 1e20;

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) { k--; s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1]! < q) k++; d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!; }
}

/** Squared distance to the nearest `true` cell for every cell of a w×h grid. */
export function edt2d(inside: (i: number) => boolean, w: number, h: number): Float64Array {
  const g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = inside(i) ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x]!;
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y]!;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x]!;
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x]!;
  }
  return g;
}

/**
 * Coverage (0..255 alpha) → 8-bit SDF: 128 = edge, >128 inside. `spread` px maps to the
 * full ±127 range. Uses sub-pixel edge offsets from coverage for smoother contours.
 */
export function alphaToSdf(alpha: Uint8ClampedArray | Uint8Array, w: number, h: number, spread: number): Uint8Array {
  const outside = edt2d((i) => alpha[i]! > 127, w, h);
  const insideD = edt2d((i) => alpha[i]! <= 127, w, h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = alpha[i]! / 255;
    const sd = Math.sqrt(insideD[i]!) - Math.sqrt(outside[i]!) + (a - 0.5) * (outside[i]! === 0 && insideD[i]! <= 1 ? 1 : 0);
    out[i] = Math.max(0, Math.min(255, Math.round(128 + (sd / spread) * 127)));
  }
  return out;
}
