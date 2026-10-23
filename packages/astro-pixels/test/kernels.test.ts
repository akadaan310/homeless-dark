import { describe, it, expect } from 'vitest';
import { evalPass, validate, toGLSL, toWGSL, type CpuTexture } from '@astro/core';
import { GrassField, DEFAULT_GRASS, CONTACT_STAMP, GRASS_STEP, FIELD_SHIFT, KERNELS, contactUniforms, type Contact } from '@astro/pixels';

const tex = (n: number, d?: Float32Array): CpuTexture => ({ width: n, height: n, data: d ? d.slice() : new Float32Array(n * n * 4) });

describe('material kernels: validity on every backend', () => {
  for (const [name, k] of Object.entries(KERNELS)) it(`${name} validates and emits GLSL + WGSL`, () => {
    expect(validate(k)).toEqual({ ok: true, errors: [] });
    expect(toGLSL(k)).toMatch(/outColor/);
    expect(toWGSL(k)).toMatch(/@fragment/);
  });
});

describe('grass field (art-directed elastic blades, declared model)', () => {
  const foot: Contact = { x: 12, y: 12, radius: 3, pressure: 1 };
  it('rejects unstable parameters', () => { expect(() => new GrassField(8, { ...DEFAULT_GRASS, kc: 50000 })).toThrow(/unstable/); });
  it('DSL kernels (CPU evaluator) ≡ independent typed-array stepper', () => {
    const n = 24, g = new GrassField(n, { ...DEFAULT_GRASS, wind: [0, 0], gust: 0 });
    let contact = tex(n, g.contact), state = tex(n, g.state);
    for (let s = 0; s < 40; s++) {
      const feet = s < 20 ? [foot] : [];
      const u = g.uniforms();
      g.stamp(feet); g.step();
      contact = evalPass(CONTACT_STAMP, n, n, { ...u.contact, ...contactUniforms(feet) }, { contact });
      state = evalPass(GRASS_STEP, n, n, u.grass, { state, contact });
    }
    let err = 0, maxB = 0;
    for (let i = 0; i < n * n * 4; i++) { err = Math.max(err, Math.abs(state.data[i]! - g.state[i]!), Math.abs(contact.data[i]! - g.contact[i]!)); maxB = Math.max(maxB, Math.abs(g.state[i]!)); }
    expect(maxB).toBeGreaterThan(0.1);
    expect(err).toBeLessThan(1e-4);
  });
  it('blades bend AWAY from the foot and the footprint matches the contact disc', () => {
    const g = new GrassField(32, { ...DEFAULT_GRASS, wind: [0, 0], gust: 0 });
    const f = { x: 16, y: 16, radius: 4, pressure: 1 };
    for (let s = 0; s < 30; s++) { g.stamp([f]); g.step(); }
    const o = (y: number, x: number) => (y * 32 + x) * 4;
    expect(g.state[o(16, 19)]!).toBeGreaterThan(0.5); // east of the foot → +x bend
    expect(g.state[o(16, 13)]!).toBeLessThan(-0.5); // west → −x
    expect(g.state[o(19, 16) + 1]!).toBeGreaterThan(0.5); // north (+cell y) → +z
    expect(g.bendAt(16 + 9, 16)).toBeLessThan(0.02); // outside the sole: untouched
  });
  it('recovers after contact ends with the declared timescale (pressed while the print persists, then springs back)', () => {
    const g = new GrassField(32, { ...DEFAULT_GRASS, wind: [0, 0], gust: 0 });
    const f = { x: 16, y: 16, radius: 4, pressure: 1 };
    for (let s = 0; s < 30; s++) { g.stamp([f]); g.step(); }
    const pressed = g.bendAt(19, 16);
    const series: number[] = [];
    for (let s = 0; s < 60 * 12; s++) { g.stamp([]); g.step(); if (s % 60 === 59) series.push(g.bendAt(19, 16)); }
    expect(series[0]!).toBeGreaterThan(pressed * 0.5); // still flattened 1 s after the foot lifts (turf memory)
    expect(series[series.length - 1]!).toBeLessThan(pressed * 0.08); // essentially upright after 12 s
    for (let i = 3; i < series.length; i++) expect(series[i]!).toBeLessThanOrEqual(series[i - 3]! + 1e-6); // monotone envelope
  });
  it('is repeatable bit-for-bit', () => {
    const run = () => { const g = new GrassField(16); for (let s = 0; s < 50; s++) { g.stamp([{ x: 8, y: 8, radius: 2, pressure: s < 25 ? 1 : 0 }]); g.step(); } return g.state; };
    expect(run()).toEqual(run());
  });
  it('wind sways blades without contact, bounded', () => {
    const g = new GrassField(16);
    for (let s = 0; s < 300; s++) { g.stamp([]); g.step(); }
    let m = 0; for (let i = 0; i < 16 * 16; i++) m = Math.max(m, g.bendAt(i % 16, Math.floor(i / 16)));
    expect(m).toBeGreaterThan(0.005); expect(m).toBeLessThan(0.2);
  });
  it('field shift moves state by whole cells and zero-fills the entering edge', () => {
    const n = 8, d = new Float32Array(n * n * 4); d[(3 * n + 3) * 4] = 1;
    const out = evalPass(FIELD_SHIFT, n, n, { texel: [1 / n, 1 / n], offset: [1, 0] }, { state: { width: n, height: n, data: d } });
    expect(out.data[(3 * n + 2) * 4]).toBe(1);
    expect(out.data[(3 * n + 7) * 4]).toBe(0);
  });
});
