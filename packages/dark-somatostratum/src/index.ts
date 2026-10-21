// SOMATOSTRATUM: one world event → time-coded visual, acoustic, haptic, particle,
// material and animation cues sharing one causal id. [C] DARK construction.
// Acoustic formulas are [K] (inverse-distance law, Doppler, speed of sound);
// their parameters are authored approximations, not measured room acoustics.

export type SurfaceKind = 'asphalt' | 'wet_asphalt' | 'concrete' | 'wood' | 'metal' | 'carpet' | 'water' | 'sand' | 'grass' | 'tile' | 'unknown';
export type CueCategory = 'step' | 'rain' | 'door' | 'vehicle' | 'wind' | 'takeoff' | 'aircraft_cabin' | 'ocean' | 'interface' | 'story' | 'thunder' | 'sign';
export type Lane = 'time' | 'world' | 'animation' | 'image' | 'audio' | 'haptic';

export interface SensoryCue {
  eventId: string;
  causedBy?: string;
  worldTick: number;
  scheduledAudioTime?: number;
  actorId?: string;
  category: CueCategory;
  intensity01: number;
  position?: [number, number, number];
  surface?: SurfaceKind;
  audioClipOrSynth?: string;
  hapticPattern?: HapticLetter;
  visualProgramId?: string;
  sourceStatus: 'real' | 'synthetic' | 'authored';
}

export interface TelemetryRecord { eventId: string; lane: Lane; t: number; detail: string }

/** Six-lane telemetry keyed by event id. Bounded ring buffer. */
export class SensoryTelemetry {
  readonly records: TelemetryRecord[] = [];
  constructor(private cap = 4000) {}
  log(eventId: string, lane: Lane, t: number, detail: string) {
    this.records.push({ eventId, lane, t, detail });
    if (this.records.length > this.cap) this.records.splice(0, this.records.length - this.cap);
  }
  lanesFor(eventId: string): Set<Lane> { return new Set(this.records.filter((r) => r.eventId === eventId).map((r) => r.lane)); }
  /** Max onset spread (seconds) between lanes of one event, a synchrony measure. */
  spread(eventId: string, lanes: Lane[] = ['animation', 'audio', 'haptic', 'image']): number {
    const ts = this.records.filter((r) => r.eventId === eventId && lanes.includes(r.lane)).map((r) => r.t);
    return ts.length ? Math.max(...ts) - Math.min(...ts) : 0;
  }
}

// ---------------------------------------------------------------- haptics
export type HapticLetter = 'TAP' | 'DOUBLE_TAP' | 'SOFT_IMPACT' | 'ROUGH_ROAD' | 'ENGINE_RUMBLE_HINT' | 'WAVE_PULSE' | 'WARNING' | 'WELCOME';
export type HapticPreference = 'OFF' | 'LOW' | 'NORMAL';

export interface HapticSpec { meaning: string; pattern: number[]; maxRepeatPerMinute: number; cooldownMs: number; tier: 1 | 2 | 3 }

/** Patterns are vibrate() style [on, off, on…] ms. Every letter is short; nothing runs perpetually. */
export const HAPTIC_ALPHABET: Record<HapticLetter, HapticSpec> = {
  TAP: { meaning: 'selection / confirmation', pattern: [12], maxRepeatPerMinute: 30, cooldownMs: 120, tier: 1 },
  DOUBLE_TAP: { meaning: 'state change acknowledged', pattern: [12, 60, 12], maxRepeatPerMinute: 12, cooldownMs: 400, tier: 1 },
  SOFT_IMPACT: { meaning: 'contact: door latch, seat, landing gear', pattern: [28], maxRepeatPerMinute: 12, cooldownMs: 500, tier: 2 },
  ROUGH_ROAD: { meaning: 'surface texture under wheels', pattern: [8, 40, 8, 40, 8], maxRepeatPerMinute: 6, cooldownMs: 4000, tier: 2 },
  ENGINE_RUMBLE_HINT: { meaning: 'engine start / spool-up hint', pattern: [40, 30, 60], maxRepeatPerMinute: 4, cooldownMs: 8000, tier: 3 },
  WAVE_PULSE: { meaning: 'hull meets a wave', pattern: [35], maxRepeatPerMinute: 8, cooldownMs: 3000, tier: 2 },
  WARNING: { meaning: 'attention: refusal or hazard', pattern: [60, 80, 60], maxRepeatPerMinute: 4, cooldownMs: 3000, tier: 3 },
  WELCOME: { meaning: 'arrival / journey milestone', pattern: [20, 90, 40], maxRepeatPerMinute: 2, cooldownMs: 20000, tier: 2 },
};

export interface HapticDriver { name: string; fire(pattern: number[], intensity: number): Promise<boolean> | boolean; cancel(): void }

export interface HapticFireRecord { letter: HapticLetter; t: number; fired: boolean; reason: string; driver: string; eventId?: string }

/**
 * Budgeted haptic scheduler: OFF by default, global emergency mute, per-letter
 * cooldown and rate limits, a per-minute total budget, cancel on pause/teardown.
 * A successful driver call is recorded as "requested", never as "felt".
 */
export class HapticScheduler {
  preference: HapticPreference = 'OFF';
  muted = false;
  paused = false;
  readonly log: HapticFireRecord[] = [];
  private last = new Map<HapticLetter, number>();
  constructor(private driver: HapticDriver | null, private totalPerMinute = 40) {}

  setDriver(d: HapticDriver | null) { this.driver = d; }

  request(letter: HapticLetter, now: number, eventId?: string): HapticFireRecord {
    const spec = HAPTIC_ALPHABET[letter];
    const rec = (fired: boolean, reason: string): HapticFireRecord => {
      const r = { letter, t: now, fired, reason, driver: this.driver?.name ?? 'none', eventId };
      this.log.push(r);
      if (this.log.length > 2000) this.log.splice(0, 500);
      return r;
    };
    if (this.muted) return rec(false, 'emergency mute');
    if (this.preference === 'OFF') return rec(false, 'preference OFF');
    if (this.paused) return rec(false, 'paused');
    if (!this.driver) return rec(false, 'no haptic capability; visual/audio cue carries the meaning');
    if (this.preference === 'LOW' && spec.tier === 3) return rec(false, 'tier 3 suppressed at LOW');
    const prev = this.last.get(letter);
    if (prev !== undefined && now - prev < spec.cooldownMs) return rec(false, 'cooldown');
    const minute = this.log.filter((r) => r.fired && now - r.t < 60000);
    if (minute.filter((r) => r.letter === letter).length >= spec.maxRepeatPerMinute) return rec(false, 'letter rate limit');
    if (minute.length >= this.totalPerMinute) return rec(false, 'total budget');
    this.last.set(letter, now);
    const intensity = this.preference === 'LOW' ? 0.5 : 1;
    const pattern = this.preference === 'LOW' ? spec.pattern.map((v, i) => (i % 2 === 0 ? Math.max(5, Math.round(v * 0.6)) : v)) : spec.pattern;
    void this.driver.fire(pattern, intensity);
    return rec(true, 'requested');
  }

  cancel(reason: 'pause' | 'teardown' | 'focus'): void {
    this.paused = reason !== 'focus' ? true : this.paused;
    this.driver?.cancel();
  }
  resume(): void { this.paused = false; }
  /** Total requested vibration time (ms) in a window — for comfort/battery audits. */
  onTimeMs(windowMs: number, now: number): number {
    return this.log.filter((r) => r.fired && now - r.t < windowMs).reduce((a, r) => a + HAPTIC_ALPHABET[r.letter].pattern.filter((_, i) => i % 2 === 0).reduce((x, y) => x + y, 0), 0);
  }
}

// ---------------------------------------------------------------- acoustic grammar
export const SPEED_OF_SOUND = 343; // m/s, dry air 20 °C

export interface FootstepSynth { surface: SurfaceKind; noiseCutoffHz: number; bodyHz: number; decay: number; gain: number; splash: number; crunch: number }

/** Footstep synthesis parameters per surface; gait speed scales gain, wetness adds splash. */
export function footstepFor(surface: SurfaceKind, speed: number, wetness = 0): FootstepSynth {
  const base: Record<SurfaceKind, Omit<FootstepSynth, 'surface' | 'gain' | 'splash'>> = {
    asphalt: { noiseCutoffHz: 2400, bodyHz: 110, decay: 0.09, crunch: 0.3 },
    wet_asphalt: { noiseCutoffHz: 5200, bodyHz: 95, decay: 0.14, crunch: 0.1 },
    concrete: { noiseCutoffHz: 3200, bodyHz: 140, decay: 0.07, crunch: 0.15 },
    wood: { noiseCutoffHz: 1500, bodyHz: 190, decay: 0.12, crunch: 0 },
    metal: { noiseCutoffHz: 6000, bodyHz: 420, decay: 0.22, crunch: 0 },
    carpet: { noiseCutoffHz: 700, bodyHz: 80, decay: 0.05, crunch: 0 },
    water: { noiseCutoffHz: 6500, bodyHz: 70, decay: 0.25, crunch: 0 },
    sand: { noiseCutoffHz: 1800, bodyHz: 60, decay: 0.16, crunch: 0.8 },
    grass: { noiseCutoffHz: 2600, bodyHz: 70, decay: 0.1, crunch: 0.6 },
    tile: { noiseCutoffHz: 4200, bodyHz: 260, decay: 0.08, crunch: 0 },
    unknown: { noiseCutoffHz: 2000, bodyHz: 120, decay: 0.08, crunch: 0.2 },
  };
  const s = surface === 'asphalt' && wetness > 0.35 ? 'wet_asphalt' : surface;
  return { surface: s, ...base[s], gain: Math.min(1, 0.35 + speed * 0.12), splash: s === 'wet_asphalt' || s === 'water' ? Math.min(1, 0.3 + wetness) : 0 };
}

/** Inverse-distance gain (Web Audio 'inverse' model). */
export function distanceGain(d: number, ref = 1, rolloff = 1): number {
  return ref / (ref + rolloff * (Math.max(d, ref) - ref));
}

/** Doppler playback-rate factor for source/listener radial velocities (positive = approaching). */
export function dopplerFactor(sourceApproachMps: number, listenerApproachMps = 0): number {
  return (SPEED_OF_SOUND + listenerApproachMps) / Math.max(1, SPEED_OF_SOUND - sourceApproachMps);
}

/** Occlusion → low-pass cutoff. Authored approximation: each occluder halves bandwidth from 18 kHz. */
export function occlusionCutoff(occluders: number, interior: boolean): number {
  const f = 18000 / 2 ** Math.min(4, occluders);
  return interior ? Math.min(f, 900) : f;
}

/** Thunder delay from distance: light first, sound after d / c. */
export const thunderDelay = (distanceM: number) => distanceM / SPEED_OF_SOUND;

/** Engine tone from speed and gear (authored): returns fundamental Hz and load 0..1. */
export function engineTone(speedMps: number, throttle: number): { hz: number; gear: number; load: number } {
  const ratios = [0, 3.6, 2.1, 1.4, 1.0, 0.8];
  const gear = speedMps < 4 ? 1 : speedMps < 10 ? 2 : speedMps < 17 ? 3 : speedMps < 25 ? 4 : 5;
  const rpm = Math.max(800, Math.min(6500, speedMps * ratios[gear]! * 95 + 800));
  return { hz: (rpm / 60) * 2, gear, load: Math.max(0.1, Math.min(1, throttle)) };
}

/** Map a world event to its sensory cues (the Somatostratum grammar). */
export function cuesFor(ev: { id: string; type: string; tick: number; actor?: string; position?: [number, number, number]; surface?: SurfaceKind; intensity?: number }): SensoryCue[] {
  const base = { eventId: ev.id, worldTick: ev.tick, actorId: ev.actor, position: ev.position, sourceStatus: 'synthetic' as const };
  switch (ev.type) {
    case 'FOOTSTEP': return [{ ...base, category: 'step', intensity01: ev.intensity ?? 0.5, surface: ev.surface, audioClipOrSynth: `synth:footstep:${ev.surface}` }];
    case 'CAR_DOOR_CLOSE': return [{ ...base, category: 'door', intensity01: 0.8, audioClipOrSynth: 'synth:door-slam', hapticPattern: 'SOFT_IMPACT' }];
    case 'RAIN_START': return [{ ...base, category: 'rain', intensity01: ev.intensity ?? 0.8, audioClipOrSynth: 'clip:synthetic_rain_wind_loop', visualProgramId: 'wet-night' }];
    case 'THUNDER_FAR': return [{ ...base, category: 'thunder', intensity01: 0.6, audioClipOrSynth: 'synth:thunder' }];
    case 'ENGINE_START': return [{ ...base, category: 'vehicle', intensity01: 0.6, audioClipOrSynth: 'synth:engine', hapticPattern: 'ENGINE_RUMBLE_HINT' }];
    case 'AIRCRAFT_TAKEOFF': return [{ ...base, category: 'takeoff', intensity01: 1, audioClipOrSynth: 'synth:jet-spool', hapticPattern: 'ENGINE_RUMBLE_HINT' }];
    case 'WAVE_HULL': return [{ ...base, category: 'ocean', intensity01: ev.intensity ?? 0.5, audioClipOrSynth: 'synth:surf', hapticPattern: 'WAVE_PULSE' }];
    case 'SIGN_LIGHT_SHIFT': return [{ ...base, category: 'sign', intensity01: 0.4, audioClipOrSynth: 'synth:chime', hapticPattern: 'TAP', visualProgramId: 'sign-program' }];
    case 'ARRIVED': return [{ ...base, category: 'story', intensity01: 0.7, audioClipOrSynth: 'clip:original_arrival_motif', hapticPattern: 'WELCOME' }];
    default: return [];
  }
}
