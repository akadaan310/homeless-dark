import { describe, expect, it } from 'vitest';
import { Color, SRGBColorSpace, LinearSRGBColorSpace, ColorManagement } from 'three';
import {
  srgbToLinear, linearToSrgb, decodeSrgb, encodeSrgb, hexToRgb, linearToOklab, oklabToLinear, linearToOklch, oklchToSrgbGamut, inGamut,
  contrastRatio, relativeLuminance, xyzToLab, linearToXyz, deltaE2000, kelvinToLinear, outdoorProfile, outdoorBlend, blendProfiles, adaptExposure,
  stepWetness, wetMaterial, parseVisualProgram, layoutSign, flashSafe, angularLetterHeight, formatBoard,
} from '../src';

describe('linear colour gate [M]', () => {
  it('sRGB transfer is piecewise IEC 61966-2-1 (not gamma 2.2) and round-trips', () => {
    expect(srgbToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 12);
    expect(Math.abs(srgbToLinear(0.5) - 0.5 ** 2.2)).toBeGreaterThan(0.003);
    for (let i = 0; i <= 255; i++) expect(linearToSrgb(srgbToLinear(i / 255))).toBeCloseTo(i / 255, 10);
  });
  it('matches Three.js ColorManagement conversions within 1e-5', () => {
    expect(ColorManagement.enabled).toBe(true);
    for (const hex of ['#ff8800', '#1a2b3c', '#808080', '#ffffff', '#000000', '#c0ffee']) {
      const c = new Color().setStyle(hex, SRGBColorSpace); // stored as linear working space
      const ours = decodeSrgb(hexToRgb(hex));
      for (const [a, b] of [[c.r, ours[0]], [c.g, ours[1]], [c.b, ours[2]]] as const) expect(Math.abs(a - b)).toBeLessThan(1e-5);
      const out = { r: 0, g: 0, b: 0 };
      c.getRGB(out, SRGBColorSpace);
      expect(Math.abs(out.r - hexToRgb(hex)[0])).toBeLessThan(1e-5);
      const lin = { r: 0, g: 0, b: 0 }; c.getRGB(lin, LinearSRGBColorSpace);
      expect(Math.abs(lin.g - ours[1])).toBeLessThan(1e-5);
    }
  });
  it('neutral ramp stays neutral through OKLab and has zero chroma', () => {
    for (let v = 0.05; v <= 1; v += 0.05) {
      const ok = linearToOklch([v, v, v]);
      expect(ok.c).toBeLessThan(2e-4);
      const back = oklabToLinear(linearToOklab([v, v, v]));
      back.forEach((x) => expect(x).toBeCloseTo(v, 6));
    }
  });
  it('double encoding is detectable: encode(encode(x)) ≠ encode(x)', () => {
    const x: [number, number, number] = [0.2, 0.2, 0.2];
    expect(Math.abs(encodeSrgb(encodeSrgb(x))[0] - encodeSrgb(x)[0])).toBeGreaterThan(0.1);
  });
  it('out-of-gamut OKLCH is flagged and mapped by chroma reduction', () => {
    const r = oklchToSrgbGamut({ l: 0.7, c: 0.35, h: 150 });
    expect(r.clipped).toBe(true);
    expect(inGamut(r.linear)).toBe(true);
    expect(oklchToSrgbGamut({ l: 0.6, c: 0.05, h: 30 }).clipped).toBe(false);
  });
  it('known swatches: white/black contrast 21:1, WCAG luminance of #777 ≈ 0.184', () => {
    expect(contrastRatio([1, 1, 1], [0, 0, 0])).toBeCloseTo(21, 6);
    expect(relativeLuminance(hexToRgb('#777777'))).toBeCloseTo(0.1844, 3);
    expect(xyzToLab(linearToXyz([1, 1, 1]))[0]).toBeCloseTo(100, 2);
  });
  it('CIEDE2000 matches Sharma et al. test pair 1 (ΔE = 2.0425)', () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
  });
  it('Planckian 6504 K is near D65 white; 2700 K is warm', () => {
    const d65 = kelvinToLinear(6504);
    expect(Math.max(...d65) - Math.min(...d65)).toBeLessThan(0.06);
    const warm = kelvinToLinear(2700);
    expect(warm[0]).toBeGreaterThan(warm[2] * 2);
  });
});

describe('light grammar [M]', () => {
  it('profiles follow solar elevation; blends sum to one and are continuous', () => {
    expect(outdoorProfile(40)).toBe('day');
    expect(outdoorProfile(2)).toBe('golden_hour');
    expect(outdoorProfile(-5)).toBe('twilight');
    expect(outdoorProfile(-20)).toBe('night');
    let prev = blendProfiles(outdoorBlend(-20)).exposureEV;
    for (let e = -20; e <= 30; e += 0.25) {
      const w = outdoorBlend(e);
      expect(Object.values(w).reduce((a, b) => a + b!, 0)).toBeCloseTo(1, 9);
      const ev = blendProfiles(w).exposureEV;
      expect(Math.abs(ev - prev)).toBeLessThan(0.1); // no popping per 0.25° of sun
      prev = ev;
    }
  });
  it('exposure adaptation is bounded per second', () => {
    expect(adaptExposure(0, 3, 0.5, 0.75)).toBeCloseTo(0.375, 9);
    expect(adaptExposure(1, 1.1, 1)).toBeCloseTo(1.1, 9);
  });
  it('wetness rises with rain, dries slowly, and puddles only in depressions', () => {
    let s = { wetness: 0, puddle: 0 };
    for (let t = 0; t < 120; t++) s = stepWetness(s, 1, 1);
    expect(s.wetness).toBeGreaterThan(0.9);
    expect(s.puddle).toBeGreaterThan(0.4);
    const flat = wetMaterial(0.85, s.wetness, 0.1, s.puddle), dip = wetMaterial(0.85, s.wetness, 0.95, s.puddle);
    expect(flat.puddleCover).toBe(0);
    expect(dip.puddleCover).toBeGreaterThan(0.5);
    expect(dip.roughness).toBeLessThan(flat.roughness);
    let d = s;
    for (let t = 0; t < 60; t++) d = stepWetness(d, 0, 1);
    expect(d.wetness).toBeGreaterThan(0.6); // drying is slower than wetting
  });
});

describe('VisualProgram DSL [M]', () => {
  const src = `SCENE geography=TAMPA.source-anchored mode=NIGHT weather=RAIN
ILLUMINANT class=streetlight temperature=warm intensity=calibrated source=municipal_or_authored
SURFACE class=asphalt wetness=0.65 roughness=wet_profile source=licensed_pbr
SIGN subject=shopfront locale=en payload=validated_grammar emission=limited
CAMERA mode=third_person adaptation=smooth filmic=AgX
PERCEPTION target=walkable_path legibility=verified comfort=reduced_flash`;
  it('parses the constitution example into a recipe', () => {
    const p = parseVisualProgram(src);
    expect(p.errors).toEqual([]);
    expect(p.recipe).toMatchObject({ mode: 'NIGHT', weather: 'RAIN', toneMapping: 'AgX', wetness: 0.65, signs: ['shopfront'] });
  });
  it('rejects unknown attributes, inadmissible values, two output transforms and unsafe storms', () => {
    expect(parseVisualProgram(src.replace('wetness=0.65', 'wetness=1.7')).ok).toBe(false);
    expect(parseVisualProgram(src + '\nCAMERA mode=cockpit filmic=ACESFilmic').errors.join()).toMatch(/one CAMERA/);
    expect(parseVisualProgram(src.replace('weather=RAIN', 'weather=STORM').replace('comfort=reduced_flash', 'comfort=standard')).ok).toBe(false);
    expect(parseVisualProgram('SCENE geography=X mode=DAY weather=CLEAR shader=eval()').ok).toBe(false);
  });
});

describe('Billboardstratum [M]', () => {
  it('fits long names into lines without overflow and reports legibility distance', () => {
    const r = layoutSign('Spruce Street Late Night Café and Bakery', { width: 3, height: 0.9 });
    expect(r.lines.length).toBeGreaterThan(1);
    expect(r.overflow).toBe(false);
    expect(r.legibleAt).toBeGreaterThan(5);
    expect(layoutSign('東京国際空港', { width: 2, height: 0.5 }, 'Hani').lines.join('')).toBe('東京国際空港');
    expect(layoutSign('x'.repeat(400), { width: 0.3, height: 0.1 }).overflow).toBe(true);
    expect(layoutSign('Café', { width: 2, height: 1 }).warnings.join()).toMatch(/NFC/);
  });
  it('flash safety and angular size', () => {
    expect(flashSafe(4, false).ok).toBe(false);
    expect(flashSafe(2, false).effectiveHz).toBe(1);
    expect(flashSafe(0.5, true).effectiveHz).toBe(0);
    expect(angularLetterHeight(0.3, 20)).toBeGreaterThan(angularLetterHeight(0.3, 20, 70));
  });
  it('board rows are fixed width', () => {
    const rows = formatBoard([{ time: '21:40', flight: 'HD 207', destination: 'London Heathrow Airport', gate: 'B4', status: 'BOARDING' }]);
    expect(rows[0]).toContain('London Heathr…');
  });
});
