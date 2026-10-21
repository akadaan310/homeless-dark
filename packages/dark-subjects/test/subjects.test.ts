import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorldAuthority, BorneGraph, startFold, foldAll, unfoldAll, grammarSize, evaluateBridgeWordForTest } from './helpers';
import {
  SubjectRegistry, motionAdapter, facadeAdapter, signProgramAdapter, lodAdapter, acousticAdapter, borneAdapter, clock9SignProposer,
  composeFacade, diversity, districtPalette, orbit, orbitLength, frequency, intervalHue, motif, compileLoom, weave, chooseLod, screenSpaceError, salience, furnishStreet,
} from '../src';
import subjects from '../src/university-subjects.json';

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/university-math.json'), 'utf8'));

describe('port equivalence against pinned university outputs [M]', () => {
  it('fold (Re-Pair) yields the same rule sequence, sizes and unfold for every fixture word', () => {
    const G = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ';
    const rename = (s: string) => (/^⟨(\d+)⟩$/.test(s) ? G[Number(s.slice(1, -1))]! : s);
    for (const f of fx.fold) {
      const st = foldAll(startFold([...f.word]));
      expect(st.rules.map((r) => [rename(r.left), rename(r.right), r.count])).toEqual(f.rules);
      expect(grammarSize(st)).toBe(f.size);
      expect(unfoldAll(st).join('')).toBe(f.unfold);
    }
  });
  it('Matrix Loom compiles every fixture address to the same matrix and acceptance', () => {
    for (const a of fx.address) {
      const c = compileLoom(a.address);
      expect(c.ok).toBe(a.ok);
      if (a.matrix) c.matrix!.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(a.matrix[i][j], 12)));
    }
  });
  it('interval orbits, hues and frequencies match', () => {
    for (const m of fx.music) {
      expect(orbit(0, m.k)).toEqual(m.orbit);
      expect(orbitLength(m.k)).toBe(m.orbitLength);
      expect(intervalHue(m.k)).toBe(m.hue);
    }
    for (const [midi, hz] of fx.frequency) expect(frequency(midi)).toBeCloseTo(hz, 9);
  });
  it('World Loom weave matches for rules 30, 90, 110', () => {
    for (const w of fx.weave) expect(weave(w.rule, 31, 12).map((r) => r.join(''))).toEqual(w.grid);
  });
  it('bridge grammar two-layer verdicts agree with the DARK motion grammar formulation', () => {
    for (const b of fx.bridge) expect(evaluateBridgeWordForTest(b.word)).toEqual({ realizable: b.realizable, admissible: b.admissible });
  });
  it('inventory covers every registered topic with a DARK status', () => {
    const s = (subjects as any).subjects as { id: string; darkStatus: string }[];
    expect(s.length).toBeGreaterThanOrEqual(62);
    expect(new Set(s.map((x: any) => x.division)).size).toBe(6);
    expect(s.every((x) => ['witnessed', 'tested', 'proposed'].includes(x.darkStatus))).toBe(true);
  });
});

describe('Division II façade grammar [M]', () => {
  const inputs = (district: string) => Array.from({ length: 60 }, (_, i) => ({ buildingId: `${district}-b${i}`, districtId: district, frontageM: 12 + (i % 7) * 4, heightM: 6 + (i % 5) * 3, ground: (i % 3 ? 'commercial' : 'residential') as 'commercial' | 'residential' }));
  it('same seed → same signature; unfold identity for all programs; varied compositions', () => {
    const a = inputs('spruce').map(composeFacade), b = inputs('spruce').map(composeFacade);
    expect(a.map((p) => p.signature)).toEqual(b.map((p) => p.signature));
    expect(a.every((p) => p.unfoldOk)).toBe(true);
    expect(diversity(a).ratio).toBeGreaterThan(0.6);
  });
  it('neighbouring districts differ in palette (interval orbit) and stay in gamut', () => {
    const p1 = districtPalette('spruce'), p2 = districtPalette('laurel');
    expect(p1.hues).not.toEqual(p2.hues);
    for (const c of [p1.wall, p1.accent, p2.wall, p2.accent]) c.forEach((x) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); });
  });
  it('street furniture: lights alternate sides, none on footways', () => {
    const f = furnishStreet(300, 4, 'primary');
    expect(f.filter((x) => x.kind === 'streetlight').length).toBeGreaterThanOrEqual(8);
    expect(furnishStreet(300, 4, 'footway')).toEqual([]);
  });
});

describe('Division IV PerceptualLOD and salience [M]', () => {
  it('SSE decreases with distance; nearer buildings get finer strata; importance tightens', () => {
    expect(screenSpaceError(0.5, 10, 60, 1080)).toBeGreaterThan(screenSpaceError(0.5, 100, 60, 1080));
    expect(chooseLod(8, 60, 1080).level).toBe(0);
    expect(chooseLod(2000, 60, 1080).level).toBe(2);
    expect(chooseLod(300, 60, 1080, 2, 4).level).toBeLessThanOrEqual(chooseLod(300, 60, 1080, 2, 1).level);
  });
  it('rendered is not salient; occluded is never salient', () => {
    expect(salience({ inFrustum: true, unoccluded: false, projectedAreaPx: 9e4, contrast: 10, motion: 1, dwellS: 5 }).cls).toBe('occluded');
    expect(salience({ inFrustum: true, unoccluded: true, projectedAreaPx: 50, contrast: 1.2, motion: 0, dwellS: 0 }).cls).toBe('rendered-visible');
    expect(salience({ inFrustum: true, unoccluded: true, projectedAreaPx: 20000, contrast: 7, motion: 0.2, dwellS: 2 }).cls).toBe('salient');
  });
});

describe('six-division pipeline through one world authority [M]', () => {
  function setup() {
    const w = new WorldAuthority();
    w.addActor({ id: 'player', role: 'player' }).addActor({ id: 'system', role: 'system' }).addActor({ id: 'npc:bo', role: 'npc' });
    for (const type of ['PLAN_ADMITTED', 'DISTRICT_COMPOSED', 'LOD_ASSIGNED', 'MUSIC_PROGRAM', 'BORNE_PROPAGATED'])
      w.register({ type, roles: ['player', 'system', 'npc'], validate: () => null, apply: () => {} });
    w.register({ type: 'SIGN_LIGHT_SHIFT', roles: ['npc', 'player'], validate: (p: any) => (Array.isArray(p?.ops) ? null : 'ops'), apply: (m, ev: any) => {
      const cur = m.get(ev.target);
      m.put({ id: ev.target, kind: 'sign', rev: cur?.rev ?? 0, data: { ...(cur?.data ?? {}), ops: ev.payload.ops }, source: 'authored' });
    } });
    w.seed({ id: 'sign/cafe-sign', kind: 'sign', rev: 1, data: { text: 'CAFÉ' }, source: 'authored' });
    const graph = new BorneGraph().add({ id: 'rain', deps: [] }, 0).add({ id: 'wetness', deps: ['rain'], compute: (g) => (g('rain') as number) * 0.9 });
    const reg = new SubjectRegistry(w);
    const known = new Set(['sign/cafe-sign']);
    reg.register(motionAdapter(() => ({ edgeOpen: () => ({ ok: true }), targetReady: () => ({ ok: true }) })))
      .register(facadeAdapter()).register(signProgramAdapter(() => known, 'npc:bo', () => w.inspect('sign/cafe-sign')!.rev))
      .register(lodAdapter()).register(acousticAdapter()).register(borneAdapter(graph));
    return { w, reg, known };
  }
  it('each division admits one concrete function and every effect explains back to its source', () => {
    const { w, reg } = setup();
    const t = [
      reg.run('operational-grammar', { start: 'street', plan: [{ action: 'ENTER_VEHICLE', target: 'veh' }, { action: 'SIT', target: 'seat' }, { action: 'RIDE' }], label: 'ride' }),
      reg.run('plicastratum', [{ buildingId: 'b1', districtId: 'd', frontageM: 20, heightM: 9, ground: 'commercial' }]),
      reg.run('purl', 'v1:sign/cafe-sign/START/TEXT:OPEN%20LATE/HUE:200/COMMIT'),
      reg.run('imagistratum', { distances: [5, 50, 500], fov: 60, viewport: 720 }),
      reg.run('generative-composition', { eventId: 'e', type: 'SIGN_LIGHT_SHIFT', tick: 1, k: 7, root: 60 }),
      reg.run('borne', { input: 'rain', value: 1, causeEventId: 'ev:rain' }),
    ];
    expect(t.map((x) => x.verdict)).toEqual(['admitted', 'admitted', 'admitted', 'admitted', 'admitted', 'admitted']);
    expect(new Set(t.map((x) => x.divisionId)).size).toBe(6);
    for (const x of t) expect(reg.explain(x.committedEventId!)).toBe(x);
    expect((w.inspect<any>('sign/cafe-sign')!.data.ops[0]).arg).toBe('OPEN LATE');
  });
  it('a stale or invalid sign program is refused before the world changes', () => {
    const { w, reg } = setup();
    const before = JSON.stringify(w.snapshot());
    expect(reg.run('purl', 'v1:sign/cafe-sign/START/HUE:999/COMMIT').verdict).toBe('refused');
    expect(reg.run('purl', 'v1:sign/nowhere/START/HUE:9/COMMIT').verdict).toBe('refused');
    expect(JSON.stringify(w.snapshot())).toBe(before);
  });
  it('CLOCK9 proposals are deterministic and always compiler-admitted', () => {
    const p = clock9SignProposer('cafe-sign');
    const known = new Set(['sign/cafe-sign']);
    const a = p(27, known)!, b = p(27, known)!;
    expect(a.address).toBe(b.address);
    expect(a.compiled.ok).toBe(true);
    for (let t = 0; t < 60; t++) { const r = p(t, known); if (r) expect(r.compiled.ok).toBe(true); }
  });
  it('motif follows its orbit length', () => {
    expect(new Set(motif(60, 4, 12).map((n) => n.midi % 12)).size).toBe(3);
  });
});
