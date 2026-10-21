import { describe, expect, it } from 'vitest';
import {
  WorldAuthority, verifyJournal, checkPlan, planProduct, startFold, foldAll, unfoldAll, grammarSize, encodeRoute, matchRoute, ScenePlicaRegistry,
  NGramModel, Clock9Proposer, BorneGraph, compileProgram, formatProgram, unfoldProgram, decide, respondToRide, remember, assignTiers, mulberry32, type NpcMind,
} from '../src';

function world() {
  const w = new WorldAuthority();
  w.addActor({ id: 'player', role: 'player' }).addActor({ id: 'npc:ana', role: 'npc' }).addActor({ id: 'visitor', role: 'visitor' });
  w.register({
    type: 'SIGN_SET', roles: ['player', 'npc'], budgetPerMinute: 3,
    validate: (p: any) => (typeof p?.text === 'string' && p.text.length <= 28 ? null : 'text must be a string ≤ 28'),
    apply: (m, ev: any) => m.put({ id: ev.target, kind: 'sign', rev: 0, data: { text: ev.payload.text }, source: 'authored' }),
  });
  return w;
}

describe('world authority [M]', () => {
  it('commits, chains hashes, refuses stale writes, honours roles and budgets', () => {
    const w = world();
    const a = w.commit({ type: 'SIGN_SET', actor: 'player', target: 'sign/cafe', payload: { text: 'OPEN' }, expectedRevision: 0 });
    expect('hash' in a).toBe(true);
    const stale = w.commit({ type: 'SIGN_SET', actor: 'player', target: 'sign/cafe', payload: { text: 'X' }, expectedRevision: 0 });
    expect(stale).toMatchObject({ ok: false });
    expect((stale as any).reason).toMatch(/stale/);
    expect(w.commit({ type: 'SIGN_SET', actor: 'visitor', target: 'sign/cafe', payload: { text: 'X' } })).toMatchObject({ ok: false });
    expect(w.commit({ type: 'SIGN_SET', actor: 'player', target: 'sign/cafe', payload: { text: 5 } })).toMatchObject({ ok: false });
    w.commit({ type: 'SIGN_SET', actor: 'player', target: 'sign/b', payload: { text: 'B' } });
    w.commit({ type: 'SIGN_SET', actor: 'player', target: 'sign/c', payload: { text: 'C' } });
    expect((w.commit({ type: 'SIGN_SET', actor: 'player', target: 'sign/d', payload: { text: 'D' } }) as any).reason).toMatch(/budget/);
    expect(verifyJournal(w.journal)).toBe(-1);
    const tampered = w.journal.map((e) => ({ ...e }));
    (tampered[1]!.payload as any).text = 'EVIL';
    expect(verifyJournal(tampered)).toBe(1);
  });
  it('reading never mutates; snapshot/restore round-trips', () => {
    const w = world();
    w.commit({ type: 'SIGN_SET', actor: 'player', target: 'sign/cafe', payload: { text: 'OPEN' } });
    const before = JSON.stringify(w.snapshot());
    const e = w.inspect<{ text: string }>('sign/cafe')!;
    e.data.text = 'mutated copy';
    w.query('sign');
    expect(JSON.stringify(w.snapshot())).toBe(before);
    const w2 = world();
    w2.restore(JSON.parse(before));
    expect(w2.inspect<{ text: string }>('sign/cafe')!.data.text).toBe('OPEN');
  });
});

describe('MotionAndEventGrammar [M]', () => {
  const open = { edgeOpen: () => ({ ok: true }), targetReady: () => ({ ok: true }) };
  const plan = [
    { action: 'OPEN_DOOR' as const, edge: 'door:cafe' }, { action: 'PASS_DOOR' as const, edge: 'door:cafe' },
    { action: 'WALK' as const }, { action: 'OPEN_DOOR' as const, edge: 'door:cafe' }, { action: 'WALK' as const, edge: 'street:spruce' },
    { action: 'ENTER_VEHICLE' as const, target: 'veh:sedan' }, { action: 'SIT' as const, target: 'seat:sedan:passenger' },
    { action: 'RIDE' as const, edge: 'road:spruce' }, { action: 'EXIT_VEHICLE' as const, target: 'veh:sedan' },
  ];
  it('door→street→seat→ride→exit is admissible and realizable', () => {
    expect(checkPlan('interior', plan, open).accepted).toBe(true);
  });
  it('rejects broken street, obstructed door, missed seat with exact witness', () => {
    const blocked = (id: string) => ({ edgeOpen: (e: string) => ({ ok: e !== id, reason: 'collider overlap' }), targetReady: () => ({ ok: true }) });
    expect(checkPlan('interior', plan, blocked('street:spruce'))).toMatchObject({ accepted: false, admissible: true, realizable: false, failedAt: 4 });
    expect(checkPlan('interior', plan, blocked('door:cafe'))).toMatchObject({ accepted: false, failedAt: 0 });
    const noSeat = { edgeOpen: () => ({ ok: true }), targetReady: (t: string) => ({ ok: !t.startsWith('seat'), reason: 'occupied' }) };
    expect(checkPlan('interior', plan, noSeat)).toMatchObject({ realizable: false, failedAt: 6 });
  });
  it('rejects inadmissible words (ride before sitting)', () => {
    const v = checkPlan('street', [{ action: 'RIDE' }], open);
    expect(v).toMatchObject({ admissible: false, failedAt: 0 });
  });
  it('product planner finds an admissible plan avoiding a blocked edge', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id, x: 0, z: 0 }));
    const edges = [
      { id: 'ab', from: 'a', to: 'b', action: 'WALK' as const, cost: 1 }, { id: 'bd', from: 'b', to: 'd', action: 'WALK' as const, cost: 1 },
      { id: 'ac', from: 'a', to: 'c', action: 'WALK' as const, cost: 2 }, { id: 'cd', from: 'c', to: 'd', action: 'WALK' as const, cost: 2 },
    ];
    const r = planProduct(nodes, edges, 'a', 'street', 'd', { edgeOpen: (e) => ({ ok: e !== 'bd' }), targetReady: () => ({ ok: true }) })!;
    expect(r.plan.map((p) => p.edge)).toEqual(['ac', 'cd']);
    expect(planProduct(nodes, edges, 'a', 'street', 'd', { edgeOpen: (e) => ({ ok: e !== 'bd' && e !== 'cd' }), targetReady: () => ({ ok: true }) })).toBeNull();
  });
});

describe('Plicastratum folds [M]', () => {
  it('unfold(fold(w)) = w across random words; grammar shrinks repetitive input', () => {
    const rnd = mulberry32(13);
    for (let k = 0; k < 50; k++) {
      const w = Array.from({ length: 1 + Math.floor(rnd() * 60) }, () => 'abcS'[Math.floor(rnd() * 4)]!);
      const f = foldAll(startFold(w));
      expect(unfoldAll(f)).toEqual(w);
    }
    const rep = 'shop awning sign door '.repeat(16).trim().split(' ');
    const f = foldAll(startFold(rep), 2);
    expect(grammarSize(f)).toBeLessThan(rep.length / 3);
    expect(unfoldAll(f)).toEqual(rep);
  });
  it('route encoding is rotation invariant and matches against a null baseline', () => {
    const route: [number, number][] = [[0, 0], [80, 0], [80, 50], [40, 50], [40, 120]];
    const rot = route.map(([x, y]) => [x * Math.cos(1) - y * Math.sin(1) + 500, x * Math.sin(1) + y * Math.cos(1)] as [number, number]);
    expect(encodeRoute(rot)).toEqual(encodeRoute(route));
    const r = matchRoute(encodeRoute(route), [{ id: 'london', symbols: encodeRoute(rot) }, { id: 'straight', symbols: ['l', 'S', 'l', 'S', 'l'] }], 0.35, mulberry32(1));
    expect(r.best!.candidateId).toBe('london');
    expect(r.best!.normalized).toBeLessThan(r.nullBaseline);
  });
  it('promotion requires provenance, license, loss declaration and held-out recurrence', () => {
    const reg = new ScenePlicaRegistry();
    const c = { id: 'shopfront', tokens: ['awning', 'sign', 'door', 'window'], provenance: 'authored', license: 'CC0-1.0', lossDeclaration: 'none', bounds: { maxTokens: 16 } };
    expect(reg.promote({ ...c, license: '' }, [])).toBeNull();
    expect(reg.promote(c, [['wall', 'awning', 'sign', 'door', 'window']])).not.toBeNull();
    expect(reg.promote({ ...c, id: 'x' }, [['wall']])).toBeNull();
    expect(reg.rejected.map((r) => r.reason)).toEqual(['no license', 'held-out test: motif does not recur in unseen data']);
  });
});

describe('CLOCK9 proposals [M]', () => {
  const corpus = [
    ['TEXT', 'HUE', 'BRIGHTNESS'], ['TEXT', 'HUE', 'CHIME'], ['HUE', 'BRIGHTNESS'], ['TEXT', 'BRIGHTNESS', 'CHIME'], ['TEXT', 'HUE', 'BRIGHTNESS'],
  ];
  const model = new NGramModel(2, 0.05).train(corpus);
  it('is deterministic per seed and clock slot', () => {
    const p = new Clock9Proposer(model);
    expect(p.at(40).tokens).toEqual(p.at(40).tokens);
    expect(p.at(40).slot).toBe(4);
    expect(p.at(9).cycle).toBe(1);
  });
  it('distributions normalize and training lowers perplexity on in-domain sequences', () => {
    const s = model.distribution(['TEXT']).reduce((a, [, p]) => a + p, 0);
    expect(s).toBeCloseTo(1, 9);
    expect(model.perplexity(['TEXT', 'HUE', 'BRIGHTNESS'])).toBeLessThan(model.perplexity(['CHIME', 'CHIME', 'CHIME']));
  });
});

describe('BORNE propagation [M]', () => {
  const g = () => new BorneGraph()
    .add({ id: 'rain', deps: [] }, 0)
    .add({ id: 'hour', deps: [] }, 12)
    .add({ id: 'wetness', deps: ['rain'], compute: (get) => Math.min(1, (get('rain') as number) * 0.8) })
    .add({ id: 'roughness', deps: ['wetness'], compute: (get) => Math.round((0.9 - 0.6 * (get('wetness') as number)) * 100) / 100 })
    .add({ id: 'footstep', deps: ['wetness'], compute: (get) => ((get('wetness') as number) > 0.3 ? 'wet_asphalt' : 'asphalt') })
    .add({ id: 'headlights', deps: ['hour', 'rain'], compute: (get) => (get('hour') as number) > 18 || (get('rain') as number) > 0.2 })
    .add({ id: 'cafeMusic', deps: ['hour'], compute: (get) => ((get('hour') as number) > 20 ? 'late' : 'day') });
  it('RAIN_START recomputes only the causal cone; hour-only nodes untouched', () => {
    const graph = g();
    const w = graph.set('rain', 1, 'ev:RAIN_START');
    expect(w.borne).toEqual(['wetness', 'roughness', 'footstep', 'headlights']);
    expect(w.recomputed).not.toContain('cafeMusic');
    expect(w.moved).toEqual(['wetness', 'roughness', 'footstep', 'headlights']);
    for (const m of w.moved) expect(w.recomputed).toContain(m);
    for (const r of w.recomputed) expect(w.borne).toContain(r);
  });
  it('early cutoff stops propagation when a value is unchanged', () => {
    const graph = g();
    graph.set('rain', 0.5);
    const w = graph.set('rain', 0.6); // wetness changes, footstep stays wet
    expect(w.cutoff).toContain('footstep');
    expect(w.cutoff).toContain('headlights');
  });
  it('refuses unborn dependencies and derived writes; topological order complete', () => {
    expect(() => new BorneGraph().add({ id: 'x', deps: ['y'], compute: () => 1 })).toThrow(/born after/);
    expect(() => g().set('wetness', 1)).toThrow(/derived/);
    expect(g().topological()).toHaveLength(7);
  });
});

describe('WorldProgramCompiler [M]', () => {
  const targets = new Set(['sign/cafe-sign', 'light/street-04']);
  it('compiles, round-trips canonically and unfolds to primitives', () => {
    const p = compileProgram('v1:sign/cafe-sign/START/TEXT:OPEN%20LATE/HUE:200/BRIGHTNESS:0.8/COMMIT', targets);
    expect(p.ok).toBe(true);
    expect(p.effect!.projections).toEqual(['visual']);
    const f = formatProgram(p);
    expect(formatProgram(compileProgram(f, targets))).toBe(f);
    expect(unfoldProgram(p)).toHaveLength(3);
  });
  it('rejects invalid types, missing targets, flash-unsafe pulses and protocol violations before execution', () => {
    expect(compileProgram('v1:sign/cafe-sign/START/HUE:abc/COMMIT', targets).ok).toBe(false);
    expect(compileProgram('v1:sign/ghost/START/HUE:20/COMMIT', targets).diagnostics[0]).toMatch(/does not exist/);
    expect(compileProgram('v1:sign/cafe-sign/START/PULSE:3/COMMIT', targets).ok).toBe(false);
    expect(compileProgram('v1:sign/cafe-sign/HUE:20/COMMIT', targets).ok).toBe(false);
    expect(compileProgram('v1:sign/cafe-sign/START/HUE:20', targets).diagnostics).toContain('never COMMITs: nothing is applied');
    expect(compileProgram('v1:sign/cafe-sign/START/TEXT:<script>/COMMIT', targets).ok).toBe(false);
    expect(compileProgram('v2:sign/cafe-sign/START/COMMIT', targets).ok).toBe(false);
  });
});

describe('NPC minds and World Loom [M]', () => {
  const ana: NpcMind = {
    id: 'npc:ana', name: 'Ana', role: 'barista', fictional: true, busyUntil: 0, memory: [], relationship: {},
    schedule: [{ from: 7, to: 15, activity: 'work', place: 'cafe' }, { from: 15, to: 19, activity: 'talk', place: 'corner' }, { from: 19, to: 7, activity: 'rest', place: 'home' }],
  };
  const ctx = { hour: 16, worldTime: 100, raining: false, playerDistance: 10, playerId: 'player' };
  it('follows schedule, shelters in rain, greets then recognizes', () => {
    expect(decide(ana, ctx).activity).toBe('talk');
    expect(decide(ana, { ...ctx, raining: true }).activity).toBe('shelter');
    expect(decide(ana, { ...ctx, playerDistance: 2 }).speechAct).toBe('greeting');
    expect(decide(remember(ana, 1, 'met', 'player', 0.3), { ...ctx, playerDistance: 2 }).speechAct).toBe('socialize');
  });
  it('ride offers can be refused for trust, work or commitments', () => {
    expect(respondToRide(ana, ctx)).toMatchObject({ accepted: false, speechAct: 'refuse_ride' });
    expect(respondToRide(ana, { ...ctx, hour: 9 })).toMatchObject({ speechAct: 'decline_ride' });
    expect(respondToRide(remember(ana, 1, 'helped', 'player', 0.5), ctx).accepted).toBe(true);
    expect(respondToRide({ ...ana, busyUntil: 500 }, ctx).speechAct).toBe('continue_task');
  });
  it('tiering never exceeds the active budget and keeps causally relevant agents active', () => {
    const agents = Array.from({ length: 200 }, (_, i) => ({ id: `a${i}`, x: i * 3, z: 0, causallyRelevant: i === 150 }));
    const t = assignTiers(agents, 0, 0, { focusedRadius: 10, activeRadius: 60, cohortRadius: 300, maxActive: 12 });
    const live = [...t.values()].filter((x) => x === 'active' || x === 'focused').length;
    expect(live).toBeLessThanOrEqual(12);
    expect(t.get('a150')).toBe('active');
    expect(t.get('a90')).toBe('cohort');
    expect(t.get('a199')).toBe('virtual');
  });
});
