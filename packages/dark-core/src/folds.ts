// dark-core/folds: Plicastratum (Division II) through a typed adapter.
//
// Port of Substrate University src/math/fold.ts (pinned in university-source.lock.json):
// [K] Re-Pair grammar compression (Larsson & Moffat 2000) yielding a straight-line
//     program; invariant unfold(fold(w)) = w.
// [C] "Plicastratum" naming, reading the SLP levels as strata, and DARK's
//     promotion rule: a recurring motif becomes a reusable macro only after
//     provenance, loss declaration, unfold rule, license, bounds and a held-out
//     test pass. Generalized here from characters to arbitrary token arrays.

export interface FoldRule { glyph: string; left: string; right: string; count: number }
export interface FoldState { original: string[]; current: string[]; rules: FoldRule[] }

export function startFold(tokens: string[]): FoldState {
  return { original: [...tokens], current: [...tokens], rules: [] };
}

const SEP = '\u0000';

export function digramCounts(s: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  const lastEnd = new Map<string, number>();
  for (let i = 0; i + 1 < s.length; i++) {
    const k = `${s[i]}${SEP}${s[i + 1]}`;
    if ((lastEnd.get(k) ?? -1) > i) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    lastEnd.set(k, i + 2);
  }
  return counts;
}

/** One Re-Pair fold. `minCount` 1 folds to a single root (as the university exhibit); 2 stops when no digram repeats. */
export function foldOnce(st: FoldState, minCount = 1): FoldState {
  if (st.current.length < 2) return st;
  const counts = digramCounts(st.current);
  let best = '', bestN = 0;
  for (let i = 0; i + 1 < st.current.length; i++) {
    const k = `${st.current[i]}${SEP}${st.current[i + 1]}`;
    const n = counts.get(k) ?? 0;
    if (n > bestN) { best = k; bestN = n; }
  }
  if (bestN < minCount) return st;
  const [left, right] = best.split(SEP) as [string, string];
  const glyph = `⟨${st.rules.length}⟩`;
  const next: string[] = [];
  let count = 0;
  for (let i = 0; i < st.current.length; i++) {
    if (i + 1 < st.current.length && st.current[i] === left && st.current[i + 1] === right) { next.push(glyph); count++; i++; }
    else next.push(st.current[i]!);
  }
  return { ...st, current: next, rules: [...st.rules, { glyph, left, right, count }] };
}

export function foldAll(st: FoldState, minCount = 1, maxRules = 4096): FoldState {
  let s = st;
  while (s.current.length > 1 && s.rules.length < maxRules) {
    const n = foldOnce(s, minCount);
    if (n === s) break;
    s = n;
  }
  return s;
}

/** Expand a symbol, with a finite-expansion budget (rules are acyclic by construction; budget guards foreign input). */
export function expand(symbol: string, rules: FoldRule[], budget = { left: 1 << 20 }): string[] {
  if (--budget.left < 0) throw new RangeError('expansion budget exceeded');
  const r = rules.find((x) => x.glyph === symbol);
  if (!r) return [symbol];
  return [...expand(r.left, rules, budget), ...expand(r.right, rules, budget)];
}

export function unfoldAll(st: FoldState): string[] {
  const budget = { left: 1 << 20 };
  return st.current.flatMap((g) => expand(g, st.rules, budget));
}

export function grammarSize(st: FoldState): number { return st.current.length + 2 * st.rules.length; }

// ------------------------------------------------------------------ route symbols
/**
 * Encode a polyline walk as typed symbols: turn class at each vertex (L, R, S, U)
 * and a length bin for each segment (s<20m, m<60m, l≥60m). Rotation/translation invariant.
 */
export function encodeRoute(pts: [number, number][], turnDeg = 30): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i]!, [bx, by] = pts[i + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    if (i > 0) {
      const [px, py] = pts[i - 1]!;
      const h1 = Math.atan2(ay - py, ax - px), h2 = Math.atan2(by - ay, bx - ax);
      let d = ((h2 - h1) * 180) / Math.PI;
      d = ((d + 540) % 360) - 180;
      out.push(Math.abs(d) > 150 ? 'U' : d > turnDeg ? 'L' : d < -turnDeg ? 'R' : 'S');
    }
    out.push(len < 20 ? 's' : len < 60 ? 'm' : 'l');
  }
  return out;
}

/** Levenshtein distance between symbol words (route similarity with saved tolerance). */
export function editDistance(a: string[], b: string[]): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

export interface RouteMatch { candidateId: string; distance: number; normalized: number; withinTolerance: boolean }

/** Match a walked route against candidates; report against a shuffled-symbol null baseline. */
export function matchRoute(walk: string[], candidates: { id: string; symbols: string[] }[], tolerance = 0.35, rnd: () => number = Math.random) {
  const matches: RouteMatch[] = candidates.map((c) => {
    const d = editDistance(walk, c.symbols);
    const n = d / Math.max(1, Math.max(walk.length, c.symbols.length));
    return { candidateId: c.id, distance: d, normalized: n, withinTolerance: n <= tolerance };
  }).sort((a, b) => a.normalized - b.normalized);
  // Null baseline: same candidates against 32 shuffles of the walk.
  let nullSum = 0, nullN = 0;
  for (let k = 0; k < 32; k++) {
    const sh = [...walk];
    for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [sh[i], sh[j]] = [sh[j]!, sh[i]!]; }
    for (const c of candidates) { nullSum += editDistance(sh, c.symbols) / Math.max(1, Math.max(sh.length, c.symbols.length)); nullN++; }
  }
  return { best: matches[0] ?? null, matches, nullBaseline: nullN ? nullSum / nullN : 1 };
}

// ------------------------------------------------------------------ promotion registry
export interface PlicaCandidate {
  id: string;
  tokens: string[]; // the motif (unfolded form)
  provenance: string;
  license: string;
  lossDeclaration: string;
  bounds: { maxTokens: number };
}

export interface PromotedPlica extends PlicaCandidate { slp: FoldState; signature: string; promotedAt: number }

export class ScenePlicaRegistry {
  readonly promoted = new Map<string, PromotedPlica>();
  readonly rejected: { id: string; reason: string }[] = [];

  /** Promote only if every gate passes, including a held-out recurrence test. */
  promote(c: PlicaCandidate, heldOut: string[][], now = 0): PromotedPlica | null {
    const fail = (reason: string) => { this.rejected.push({ id: c.id, reason }); return null; };
    if (!c.provenance) return fail('no provenance');
    if (!c.license) return fail('no license');
    if (!c.lossDeclaration) return fail('no loss declaration');
    if (c.tokens.length < 2 || c.tokens.length > c.bounds.maxTokens) return fail('outside bounds');
    const slp = foldAll(startFold(c.tokens));
    const back = unfoldAll(slp);
    if (back.join('|') !== c.tokens.join('|')) return fail('unfold(fold(x)) != x');
    const recurs = heldOut.filter((w) => containsRun(w, c.tokens)).length;
    if (recurs < 1) return fail('held-out test: motif does not recur in unseen data');
    const p: PromotedPlica = { ...c, slp, signature: c.tokens.join('·'), promotedAt: now };
    this.promoted.set(c.id, p);
    return p;
  }
}

function containsRun(w: string[], run: string[]): boolean {
  outer: for (let i = 0; i + run.length <= w.length; i++) {
    for (let j = 0; j < run.length; j++) if (w[i + j] !== run[j]) continue outer;
    return true;
  }
  return false;
}
