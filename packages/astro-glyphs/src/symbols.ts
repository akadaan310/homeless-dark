// A0: the 118 element-symbol spellings as OPAQUE tokens (§021–§024, §029, §039).
// At A0 a token has identity (exact case-sensitive spelling) and nothing else: no atomic
// number, name, group, valence, bonding or any chemical interpretation. The token list is
// stored in lexicographic order so no array index leaks the periodic ordering.
import data from '../data/opaque-symbols-118.json';

export const A0_TOKENS: readonly string[] = Object.freeze([...(data as { tokens: string[] }).tokens]);
const TOKEN_SET = new Set(A0_TOKENS);
const BY_LENGTH = [...A0_TOKENS].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));

export type Occurrence = { token: string; position: number };

export class SymbolParseError extends Error {
  constructor(msg: string, readonly certificate: { input: string; at: number; reason: 'unknown_token' | 'ambiguous' | 'malformed' | 'too_long'; candidates?: string[][] }) { super(msg); }
}

/**
 * Parse explicit-separator notation: `H-H-O` → [H, H, O] (three ordered occurrences).
 * Never rewrites to `H2O`, never infers bonds. Unknown tokens are refused with a certificate.
 */
export function parseOccurrences(input: string, sep = '-'): Occurrence[] {
  if (typeof input !== 'string' || input.length === 0) throw new SymbolParseError('empty input', { input: String(input), at: 0, reason: 'malformed' });
  if (input.length > 512) throw new SymbolParseError('input too long', { input: input.slice(0, 32), at: 512, reason: 'too_long' });
  const parts = input.split(sep);
  let pos = 0;
  return parts.map((p, i) => {
    if (!TOKEN_SET.has(p)) throw new SymbolParseError(`"${p}" is not one of the 118 opaque tokens`, { input, at: pos, reason: p === '' ? 'malformed' : 'unknown_token' });
    const o = { token: p, position: i };
    pos += p.length + sep.length;
    return o;
  });
}

/** Separator-free strings may be ambiguous (e.g. "CO" = [C,O] or [Co]); all readings are returned, none chosen. */
export function tokenizations(input: string, limit = 64): string[][] {
  if (!/^[A-Za-z]{1,50}$/.test(input)) throw new SymbolParseError('not a symbol string', { input, at: 0, reason: 'malformed' });
  const out: string[][] = [];
  const walk = (pos: number, path: string[]) => {
    if (out.length >= limit) return;
    if (pos === input.length) { out.push(path); return; }
    for (const t of BY_LENGTH) if (input.startsWith(t, pos)) walk(pos + t.length, [...path, t]);
  };
  walk(0, []);
  return out;
}

/** Unique parse or refusal with an ambiguity certificate. */
export function parseUnique(input: string): string[] {
  const r = tokenizations(input);
  if (r.length === 0) throw new SymbolParseError(`no reading of "${input}" in the opaque alphabet`, { input, at: 0, reason: 'unknown_token' });
  if (r.length > 1) throw new SymbolParseError(`"${input}" is ambiguous (${r.length} readings)`, { input, at: 0, reason: 'ambiguous', candidates: r });
  return r[0]!;
}

// ---------------------------------------------------------------- typographic closure (§023)
export type Word = readonly string[];
export const concat = (a: Word, b: Word): Word => [...a, ...b];
export const group = (w: Word): { kind: 'group'; items: Word } => ({ kind: 'group', items: w });
/** Explicit repetition structure — NOT multiplication, NOT a subscript. */
export const repeat = (w: Word, n: number): { kind: 'repeat'; items: Word; times: number } => {
  if (!Number.isInteger(n) || n < 0 || n > 64) throw new RangeError('repeat count must be an integer in [0, 64]');
  return { kind: 'repeat', items: w, times: n };
};
export const expandRepeat = (r: { items: Word; times: number }): Word => Array.from({ length: r.times }, () => r.items).flat();
export const permute = (w: Word, perm: number[]): Word => {
  if (perm.length !== w.length || new Set(perm).size !== perm.length || perm.some((p) => p < 0 || p >= w.length)) throw new Error('not a permutation');
  return perm.map((p) => w[p]!);
};
/** Token homomorphism h: A0 → A0* extended to words. */
export const homomorphism = (h: Record<string, Word>) => (w: Word): Word => w.flatMap((t) => { if (!(t in h)) throw new Error(`homomorphism undefined on ${t}`); return [...h[t]!]; });
/** Multiset of occurrences — an explicit lossy reduction that forgets order. */
export const multiset = (w: Word): Record<string, number> => w.reduce((m, t) => ({ ...m, [t]: (m[t] ?? 0) + 1 }), {} as Record<string, number>);
/** Order-preserving fingerprint (FNV-1a over the joined token sequence). */
export function fingerprint(w: Word): string {
  let h = 0x811c9dc5;
  const s = w.join('\u0001');
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/** Bounded enumeration of A0^n (§029): the language is countably infinite; a device explores finite depth. */
export function enumerateWords(alphabet: readonly string[], maxLen: number, cap = 200000): { byLength: number[]; produced: number; cutoff: boolean; duplicatesUnderMultiset: number } {
  const byLength: number[] = [];
  let produced = 0, cutoff = false;
  const multis = new Set<string>();
  let dupe = 0;
  let layer: string[][] = [[]];
  for (let n = 1; n <= maxLen; n++) {
    const next: string[][] = [];
    for (const w of layer) for (const t of alphabet) {
      if (produced >= cap) { cutoff = true; break; }
      const nw = [...w, t];
      next.push(nw); produced++;
      const key = Object.entries(multiset(nw)).sort().join(',');
      if (multis.has(key)) dupe++; else multis.add(key);
    }
    byLength.push(next.length);
    layer = next;
    if (cutoff) break;
  }
  return { byLength, produced, cutoff, duplicatesUnderMultiset: dupe };
}

// ---------------------------------------------------------------- A1 admission (§024, §040)
export interface ChemicalClaim { word: Word; claim: 'identity' | 'bonding' | 'valence' | 'stability' | 'formula'; source: string | null; model: string | null; units: string | null; reviewedBy: string | null }
export interface AdmissionResult { admitted: boolean; level: 'A0' | 'A1'; reason: string }

/** A1 gate: chemistry is attachable only with external source, model, units and review. Disabled = A0 asserts nothing. */
export function admitChemistry(c: ChemicalClaim, chemistryEnabled: boolean): AdmissionResult {
  if (!chemistryEnabled) return { admitted: false, level: 'A0', reason: 'chemistry disabled: A0 tokens carry no identity, bonding or valence' };
  const missing = (['source', 'model', 'units', 'reviewedBy'] as const).filter((k) => !c[k]);
  if (missing.length) return { admitted: false, level: 'A0', reason: `underdetermined: missing ${missing.join(', ')}` };
  return { admitted: true, level: 'A1', reason: `externally witnessed by ${c.source} (${c.model}), reviewed by ${c.reviewedBy}` };
}

/**
 * Blind-A0 leakage audit (§039, §114): with tokens only, a predictor of any property assigned
 * to tokens cannot beat chance on a held-out split. `feature` is what the predictor may see.
 * Returns accuracy of a nearest-spelling predictor vs. a shuffled-label null.
 */
export function blindPredictionAudit(labels: Record<string, number>, seed = 7): { accuracy: number; nullAccuracy: number; chance: number; leakage: boolean } {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const toks = Object.keys(labels).sort(() => rnd() - 0.5);
  const cut = Math.floor(toks.length * 0.7);
  const train = toks.slice(0, cut), test = toks.slice(cut);
  // predictor may only use the opaque spelling: predict the label of the lexicographically nearest training token
  const predict = (t: string) => { let best = train[0]!; for (const x of train) if (Math.abs(x.localeCompare(t)) <= Math.abs(best.localeCompare(t)) && x[0] === t[0]) best = x; return labels[best]!; };
  const classes = [...new Set(Object.values(labels))];
  const acc = test.filter((t) => predict(t) === labels[t]).length / test.length;
  const shuffled = Object.fromEntries(Object.keys(labels).map((k, i, arr) => [k, labels[arr[(i * 37 + 11) % arr.length]!]!]));
  const nullAcc = test.filter((t) => predict(t) === shuffled[t]).length / test.length;
  const chance = 1 / classes.length;
  return { accuracy: acc, nullAccuracy: nullAcc, chance, leakage: acc > chance + 0.25 };
}
