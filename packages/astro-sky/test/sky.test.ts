import { describe, it, expect } from 'vitest';
import * as Astronomy from 'astronomy-engine';
import ref from '../../../data/sky/horizons_references.json';
import { hipparcosStars, syntheticStars, GAIA_DR3, npix, ang2pixRing, raDecToPix, SkyIndex, angularSep, gmstDeg, equatorialToHorizontal, sunRaDec, moonRaDec, antipode, nadirRaDec, precessToJ2000, angularLinks, defaultShell, ellipsoidNormal } from '@astro/sky';

const sepDeg = (a: { raDeg: number; decDeg: number }, r: { ra_deg: number; dec_deg: number }) => angularSep(a.raDeg, a.decDeg, r.ra_deg, r.dec_deg);

describe('ephemeris vs JPL Horizons DE441 fixture', () => {
  for (const r of ref.records) {
    it(`${r.body} at ${r.at}`, () => {
      const d = new Date(r.at);
      const od = r.body === 'Sun' ? sunRaDec(d) : moonRaDec(d);
      const got = precessToJ2000(od.raDeg, od.decDeg, d);
      // ASTRO uses low-precision analytic series: Sun ≤ 0.05°, Moon ≤ 1° (documented tolerances, not Horizons-grade)
      expect(sepDeg(got, r)).toBeLessThan(r.body === 'Sun' ? 0.05 : 1);
      // independent library cross-check (astronomy-engine, MIT): ≤ 0.01° from Horizons
      // geocentric J2000 vector with aberration (Horizons 'astrometric' omits it; ≤ 20″ difference)
      const eq = Astronomy.EquatorFromVector(Astronomy.GeoVector(r.body === 'Sun' ? Astronomy.Body.Sun : Astronomy.Body.Moon, d, false));
      expect(sepDeg({ raDeg: eq.ra * 15, decDeg: eq.dec }, r)).toBeLessThan(0.01);
    });
  }
  it('GMST agrees with astronomy-engine sidereal time', () => {
    const d = new Date('2026-10-20T02:00:00Z');
    const diff = Math.abs(((gmstDeg(d) - Astronomy.SiderealTime(d) * 15 + 540) % 360) - 180);
    expect(diff).toBeLessThan(0.01);
  });
});

describe('HEALPix ring scheme', () => {
  it('covers all pixels and is equal-area (chi-square on uniform points)', () => {
    const nside = 4, N = npix(nside), counts = new Array(N).fill(0);
    const stars = syntheticStars(48000, 7);
    for (const s of stars) counts[raDecToPix(nside, s.raDeg, s.decDeg)]++;
    expect(counts.every((c) => c > 0)).toBe(true);
    const exp = stars.length / N;
    const chi2 = counts.reduce((a, c) => a + (c - exp) ** 2 / exp, 0);
    // dof = 191; 99.9th percentile ≈ 262
    expect(chi2).toBeLessThan(262);
  });
  it('poles and pixel range', () => {
    expect(ang2pixRing(8, 0.0001, 0)).toBeLessThan(4);
    expect(ang2pixRing(8, Math.PI - 0.0001, 0)).toBeGreaterThanOrEqual(npix(8) - 4);
  });
});

describe('catalogue and provenance', () => {
  it('Hipparcos subset is observed data with source; Gaia DR3 is explicitly blocked', () => {
    const h = hipparcosStars();
    expect(h.length).toBeGreaterThan(1000);
    expect(h.every((s) => s.status === 'observed' && s.epoch === 'J2000')).toBe(true);
    expect(syntheticStars(3)[0]!.status).toBe('simulation');
    expect(GAIA_DR3.status).toBe('BLOCKED'); expect(GAIA_DR3.ingested).toBe(0);
    expect(defaultShell().status).toMatch(/stylistic/);
  });
  it('sky index query finds Sirius region stars', () => {
    const h = hipparcosStars(), idx = new SkyIndex(8, h);
    const sirius = h.reduce((a, b) => (b.mag < a.mag ? b : a));
    expect(idx.query(sirius.raDeg, sirius.decDeg, 0.5).some((s) => s.id === sirius.id)).toBe(true);
  });
  it('link grammar reports a chance baseline and is non-physical', () => {
    const r = angularLinks(hipparcosStars(), 3, 3.5);
    expect(r.links.every((l) => l.physical === false)).toBe(true);
    expect(Number.isFinite(r.chanceBaseline)).toBe(true);
  });
});

describe('globe / observer geometry', () => {
  it('Polaris altitude ≈ observer latitude at Tampa', () => {
    const h = equatorialToHorizontal(37.95, 89.26, 27.95, -82.46, new Date('2026-10-20T02:00:00Z'));
    expect(Math.abs(h.altDeg - 27.95)).toBeLessThan(1.2);
  });
  it('antipode and nadir', () => {
    expect(antipode(27.95, -82.46)).toEqual({ lat: -27.95, lon: 97.54 });
    expect(nadirRaDec(27.95, -82.46, new Date()).decDeg).toBe(-27.95);
    const n = ellipsoidNormal(0, 0); expect(n[0]).toBeCloseTo(1, 9);
  });
});
