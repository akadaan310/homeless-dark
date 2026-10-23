// Tetradic substrate objects (§031–§037). T = (FORM, IN_FORM, TRANSFORM, INFORM).
// IN_FORM is the formally specified complement/forbidden context relative to a DECLARED
// universe — not "inorganic". UNKNOWN is never NOT (§032): no negation-as-failure.

export type Truth = 'TRUE' | 'NOT' | 'UNKNOWN' | 'INCOMPATIBLE';

export interface Universe { id: string; members: readonly string[]; closedWorld: boolean }

export interface Tetrad<F = unknown> {
  form: { structure: F; observed: boolean };
  inForm: { universe: string; forbidden: readonly string[] };
  transform: { op: string; admissible: boolean };
  inform: { evidence: string[]; grounded: boolean };
  source: string;
  epistemic: 'established' | 'construction' | 'hypothesis' | 'tested' | 'refuted' | 'unknown';
}

/** Membership with explicit open/closed world semantics. */
export function holds(u: Universe, x: string, known: ReadonlySet<string>, contradicted: ReadonlySet<string> = new Set()): { value: Truth; scope: string; source: string } {
  if (contradicted.has(x)) return { value: 'INCOMPATIBLE', scope: u.id, source: 'explicit incompatible evidence' };
  if (known.has(x)) return { value: 'TRUE', scope: u.id, source: 'positive evidence' };
  if (!u.members.includes(x)) return { value: 'NOT', scope: u.id, source: 'outside the declared universe (complement)' };
  return u.closedWorld ? { value: 'NOT', scope: u.id, source: 'closed-world declaration' } : { value: 'UNKNOWN', scope: u.id, source: 'open corpus: absence of evidence is not evidence of absence' };
}

export function complement(u: Universe, set: readonly string[]): string[] { return u.members.filter((m) => !set.includes(m)); }

export function validateTetrad(t: Tetrad): string[] {
  const e: string[] = [];
  if (!t.source) e.push('source required');
  if (!t.inForm.universe) e.push('IN_FORM must name its universe');
  if (t.form.observed && t.inForm.forbidden.length === 0 && t.epistemic === 'established') e.push('an established tetrad must state its forbidden context');
  if (t.inform.grounded && t.inform.evidence.length === 0) e.push('grounded INFORM requires evidence');
  if (!t.transform.admissible && t.inform.grounded) e.push('an inadmissible TRANSFORM cannot yield grounded INFORM');
  return e;
}

// ---------------------------------------------------------------- substrate predicate (§035)
export interface SubstrateClaim { carrier?: string; signature?: string[]; operations?: string[]; observationRegime?: string; boundaries?: string; invariants?: string[]; witnesses?: string[] }
export function admitSubstrate(c: SubstrateClaim): { admitted: boolean; missing: string[] } {
  const req: (keyof SubstrateClaim)[] = ['carrier', 'signature', 'operations', 'observationRegime', 'boundaries', 'invariants', 'witnesses'];
  const missing = req.filter((k) => { const v = c[k]; return v === undefined || (Array.isArray(v) && v.length === 0) || v === ''; });
  return { admitted: missing.length === 0, missing };
}

// ---------------------------------------------------------------- relative primitives (§036)
export interface QUnit { id: string; schema: string; parts: string[] }
/** Refine a unit under a new observation schema; report kept / collapsed / newly observed. */
export function refine(u: QUnit, newSchema: string, observe: (part: string) => string[]): { unit: QUnit; kept: string[]; collapsed: string[]; newlyObserved: string[] } {
  const kept: string[] = [], collapsed: string[] = [], newly: string[] = [];
  const parts: string[] = [];
  for (const p of u.parts) {
    const sub = observe(p);
    if (sub.length === 0) collapsed.push(p);
    else if (sub.length === 1 && sub[0] === p) { kept.push(p); parts.push(p); }
    else { newly.push(...sub); parts.push(...sub); }
  }
  return { unit: { id: `${u.id}@${newSchema}`, schema: newSchema, parts }, kept, collapsed, newlyObserved: newly };
}

// ---------------------------------------------------------------- alphabet towers (§037)
export interface TowerMap { from: string; to: string; invertible: boolean; loss: string }
export const RENDER_TOWER: TowerMap[] = [
  { from: 'input symbols', to: 'compiled operations', invertible: true, loss: 'none (typed parse; refusals certified)' },
  { from: 'compiled operations', to: 'graph edges', invertible: true, loss: 'none for admitted ops (witness retains op log)' },
  { from: 'graph edges', to: 'scene primitives', invertible: false, loss: 'layout coordinates are chosen, not implied by the graph' },
  { from: 'scene primitives', to: 'radiance', invertible: false, loss: 'shading integrates geometry, light and material; many scenes → one image' },
  { from: 'radiance', to: 'display pixels', invertible: false, loss: 'tone mapping, quantization, resampling (kernel growth, §058)' },
];
