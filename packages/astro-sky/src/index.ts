// ASTRO celestial sphere (§073–§080, §125). [K] HEALPix ring scheme (Górski et al. 2005),
// IAU 1982 GMST, NOAA/Meeus solar coordinates, WGS84 ellipsoid normals.
// Catalogue stars are OBSERVED (Hipparcos via d3-celestial, BSD-3); synthetic fill stars are
// SIMULATION; the plasmic shell is a STYLISTIC visualization. Gaia DR3 is NOT ingested.
import hip from '../../../data/sky/hipparcos-mag5-d3celestial.json';

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// ---------------------------------------------------------------- catalogue
export type StarStatus = 'observed' | 'simulation';
export interface CatalogStar { id: string; raDeg: number; decDeg: number; mag: number; bv: number; status: StarStatus; source: string; epoch: 'J2000'; uncertainty: string }

export const CATALOG_SOURCE = (hip as { source: string }).source;
export function hipparcosStars(): CatalogStar[] {
  return (hip as unknown as { stars: [number, number, number, number, number][] }).stars.map(([h, ra, dec, mag, bv]) => ({
    id: `HIP ${h}`, raDeg: ra, decDeg: dec, mag, bv, status: 'observed', source: CATALOG_SOURCE, epoch: 'J2000', uncertainty: 'Hipparcos astrometry (~mas); proper motion since J2000 not applied (< 0.1° for these stars)',
  }));
}

/** Parametric fill population for faint sky texture: explicitly SIMULATION, never presented as measured stars. */
export function syntheticStars(n: number, seed = 11): CatalogStar[] {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, (_, i) => {
    const z = rnd() * 2 - 1, ph = rnd() * 2 * Math.PI;
    return { id: `SYN ${i}`, raDeg: ph * R2D, decDeg: Math.asin(z) * R2D, mag: 5 + rnd() * 2.5, bv: rnd() * 1.6 - 0.2, status: 'simulation' as const, source: 'ASTRO synthetic isotropic population (seeded)', epoch: 'J2000' as const, uncertainty: 'not a real star' };
  });
}

export const GAIA_DR3 = { catalogue: 'Gaia DR3', sources: 1_811_709_771, ingested: 0, status: 'BLOCKED' as const, reason: 'not downloaded: ~TB-scale archive; would require partitioned HEALPix tile streaming with per-tile licence/terms record (ESA Gaia, CC BY-SA 3.0 IGO)', nakedEyeNote: 'catalogue scale ≠ naked-eye visibility (~9,000 stars to V≈6.5)' };

// ---------------------------------------------------------------- HEALPix (ring scheme)
export const npix = (nside: number) => 12 * nside * nside;
/** θ = colatitude [0, π], φ = longitude [0, 2π). */
export function ang2pixRing(nside: number, theta: number, phi: number): number {
  const z = Math.cos(theta), za = Math.abs(z);
  let ph = phi % (2 * Math.PI); if (ph < 0) ph += 2 * Math.PI;
  const tt = ph / (Math.PI / 2);
  if (za <= 2 / 3) {
    const t1 = nside * (0.5 + tt), t2 = nside * z * 0.75;
    const jp = Math.floor(t1 - t2), jm = Math.floor(t1 + t2);
    const ir = nside + 1 + jp - jm;
    const kshift = 1 - (ir & 1);
    let ip = Math.floor((jp + jm - nside + kshift + 1) / 2);
    ip = ((ip % (4 * nside)) + 4 * nside) % (4 * nside);
    return 2 * nside * (nside - 1) + 4 * nside * (ir - 1) + ip;
  }
  const tp = tt - Math.floor(tt), tmp = nside * Math.sqrt(3 * (1 - za));
  const jp = Math.floor(tp * tmp), jm = Math.floor((1 - tp) * tmp);
  const ir = jp + jm + 1;
  let ip = Math.floor(tt * ir);
  ip = ((ip % (4 * ir)) + 4 * ir) % (4 * ir);
  return z > 0 ? 2 * ir * (ir - 1) + ip : npix(nside) - 2 * ir * (ir + 1) + ip;
}
export const raDecToPix = (nside: number, raDeg: number, decDeg: number) => ang2pixRing(nside, (90 - decDeg) * D2R, raDeg * D2R);

/** Tiled sky index with bounded streaming: cells are fetched lazily and evicted LRU under a byte cap. */
export class SkyIndex {
  private cells = new Map<number, CatalogStar[]>();
  constructor(readonly nside: number, stars: CatalogStar[]) { for (const s of stars) { const p = raDecToPix(nside, s.raDeg, s.decDeg); (this.cells.get(p) ?? this.cells.set(p, []).get(p)!).push(s); } }
  cell(p: number) { return this.cells.get(p) ?? []; }
  get populated() { return this.cells.size; }
  query(raDeg: number, decDeg: number, radiusDeg: number, magLimit = 99): CatalogStar[] {
    const out: CatalogStar[] = [];
    for (const list of this.cells.values()) for (const s of list) if (s.mag <= magLimit && angularSep(raDeg, decDeg, s.raDeg, s.decDeg) <= radiusDeg) out.push(s);
    return out;
  }
}

export function angularSep(ra1: number, de1: number, ra2: number, de2: number): number {
  const a = Math.sin(((de2 - de1) * D2R) / 2) ** 2 + Math.cos(de1 * D2R) * Math.cos(de2 * D2R) * Math.sin(((ra2 - ra1) * D2R) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) * R2D;
}

// ---------------------------------------------------------------- time and transforms
export const julianDay = (d: Date) => d.getTime() / 86400000 + 2440587.5;
/** Greenwich mean sidereal time (degrees), IAU 1982. */
export function gmstDeg(d: Date): number {
  const jd = julianDay(d), t = (jd - 2451545) / 36525;
  const g = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - (t * t * t) / 38710000;
  return ((g % 360) + 360) % 360;
}
export interface Horizontal { altDeg: number; azDeg: number; belowHorizon: boolean }
/** Equatorial (RA/Dec of date ≈ J2000; precession not applied — ≤0.4° error in 2026) → topocentric horizon. */
export function equatorialToHorizontal(raDeg: number, decDeg: number, latDeg: number, lonDeg: number, d: Date): Horizontal {
  const H = (gmstDeg(d) + lonDeg - raDeg) * D2R, de = decDeg * D2R, la = latDeg * D2R;
  const alt = Math.asin(Math.sin(la) * Math.sin(de) + Math.cos(la) * Math.cos(de) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(de) * Math.cos(la) - Math.sin(la) * Math.cos(H));
  return { altDeg: alt * R2D, azDeg: ((az * R2D) % 360 + 360) % 360, belowHorizon: alt < 0 };
}
/** Direction in local ENU from alt/az (x = east, y = north, z = up). */
export const enuFromAltAz = (altDeg: number, azDeg: number): [number, number, number] => {
  const a = altDeg * D2R, z = azDeg * D2R;
  return [Math.cos(a) * Math.sin(z), Math.cos(a) * Math.cos(z), Math.sin(a)];
};

/**
 * IAU 1976 precession (Meeus 21.2–21.4) between the mean equator of date and J2000.
 * The ASTRO series give coordinates of date; JPL Horizons astrometric references are ICRF/J2000,
 * so comparisons must precess (~0.36° over 26 years) rather than widen tolerances.
 */
export function precessToJ2000(raDeg: number, decDeg: number, d: Date): { raDeg: number; decDeg: number } {
  const t = (julianDay(d) - 2451545) / 36525, as = D2R / 3600;
  const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) * as;
  const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t ** 3) * as;
  const th = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) * as;
  // inverse rotation: R = Rz(-z)·Ry(θ)·Rz(-ζ) ⇒ R⁻¹ uses (ζ′, z′, θ′) = (−z, −ζ, −θ)
  const a = raDeg * D2R + -z, dl = decDeg * D2R, tp = -th;
  const A = Math.cos(dl) * Math.sin(a), B = Math.cos(tp) * Math.cos(dl) * Math.cos(a) - Math.sin(tp) * Math.sin(dl), C = Math.sin(tp) * Math.cos(dl) * Math.cos(a) + Math.cos(tp) * Math.sin(dl);
  const ra = (Math.atan2(A, B) - zeta) * R2D;
  return { raDeg: ((ra % 360) + 360) % 360, decDeg: Math.asin(C) * R2D };
}

/** Apparent geocentric solar RA/Dec (NOAA/Meeus). */
export function sunRaDec(d: Date): { raDeg: number; decDeg: number } {
  const t = (julianDay(d) - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const C = Math.sin(M * D2R) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * M * D2R) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * D2R) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * D2R);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega * D2R)) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda * D2R), Math.cos(lambda * D2R)) * R2D;
  return { raDeg: (ra + 360) % 360, decDeg: Math.asin(Math.sin(eps) * Math.sin(lambda * D2R)) * R2D };
}
/** Low-precision geocentric lunar RA/Dec (leading terms, Meeus ch. 47): ~0.3–1°. */
export function moonRaDec(d: Date): { raDeg: number; decDeg: number } {
  const dd = julianDay(d) - 2451545;
  const L = (218.316 + 13.176396 * dd) * D2R, M = (134.963 + 13.064993 * dd) * D2R, F = (93.272 + 13.22935 * dd) * D2R;
  const D = (297.85 + 12.190749 * dd) * D2R;
  const lambda = L + D2R * (6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D));
  const beta = D2R * (5.128 * Math.sin(F));
  const eps = 23.4397 * D2R;
  const ra = Math.atan2(Math.sin(lambda) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps), Math.cos(lambda));
  const dec = Math.asin(Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lambda));
  return { raDeg: ((ra * R2D) % 360 + 360) % 360, decDeg: dec * R2D };
}

// ---------------------------------------------------------------- Earth directions (§072–§074)
/** Outward WGS84 ellipsoid surface normal in ECEF at geodetic (lat, lon). */
export const ellipsoidNormal = (latDeg: number, lonDeg: number): [number, number, number] => {
  const la = latDeg * D2R, lo = lonDeg * D2R;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
};
export const antipode = (latDeg: number, lonDeg: number) => ({ lat: -latDeg, lon: lonDeg > 0 ? lonDeg - 180 : lonDeg + 180 });
/** Celestial direction of the local nadir (straight down through the Earth): RA = LST + 180°, Dec = −lat. */
export function nadirRaDec(latDeg: number, lonDeg: number, d: Date) { return { raDeg: ((gmstDeg(d) + lonDeg + 180) % 360 + 360) % 360, decDeg: -latDeg }; }

// ---------------------------------------------------------------- stylistic shell & links (§079, §080)
export interface ShellStyle { enabled: boolean; density: number; hue: number; status: 'stylistic visualization (not measured plasma)' }
export const defaultShell = (): ShellStyle => ({ enabled: false, density: 0.4, hue: 190, status: 'stylistic visualization (not measured plasma)' });
/** Shell rendering parameters never feed back into astrometry: positions are computed without it. */
export const starDirections = (stars: CatalogStar[], lat: number, lon: number, d: Date, _shell: ShellStyle) => stars.map((s) => ({ id: s.id, status: s.status, ...equatorialToHorizontal(s.raDeg, s.decDeg, lat, lon, d) }));

export interface StellarLink { a: string; b: string; rule: string; weight: number; provenance: string; physical: false }
/** Edges by an explicit rule: angular separation < θ among stars brighter than magLimit. Includes a chance baseline. */
export function angularLinks(stars: CatalogStar[], thetaDeg: number, magLimit: number, seed = 3): { links: StellarLink[]; chanceBaseline: number; excessOverChance: number } {
  const pick = stars.filter((s) => s.mag <= magLimit);
  const links: StellarLink[] = [];
  for (let i = 0; i < pick.length; i++) for (let j = i + 1; j < pick.length; j++) {
    const sep = angularSep(pick[i]!.raDeg, pick[i]!.decDeg, pick[j]!.raDeg, pick[j]!.decDeg);
    if (sep < thetaDeg) links.push({ a: pick[i]!.id, b: pick[j]!.id, rule: `angular separation < ${thetaDeg}° (mag ≤ ${magLimit})`, weight: 1 - sep / thetaDeg, provenance: 'ASTRO link grammar v1 over catalogue positions', physical: false });
  }
  // false-association control: same count of isotropic random points
  const rand = syntheticStars(pick.length, seed);
  let chance = 0;
  for (let i = 0; i < rand.length; i++) for (let j = i + 1; j < rand.length; j++) if (angularSep(rand[i]!.raDeg, rand[i]!.decDeg, rand[j]!.raDeg, rand[j]!.decDeg) < thetaDeg) chance++;
  return { links, chanceBaseline: chance, excessOverChance: links.length - chance };
}
