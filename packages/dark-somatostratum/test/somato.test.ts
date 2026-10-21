import { describe, expect, it } from 'vitest';
import { HapticScheduler, HAPTIC_ALPHABET, footstepFor, distanceGain, dopplerFactor, occlusionCutoff, thunderDelay, engineTone, cuesFor, SensoryTelemetry, type SurfaceKind } from '../src';

const driver = () => { const calls: number[][] = []; return { calls, d: { name: 'test', fire: (p: number[]) => { calls.push(p); return true; }, cancel: () => {} } }; };

describe('haptic alphabet and budgets [M]', () => {
  it('is OFF by default and never fires without opt-in', () => {
    const { calls, d } = driver();
    const h = new HapticScheduler(d);
    expect(h.request('TAP', 0).fired).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it('honours cooldown, rate limit, emergency mute, pause and LOW tier suppression', () => {
    const { calls, d } = driver();
    const h = new HapticScheduler(d);
    h.preference = 'NORMAL';
    expect(h.request('SOFT_IMPACT', 0).fired).toBe(true);
    expect(h.request('SOFT_IMPACT', 100).reason).toBe('cooldown');
    let fired = 0;
    for (let t = 1000; t < 60000; t += 600) if (h.request('SOFT_IMPACT', t).fired) fired++;
    expect(fired + 1).toBeLessThanOrEqual(HAPTIC_ALPHABET.SOFT_IMPACT.maxRepeatPerMinute);
    h.muted = true; expect(h.request('TAP', 70000).reason).toBe('emergency mute'); h.muted = false;
    h.cancel('pause'); expect(h.request('TAP', 71000).reason).toBe('paused'); h.resume();
    h.preference = 'LOW'; expect(h.request('WARNING', 72000).reason).toMatch(/tier 3/);
    expect(calls.length).toBe(fired + 1);
  });
  it('10-minute walk with a footstep-rate request stream stays inside the comfort budget', () => {
    const { d } = driver();
    const h = new HapticScheduler(d, 40);
    h.preference = 'NORMAL';
    for (let t = 0; t < 600000; t += 500) h.request('TAP', t);
    expect(h.onTimeMs(60000, 600000)).toBeLessThanOrEqual(30 * 12);
    expect(h.log.filter((r) => r.fired).length).toBeLessThanOrEqual(10 * 30);
  });
  it('no-capability browsers degrade to visual/audio with a recorded reason', () => {
    const h = new HapticScheduler(null);
    h.preference = 'NORMAL';
    expect(h.request('WELCOME', 0).reason).toMatch(/no haptic capability/);
  });
});

describe('acoustic event grammar [M]', () => {
  it('at least six surfaces have distinguishable footstep synthesis', () => {
    const kinds: SurfaceKind[] = ['asphalt', 'wet_asphalt', 'concrete', 'wood', 'metal', 'carpet', 'sand', 'grass', 'tile'];
    const sigs = new Set(kinds.map((k) => { const f = footstepFor(k, 1.4); return `${f.noiseCutoffHz}|${f.bodyHz}|${f.decay}`; }));
    expect(sigs.size).toBeGreaterThanOrEqual(6);
    expect(footstepFor('asphalt', 1.4, 0.8).surface).toBe('wet_asphalt');
    expect(footstepFor('asphalt', 1.4, 0.8).splash).toBeGreaterThan(0);
  });
  it('distance attenuation, Doppler, occlusion and thunder delay follow declared models', () => {
    expect(distanceGain(1)).toBe(1);
    expect(distanceGain(10)).toBeCloseTo(0.1, 9);
    expect(dopplerFactor(20)).toBeGreaterThan(1);
    expect(dopplerFactor(-20)).toBeLessThan(1);
    expect(occlusionCutoff(1, false)).toBe(9000);
    expect(occlusionCutoff(0, true)).toBe(900);
    expect(thunderDelay(3430)).toBeCloseTo(10, 9);
    expect(engineTone(20, 0.5).gear).toBe(4);
  });
  it('one CAR_DOOR_CLOSE event yields audio + haptic cues sharing its id; telemetry measures spread', () => {
    const c = cuesFor({ id: 'ev:7', type: 'CAR_DOOR_CLOSE', tick: 7 });
    expect(c[0]).toMatchObject({ eventId: 'ev:7', hapticPattern: 'SOFT_IMPACT' });
    const tel = new SensoryTelemetry();
    tel.log('ev:7', 'world', 1.0, 'commit'); tel.log('ev:7', 'animation', 1.001, 'door hinge');
    tel.log('ev:7', 'audio', 1.012, 'slam'); tel.log('ev:7', 'haptic', 1.004, 'SOFT_IMPACT'); tel.log('ev:7', 'image', 1.016, 'frame');
    expect(tel.lanesFor('ev:7').size).toBe(5);
    expect(tel.spread('ev:7')).toBeCloseTo(0.015, 9);
  });
});
