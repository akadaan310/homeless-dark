import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  A0_TOKENS, parseOccurrences, tokenizations, parseUnique, SymbolParseError, concat, repeat, expandRepeat, permute, homomorphism, multiset, fingerprint, enumerateWords,
  admitChemistry, blindPredictionAudit, pchemTemplates, cycle, invariants, applyOp, interpretAngle, ochemCatalog, holds, complement, validateTetrad, admitSubstrate, refine, RENDER_TOWER,
} from '../src';

const pack = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/pack-pchem-ids.json'), 'utf8'));

describe('A0 opaque symbols [M]', () => {
  it('has exactly 118 unique case-sensitive tokens in lexicographic (non-periodic) order', () => {
    expect(A0_TOKENS).toHaveLength(118);
    expect(new Set(A0_TOKENS).size).toBe(118);
    expect([...A0_TOKENS]).toEqual([...A0_TOKENS].sort());
    expect(A0_TOKENS.includes('Og')).toBe(true);
    expect(A0_TOKENS.includes('og')).toBe(false);
  });
  it('H-H-O parses to exactly three ordered occurrences, nothing else', () => {
    const p = parseOccurrences('H-H-O');
    expect(p.map((o) => o.token)).toEqual(['H', 'H', 'O']);
    expect(p.map((o) => o.position)).toEqual([0, 1, 2]);
    expect(JSON.stringify(p)).not.toMatch(/H2O|bond|valence|water/i);
  });
  it('refuses unknown and malformed sequences with a certificate', () => {
    expect(() => parseOccurrences('H-Xx-O')).toThrow(SymbolParseError);
    try { parseOccurrences('H--O'); } catch (e) { expect((e as SymbolParseError).certificate.reason).toBe('malformed'); }
    expect(() => parseOccurrences('h-h-o')).toThrow();
  });
  it('separator-free strings: exact case makes readings unique; impossible strings are refused', () => {
    expect(tokenizations('CO')).toEqual([['C', 'O']]);
    expect(tokenizations('Co')).toEqual([['Co']]);
    expect(parseUnique('CoO')).toEqual(['Co', 'O']);
    expect(() => parseUnique('Qq')).toThrow(/no reading/);
  });
  it('typographic closure distinguishes order but can record the common multiset', () => {
    const a = ['H', 'H', 'O'], b = ['O', 'H', 'H'];
    expect(fingerprint(a)).not.toBe(fingerprint(b));
    expect(multiset(a)).toEqual(multiset(b));
    expect(permute(a, [2, 0, 1])).toEqual(b);
    expect(expandRepeat(repeat(['H'], 2))).toEqual(['H', 'H']);
    expect(concat(['H'], ['O'])).toEqual(['H', 'O']);
    expect(homomorphism({ H: ['O'], O: ['H', 'H'] })(['H', 'O'])).toEqual(['O', 'H', 'H']);
  });
  it('finite alphabet, unbounded language: growth |A|^n with cutoff and duplicate equivalences recorded', () => {
    const r = enumerateWords(['H', 'O', 'N'], 4);
    expect(r.byLength).toEqual([3, 9, 27, 81]);
    expect(r.duplicatesUnderMultiset).toBeGreaterThan(0);
    expect(enumerateWords(A0_TOKENS, 6, 1000).cutoff).toBe(true);
  });
  it('A1: with chemistry disabled nothing is asserted; enabled requires source, model, units and review', () => {
    const c = { word: ['H', 'H', 'O'], claim: 'bonding' as const, source: null, model: null, units: null, reviewedBy: null };
    expect(admitChemistry(c, false)).toMatchObject({ admitted: false, level: 'A0' });
    expect(admitChemistry(c, true).reason).toMatch(/underdetermined/);
    expect(admitChemistry({ ...c, source: 'ext', model: 'm', units: 'u', reviewedBy: 'cofounder' }, true).admitted).toBe(true);
  });
  it('blind A0 leakage audit: spelling-only predictor does not beat chance on shuffled chemical labels', () => {
    // labels: an arbitrary two-class property assigned without reference to spelling
    const labels = Object.fromEntries(A0_TOKENS.map((t, i) => [t, (i * 7919) % 2]));
    const r = blindPredictionAudit(labels);
    expect(r.leakage).toBe(false);
  });
});

describe('P-Chem abstract templates and graph grammar [M]', () => {
  const T = pchemTemplates();
  it('117 non-carbon labels × 6 ring sizes = 702 abstract templates, identical ids to the source pack, 0 certified chemicals', () => {
    expect(T).toHaveLength(702);
    expect(T.some((t) => t.label === 'C')).toBe(false);
    expect(T.map((t) => t.id).sort()).toEqual([...pack.ids].sort());
    expect(T.every((t) => t.epistemic === 'abstract_grammar_only' && t.chemical_admission === false)).toBe(true);
    for (const t of T) expect(invariants(t)).toMatchObject({ vertices: t.n, edges: t.n, components: 1, cycleRank: 1, simple: true });
  });
  it('typed operators emit pre/post invariants and failure witnesses', () => {
    const c6 = cycle('X', 6), c5 = cycle('Y', 5);
    const fused = applyOp(c6, { op: 'FUSE', other: c5, edgeA: [0, 1], edgeB: [0, 1] });
    expect(fused.witness.post).toMatchObject({ vertices: 9, edges: 10, cycleRank: 2 });
    const spiro = applyOp(c6, { op: 'SPIRO', other: c5, a: 0, b: 0 });
    expect(spiro.witness.post).toMatchObject({ vertices: 10, edges: 11, cycleRank: 2 });
    const join = applyOp(c6, { op: 'JOIN', other: c5, a: 0, b: 0 });
    expect(join.witness.post).toMatchObject({ vertices: 11, edges: 12, cycleRank: 2 });
    const bridge = applyOp(c6, { op: 'BRIDGE', a: 0, b: 3, length: 2 });
    expect(bridge.witness.post).toMatchObject({ vertices: 7, edges: 8, cycleRank: 2 });
    expect(applyOp(c6, { op: 'NEW_EDGE', a: 0, b: 1 }).witness).toMatchObject({ ok: false });
    expect(applyOp(c6, { op: 'DELETE_EDGE', a: 0, b: 1 }).witness.post).toMatchObject({ cycleRank: 0, components: 1 });
    expect(applyOp(c6, { op: 'ROTATE', k: 2 }).witness.post).toEqual(invariants(c6));
    expect(applyOp(c6, { op: 'REFLECT' }).witness.post).toEqual(invariants(c6));
    expect(applyOp(c6, { op: 'MARK', v: 9, mark: 'a' }).witness.ok).toBe(false);
    for (const w of [fused, spiro, join, bridge]) expect(w.witness.claim).toMatch(/non-chemical/);
  });
  it('keeps nonplanar cases: K5 from a 5-cycle exceeds the planar edge bound', () => {
    let g: any = cycle('Z', 5);
    for (const [a, b] of [[0, 2], [0, 3], [1, 3], [1, 4], [2, 4]]) g = applyOp(g, { op: 'NEW_EDGE', a: a!, b: b! }).graph;
    expect(invariants(g).edges).toBe(10);
    expect(applyOp(g, { op: 'ROTATE', k: 1 }).witness.planar).toBe(false);
  });
  it('representation types are refused across domains', () => {
    expect(interpretAngle('straight_line_embedding', 6, 'bond_angle').ok).toBe(false);
    expect(interpretAngle('combinatorial_cycle', 6, 'drawing').ok).toBe(false);
    expect(interpretAngle('straight_line_embedding', 6, 'drawing').value).toBe(120);
  });
  it('O-Chem atlas: 66 RDKit-validated entries in 46 populated cells, kept separate from A0', () => {
    expect(ochemCatalog()).toMatchObject({ entries: 66, cells: 46 });
  });
});

describe('tetrads and the open world [M]', () => {
  const U = { id: 'U:symbols', members: ['H', 'O', 'N'], closedWorld: false };
  it('UNKNOWN is not NOT; complement is relative to a declared universe', () => {
    expect(holds(U, 'N', new Set(['H'])).value).toBe('UNKNOWN');
    expect(holds({ ...U, closedWorld: true }, 'N', new Set(['H'])).value).toBe('NOT');
    expect(holds(U, 'Fe', new Set()).value).toBe('NOT');
    expect(holds(U, 'H', new Set(['H']), new Set(['H'])).value).toBe('INCOMPATIBLE');
    expect(complement(U, ['H'])).toEqual(['O', 'N']);
  });
  it('tetrad schema validation and counterexamples', () => {
    const ok = { form: { structure: ['H'], observed: true }, inForm: { universe: U.id, forbidden: ['Fe'] }, transform: { op: 'concat', admissible: true }, inform: { evidence: ['parse'], grounded: true }, source: 'test', epistemic: 'tested' as const };
    expect(validateTetrad(ok)).toEqual([]);
    expect(validateTetrad({ ...ok, transform: { op: 'x', admissible: false } })).toContain('an inadmissible TRANSFORM cannot yield grounded INFORM');
    expect(validateTetrad({ ...ok, inform: { evidence: [], grounded: true } })).toContain('grounded INFORM requires evidence');
  });
  it('a single letter with no operator fails full substrate admission', () => {
    expect(admitSubstrate({ carrier: 'H' })).toMatchObject({ admitted: false });
    expect(admitSubstrate({ carrier: 'A0', signature: ['concat'], operations: ['concat'], observationRegime: 'typographic', boundaries: 'length ≤ 512', invariants: ['order'], witnesses: ['tests'] }).admitted).toBe(true);
  });
  it('relative primitives refine and report kept/collapsed/new', () => {
    const r = refine({ id: 'q', schema: 's0', parts: ['a', 'b', 'c'] }, 's1', (p) => (p === 'a' ? ['a'] : p === 'b' ? ['b1', 'b2'] : []));
    expect(r).toMatchObject({ kept: ['a'], collapsed: ['c'], newlyObserved: ['b1', 'b2'] });
  });
  it('the render tower declares which maps are invertible', () => {
    expect(RENDER_TOWER.filter((m) => m.invertible).map((m) => m.to)).toEqual(['compiled operations', 'graph edges']);
  });
});
