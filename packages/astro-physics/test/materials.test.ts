import { describe, it, expect } from 'vitest';
import { applyImpact, newGlass, criticalEnergy, fracture, polyArea, tyreFriction, checkContract, boundsCompatible, GLASS_DENSITY, type GlassSpec, type PhysicalPresenceContract } from '@astro/physics';

const pane: GlassSpec = { id: 'cafe-pane-A', width: 1.6, height: 2.6, thickness: 0.006, density: GLASS_DENSITY, seed: 42 };
const hit = (energy: number, u = 0.5, v = 0.5) => ({ u, v, energy, t: 0, actor: 'player', eventId: null });

describe('glass (authored brittle-pane model)', () => {
  it('critical energy scales with thickness²', () => { expect(criticalEnergy({ ...pane, thickness: 0.012 })).toBeCloseTo(4 * criticalEnergy(pane)); });
  it('tiny taps are elastic; scratches add no damage', () => {
    expect(applyImpact(pane, newGlass(), hit(0.05)).outcome).toBe('none');
    const s = applyImpact(pane, newGlass(), hit(0.5), true);
    expect(s.outcome).toBe('scratch'); expect(s.state.damage).toBe(0); expect(s.state.scratches).toBeGreaterThan(0);
  });
  it('repeated sub-critical knocks accumulate damage and cross the fracture threshold', () => {
    let st = newGlass(); const outcomes: string[] = [];
    for (let i = 0; i < 20 && !st.broken; i++) { const r = applyImpact(pane, st, hit(1.4, 0.4 + i * 0.01, 0.5)); st = r.state; outcomes.push(r.outcome); }
    expect(outcomes[0]).toBe('crack');
    expect(outcomes[outcomes.length - 1]).toBe('fracture');
    expect(outcomes.length).toBeGreaterThan(3);
    expect(st.cracks.length).toBeGreaterThan(outcomes.length * 3);
    expect(applyImpact(pane, st, hit(1)).outcome).toBe('refused');
  });
  it('a single super-critical blow fractures; shards conserve area and mass, and are bounded', () => {
    const r = applyImpact(pane, newGlass(), hit(10, 0.3, 0.7));
    expect(r.outcome).toBe('fracture');
    const area = r.state.shards.reduce((a, s) => a + s.area, 0);
    expect(area).toBeCloseTo(pane.width * pane.height, 6);
    expect(r.state.shards.reduce((a, s) => a + s.mass, 0)).toBeCloseTo(pane.width * pane.height * pane.thickness * GLASS_DENSITY, 6);
    expect(r.state.shards.length).toBeLessThanOrEqual(24);
  });
  it('is deterministic for the same seed and history', () => {
    const run = () => applyImpact(pane, applyImpact(pane, newGlass(), hit(1.2)).state, hit(9)).state;
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
  it('infeasible contacts are refused', () => { expect(applyImpact(pane, newGlass(), hit(1e6)).outcome).toBe('refused'); });
  it('shard polygons are valid', () => { for (const s of fracture(pane, hit(5))) expect(polyArea(s.poly)).toBeCloseTo(s.area, 9); });
});

describe('tyre friction', () => {
  it('wet < dry, puddle at speed < wet, bounded', () => {
    const dry = tyreFriction('asphalt', 0, 0), wet = tyreFriction('asphalt', 1, 0), plane = tyreFriction('asphalt', 1, 1, 25);
    expect(dry).toBeCloseTo(0.9); expect(wet).toBeGreaterThan(0.5); expect(wet).toBeLessThan(0.6); expect(plane).toBeLessThan(wet); expect(plane).toBeGreaterThanOrEqual(0.2);
    expect(tyreFriction('asphalt', 1, 1, 2)).toBeGreaterThan(plane); // no aquaplaning at walking pace
  });
});

describe('physical presence contracts', () => {
  const base: PhysicalPresenceContract = { identity: 'x', geometry: 'box', sourceStatus: 'authored', materialModel: 'm', fidelity: 'art_directed', units: {}, stateChannels: [], collision: 'box', contactLaw: 'c', responseOperators: ['r'], coupledFields: [], observers: [], LOD: 'l', errorBounds: 'e', memoryBudget: '1 KB', verificationTests: ['t'], provenance: 'p', epistemicStatus: 'authored', touchable: true };
  it('touchable objects need collision, responses and tests', () => {
    expect(checkContract(base)).toEqual([]);
    expect(checkContract({ ...base, collision: 'none' }).join()).toMatch(/collision/);
    expect(checkContract({ ...base, responseOperators: [] }).join()).toMatch(/response/);
    expect(checkContract({ ...base, fidelity: 'scientific_model', errorBounds: 'small' }).join()).toMatch(/numeric/);
  });
  it('render vs proxy bounds compatibility', () => {
    expect(boundsCompatible({ min: [0, 0, 0], max: [1, 2, 0.05] }, { min: [0, 0, 0], max: [1, 2, 0.1] }).ok).toBe(true);
    expect(boundsCompatible({ min: [0, 0, 0], max: [1, 2, 0.05] }, { min: [5, 0, 0], max: [6, 2, 0.1] }).ok).toBe(false);
  });
});
