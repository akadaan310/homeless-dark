// ASTRO material-field kernels (v4.1 §03–§08). Each kernel is declared ONCE in the bounded
// shader DSL and executed by three backends: the DSL CPU evaluator (`evalPass`), WebGL2
// (`toGLSL`) and WebGPU (`toWGSL`). Hand-written typed-array steppers below are the
// independent reference oracles the DSL programs are tested against.
//
// Fields are world-aligned square windows of N×N cells with cell size `dx` metres, stored as
// RGBA float textures (rows = +z cells… see `cellOf`). A display pixel samples them; it is
// never itself a solver.
//
// Declared fidelity (§04): grass = art-directed elastic blade model (angular spring–damper per
// cell, contact-driven target bend, wind forcing) — plausible, not botanically measured.
// Contact = pressure footprint with exponential persistence (soil/turf memory) — authored
// time constant. Ripples = damped linear wave equation (scientific model, linear regime only).
import { num, ref, bin, call, sample, swz, ctor, type ShaderProgram, type Expr, type Stmt } from '@astro/core';

const uvx = swz(ref('uv'), 'x'), uvy = swz(ref('uv'), 'y');
const tx = swz(ref('texel'), 'x'), ty = swz(ref('texel'), 'y');
const at = (dx: number, dy: number) => swz(sample('state', bin('+', ref('uv'), ctor('vec2', bin('*', tx, num(dx)), bin('*', ty, num(dy))))), 'x');
const interior = bin('*', bin('*', call('step', tx, uvx), call('step', uvx, bin('-', num(1), tx))), bin('*', call('step', ty, uvy), call('step', uvy, bin('-', num(1), ty))));
const neg = (e: Expr) => bin('*', num(-1), e);
const L = (name: string, t: 'f32' | 'vec2' | 'vec4', e: Expr): Stmt => ({ k: 'let', name, t, e });

// ------------------------------------------------------------------ ripple (damped wave)
export const WAVE_STEP: ShaderProgram = {
  name: 'wave_step',
  uniforms: [{ name: 'texel', t: 'vec2' }, { name: 'k', t: 'f32' }, { name: 'dt', t: 'f32' }, { name: 'damp', t: 'f32' }],
  samplers: ['state'],
  body: [
    L('s', 'vec4', sample('state', ref('uv'))),
    L('lap', 'f32', bin('-', bin('+', bin('+', at(-1, 0), at(1, 0)), bin('+', at(0, -1), at(0, 1))), bin('*', num(4), swz(ref('s'), 'x')))),
    L('mask', 'f32', interior),
    L('v', 'f32', bin('*', bin('/', bin('+', swz(ref('s'), 'y'), bin('*', bin('*', ref('dt'), ref('k')), ref('lap'))), bin('+', num(1), bin('*', ref('damp'), ref('dt')))), ref('mask'))),
    L('h', 'f32', bin('*', bin('+', swz(ref('s'), 'x'), bin('*', ref('dt'), ref('v'))), ref('mask'))),
    { k: 'out', e: ctor('vec4', ref('h'), ref('v'), num(0), num(1)) },
  ],
};

export const WAVE_IMPULSE: ShaderProgram = {
  name: 'wave_impulse',
  uniforms: [{ name: 'texel', t: 'vec2' }, { name: 'center', t: 'vec2' }, { name: 'amp', t: 'f32' }, { name: 'rad', t: 'f32' }, { name: 'res', t: 'vec2' }],
  samplers: ['state'],
  body: [
    L('s', 'vec4', sample('state', ref('uv'))),
    L('d', 'vec2', bin('-', bin('-', bin('*', ref('uv'), ref('res')), ctor('vec2', num(0.5), num(0.5))), ref('center'))),
    L('inside', 'f32', bin('*', bin('*', call('step', call('abs', swz(ref('d'), 'x')), bin('+', ref('rad'), num(0.001))), call('step', call('abs', swz(ref('d'), 'y')), bin('+', ref('rad'), num(0.001)))), interior)),
    L('add', 'f32', bin('*', bin('*', ref('amp'), call('exp', bin('/', neg(call('dot', ref('d'), ref('d'))), bin('+', bin('*', bin('*', ref('rad'), ref('rad')), num(0.5)), num(1e-6))))), ref('inside'))),
    { k: 'out', e: ctor('vec4', bin('+', swz(ref('s'), 'x'), ref('add')), swz(ref('s'), 'y'), num(0), num(1)) },
  ],
};

// ------------------------------------------------------------------ contact footprint field
/** Up to four contact discs (foot soles, tyre patches) in CELL units: (cx, cy, radius, pressure 0..1). */
export const CONTACT_SLOTS = 4;
const footTerm = (i: number): Stmt[] => {
  const f = ref(`foot${i}`);
  const d = `d${i}`, r = `r${i}`, p = `p${i}`;
  return [
    L(d, 'vec2', bin('-', bin('-', bin('*', ref('uv'), ref('res')), ctor('vec2', num(0.5), num(0.5))), ctor('vec2', swz(f, 'x'), swz(f, 'y')))),
    L(r, 'f32', call('length', ref(d))),
    // pressure profile: flat sole core, soft edge (1 inside 0.6R, 0 beyond R)
    L(p, 'f32', bin('*', swz(f, 'w'), bin('-', num(1), call('smoothstep', bin('*', swz(f, 'z'), num(0.6)), swz(f, 'z'), ref(r))))),
    { k: 'set', name: 'press', e: call('max', ref('press'), ref(p)) },
    // push direction (away from the disc centre) weighted by the new pressure
    { k: 'set', name: 'push', e: bin('+', ref('push'), bin('*', bin('/', ref(d), call('max', ref(r), num(0.5))), ref(p))) },
  ];
};
export const CONTACT_STAMP: ShaderProgram = {
  name: 'contact_stamp',
  uniforms: [{ name: 'res', t: 'vec2' }, { name: 'decay', t: 'f32' }, ...Array.from({ length: CONTACT_SLOTS }, (_, i) => ({ name: `foot${i}`, t: 'vec4' as const }))],
  samplers: ['contact'],
  body: [
    L('c', 'vec4', sample('contact', ref('uv'))),
    L('press', 'f32', bin('*', swz(ref('c'), 'x'), ref('decay'))),
    L('push', 'vec2', bin('*', ctor('vec2', swz(ref('c'), 'y'), swz(ref('c'), 'z')), ref('decay'))),
    ...Array.from({ length: CONTACT_SLOTS }, (_, i) => footTerm(i)).flat(),
    // keep the direction bounded (unit-ish) so stacked feet do not overdrive bending
    L('pl', 'f32', call('max', call('length', ref('push')), num(1))),
    { k: 'out', e: ctor('vec4', call('min', ref('press'), num(1)), bin('/', swz(ref('push'), 'x'), ref('pl')), bin('/', swz(ref('push'), 'y'), ref('pl')), num(1)) },
  ],
};

// ------------------------------------------------------------------ grass blade field
/**
 * State per cell: (bendX, bendZ, ωX, ωZ) in radians and rad/s. Angular spring–damper:
 *   ω' = (ω + dt·(−k·b + kc·p·(b* − b) + wind)) / (1 + c·dt),   b' = b + dt·ω'
 * with target bend b* = push·maxBend (flattening away from the foot). Semi-implicit Euler;
 * stable for dt·√(k + kc) < 2 (checked by GrassField).
 */
export const GRASS_STEP: ShaderProgram = {
  name: 'grass_step',
  uniforms: [{ name: 'res', t: 'vec2' }, { name: 'dt', t: 'f32' }, { name: 'k', t: 'f32' }, { name: 'kc', t: 'f32' }, { name: 'c', t: 'f32' }, { name: 'maxBend', t: 'f32' }, { name: 'wind', t: 'vec2' }, { name: 'gust', t: 'f32' }, { name: 'phase', t: 'f32' }, { name: 'org', t: 'vec2' }],
  samplers: ['state', 'contact'],
  body: [
    L('s', 'vec4', sample('state', ref('uv'))),
    L('ct', 'vec4', sample('contact', ref('uv'))),
    L('b', 'vec2', ctor('vec2', swz(ref('s'), 'x'), swz(ref('s'), 'y'))),
    L('w', 'vec2', ctor('vec2', swz(ref('s'), 'z'), swz(ref('s'), 'w'))),
    L('p', 'f32', swz(ref('ct'), 'x')),
    L('target', 'vec2', bin('*', ctor('vec2', swz(ref('ct'), 'y'), swz(ref('ct'), 'z')), ref('maxBend'))),
    // gusts travel across the field: phase varies with WORLD cell position (org = window origin in cells)
    L('cell', 'vec2', bin('+', bin('*', ref('uv'), ref('res')), ref('org'))),
    L('g', 'f32', bin('+', num(0.6), bin('*', ref('gust'), call('sin', bin('+', ref('phase'), bin('*', num(0.37), bin('+', swz(ref('cell'), 'x'), bin('*', num(0.61), swz(ref('cell'), 'y'))))))))),
    L('acc', 'vec2', bin('+', bin('+', bin('*', neg(ref('k')), ref('b')), bin('*', bin('*', ref('kc'), ref('p')), bin('-', ref('target'), ref('b')))), bin('*', ref('wind'), ref('g')))),
    L('w2', 'vec2', bin('/', bin('+', ref('w'), bin('*', ref('dt'), ref('acc'))), bin('+', num(1), bin('*', ref('c'), ref('dt'))))),
    L('b2', 'vec2', bin('+', ref('b'), bin('*', ref('dt'), ref('w2')))),
    { k: 'out', e: ctor('vec4', swz(ref('b2'), 'x'), swz(ref('b2'), 'y'), swz(ref('w2'), 'x'), swz(ref('w2'), 'y')) },
  ],
};

/** Recentre a world-aligned window by an integer cell offset (cells leaving are dropped, entering are zero). */
export const FIELD_SHIFT: ShaderProgram = {
  name: 'field_shift',
  uniforms: [{ name: 'texel', t: 'vec2' }, { name: 'offset', t: 'vec2' }],
  samplers: ['state'],
  body: [
    L('q', 'vec2', bin('+', ref('uv'), bin('*', ref('offset'), ref('texel')))),
    L('inside', 'f32', bin('*', bin('*', call('step', num(0), swz(ref('q'), 'x')), call('step', swz(ref('q'), 'x'), num(1))), bin('*', call('step', num(0), swz(ref('q'), 'y')), call('step', swz(ref('q'), 'y'), num(1))))),
    { k: 'out', e: bin('*', sample('state', ref('q')), ref('inside')) },
  ],
};

export const KERNELS = { WAVE_STEP, WAVE_IMPULSE, CONTACT_STAMP, GRASS_STEP, FIELD_SHIFT } as const;

// ------------------------------------------------------------------ independent CPU references
const f32 = Math.fround;
export interface Contact { x: number; y: number; radius: number; pressure: number } // cell units

export interface GrassParams { k: number; kc: number; c: number; maxBend: number; dt: number; wind: [number, number]; gust: number; decay: number }
export const DEFAULT_GRASS: GrassParams = { k: 38, kc: 260, c: 7.5, maxBend: 1.25, dt: 1 / 60, wind: [0.8, 0.3], gust: 0.4, decay: 0.9952 };

/** Contact + grass fields on typed arrays (no per-cell objects). */
export class GrassField {
  readonly contact: Float32Array; // RGBA: pressure, pushX, pushZ, 1
  readonly state: Float32Array; // RGBA: bendX, bendZ, ωX, ωZ
  t = 0; steps = 0;
  /** Window origin in world cells (gust phase is world-anchored). */
  org: [number, number] = [0, 0];
  constructor(readonly n: number, readonly p: GrassParams = DEFAULT_GRASS) {
    if (p.dt * Math.sqrt(p.k + p.kc) >= 2) throw new RangeError(`grass step unstable: dt·√(k+kc) = ${(p.dt * Math.sqrt(p.k + p.kc)).toFixed(3)} ≥ 2`);
    this.contact = new Float32Array(n * n * 4); this.state = new Float32Array(n * n * 4);
    for (let i = 0; i < n * n; i++) this.contact[i * 4 + 3] = 1;
  }
  stamp(feet: Contact[]) {
    const { n } = this, d = this.p.decay;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const o = (y * n + x) * 4;
      let press = f32(this.contact[o]! * d), px = f32(this.contact[o + 1]! * d), pz = f32(this.contact[o + 2]! * d);
      for (let i = 0; i < CONTACT_SLOTS; i++) {
        const f = feet[i] ?? { x: -1e4, y: -1e4, radius: 1, pressure: 0 };
        const dx = f32(x - f.x), dy = f32(y - f.y), r = f32(Math.hypot(dx, dy));
        const e0 = f.radius * 0.6, e1 = f.radius, t = Math.min(1, Math.max(0, (r - e0) / (e1 - e0)));
        const pp = f32(f.pressure * (1 - t * t * (3 - 2 * t)));
        press = Math.max(press, pp);
        const den = Math.max(r, 0.5);
        px = f32(px + (dx / den) * pp); pz = f32(pz + (dy / den) * pp);
      }
      const pl = Math.max(Math.hypot(px, pz), 1);
      this.contact[o] = Math.min(press, 1); this.contact[o + 1] = px / pl; this.contact[o + 2] = pz / pl;
    }
  }
  step() {
    const { n, p } = this;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const o = (y * n + x) * 4;
      const pr = this.contact[o]!, tX = this.contact[o + 1]! * p.maxBend, tZ = this.contact[o + 2]! * p.maxBend;
      const cx = x + 0.5 + this.org[0], cy = y + 0.5 + this.org[1];
      const g = 0.6 + p.gust * Math.sin(this.t * 1.7 + 0.37 * (cx + 0.61 * cy));
      for (let a = 0; a < 2; a++) {
        const b = this.state[o + a]!, w = this.state[o + 2 + a]!, tg = a ? tZ : tX;
        const acc = -p.k * b + p.kc * pr * (tg - b) + p.wind[a]! * g;
        const w2 = (w + p.dt * acc) / (1 + p.c * p.dt);
        this.state[o + 2 + a] = w2; this.state[o + a] = b + p.dt * w2;
      }
    }
    this.t += p.dt; this.steps++;
  }
  /** Uniform values for the DSL kernels at the current time (phase couples gusts to t). */
  uniforms() { const p = this.p; return { grass: { res: [this.n, this.n], dt: p.dt, k: p.k, kc: p.kc, c: p.c, maxBend: p.maxBend, wind: p.wind as number[], gust: p.gust, phase: this.t * 1.7, org: [...this.org] }, contact: { res: [this.n, this.n], decay: p.decay } }; }
  bendAt(x: number, y: number) { const o = (y * this.n + x) * 4; return Math.hypot(this.state[o]!, this.state[o + 1]!); }
}

/** Contact discs → the four uniform slots (unused slots get zero pressure far away). */
export function contactUniforms(feet: Contact[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (let i = 0; i < CONTACT_SLOTS; i++) { const f = feet[i]; out[`foot${i}`] = f ? [f.x, f.y, f.radius, f.pressure] : [-1e4, -1e4, 1, 0]; }
  return out;
}
