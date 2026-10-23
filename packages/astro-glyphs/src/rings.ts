// P-Chem abstract ring grammar (§026–§028, §033, §115) and the O-Chem atlas catalog (§025, §030).
// A template G_{s,n} = (V_n, E_n, label = s) is a FORMAL combinatorial cycle. Its chemical
// realizability is unknown; no template is ever auto-certified as a molecule.
import { A0_TOKENS } from './symbols';
import atlas from '../data/ochem-atlas-66.json';

export interface RingGraph { id: string; label: string | null; n: number; edges: [number, number][]; marks: Record<number, string>; epistemic: 'abstract_grammar_only'; chemical_admission: false }

export const RING_SIZES = [3, 4, 5, 6, 7, 8] as const;

export function cycle(label: string | null, n: number): RingGraph {
  if (!Number.isInteger(n) || n < 3 || n > 64) throw new RangeError('cycle size must be an integer in [3, 64]');
  return { id: `P:${label ?? '_'}:CYCLE_${n}`, label, n, edges: Array.from({ length: n }, (_, i) => [i, (i + 1) % n] as [number, number]), marks: {}, epistemic: 'abstract_grammar_only', chemical_admission: false };
}

/** 117 non-carbon labels × ring sizes 3–8 = 702 abstract templates. Carbon is the separate O-Chem baseline (§027). */
export function pchemTemplates(): RingGraph[] {
  return A0_TOKENS.filter((t) => t !== 'C').flatMap((t) => RING_SIZES.map((n) => cycle(t, n)));
}

// ---------------------------------------------------------------- invariants
export interface GraphInvariants { vertices: number; edges: number; components: number; cycleRank: number; degreeSequence: number[]; simple: boolean }
export function invariants(g: { n: number; edges: [number, number][] }): GraphInvariants {
  const deg = new Array(g.n).fill(0);
  const seen = new Set<string>();
  let simple = true;
  for (const [a, b] of g.edges) {
    if (a === b) simple = false;
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    if (seen.has(k)) simple = false;
    seen.add(k); deg[a]++; deg[b]++;
  }
  const parent = Array.from({ length: g.n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x]!)));
  for (const [a, b] of g.edges) parent[find(a)] = find(b);
  const components = new Set(Array.from({ length: g.n }, (_, i) => find(i))).size;
  return { vertices: g.n, edges: g.edges.length, components, cycleRank: g.edges.length - g.n + components, degreeSequence: [...deg].sort((x, y) => y - x), simple };
}

// ---------------------------------------------------------------- typed graph operators (§028)
export type GraphOp =
  | { op: 'NEW_EDGE'; a: number; b: number }
  | { op: 'DELETE_EDGE'; a: number; b: number }
  | { op: 'JOIN'; other: RingGraph; a: number; b: number } // ring assembly: bond between rings
  | { op: 'FUSE'; other: RingGraph; edgeA: [number, number]; edgeB: [number, number] } // share an edge
  | { op: 'SPIRO'; other: RingGraph; a: number; b: number } // share one vertex
  | { op: 'BRIDGE'; a: number; b: number; length: number } // new path between two vertices
  | { op: 'MARK'; v: number; mark: string }
  | { op: 'ROTATE'; k: number }
  | { op: 'REFLECT' };

export interface OpWitness { op: GraphOp['op']; ok: boolean; reason: string; pre: GraphInvariants; post: GraphInvariants | null; planar: boolean | 'unknown'; claim: 'none (non-chemical transformation)' }

type G = { id: string; label: string | null; n: number; edges: [number, number][]; marks: Record<number, string> };

export function applyOp(g: G, o: GraphOp): { graph: G | null; witness: OpWitness } {
  const pre = invariants(g);
  const fail = (reason: string) => ({ graph: null, witness: { op: o.op, ok: false, reason, pre, post: null, planar: 'unknown' as const, claim: 'none (non-chemical transformation)' as const } });
  const vok = (v: number, n = g.n) => Number.isInteger(v) && v >= 0 && v < n;
  const has = (a: number, b: number, e = g.edges) => e.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  let out: G;
  switch (o.op) {
    case 'NEW_EDGE':
      if (!vok(o.a) || !vok(o.b) || o.a === o.b) return fail('NEW_EDGE needs two distinct existing vertices');
      if (has(o.a, o.b)) return fail('edge already present (multigraphs are not admitted)');
      out = { ...g, edges: [...g.edges, [o.a, o.b]] }; break;
    case 'DELETE_EDGE':
      if (!has(o.a, o.b)) return fail('edge not present');
      out = { ...g, edges: g.edges.filter(([x, y]) => !((x === o.a && y === o.b) || (x === o.b && y === o.a))) }; break;
    case 'JOIN': {
      if (!vok(o.a) || !vok(o.b, o.other.n)) return fail('JOIN vertex out of range');
      const off = g.n;
      out = { ...g, id: `${g.id}+J+${o.other.id}`, n: g.n + o.other.n, edges: [...g.edges, ...o.other.edges.map(([x, y]) => [x + off, y + off] as [number, number]), [o.a, o.b + off]] }; break;
    }
    case 'FUSE': {
      if (!has(...o.edgeA) || !has(o.edgeB[0], o.edgeB[1], o.other.edges)) return fail('FUSE edges must exist in both graphs');
      const map = new Map<number, number>([[o.edgeB[0], o.edgeA[0]], [o.edgeB[1], o.edgeA[1]]]);
      let next = g.n;
      for (let v = 0; v < o.other.n; v++) if (!map.has(v)) map.set(v, next++);
      const edges = [...g.edges];
      for (const [x, y] of o.other.edges) { const a = map.get(x)!, b = map.get(y)!; if (!has(a, b, edges)) edges.push([a, b]); }
      out = { ...g, id: `${g.id}+F+${o.other.id}`, n: next, edges }; break;
    }
    case 'SPIRO': {
      if (!vok(o.a) || !vok(o.b, o.other.n)) return fail('SPIRO vertex out of range');
      const map = new Map<number, number>([[o.b, o.a]]);
      let next = g.n;
      for (let v = 0; v < o.other.n; v++) if (!map.has(v)) map.set(v, next++);
      out = { ...g, id: `${g.id}+S+${o.other.id}`, n: next, edges: [...g.edges, ...o.other.edges.map(([x, y]) => [map.get(x)!, map.get(y)!] as [number, number])] }; break;
    }
    case 'BRIDGE': {
      if (!vok(o.a) || !vok(o.b) || o.a === o.b || !Number.isInteger(o.length) || o.length < 1 || o.length > 16) return fail('BRIDGE needs distinct vertices and length 1..16');
      const edges = [...g.edges];
      let prev = o.a, n = g.n;
      for (let i = 0; i < o.length - 1; i++) { edges.push([prev, n]); prev = n++; }
      if (o.length === 1 && has(o.a, o.b)) return fail('bridge of length 1 would duplicate an edge');
      edges.push([prev, o.b]);
      out = { ...g, id: `${g.id}+B${o.length}`, n, edges }; break;
    }
    case 'MARK':
      if (!vok(o.v)) return fail('MARK vertex out of range');
      if (!/^[A-Za-z0-9*+=-]{1,8}$/.test(o.mark)) return fail('mark must be a short typed label');
      out = { ...g, marks: { ...g.marks, [o.v]: o.mark } }; break;
    case 'ROTATE': {
      const k = ((o.k % g.n) + g.n) % g.n;
      const m = (v: number) => (v + k) % g.n;
      out = { ...g, edges: g.edges.map(([x, y]) => [m(x), m(y)] as [number, number]), marks: Object.fromEntries(Object.entries(g.marks).map(([v, s]) => [m(Number(v)), s])) }; break;
    }
    case 'REFLECT': {
      const m = (v: number) => (g.n - v) % g.n;
      out = { ...g, edges: g.edges.map(([x, y]) => [m(x), m(y)] as [number, number]), marks: Object.fromEntries(Object.entries(g.marks).map(([v, s]) => [m(Number(v)), s])) }; break;
    }
  }
  const post = invariants(out);
  // Euler bound for simple planar graphs: E ≤ 3V − 6 (necessary, not sufficient) — larger means certainly nonplanar.
  const planar = post.vertices >= 3 && post.edges > 3 * post.vertices - 6 ? false : 'unknown';
  return { graph: out, witness: { op: o.op, ok: true, reason: 'admitted (syntactic graph operation)', pre, post, planar, claim: 'none (non-chemical transformation)' } };
}

// ---------------------------------------------------------------- representation types (§033)
export type RingRepresentation = 'combinatorial_cycle' | 'straight_line_embedding' | 'projected_curve' | 'molecular_graph' | 'physical_realization';
/** Refuse to read a flat polygon's interior angle as bond chemistry or sky mechanics. */
export function interpretAngle(rep: RingRepresentation, n: number, as: 'bond_angle' | 'celestial' | 'drawing'): { ok: boolean; value?: number; reason: string } {
  if (as !== 'drawing') return { ok: false, reason: `a ${rep} polygon angle is not a ${as === 'bond_angle' ? 'chemical bond angle' : 'celestial-mechanics quantity'}` };
  if (rep !== 'straight_line_embedding') return { ok: false, reason: `${rep} carries no Euclidean angle` };
  return { ok: true, value: ((n - 2) * 180) / n, reason: 'interior angle of the regular drawing only' };
}

// ---------------------------------------------------------------- O-Chem atlas (§025)
export interface AtlasEntry { id: string; row: string; col: string; name: string; smiles: string; formula: string; atoms: number; bonds: number; ringCount: number; ringSizes: number[]; aromatic: boolean; source: string; evidence: string }
export const OCHEM = atlas as unknown as { title: string; status: string; columns: string[]; rows: { key: string; title: string; family: string }[]; entries: AtlasEntry[]; rdkit: string };
export function ochemCatalog() {
  const cells = new Set(OCHEM.entries.map((e) => `${e.row}:${e.col}`));
  const families = new Set(OCHEM.rows.map((r) => r.family));
  return { entries: OCHEM.entries.length, cells: cells.size, families: families.size, rows: OCHEM.rows.length, provenance: `RDKit ${OCHEM.rdkit}; graphs generated from known SMILES (not optically recognized)` };
}
