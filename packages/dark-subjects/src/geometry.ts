// Division IV: ImageAndWorldGeometry — PerceptualLOD and camera salience;
// Division III: Matrix Loom (port of the university loom:// compiler);
// Division VI: World Loom weave (port of the university elementary CA).
//
// [K] screen-space error (Cozzi & Ring, 3D Engine Design for Virtual Globes),
//     pinhole projection, elementary cellular automata (Wolfram 1983),
//     homogeneous 2D transforms. [C] projection-loss declarations per LOD stratum.

// ---------------------------------------------------------------- PerceptualLOD
export interface LodLevel { level: number; geometricErrorM: number; keeps: string[]; loses: string[] }

export const BUILDING_LODS: LodLevel[] = [
  { level: 0, geometricErrorM: 0.05, keeps: ['bays', 'window frames', 'awnings', 'sign glyphs', 'PBR normal detail'], loses: [] },
  { level: 1, geometricErrorM: 0.5, keeps: ['bays', 'window grid (texture)', 'sign emission'], loses: ['window frame depth', 'awning geometry', 'normal-map microdetail'] },
  { level: 2, geometricErrorM: 3, keeps: ['footprint extrusion', 'height', 'palette', 'lit-window pattern'], loses: ['bay geometry', 'sign legibility', 'material texture'] },
];

/** Screen-space error in pixels for geometric error e at distance d with vertical FOV (deg) and viewport height (px). */
export function screenSpaceError(e: number, d: number, fovDeg: number, viewportPx: number): number {
  return (e * viewportPx) / (2 * Math.max(0.01, d) * Math.tan(((fovDeg / 2) * Math.PI) / 180));
}

/** Choose the coarsest level whose SSE stays ≤ tolerance px; importance (faces, vehicles, signs) tightens tolerance. */
export function chooseLod(d: number, fovDeg: number, viewportPx: number, tolerancePx = 2, importance = 1, levels = BUILDING_LODS): LodLevel {
  const tol = tolerancePx / Math.max(0.25, importance);
  for (let i = levels.length - 1; i >= 0; i--) if (screenSpaceError(levels[i]!.geometricErrorM, d, fovDeg, viewportPx) <= tol) return levels[i]!;
  return levels[0]!;
}

export interface SalienceInput {
  inFrustum: boolean; unoccluded: boolean; projectedAreaPx: number; contrast: number; motion: number; dwellS: number;
}
export type VisibilityClass = 'outside' | 'frustum-candidate' | 'occluded' | 'rendered-visible' | 'salient';

/** Deterministic weighted salience PROXY (uncalibrated). Being rendered is not being noticed. */
export function salience(s: SalienceInput): { score: number; cls: VisibilityClass } {
  if (!s.inFrustum) return { score: 0, cls: 'outside' };
  if (!s.unoccluded) return { score: 0, cls: 'occluded' };
  const area = Math.min(1, s.projectedAreaPx / 20000);
  const score = 0.4 * area + 0.3 * Math.min(1, (s.contrast - 1) / 6) + 0.15 * Math.min(1, s.motion) + 0.15 * Math.min(1, s.dwellS / 2);
  return { score, cls: score > 0.45 ? 'salient' : s.projectedAreaPx > 4 ? 'rendered-visible' : 'frustum-candidate' };
}

// ---------------------------------------------------------------- Matrix Loom
export type Mat3 = [[number, number, number], [number, number, number], [number, number, number]];
const I3 = (): Mat3 => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r = I3();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i]![j] = a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!;
  return r;
}

function rational(s: string): number | null {
  const m = /^(-?\d{1,6})(?:\/(\d{1,6}))?$/.exec(s.trim());
  if (!m) return null;
  const d = m[2] ? Number(m[2]) : 1;
  return d === 0 ? null : Number(m[1]) / d;
}

/** Compile `loom://<res>/START/OP…/COMMIT` to one homogeneous matrix (exact rotations only, as the university compiler). */
export function compileLoom(address: string): { ok: boolean; matrix: Mat3 | null; states: string[]; error?: string } {
  const m = /^loom:\/\/([a-z0-9-]{1,32})((?:\/[^/\s]+)*)\/?$/i.exec(address.trim());
  if (!m) return { ok: false, matrix: null, states: [], error: 'malformed address' };
  let state = 'idle';
  const states = [state];
  let M = I3();
  for (const raw of (m[2] ?? '').split('/').filter(Boolean)) {
    if (state === 'rejected') break;
    const i = raw.indexOf(':');
    const op = (i < 0 ? raw : raw.slice(0, i)).toUpperCase();
    let arg = i < 0 ? '' : raw.slice(i + 1);
    try { arg = decodeURIComponent(arg); } catch { /* keep */ }
    let T: Mat3 | null = null;
    if (op === 'START') state = state === 'idle' ? 'open' : 'rejected';
    else if (op === 'COMMIT') state = state === 'open' ? 'committed' : 'rejected';
    else if (state !== 'open') state = 'rejected';
    else {
      if (op === 'ROTATE') {
        const d = Number(arg);
        const k = Number.isInteger(d) ? ((d % 360) + 360) % 360 : -1;
        const cs: Record<number, [number, number]> = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] };
        const v = cs[k];
        if (v) T = [[v[0], -v[1], 0], [v[1], v[0], 0], [0, 0, 1]];
      } else if (op === 'SCALE') {
        const [a, b] = arg.split(','); const sx = rational(a ?? ''); const sy = b !== undefined ? rational(b) : sx;
        if (sx !== null && sy !== null) T = [[sx, 0, 0], [0, sy, 0], [0, 0, 1]];
      } else if (op === 'SHIFT') {
        const [a, b] = arg.split(','); const tx = rational(a ?? ''), ty = rational(b ?? '');
        if (tx !== null && ty !== null) T = [[1, 0, tx], [0, 1, ty], [0, 0, 1]];
      } else if (op === 'SHEAR') {
        const k = rational(arg); if (k !== null) T = [[1, k, 0], [0, 1, 0], [0, 0, 1]];
      } else if (op === 'REFLECT') {
        if (arg === 'x') T = [[1, 0, 0], [0, -1, 0], [0, 0, 1]];
        if (arg === 'y') T = [[-1, 0, 0], [0, 1, 0], [0, 0, 1]];
      }
      if (T) M = mul3(T, M); else state = 'rejected';
    }
    states.push(state);
  }
  return { ok: state === 'committed', matrix: state === 'committed' ? M : null, states };
}

export function applyMat3(m: Mat3, x: number, y: number): [number, number] {
  return [m[0][0] * x + m[0][1] * y + m[0][2], m[1][0] * x + m[1][1] * y + m[1][2]];
}

// ---------------------------------------------------------------- World Loom weave
export function stepRule(row: number[], rule: number): number[] {
  const n = row.length;
  return row.map((_, i) => ((rule >> ((row[(i - 1 + n) % n]! << 2) | (row[i]! << 1) | row[(i + 1) % n]!)) & 1));
}

export function weave(rule: number, width: number, rows: number): number[][] {
  if (!Number.isInteger(rule) || rule < 0 || rule > 255) throw new RangeError('rule must be an integer in [0, 255]');
  let row: number[] = Array.from({ length: width }, (_, i) => (i === Math.floor(width / 2) ? 1 : 0));
  const out = [row];
  for (let t = 1; t < rows; t++) { row = stepRule(row, rule); out.push(row); }
  return out;
}
