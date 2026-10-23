import { describe, it, expect } from 'vitest';
import { WaveField, fieldBytes, chooseFieldGrid, tileStats } from '@astro/pixels';
import { validatePixelWitness } from '@astro/core';

describe('wave field', () => {
  it('rejects CFL-unstable parameters', () => {
    expect(() => new WaveField(64, 64, { c: 3, damping: 0, dt: 0.02, dx: 0.05 })).toThrow(/CFL/);
  });
  it('an impulse propagates outward at bounded speed and energy decays with damping', () => {
    const w = new WaveField(129, 129, { c: 1, damping: 0.4, dt: 0.02, dx: 0.05 });
    w.impulse(64, 64, 1, 2);
    const e0 = w.energy();
    for (let i = 0; i < 40; i++) w.step();
    // after t=0.8 s a c=1 wave travels 0.8 m = 16 cells; nothing beyond ~22 cells
    // physical front: c·t = 0.8 m = 16 cells; the explicit stencil's domain of dependence is 1 cell/step,
    // so beyond 40+radius cells the field must be exactly zero.
    let ring = 0; for (let x = 64 + 10; x < 64 + 22; x++) ring = Math.max(ring, Math.abs(w.h[64 * 129 + x]!));
    let tail = 0; for (let x = 64 + 30; x < 64 + 42; x++) tail = Math.max(tail, Math.abs(w.h[64 * 129 + x]!));
    let beyond = 0; for (let x = 64 + 43; x < 128; x++) beyond = Math.max(beyond, Math.abs(w.h[64 * 129 + x]!));
    expect(ring).toBeGreaterThan(1e-3);
    expect(tail).toBeLessThan(ring * 0.5);
    expect(beyond).toBe(0);
    for (let i = 0; i < 400; i++) w.step();
    expect(w.energy()).toBeLessThan(e0);
  });
  it('is deterministic and emits a valid witness', () => {
    const run = () => { const w = new WaveField(48, 48); w.impulse(20, 20); for (let i = 0; i < 30; i++) w.step(); return w; };
    const a = run(), b = run();
    expect(a.digest()).toBe(b.digest());
    const wit = a.witness(20, 20, 'evt-1');
    expect(validatePixelWitness(wit)).toEqual([]);
    expect(validatePixelWitness({ ...wit, x: -1 }).length).toBeGreaterThan(0);
    expect(wit.epistemic).toBe('simulation');
  });
  it('stiff zones slow propagation', () => {
    const w = new WaveField(96, 32, { c: 1, damping: 0, dt: 0.02, dx: 0.05 });
    w.zone(48, 0, 95, 31, 0.1, 1);
    w.impulse(24, 16); w.impulse(72, 16);
    for (let i = 0; i < 25; i++) w.step();
    const spread = (cx: number) => { let n = 0; for (let x = cx - 20; x <= cx + 20; x++) if (Math.abs(w.h[16 * 96 + x]!) > 1e-3) n++; return n; };
    expect(spread(24)).toBeGreaterThan(spread(72));
  });
});

describe('budgets and tiles', () => {
  it('field budget arithmetic and ceiling', () => {
    expect(fieldBytes(512, 256, 8, 2).bytes).toBe(512 * 256 * 16);
    const g = chooseFieldGrid(3840, 2160, 'full', 32 * 1024 * 1024);
    expect(g.bytes).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(chooseFieldGrid(1920, 1080, 'tiles', 1 << 30).nx).toBeLessThan(1920);
  });
  it('tile stats find changed tiles', () => {
    const W = 64, H = 64, a = new Uint8Array(W * H * 4), b = a.slice();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) b[(y * W + x) * 4] = 200;
    const s = tileStats(b, a, W, H);
    expect(s.changedTiles).toBe(1);
    expect(s.changed[0]).toBe(1);
  });
});
