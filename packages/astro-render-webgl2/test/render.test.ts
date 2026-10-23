import { describe, it, expect } from 'vitest';
import { evalPass, validate, toGLSL, toWGSL, type CpuTexture } from '@astro/core';
import { WaveField } from '@astro/pixels';
import { skyRadiance, projectSH, shIrradiance, defaultSky, airMass, edt2d, alphaToSdf, WAVE_STEP, WAVE_IMPULSE, FORWARD_FS, SKY_FS, withDefines } from '@astro/render-webgl2';

describe('analytic sky model', () => {
  const day = defaultSky();
  it('Kasten–Young air mass: 1 at zenith, ≈38 at the horizon', () => {
    expect(airMass(1)).toBeCloseTo(1, 2);
    expect(airMass(0)).toBeGreaterThan(30);
    expect(airMass(0)).toBeLessThan(45);
  });
  it('clear zenith is blue (Rayleigh λ⁻⁴) and in the calibrated range', () => {
    const z = skyRadiance([0, 1, 0], day, false);
    expect(z[2]).toBeGreaterThan(z[1]); expect(z[1]).toBeGreaterThan(z[0]);
    expect(z[2]).toBeGreaterThan(0.15); expect(z[2]).toBeLessThan(1.5);
  });
  it('low sun reddens the horizon toward the sun relative to the zenith', () => {
    const p = { ...day, sunDir: [0, 0.05, -0.9987] as [number, number, number] };
    const h = skyRadiance([0, 0.02, -0.9998], p, false), z = skyRadiance([0, 1, 0], p, false);
    expect(h[0] / h[2]).toBeGreaterThan(z[0] / z[2]);
  });
  it('night sky is dark and the sun disc stays finite (display clamp applied by the renderer)', () => {
    const n = skyRadiance([0, 1, 0], { ...day, sunDir: [0, -0.5, -0.866], night: 1 }, true);
    expect(Math.max(...n)).toBeLessThan(0.002);
    const s = skyRadiance(day.sunDir, day, true);
    expect(Number.isFinite(s[0])).toBe(true);
  });
  it('overcast replaces the clear sky in proportion to cover', () => {
    const o = skyRadiance([0, 1, 0], { ...day, cloud: 1 }, false);
    expect(o).toEqual(day.cloudColor.map((c) => expect.closeTo(c, 6)));
  });
  it('SH irradiance matches brute-force cosine integration of the sky (≤5%)', () => {
    const brute = (n: [number, number, number]) => {
      let e = 0; const N = 200, M = 400;
      for (let i = 0; i < N; i++) { const th = ((i + 0.5) / N) * Math.PI, st = Math.sin(th); for (let j = 0; j < M; j++) { const ph = ((j + 0.5) / M) * 2 * Math.PI; const d: [number, number, number] = [st * Math.sin(ph), Math.cos(th), -st * Math.cos(ph)]; const c = d[0] * n[0] + d[1] * n[1] + d[2] * n[2]; if (c > 0) e += skyRadiance(d, day, false)[2] * c * st * (Math.PI / N) * ((2 * Math.PI) / M); } }
      return e;
    };
    const sh = projectSH(day, 32, 64);
    for (const n of [[0, 1, 0], [1, 0, 0], [0, 0.7071, -0.7071]] as [number, number, number][]) {
      const ref = brute(n), got = shIrradiance(sh, n)[2];
      expect(Math.abs(got - ref) / ref).toBeLessThan(0.05);
    }
  });
  it('SH irradiance of the day sky is brighter facing up than facing down', () => {
    const sh = projectSH(day);
    expect(shIrradiance(sh, [0, 1, 0])[2]).toBeGreaterThan(shIrradiance(sh, [0, -1, 0])[2]);
  });
});

describe('SDF', () => {
  it('EDT gives exact Euclidean distances', () => {
    const w = 21, h = 21;
    const d = edt2d((i) => i === 10 * w + 10, w, h);
    expect(d[10 * w + 13]).toBe(9);
    expect(d[14 * w + 13]).toBe(25);
  });
  it('a filled disc maps to 128 at the edge, >128 inside, <128 outside', () => {
    const w = 64, a = new Uint8Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) a[y * w + x] = Math.hypot(x - 32, y - 32) < 16 ? 255 : 0;
    const s = alphaToSdf(a, w, w, 8);
    expect(s[32 * w + 32]).toBe(255);
    expect(s[32 * w + 2]).toBe(0);
    expect(Math.abs(s[32 * w + 48]! - 128)).toBeLessThan(20);
  });
});

describe('pixel-field program: DSL ≡ CPU reference solver', () => {
  it('both programs validate and emit GLSL + WGSL', () => {
    for (const p of [WAVE_STEP, WAVE_IMPULSE]) { expect(validate(p).ok).toBe(true); expect(toGLSL(p)).toMatch(/void main/); expect(toWGSL(p)).toMatch(/@fragment/); }
  });
  it('DSL evaluation matches WaveField step-for-step (float32)', () => {
    const nx = 24, ny = 20, P = { c: 1, damping: 0.3, dt: 0.02, dx: 0.05 };
    const cpu = new WaveField(nx, ny, P);
    cpu.impulse(9, 11, 1, 2);
    let tex: CpuTexture = { width: nx, height: ny, data: new Float32Array(nx * ny * 4) };
    tex = evalPass(WAVE_IMPULSE, nx, ny, { texel: [1 / nx, 1 / ny], center: [9, 11], amp: 1, rad: 2, res: [nx, ny] }, { state: tex });
    for (let s = 0; s < 25; s++) {
      cpu.step();
      tex = evalPass(WAVE_STEP, nx, ny, { texel: [1 / nx, 1 / ny], k: (P.c * P.c) / (P.dx * P.dx), dt: P.dt, damp: P.damping }, { state: tex });
    }
    let maxErr = 0, maxH = 0;
    for (let i = 0; i < nx * ny; i++) { maxErr = Math.max(maxErr, Math.abs(tex.data[i * 4]! - cpu.h[i]!)); maxH = Math.max(maxH, Math.abs(cpu.h[i]!)); }
    expect(maxH).toBeGreaterThan(1e-3);
    expect(maxErr).toBeLessThan(1e-5);
  });
});

describe('shader assembly', () => {
  it('forward + sky sources assemble with defines', () => {
    const fs = withDefines(FORWARD_FS, ['FEATURE_WET', 'MAP', 'NORMALMAP']);
    expect(fs.startsWith('#version 300 es')).toBe(true);
    expect(fs).toMatch(/#define FEATURE_WET/);
    expect(withDefines(SKY_FS, [])).toMatch(/skyRadiance/);
  });
});
