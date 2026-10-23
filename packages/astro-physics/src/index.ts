// ASTRO field-law registry (§055, §056, §103). Each law owns its state units; two laws
// never share a texture channel with incompatible units. Laws are modules, not one
// "physics of pixels". Rigid-body contact is Rapier's, referenced here only by unit contract.

export type Unit = 'm' | 'm/s' | 'K' | 'kg/m^3' | 'N' | 'V/m' | 'W/m^2/sr' | '1';
export interface FieldLaw {
  id: 'wave' | 'diffusion' | 'fluid_approx' | 'mass_spring' | 'em_visualization' | 'optics' | 'rigid_contact';
  state: { name: string; unit: Unit }[];
  parameters: { name: string; unit: string }[];
  stability: string;
  epistemic: 'simulation' | 'abstract';
  illustrative: boolean;
}

export const LAWS: Record<FieldLaw['id'], FieldLaw> = {
  wave: { id: 'wave', state: [{ name: 'height', unit: 'm' }, { name: 'velocity', unit: 'm/s' }], parameters: [{ name: 'c', unit: 'm/s' }, { name: 'gamma', unit: '1/s' }], stability: 'c·dt·√2/dx < 1 (CFL)', epistemic: 'simulation', illustrative: true },
  diffusion: { id: 'diffusion', state: [{ name: 'temperature', unit: 'K' }], parameters: [{ name: 'alpha', unit: 'm^2/s' }], stability: 'alpha·dt/dx² ≤ 1/4', epistemic: 'simulation', illustrative: true },
  fluid_approx: { id: 'fluid_approx', state: [{ name: 'density', unit: 'kg/m^3' }, { name: 'velocity', unit: 'm/s' }], parameters: [{ name: 'viscosity', unit: 'm^2/s' }], stability: 'semi-Lagrangian advection (unconditionally stable, dissipative)', epistemic: 'simulation', illustrative: true },
  mass_spring: { id: 'mass_spring', state: [{ name: 'displacement', unit: 'm' }, { name: 'velocity', unit: 'm/s' }], parameters: [{ name: 'k', unit: 'N/m' }, { name: 'mass', unit: 'kg' }], stability: 'dt < 2·√(m/k)', epistemic: 'simulation', illustrative: false },
  em_visualization: { id: 'em_visualization', state: [{ name: 'field', unit: 'V/m' }], parameters: [], stability: 'visualization only', epistemic: 'abstract', illustrative: true },
  optics: { id: 'optics', state: [{ name: 'radiance', unit: 'W/m^2/sr' }], parameters: [{ name: 'exposure', unit: 'EV' }], stability: 'n/a', epistemic: 'simulation', illustrative: false },
  rigid_contact: { id: 'rigid_contact', state: [{ name: 'position', unit: 'm' }, { name: 'velocity', unit: 'm/s' }], parameters: [{ name: 'friction', unit: '1' }], stability: 'Rapier fixed step 1/60 s', epistemic: 'simulation', illustrative: false },
};

export interface ChannelBinding { texture: string; channel: 0 | 1 | 2 | 3; law: FieldLaw['id']; state: string }

/** Reject bindings where one texture channel carries two laws' states with different units. */
export function checkBindings(bindings: ChannelBinding[]): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const at = new Map<string, ChannelBinding>();
  for (const b of bindings) {
    const law = LAWS[b.law];
    const st = law.state.find((s) => s.name === b.state);
    if (!st) { errors.push(`${b.law} has no state ${b.state}`); continue; }
    const k = `${b.texture}.${b.channel}`;
    const prev = at.get(k);
    if (prev) {
      const pu = LAWS[prev.law].state.find((s) => s.name === prev.state)!.unit;
      if (pu !== st.unit || prev.law !== b.law) errors.push(`${k} already carries ${prev.law}.${prev.state} [${pu}]; cannot also carry ${b.law}.${b.state} [${st.unit}]`);
    } else at.set(k, b);
  }
  return { ok: errors.length === 0, errors };
}

/** Explicit heat diffusion reference with stability check. */
export function diffuse(T: Float32Array, nx: number, ny: number, alpha: number, dt: number, dx: number): Float32Array {
  const r = (alpha * dt) / (dx * dx);
  if (r > 0.25) throw new RangeError(`diffusion number ${r.toFixed(3)} > 0.25: unstable`);
  const out = T.slice();
  for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) { const i = y * nx + x; out[i] = T[i]! + r * (T[i - 1]! + T[i + 1]! + T[i - nx]! + T[i + nx]! - 4 * T[i]!); }
  return out;
}

/** Fixed-step integrator (§103): identical step outputs regardless of display rate. */
export class FixedStepper {
  private acc = 0;
  steps = 0;
  constructor(readonly h = 1 / 60, readonly maxSteps = 4) {}
  advance(frameDt: number, step: (h: number) => void): { steps: number; alpha: number; dropped: number } {
    this.acc += Math.min(frameDt, 0.25);
    let n = 0, dropped = 0;
    while (this.acc >= this.h - 1e-12 && n < this.maxSteps) { step(this.h); this.acc -= this.h; n++; this.steps++; }
    if (n === this.maxSteps && this.acc > this.h) { dropped = this.acc; this.acc = 0; }
    return { steps: n, alpha: this.acc / this.h, dropped };
  }
}
export * from './materials';
