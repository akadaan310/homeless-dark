// v4.1 material laws (§05, §07, §08). Pure and deterministic; the world authority admits the
// events that drive them and the renderer projects their state.
//
// Declared fidelity: glass = authored calibration of a brittle pane (energy threshold scaling
// with thickness², sub-critical damage accumulation in the style of a Miner's-rule sum,
// radial + concentric fracture topology). It is a plausible game model, NOT fracture mechanics.
// Tyre friction = textbook-range peak μ for asphalt (dry ≈ 0.9, wet ≈ 0.5–0.6) with a
// water-film reduction; values are representative, not measured for this street.

// ------------------------------------------------------------------ glass
export interface GlassSpec { id: string; width: number; height: number; thickness: number; density: number; seed: number }
export interface Impact { u: number; v: number; energy: number; t: number; actor: string; eventId: string | null }
export interface Crack { a: [number, number]; b: [number, number]; gen: number }
export interface Shard { poly: [number, number][]; area: number; mass: number; centroid: [number, number] }
export interface GlassState { damage: number; impacts: Impact[]; cracks: Crack[]; scratches: number; broken: boolean; revision: number; shards: Shard[] }

export const GLASS_DENSITY = 2500; // kg/m³ soda-lime
/** Single-blow fracture energy for the pane (authored calibration: 3 J at 6 mm, ∝ thickness²). */
export const criticalEnergy = (s: GlassSpec) => 3.0 * (s.thickness / 0.006) ** 2;
export const newGlass = (): GlassState => ({ damage: 0, impacts: [], cracks: [], scratches: 0, broken: false, revision: 0, shards: [] });

const rng = (seed: number) => { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 4294967296; };

export interface ImpactResult { state: GlassState; outcome: 'none' | 'scratch' | 'crack' | 'fracture' | 'refused'; reason: string }

/**
 * Apply one admitted contact. `tangential` contacts scratch (no structural damage);
 * normal impacts below the threshold add damage (E/Ec)² and grow radial cracks; damage ≥ 1
 * or a single super-critical blow fractures the pane into bounded shards.
 */
export function applyImpact(spec: GlassSpec, st: GlassState, imp: Impact, tangential = false): ImpactResult {
  if (st.broken) return { state: st, outcome: 'refused', reason: 'pane already fractured' };
  if (!(imp.energy >= 0 && imp.energy < 5000) || imp.u < 0 || imp.u > 1 || imp.v < 0 || imp.v > 1) return { state: st, outcome: 'refused', reason: 'infeasible contact (energy or location out of range)' };
  const s: GlassState = { ...st, impacts: [...st.impacts, imp], cracks: [...st.cracks], revision: st.revision + 1 };
  const ec = criticalEnergy(spec);
  if (tangential) { s.scratches += imp.energy * 0.2; return { state: s, outcome: 'scratch', reason: 'tangential contact: surface scratch only' }; }
  const r = imp.energy / ec;
  if (r < 0.04) return { state: s, outcome: 'none', reason: 'below damage threshold (elastic)' };
  s.damage = Math.min(1, st.damage + r * r * 0.9);
  // radial cracks from the impact point; length grows with energy
  const R = rng(spec.seed ^ Math.round(imp.u * 9973) ^ Math.round(imp.v * 7919) ^ s.revision);
  const n = Math.min(9, 3 + Math.floor(r * 6));
  const len = Math.min(0.6, 0.05 + 0.35 * r);
  for (let i = 0; i < n; i++) {
    const a = ((i + R() * 0.6) / n) * Math.PI * 2;
    let p: [number, number] = [imp.u, imp.v];
    const seg = 3;
    for (let k = 0; k < seg; k++) {
      const q: [number, number] = [clamp01(p[0] + (Math.cos(a + (R() - 0.5) * 0.5) * len) / seg / (spec.width / spec.height)), clamp01(p[1] + (Math.sin(a + (R() - 0.5) * 0.5) * len) / seg)];
      s.cracks.push({ a: p, b: q, gen: s.revision }); p = q;
    }
  }
  if (s.damage >= 1 || r >= 1) {
    s.broken = true; s.damage = 1;
    s.shards = fracture(spec, imp, R);
    return { state: s, outcome: 'fracture', reason: r >= 1 ? `single blow ${imp.energy.toFixed(2)} J ≥ critical ${ec.toFixed(2)} J` : `accumulated damage reached 1 after ${s.impacts.length} impacts` };
  }
  return { state: s, outcome: 'crack', reason: `damage ${s.damage.toFixed(3)} (E/Ec = ${r.toFixed(3)})` };
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Radial × concentric partition of the pane (in metres, origin bottom-left) around the impact. Area-conserving. */
export function fracture(spec: GlassSpec, imp: Impact, R = rng(spec.seed)): Shard[] {
  const W = spec.width, H = spec.height, c: [number, number] = [imp.u * W, imp.v * H];
  const sectors = 8, rings = 3, rMax = Math.hypot(Math.max(c[0], W - c[0]), Math.max(c[1], H - c[1])) * 1.01;
  const radii = [0, ...Array.from({ length: rings - 1 }, (_, i) => rMax * ((i + 1) / rings) ** 1.3 * (0.85 + R() * 0.3)), rMax * 4];
  const angles = Array.from({ length: sectors }, (_, i) => ((i + 0.2 + R() * 0.6) / sectors) * Math.PI * 2).sort((a, b) => a - b);
  const rect: [number, number][] = [[0, 0], [W, 0], [W, H], [0, H]];
  const shards: Shard[] = [];
  for (let s = 0; s < sectors; s++) {
    const a0 = angles[s]!, a1 = s + 1 < sectors ? angles[s + 1]! : angles[0]! + Math.PI * 2;
    for (let k = 0; k < rings; k++) {
      // annular sector polygon, clipped to the pane rectangle
      const r0 = radii[k]!, r1 = radii[k + 1]!, steps = 6, poly: [number, number][] = [];
      for (let i = 0; i <= steps; i++) { const a = a0 + ((a1 - a0) * i) / steps; poly.push([c[0] + Math.cos(a) * r1, c[1] + Math.sin(a) * r1]); }
      if (r0 === 0) poly.push(c); else for (let i = steps; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / steps; poly.push([c[0] + Math.cos(a) * r0, c[1] + Math.sin(a) * r0]); }
      const clipped = clipPolygon(poly, rect);
      const area = polyArea(clipped);
      if (area < 1e-6) continue;
      shards.push({ poly: clipped, area, mass: area * spec.thickness * spec.density, centroid: centroid(clipped) });
    }
  }
  return shards;
}

export function polyArea(p: [number, number][]) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i]!, r = p[(i + 1) % p.length]!; a += q[0] * r[1] - r[0] * q[1]; } return Math.abs(a) / 2; }
function centroid(p: [number, number][]): [number, number] { let x = 0, y = 0; for (const q of p) { x += q[0]; y += q[1]; } return [x / p.length, y / p.length]; }
/** Sutherland–Hodgman clip of a polygon against a convex clip polygon (CCW). */
export function clipPolygon(subject: [number, number][], clip: [number, number][]): [number, number][] {
  let out = subject;
  for (let i = 0; i < clip.length; i++) {
    const A = clip[i]!, B = clip[(i + 1) % clip.length]!;
    const inside = (p: [number, number]) => (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]) >= 0;
    const inter = (p: [number, number], q: [number, number]): [number, number] => {
      const a1 = B[1] - A[1], b1 = A[0] - B[0], c1 = a1 * A[0] + b1 * A[1];
      const a2 = q[1] - p[1], b2 = p[0] - q[0], c2 = a2 * p[0] + b2 * p[1], d = a1 * b2 - a2 * b1;
      return [(b2 * c1 - b1 * c2) / d, (a1 * c2 - a2 * c1) / d];
    };
    const inp = out; out = [];
    for (let j = 0; j < inp.length; j++) {
      const P = inp[j]!, Q = inp[(j + 1) % inp.length]!;
      if (inside(Q)) { if (!inside(P)) out.push(inter(P, Q)); out.push(Q); } else if (inside(P)) out.push(inter(P, Q));
    }
    if (!out.length) break;
  }
  return out;
}

// ------------------------------------------------------------------ tyre–road friction
export type RoadSurface = 'asphalt' | 'wet_asphalt' | 'concrete' | 'grass' | 'wood' | 'unknown';
const DRY_MU: Record<RoadSurface, number> = { asphalt: 0.9, wet_asphalt: 0.9, concrete: 0.85, grass: 0.45, wood: 0.6, unknown: 0.7 };
/** Peak friction coefficient: wetness lowers μ toward ≈0.55 on asphalt; standing water (puddle) toward ≈0.3 (aquaplaning onset at speed). */
export function tyreFriction(surface: RoadSurface, wetness: number, puddle: number, speedMps = 0): number {
  const base = DRY_MU[surface];
  const w = Math.min(1, Math.max(0, wetness)), p = Math.min(1, Math.max(0, puddle));
  const wet = base * (1 - 0.38 * w);
  const plane = 1 - 0.45 * p * Math.min(1, Math.max(0, (speedMps - 8) / 14));
  return Math.max(0.2, wet * (1 - 0.15 * p) * plane);
}

// ------------------------------------------------------------------ physical presence contracts (§05)
export type Fidelity = 'scientific_model' | 'plausible_approximation' | 'art_directed' | 'static_scenery' | 'unavailable';
export interface PhysicalPresenceContract {
  identity: string; geometry: string; sourceStatus: 'verified' | 'derived' | 'authored' | 'unavailable';
  materialModel: string; fidelity: Fidelity; units: Record<string, string>; stateChannels: string[];
  collision: 'trimesh' | 'box' | 'capsule' | 'raycast_vehicle' | 'dynamic_shards' | 'none';
  contactLaw: string; responseOperators: string[]; coupledFields: string[]; observers: string[];
  LOD: string; errorBounds: string; memoryBudget: string; verificationTests: string[]; provenance: string; epistemicStatus: string;
  touchable: boolean;
}
export function checkContract(c: PhysicalPresenceContract): string[] {
  const e: string[] = [];
  const req: (keyof PhysicalPresenceContract)[] = ['identity', 'geometry', 'materialModel', 'contactLaw', 'LOD', 'errorBounds', 'memoryBudget', 'provenance', 'epistemicStatus'];
  for (const k of req) if (!c[k] || String(c[k]).trim() === '') e.push(`${c.identity}: missing ${k}`);
  if (c.touchable && c.collision === 'none') e.push(`${c.identity}: touchable but has no collision proxy`);
  if (c.touchable && c.responseOperators.length === 0 && c.fidelity !== 'static_scenery') e.push(`${c.identity}: touchable without response operators`);
  if (c.touchable && c.verificationTests.length === 0) e.push(`${c.identity}: no verification tests`);
  if (c.fidelity === 'scientific_model' && !/[0-9]/.test(c.errorBounds)) e.push(`${c.identity}: scientific model without a numeric error bound`);
  return e;
}
/** Render surface vs physics proxy compatibility: axis-aligned bounds must overlap with IoU ≥ min. */
export function boundsCompatible(render: { min: number[]; max: number[] }, proxy: { min: number[]; max: number[] }, minIoU = 0.5): { ok: boolean; iou: number } {
  let inter = 1, ua = 1, ub = 1;
  for (let k = 0; k < 3; k++) {
    const lo = Math.max(render.min[k]!, proxy.min[k]!), hi = Math.min(render.max[k]!, proxy.max[k]!);
    const pad = 0.02; // thin panels: treat a 2 cm slab as volumetric
    inter *= Math.max(0, hi - lo + pad); ua *= render.max[k]! - render.min[k]! + pad; ub *= proxy.max[k]! - proxy.min[k]! + pad;
  }
  const iou = inter / (ua + ub - inter);
  return { ok: iou >= minIoU, iou };
}
