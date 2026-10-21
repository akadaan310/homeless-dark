// WGS84 geodesy in double precision: geodetic <-> ECEF <-> local ENU.
// [K] Established: WGS84 defining constants (NIMA TR8350.2), closed-form ECEF,
// Bowring-seeded iterative inverse, ENU rotation. Distances use Vincenty's
// inverse formula on the ellipsoid with a spherical fallback near antipodes.

export const WGS84 = {
  a: 6378137.0,
  f: 1 / 298.257223563,
  get b() { return this.a * (1 - this.f); },
  get e2() { return this.f * (2 - this.f); },
} as const;

export interface Geodetic { lat: number; lon: number; h: number }
export type Vec3 = [number, number, number];

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Normalize longitude to [-180, 180). */
export function normalizeLon(lon: number): number {
  const x = ((((lon + 180) % 360) + 360) % 360) - 180;
  return x === 180 ? -180 : x;
}

export function validGeodetic(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

export function geodeticToEcef(lat: number, lon: number, h = 0): Vec3 {
  const la = lat * D2R, lo = lon * D2R;
  const s = Math.sin(la), c = Math.cos(la);
  const n = WGS84.a / Math.sqrt(1 - WGS84.e2 * s * s);
  return [(n + h) * c * Math.cos(lo), (n + h) * c * Math.sin(lo), (n * (1 - WGS84.e2) + h) * s];
}

export function ecefToGeodetic(x: number, y: number, z: number): Geodetic {
  const { a, e2 } = WGS84;
  const b = WGS84.b;
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x) * R2D;
  if (p < 1e-9) {
    // On the polar axis.
    const lat = z >= 0 ? 90 : -90;
    return { lat, lon: 0, h: Math.abs(z) - b };
  }
  const ep2 = (a * a - b * b) / (b * b);
  // Bowring seed, then Newton-style refinement (converges to < 1e-12 rad in 2-3 steps).
  let th = Math.atan2(z * a, p * b);
  let lat = Math.atan2(z + ep2 * b * Math.sin(th) ** 3, p - e2 * a * Math.cos(th) ** 3);
  for (let i = 0; i < 4; i++) {
    const s = Math.sin(lat);
    const n = a / Math.sqrt(1 - e2 * s * s);
    const h = p / Math.cos(lat) - n;
    const next = Math.atan2(z, p * (1 - (e2 * n) / (n + h)));
    if (Math.abs(next - lat) < 1e-14) { lat = next; break; }
    lat = next;
  }
  const s = Math.sin(lat);
  const n = a / Math.sqrt(1 - e2 * s * s);
  const h = Math.abs(lat) < (89.9 * D2R) ? p / Math.cos(lat) - n : Math.abs(z) / Math.abs(s) - n * (1 - e2);
  return { lat: lat * R2D, lon, h };
}

/** Rotation rows (east, north, up) at a geodetic origin. */
function enuBasis(lat: number, lon: number): [Vec3, Vec3, Vec3] {
  const la = lat * D2R, lo = lon * D2R;
  const sl = Math.sin(la), cl = Math.cos(la), so = Math.sin(lo), co = Math.cos(lo);
  return [[-so, co, 0], [-sl * co, -sl * so, cl], [cl * co, cl * so, sl]];
}

export function ecefToEnu(p: Vec3, origin: Geodetic): Vec3 {
  const o = geodeticToEcef(origin.lat, origin.lon, origin.h);
  const d: Vec3 = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  const [e, n, u] = enuBasis(origin.lat, origin.lon);
  return [e[0] * d[0] + e[1] * d[1] + e[2] * d[2], n[0] * d[0] + n[1] * d[1] + n[2] * d[2], u[0] * d[0] + u[1] * d[1] + u[2] * d[2]];
}

export function enuToEcef(v: Vec3, origin: Geodetic): Vec3 {
  const o = geodeticToEcef(origin.lat, origin.lon, origin.h);
  const [e, n, u] = enuBasis(origin.lat, origin.lon);
  return [
    o[0] + e[0] * v[0] + n[0] * v[1] + u[0] * v[2],
    o[1] + e[1] * v[0] + n[1] * v[1] + u[1] * v[2],
    o[2] + e[2] * v[0] + n[2] * v[1] + u[2] * v[2],
  ];
}

export function geodeticToEnu(g: Geodetic, origin: Geodetic): Vec3 {
  return ecefToEnu(geodeticToEcef(g.lat, g.lon, g.h), origin);
}

export function enuToGeodetic(v: Vec3, origin: Geodetic): Geodetic {
  const p = enuToEcef(v, origin);
  return ecefToGeodetic(p[0], p[1], p[2]);
}

/** Mean Earth radius (IUGG) for spherical approximations. */
export const MEAN_RADIUS = 6371008.8;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dla = (lat2 - lat1) * D2R, dlo = (lon2 - lon1) * D2R;
  const s = Math.sin(dla / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dlo / 2) ** 2;
  return 2 * MEAN_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Vincenty inverse on the WGS84 ellipsoid (metres). Falls back to haversine if it fails to converge (near-antipodal). */
export function geodesicDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const { a, f } = WGS84;
  const b = WGS84.b;
  const L = normalizeLon(lon2 - lon1) * D2R;
  const U1 = Math.atan((1 - f) * Math.tan(lat1 * D2R));
  const U2 = Math.atan((1 - f) * Math.tan(lat2 * D2R));
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
  let lambda = L;
  for (let i = 0; i < 200; i++) {
    const sl = Math.sin(lambda), cl = Math.cos(lambda);
    const sSigma = Math.sqrt((cU2 * sl) ** 2 + (cU1 * sU2 - sU1 * cU2 * cl) ** 2);
    if (sSigma === 0) return 0;
    const cSigma = sU1 * sU2 + cU1 * cU2 * cl;
    const sigma = Math.atan2(sSigma, cSigma);
    const sAlpha = (cU1 * cU2 * sl) / sSigma;
    const c2Alpha = 1 - sAlpha * sAlpha;
    const c2SigmaM = c2Alpha !== 0 ? cSigma - (2 * sU1 * sU2) / c2Alpha : 0;
    const C = (f / 16) * c2Alpha * (4 + f * (4 - 3 * c2Alpha));
    const prev = lambda;
    lambda = L + (1 - C) * f * sAlpha * (sigma + C * sSigma * (c2SigmaM + C * cSigma * (-1 + 2 * c2SigmaM * c2SigmaM)));
    if (Math.abs(lambda - prev) < 1e-12) {
      const u2 = (c2Alpha * (a * a - b * b)) / (b * b);
      const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
      const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
      const dSigma = B * sSigma * (c2SigmaM + (B / 4) * (cSigma * (-1 + 2 * c2SigmaM * c2SigmaM) - (B / 6) * c2SigmaM * (-3 + 4 * sSigma * sSigma) * (-3 + 4 * c2SigmaM * c2SigmaM)));
      return b * A * (sigma - dSigma);
    }
  }
  return haversine(lat1, lon1, lat2, lon2);
}

export function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Point at fraction t along the great circle (spherical slerp); correct across the antimeridian. */
export function intermediatePoint(lat1: number, lon1: number, lat2: number, lon2: number, t: number): { lat: number; lon: number } {
  const p1 = lat1 * D2R, l1 = lon1 * D2R, p2 = lat2 * D2R, l2 = lon2 * D2R;
  const d = haversine(lat1, lon1, lat2, lon2) / MEAN_RADIUS;
  if (d < 1e-12) return { lat: lat1, lon: lon1 };
  const A = Math.sin((1 - t) * d) / Math.sin(d), B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) * R2D, lon: normalizeLon(Math.atan2(y, x) * R2D) };
}
