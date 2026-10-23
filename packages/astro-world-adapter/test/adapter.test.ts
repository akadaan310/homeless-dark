import { describe, it, expect } from 'vitest';
import { formatView, parseView, journalDigest, compareJournals, observe } from '@astro/world-adapter';

const view = { region: 'tampa-dale-mabry', lens: 'sky' as const, utc: '2026-10-21T21:35:00Z', lat: 27.9594638, lon: -82.5054865, yaw: 1.2, pitch: -0.18 };
describe('view addresses', () => {
  it('round-trip and stay read-only', () => {
    const s = formatView(view);
    const p = parseView(s);
    expect(p.ok && p.view).toEqual({ ...view, lat: 27.959464, lon: -82.505486 }); // 1e-6° ≈ 0.1 m
    expect(parseView(`${s}&teleport=1`)).toMatchObject({ ok: false });
    expect(parseView(s.replace('/sky@', '/xray@'))).toMatchObject({ ok: false });
    expect(parseView('homeless:view/a/sky@2026-10-21T00:00:00Z?lat=91&lon=0&yaw=0&pitch=0')).toMatchObject({ ok: false });
  });
});
describe('journals', () => {
  const j = [{ id: 'e1', type: 'FOOTSTEP', actor: 'player', tick: 3, payload: { surface: 'concrete', speed: 1.5 } }, { id: 'e2', type: 'RAIN_START', actor: 'system', tick: 9, payload: { intensity: 0.8 } }];
  it('digest ignores ids and key order', () => {
    const k = [{ ...j[0]!, id: 'x', payload: { speed: 1.5, surface: 'concrete' } }, { ...j[1]!, id: 'y' }];
    expect(journalDigest(k)).toBe(journalDigest(j));
    expect(observe({ journal: j }).journalLength).toBe(2);
  });
  it('compare finds the first divergence', () => {
    const k = [j[0]!, { ...j[1]!, payload: { intensity: 0.7 } }];
    const r = compareJournals(j, k);
    expect(r.equal).toBe(false);
    expect(!r.equal && r.index).toBe(1);
    expect(compareJournals(j, k, { ignorePayloadKeys: ['intensity'] }).equal).toBe(true);
  });
});
