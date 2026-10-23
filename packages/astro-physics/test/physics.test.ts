import { describe, it, expect } from 'vitest';
import { LAWS, checkBindings, diffuse, FixedStepper } from '@astro/physics';

describe('field laws', () => {
  it('every law declares units and a stability rule', () => {
    for (const l of Object.values(LAWS)) { expect(l.state.length).toBeGreaterThan(0); expect(l.stability.length).toBeGreaterThan(0); }
  });
  it('rejects channel sharing across incompatible units', () => {
    expect(checkBindings([{ texture: 'f0', channel: 0, law: 'wave', state: 'height' }, { texture: 'f0', channel: 1, law: 'wave', state: 'velocity' }]).ok).toBe(true);
    const r = checkBindings([{ texture: 'f0', channel: 0, law: 'wave', state: 'height' }, { texture: 'f0', channel: 0, law: 'diffusion', state: 'temperature' }]);
    expect(r.ok).toBe(false); expect(r.errors[0]).toMatch(/K/);
    expect(checkBindings([{ texture: 'f0', channel: 0, law: 'wave', state: 'mass' }]).ok).toBe(false);
  });
  it('diffusion conserves interior heat (before reaching the boundary) and rejects unstable steps', () => {
    const n = 33, T = new Float32Array(n * n); T[16 * n + 16] = 100;
    let s: Float32Array = T; for (let i = 0; i < 10; i++) s = diffuse(s, n, n, 1, 0.2, 1);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 3);
    expect(s[16 * n + 16]!).toBeLessThan(100);
    expect(() => diffuse(T, n, n, 1, 0.3, 1)).toThrow(/unstable/);
  });
  it('fixed stepper produces the same step count independent of frame cadence', () => {
    const count = (frame: number, frames: number) => { const s = new FixedStepper(1 / 60, 8); let n = 0; for (let i = 0; i < frames; i++) s.advance(frame, () => n++); return n; };
    expect(count(1 / 30, 60)).toBe(120);
    expect(count(1 / 120, 240)).toBe(120);
    expect(count(1 / 144, 288)).toBe(120);
  });
});
