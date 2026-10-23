// ASTRO pixel substrate (§051–§056, §108, §113). A display sample is an OBSERVATION location;
// a solver cell is a STATE carrier. Dense state lives in typed arrays / GPU textures —
// never one JS object per pixel. The CPU solver here is the reference oracle for the GPU pass.
import type { PixelFieldWitness, Epistemic } from '@astro/core';

export interface WaveParams { c: number; damping: number; dt: number; dx: number }

/** Damped 2D wave equation  h_tt = c² ∇²h − γ h_t, explicit leapfrog on a cell grid. */
export class WaveField {
  readonly h: Float32Array;
  readonly v: Float32Array;
  readonly stiffness: Float32Array; // per-cell c² multiplier (material zones, §056)
  readonly damp: Float32Array; // per-cell damping multiplier
  t = 0;
  steps = 0;
  readonly cfl: number;
  constructor(readonly nx: number, readonly ny: number, readonly p: WaveParams = { c: 1, damping: 0.05, dt: 0.02, dx: 0.05 }) {
    if (nx < 3 || ny < 3 || nx > 4096 || ny > 4096) throw new RangeError('grid size out of range');
    this.cfl = (p.c * p.dt * Math.SQRT2) / p.dx;
    if (this.cfl >= 1) throw new RangeError(`CFL ${this.cfl.toFixed(3)} ≥ 1: unstable explicit scheme rejected`);
    this.h = new Float32Array(nx * ny); this.v = new Float32Array(nx * ny);
    this.stiffness = new Float32Array(nx * ny).fill(1); this.damp = new Float32Array(nx * ny).fill(1);
  }
  impulse(x: number, y: number, amp = 1, radius = 2) {
    for (let j = -radius; j <= radius; j++) for (let i = -radius; i <= radius; i++) {
      const X = x + i, Y = y + j;
      if (X <= 0 || Y <= 0 || X >= this.nx - 1 || Y >= this.ny - 1) continue;
      this.h[Y * this.nx + X]! += amp * Math.exp(-(i * i + j * j) / (radius * radius * 0.5 + 1e-6));
    }
  }
  zone(x0: number, y0: number, x1: number, y1: number, stiffness: number, damping: number) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const k = y * this.nx + x; this.stiffness[k] = stiffness; this.damp[k] = damping; }
  }
  step() {
    const { nx, ny, h, v } = this, { c, damping, dt, dx } = this.p;
    const k = (c * c) / (dx * dx);
    for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
      const i = y * nx + x;
      const lap = h[i - 1]! + h[i + 1]! + h[i - nx]! + h[i + nx]! - 4 * h[i]!;
      v[i] = (v[i]! + dt * k * this.stiffness[i]! * lap) / (1 + damping * this.damp[i]! * dt);
    }
    for (let i = 0; i < h.length; i++) h[i]! += dt * v[i]!;
    // fixed (Dirichlet) boundary
    for (let x = 0; x < nx; x++) { h[x] = v[x] = 0; h[(ny - 1) * nx + x] = v[(ny - 1) * nx + x] = 0; }
    for (let y = 0; y < ny; y++) { h[y * nx] = v[y * nx] = 0; h[y * nx + nx - 1] = v[y * nx + nx - 1] = 0; }
    this.t += dt; this.steps++;
  }
  /** Discrete wave energy ½Σ(v² + c²·k·|∇h|²)·dx² (kinetic + potential, J per unit density). */
  energy() {
    const { nx, ny, h, v } = this, { c, dx } = this.p;
    let e = 0;
    for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
      const i = y * nx + x, gx = (h[i + 1]! - h[i]!) / dx, gy = (h[i + nx]! - h[i]!) / dx;
      e += v[i]! ** 2 + c * c * this.stiffness[i]! * (gx * gx + gy * gy);
    }
    return 0.5 * e * dx * dx;
  }
  digest() { let h1 = 0x811c9dc5; const b = new Uint8Array(this.h.buffer); for (let i = 0; i < b.length; i += 7) h1 = Math.imul(h1 ^ b[i]!, 0x01000193) >>> 0; return h1.toString(16).padStart(8, '0'); }
  witness(x: number, y: number, eventId: string | null, epistemic: Epistemic = 'simulation'): PixelFieldWitness {
    return { x, y, resolution: [this.nx, this.ny], t: this.t, model: 'damped-wave-2d/leapfrog', gridId: `wave:${this.nx}x${this.ny}`, fieldVersion: String(this.steps), inputEventId: eventId, stateDigest: this.digest(), epistemic };
  }
}

// ---------------------------------------------------------------- budgets (§054, §108)
export interface FieldBudget { nx: number; ny: number; bytesPerTexel: number; textures: number; bytes: number }
export const fieldBytes = (nx: number, ny: number, bytesPerTexel: number, textures: number): FieldBudget => ({ nx, ny, bytesPerTexel, textures, bytes: nx * ny * bytesPerTexel * textures });

export type FieldProfile = 'tiles' | 'full';
/** Default: resolution-scaled simulation; full physical-pixel grid only on capable profiles and under a ceiling. */
export function chooseFieldGrid(canvasW: number, canvasH: number, profile: FieldProfile, ceilingBytes: number, bytesPerTexel = 8, textures = 2): FieldBudget {
  let s = profile === 'full' ? 1 : 0.25;
  for (;;) {
    const b = fieldBytes(Math.max(16, Math.round(canvasW * s)), Math.max(16, Math.round(canvasH * s)), bytesPerTexel, textures);
    if (b.bytes <= ceilingBytes || s < 1 / 64) return b;
    s /= 2;
  }
}

// ---------------------------------------------------------------- telemetry (§113)
/** Tile statistics over an RGBA8/float buffer: mean, variance, energy and changed-pixel mask (no per-pixel objects). */
export function tileStats(cur: ArrayLike<number>, prev: ArrayLike<number> | null, width: number, height: number, tile = 16, channels = 4, threshold = 2) {
  const tx = Math.ceil(width / tile), ty = Math.ceil(height / tile);
  const mean = new Float32Array(tx * ty), variance = new Float32Array(tx * ty), changed = new Uint8Array(tx * ty);
  for (let j = 0; j < ty; j++) for (let i = 0; i < tx; i++) {
    let s = 0, s2 = 0, n = 0, ch = 0;
    for (let y = j * tile; y < Math.min(height, (j + 1) * tile); y++) for (let x = i * tile; x < Math.min(width, (i + 1) * tile); x++) {
      const k = (y * width + x) * channels;
      const l = 0.2126 * (cur[k] as number) + 0.7152 * (cur[k + 1] as number) + 0.0722 * (cur[k + 2] as number);
      s += l; s2 += l * l; n++;
      if (prev && Math.abs((cur[k] as number) - (prev[k] as number)) + Math.abs((cur[k + 1] as number) - (prev[k + 1] as number)) + Math.abs((cur[k + 2] as number) - (prev[k + 2] as number)) > threshold) ch++;
    }
    const m = s / n;
    mean[j * tx + i] = m; variance[j * tx + i] = s2 / n - m * m; changed[j * tx + i] = ch > 0 ? 1 : 0;
  }
  let energy = 0; for (const m of mean) energy += m * m;
  return { tilesX: tx, tilesY: ty, mean, variance, changed, changedTiles: changed.reduce((a, b) => a + b, 0), energy: energy / mean.length };
}
export * from './kernels';
