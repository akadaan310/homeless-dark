// HOMELESS material fields (v4.1 §03–§08): the SAME DSL kernels the laboratory and the CPU
// reference execute, stepped on the GPU every frame and sampled by the renderer.
//  · Grass: a 16 m world-aligned window (256² cells, 6.25 cm) of blade state, driven by a
//    contact field stamped from actual foot-bone positions of the player and nearby NPCs.
//  · Ripples: a 24 m window damped-wave field; impulses come from footsteps and tyres that
//    land in standing water (puddle cover from the same depression law as the wet shader)
//    and from raindrops. The wet material reads it as surface slope.
// Layering (§03): world/collision authority → these fields → camera/display sampling.
import { Mesh, Material, Geometry, Attribute, Texture, Vec3 } from '@astro/core';
import { GpuFieldSet, type Renderer } from '@astro/render-webgl2';
import { CONTACT_STAMP, GRASS_STEP, FIELD_SHIFT, WAVE_STEP, WAVE_IMPULSE, DEFAULT_GRASS, contactUniforms, CONTACT_SLOTS, type Contact } from '@astro/pixels';

// ------------------------------------------------------------------ puddle law (CPU mirror of the wet shader)
const fract = (x: number) => x - Math.floor(x);
function darkHash(px: number, py: number) {
  let x = fract(px * 123.34), y = fract(py * 456.21);
  const d = x * (x + 45.32) + y * (y + 45.32);
  x += d; y += d;
  return fract(x * y);
}
function darkNoise(px: number, py: number) {
  const ix = Math.floor(px), iy = Math.floor(py);
  let fx = px - ix, fy = py - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = darkHash(ix, iy), b = darkHash(ix + 1, iy), c = darkHash(ix, iy + 1), d = darkHash(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
/** Authored depression field (0..1) — identical formula to `darkDepression` in the forward shader. */
export const depression = (x: number, z: number) => 0.55 * darkNoise(x * 0.18, z * 0.18) + 0.3 * darkNoise(x * 0.61 + 3.1, z * 0.61 + 3.1) + 0.15 * darkNoise(x * 1.7 + 7.3, z * 1.7 + 7.3);
/** Standing-water cover at a point for the current puddle level (same law as the shader). */
export const puddleCover = (x: number, z: number, puddle: number) => Math.min(1, Math.max(0, (depression(x, z) - 0.55) * 3)) * puddle;

// ------------------------------------------------------------------ surface mask (where real grass ground is)
/** Rasterise non-grass triangles (roads, walks, footprints) into an R8 mask: 255 = grass ground. */
export function rasterMask(size: number, res: number, origin: [number, number], blockers: Geometry[]): { tex: Texture; data: Uint8Array; cellM: number } {
  const data = new Uint8Array(res * res).fill(255), cell = size / res;
  const tri = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => {
    const toC = (x: number, z: number) => [(x - origin[0]) / cell, (z - origin[1]) / cell] as const;
    const [x0, y0] = toC(ax, az), [x1, y1] = toC(bx, bz), [x2, y2] = toC(cx, cz);
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 1)), maxX = Math.min(res - 1, Math.ceil(Math.max(x0, x1, x2) + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 1)), maxY = Math.min(res - 1, Math.ceil(Math.max(y0, y1, y2) + 1));
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-9) return;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      // conservative: test the cell centre with a half-cell dilation so blades never poke through kerbs
      let inside = false;
      for (const [ox, oy] of [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const px = x + ox, py = y + oy;
        const w0 = (x1 - px) * (y2 - py) - (x2 - px) * (y1 - py), w1 = (x2 - px) * (y0 - py) - (x0 - px) * (y2 - py), w2 = (x0 - px) * (y1 - py) - (x1 - px) * (y0 - py);
        if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) { inside = true; break; }
      }
      if (inside) data[y * res + x] = 0;
    }
  };
  for (const g of blockers) {
    const p = g.getAttribute('position'), idx = g.index?.array;
    const n = idx ? idx.length : p.count;
    for (let i = 0; i + 2 < n; i += 3) {
      const a = idx ? idx[i]! : i, b = idx ? idx[i + 1]! : i + 1, c = idx ? idx[i + 2]! : i + 2;
      tri(p.getX(a), p.getZ(a), p.getX(b), p.getZ(b), p.getX(c), p.getZ(c));
    }
  }
  const tex = new Texture({ kind: 'data', data, width: res, height: res, channels: 1 }, 'linear', 'grass-mask');
  tex.wrap = 'clamp'; tex.filter = 'nearest'; tex.mipmaps = false;
  return { tex, data, cellM: cell };
}

// ------------------------------------------------------------------ blade geometry
/**
 * Tufts of `perTuft` blades with roots jittered in a T×T tile (toroidal). Blades of one tuft share
 * a root cell (one blade-state sample) but differ in facing, lean, height and width.
 * aCustom = (x, z, seed, height); 3 segments + pointed tip per blade.
 */
export function bladeGeometry(tufts: number, T: number, seed = 1, perTuft = 4): Geometry {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const SEG = 3, vpb = SEG * 2 + 1, count = tufts * perTuft;
  const pos = new Float32Array(count * vpb * 3), uv = new Float32Array(count * vpb * 2), cus = new Float32Array(count * vpb * 4), nor = new Float32Array(count * vpb * 3);
  const idx = new Uint32Array(count * ((SEG - 1) * 6 + 3));
  let ii = 0, b = 0;
  for (let t = 0; t < tufts; t++) {
    const tx = rnd() * T, tz = rnd() * T;
    for (let k = 0; k < perTuft; k++, b++) {
      const x = tx + (rnd() - 0.5) * 0.04, z = tz + (rnd() - 0.5) * 0.04, sd = rnd(), h = 0.045 + rnd() * 0.07, w = 0.006 + rnd() * 0.006;
      const lean = (rnd() - 0.5) * 0.5; // individual rest lean (curl) in blade-local x
      const base = b * vpb;
      let v = 0;
      for (let i = 0; i <= SEG; i++) {
        const u = i / SEG, half = w * (1 - u * 0.8);
        for (const side of i === SEG ? [0] : [-1, 1]) {
          const vi = base + v++;
          pos.set([side * half + lean * u * u * h, u, 0], vi * 3); uv.set([0.5 + side * 0.5, u], vi * 2); cus.set([x, z, sd, h], vi * 4); nor.set([0, 0, 1], vi * 3);
        }
      }
      for (let i = 0; i < SEG - 1; i++) { const a = base + i * 2; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], ii); ii += 6; }
      const a = base + (SEG - 1) * 2; idx.set([a, a + 1, a + 2], ii); ii += 3;
    }
  }
  const g = new Geometry();
  g.setAttribute('position', new Attribute(pos, 3)); g.setAttribute('normal', new Attribute(nor, 3)); g.setAttribute('uv', new Attribute(uv, 2)); g.setAttribute('aSplat', new Attribute(cus, 4));
  g.setIndex(idx);
  return g;
}

export interface FieldTelemetry { grassSteps: number; contacts: number; rippleSteps: number; splashes: number; drops: number; gpuPassMs: number; window: [number, number]; blades: number }

export class FieldSystem {
  readonly grass: GpuFieldSet | null = null;
  readonly ripple: GpuFieldSet | null = null;
  readonly blades: Mesh | null = null;
  readonly N = 256; readonly dx = 0.0625; // grass: 16 m window
  readonly RN = 256; readonly rdx = 0.09375; // ripples: 24 m window
  origin: [number, number] = [0, 0];
  rOrigin: [number, number] = [0, 0];
  private t = 0;
  readonly tel: FieldTelemetry = { grassSteps: 0, contacts: 0, rippleSteps: 0, splashes: 0, drops: 0, gpuPassMs: 0, window: [0, 0], blades: 0 };
  blocked: string | null = null;
  constructor(private r: Renderer, mask: { tex: Texture; origin: [number, number]; size: number } | null, bladeCount: number) {
    try {
      (this as { grass: GpuFieldSet | null }).grass = mask ? new GpuFieldSet(r.gl, this.N, this.N, ['state', 'contact']) : null;
      (this as { ripple: GpuFieldSet | null }).ripple = new GpuFieldSet(r.gl, this.RN, this.RN, ['state']);
    } catch (e) { this.blocked = (e as Error).message; return; }
    if (mask && this.grass) {
      const m = new Mesh(bladeGeometry(bladeCount, this.N * this.dx, 7), new Material({ feature: 'grass', color: 0x5a7334, side: 'double', roughness: 0.75, detailMap: mask.tex, name: 'grass blades (near field)' }));
      m.frustumCulled = false; m.receiveShadow = true; m.castShadow = false; m.epistemic = 'simulation';
      m.userData.contract = 'grass-ground';
      (this as { blades: Mesh | null }).blades = m;
      r.globals.uMaskOx = mask.origin[0]; r.globals.uMaskOz = mask.origin[1]; r.globals.uMaskSize = mask.size;
      this.tel.blades = bladeCount * 4;
    }
  }
  /** Recentre windows on the focus with whole-cell shifts (state is carried, never re-seeded). */
  private recentre(set: GpuFieldSet, org: [number, number], n: number, d: number, c: Vec3, fields: string[]) {
    const half = (n * d) / 2;
    const kx = Math.round((c.x - half - org[0]) / d), kz = Math.round((c.z - half - org[1]) / d);
    if (Math.abs(kx) * d < n * d * 0.125 && Math.abs(kz) * d < n * d * 0.125) return;
    for (const f of fields) set.run(FIELD_SHIFT, f, { offset: [kx, kz] }, { state: f });
    org[0] += kx * d; org[1] += kz * d;
  }
  /** World-space contact discs → cell-space slots; several passes when more than four feet. */
  update(dt: number, focus: Vec3, feet: { x: number; z: number; r: number; p: number }[], puddle: number, rain: number) {
    if (this.blocked) return;
    this.t += dt;
    const steps = Math.min(3, Math.max(1, Math.round(dt * 60)));
    if (this.grass) {
      const g = this.grass;
      this.recentre(g, this.origin, this.N, this.dx, focus, ['state', 'contact']);
      const cells: Contact[] = feet.map((f) => ({ x: (f.x - this.origin[0]) / this.dx - 0.5, y: (f.z - this.origin[1]) / this.dx - 0.5, radius: f.r / this.dx, pressure: f.p }));
      const P = DEFAULT_GRASS;
      for (let s = 0; s < steps; s++) {
        for (let i = 0; i < Math.max(1, Math.ceil(cells.length / CONTACT_SLOTS)); i++)
          g.run(CONTACT_STAMP, 'contact', { res: [this.N, this.N], decay: i === 0 ? P.decay : 1, ...contactUniforms(cells.slice(i * CONTACT_SLOTS, i * CONTACT_SLOTS + CONTACT_SLOTS)) }, { contact: 'contact' });
        g.run(GRASS_STEP, 'state', { res: [this.N, this.N], dt: P.dt, k: P.k, kc: P.kc, c: P.c, maxBend: P.maxBend, wind: P.wind as number[], gust: P.gust, phase: (this.t + s * P.dt) * 1.7, org: [this.origin[0] / this.dx, this.origin[1] / this.dx] }, { state: 'state', contact: 'contact' });
        this.tel.grassSteps++;
      }
      this.tel.contacts = cells.length;
      this.r.fieldTextures.grassState = g.texture('state');
      Object.assign(this.r.globals, { uGrassOx: this.origin[0], uGrassOz: this.origin[1], uGrassCell: this.dx, uGrassRes: this.N, uGrassY: -0.005 });
    }
    if (this.ripple) {
      const w = this.ripple;
      this.recentre(w, this.rOrigin, this.RN, this.rdx, focus, ['state']);
      // raindrops on standing water: Poisson-like count per frame ∝ rain intensity
      if (rain > 0.05 && puddle > 0.05) {
        const drops = Math.floor(rain * 14 * dt * 60 * 0.25);
        for (let i = 0; i < drops; i++) w.run(WAVE_IMPULSE, 'state', { center: [Math.random() * this.RN, Math.random() * this.RN], amp: 0.012, rad: 1, res: [this.RN, this.RN] }, {});
        this.tel.drops += drops;
      }
      for (let s = 0; s < steps; s++) { w.run(WAVE_STEP, 'state', { k: (0.35 * 0.35) / (this.rdx * this.rdx), dt: 1 / 60, damp: 1.8 }, {}); this.tel.rippleSteps++; }
      this.r.fieldTextures.ripple = w.texture('state');
      Object.assign(this.r.globals, { uRippleOx: this.rOrigin[0], uRippleOz: this.rOrigin[1], uRippleSize: this.RN * this.rdx, uRippleRes: this.RN, uRippleOn: puddle > 0.02 ? 1 : 0 });
    }
    this.tel.gpuPassMs = (this.grass?.lastMs ?? 0) + (this.ripple?.lastMs ?? 0);
    this.tel.window = [+this.origin[0].toFixed(2), +this.origin[1].toFixed(2)];
  }
  /** A contact landing in standing water (footstep, tyre): ripple impulse proportional to the water depth proxy. */
  splash(x: number, z: number, cover: number, strength = 1) {
    if (!this.ripple || cover <= 0.05) return false;
    const cx = (x - this.rOrigin[0]) / this.rdx - 0.5, cz = (z - this.rOrigin[1]) / this.rdx - 0.5;
    if (cx < 1 || cz < 1 || cx > this.RN - 2 || cz > this.RN - 2) return false;
    this.ripple.run(WAVE_IMPULSE, 'state', { center: [cx, cz], amp: 0.08 * cover * strength, rad: 2, res: [this.RN, this.RN] }, {});
    this.tel.splashes++;
    return true;
  }
  /** GPU readback witness of the blade field around a world point (debug/test only: stalls the pipeline). */
  grassWitness(x: number, z: number, radiusM = 0.4) {
    if (!this.grass) return null;
    const st = this.grass.read('state'), ct = this.grass.read('contact');
    const cx = Math.floor((x - this.origin[0]) / this.dx), cz = Math.floor((z - this.origin[1]) / this.dx), R = Math.ceil(radiusM / this.dx);
    let maxBend = 0, maxPress = 0;
    for (let j = cz - R; j <= cz + R; j++) for (let i = cx - R; i <= cx + R; i++) {
      if (i < 0 || j < 0 || i >= this.N || j >= this.N) continue;
      const o = (j * this.N + i) * 4;
      maxBend = Math.max(maxBend, Math.hypot(st[o]!, st[o + 1]!)); maxPress = Math.max(maxPress, ct[o]!);
    }
    return { at: [x, z], cell: [cx, cz], maxBendRad: maxBend, maxPressure: maxPress, origin: [...this.origin], steps: this.tel.grassSteps, model: 'grass_step (art-directed elastic blade)', epistemic: 'simulation' };
  }
  dispose() { this.grass?.dispose(); this.ripple?.dispose(); this.r.fieldTextures.grassState = null; this.r.fieldTextures.ripple = null; this.r.globals.uRippleOn = 0; }
}
