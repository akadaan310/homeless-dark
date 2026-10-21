// Chromastratum light grammar: source families, profiles, bounded exposure and wetness.
// [K] Kelvin→linear sRGB via Planckian locus fit (Krystek 1985 in CIE 1960 uv → XYZ),
//     photometric units where Three exposes them (candela for point/spot lights).
// [C] profile table, selection rules, adaptation bounds: authored, tuned by test.

import { linearToXyz, xyzToLinear, type RGB } from './color';

export type LightProfileId = 'day' | 'golden_hour' | 'twilight' | 'night' | 'indoor' | 'tunnel' | 'underwater' | 'aircraft_cabin';

export interface LightProfile {
  id: LightProfileId;
  exposureEV: number; // camera exposure compensation, EV100-relative authored value
  sunIntensityLux: number; // illuminance scale for the directional key (scene units)
  hemiIntensity: number;
  skyTurbidity: number; rayleigh: number; mieCoefficient: number; mieDirectionalG: number;
  fogDensity: number;
  streetLightsOn: boolean;
  colorTempK: number; // key colour temperature
  source: 'authored';
}

export const PROFILES: Record<LightProfileId, LightProfile> = {
  day: { id: 'day', exposureEV: 0, sunIntensityLux: 5.2, hemiIntensity: 0.3, skyTurbidity: 6, rayleigh: 1.4, mieCoefficient: 0.004, mieDirectionalG: 0.8, fogDensity: 0.0012, streetLightsOn: false, colorTempK: 5600, source: 'authored' },
  golden_hour: { id: 'golden_hour', exposureEV: 0.4, sunIntensityLux: 3.8, hemiIntensity: 0.25, skyTurbidity: 8, rayleigh: 2.2, mieCoefficient: 0.006, mieDirectionalG: 0.86, fogDensity: 0.0016, streetLightsOn: false, colorTempK: 3400, source: 'authored' },
  twilight: { id: 'twilight', exposureEV: 1.2, sunIntensityLux: 0.35, hemiIntensity: 0.18, skyTurbidity: 9, rayleigh: 3, mieCoefficient: 0.008, mieDirectionalG: 0.9, fogDensity: 0.002, streetLightsOn: true, colorTempK: 7500, source: 'authored' },
  night: { id: 'night', exposureEV: 1.9, sunIntensityLux: 0.06, hemiIntensity: 0.05, skyTurbidity: 2, rayleigh: 0.3, mieCoefficient: 0.002, mieDirectionalG: 0.7, fogDensity: 0.0025, streetLightsOn: true, colorTempK: 4100, source: 'authored' },
  indoor: { id: 'indoor', exposureEV: 1.1, sunIntensityLux: 0.4, hemiIntensity: 0.45, skyTurbidity: 6, rayleigh: 1.4, mieCoefficient: 0.004, mieDirectionalG: 0.8, fogDensity: 0, streetLightsOn: true, colorTempK: 3000, source: 'authored' },
  tunnel: { id: 'tunnel', exposureEV: 1.6, sunIntensityLux: 0.1, hemiIntensity: 0.2, skyTurbidity: 6, rayleigh: 1, mieCoefficient: 0.004, mieDirectionalG: 0.8, fogDensity: 0.004, streetLightsOn: true, colorTempK: 4000, source: 'authored' },
  underwater: { id: 'underwater', exposureEV: 1, sunIntensityLux: 0.5, hemiIntensity: 0.5, skyTurbidity: 6, rayleigh: 1, mieCoefficient: 0.01, mieDirectionalG: 0.8, fogDensity: 0.05, streetLightsOn: false, colorTempK: 9000, source: 'authored' },
  aircraft_cabin: { id: 'aircraft_cabin', exposureEV: 0.9, sunIntensityLux: 1.2, hemiIntensity: 0.5, skyTurbidity: 3, rayleigh: 0.8, mieCoefficient: 0.003, mieDirectionalG: 0.8, fogDensity: 0, streetLightsOn: true, colorTempK: 4300, source: 'authored' },
};

/** Outdoor profile from solar elevation (degrees). Thresholds: civil twilight −6°, golden hour < 8°. */
export function outdoorProfile(sunElevation: number): LightProfileId {
  if (sunElevation >= 8) return 'day';
  if (sunElevation >= -1) return 'golden_hour';
  if (sunElevation >= -8) return 'twilight';
  return 'night';
}

/** Smooth weights over outdoor profiles (for continuous transitions without popping). */
export function outdoorBlend(sunElevation: number): Partial<Record<LightProfileId, number>> {
  const keys: [LightProfileId, number][] = [['night', -12], ['twilight', -4], ['golden_hour', 3], ['day', 15]];
  if (sunElevation <= keys[0]![1]) return { night: 1 };
  if (sunElevation >= keys[3]![1]) return { day: 1 };
  for (let i = 0; i < 3; i++) {
    const [a, ea] = keys[i]!, [b, eb] = keys[i + 1]!;
    if (sunElevation >= ea && sunElevation <= eb) {
      const t = (sunElevation - ea) / (eb - ea);
      const s = t * t * (3 - 2 * t);
      return { [a]: 1 - s, [b]: s };
    }
  }
  return { day: 1 };
}

export function blendProfiles(weights: Partial<Record<LightProfileId, number>>): Omit<LightProfile, 'id' | 'streetLightsOn' | 'source'> & { streetLights: number } {
  const acc = { exposureEV: 0, sunIntensityLux: 0, hemiIntensity: 0, skyTurbidity: 0, rayleigh: 0, mieCoefficient: 0, mieDirectionalG: 0, fogDensity: 0, colorTempK: 0, streetLights: 0 };
  let total = 0;
  for (const [id, w] of Object.entries(weights) as [LightProfileId, number][]) {
    const p = PROFILES[id];
    total += w;
    for (const k of ['exposureEV', 'sunIntensityLux', 'hemiIntensity', 'skyTurbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'fogDensity', 'colorTempK'] as const) acc[k] += p[k] * w;
    acc.streetLights += (p.streetLightsOn ? 1 : 0) * w;
  }
  for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] /= total || 1;
  return acc;
}

/** Bounded, time-smoothed exposure adaptation; maxEVPerSecond is an accessibility setting. */
export function adaptExposure(current: number, target: number, dt: number, maxEVPerSecond = 0.75): number {
  const d = target - current;
  const lim = maxEVPerSecond * dt;
  return current + Math.max(-lim, Math.min(lim, d));
}

/** Correlated colour temperature → normalized linear sRGB (max channel = 1). Valid 1667–25000 K. */
export function kelvinToLinear(k: number): RGB {
  const T = Math.max(1667, Math.min(25000, k));
  // Krystek (1985) rational approximation of the Planckian locus in CIE 1960 (u, v).
  const u = (0.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * T * T) / (1 + 8.42420235e-4 * T + 7.08145163e-7 * T * T);
  const v = (0.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * T * T) / (1 - 2.89741816e-5 * T + 1.61456053e-7 * T * T);
  const x = (3 * u) / (2 * u - 8 * v + 4), y = (2 * v) / (2 * u - 8 * v + 4);
  const X = x / y, Z = (1 - x - y) / y;
  const lin = xyzToLinear([X, 1, Z]).map((c) => Math.max(0, c)) as RGB;
  const m = Math.max(...lin);
  return lin.map((c) => c / m) as RGB;
}
export { linearToXyz };

// ---------------------------------------------------------------- wetness grammar
export interface WetnessState { wetness: number; puddle: number }

/**
 * Rain intensity r∈[0,1] → surface wetness with first-order wetting/drying.
 * τ_wet ≈ 40 s at full rain; drying τ ≈ 240 s. Puddles fill only where the
 * authored depression mask is high (no random puddles everywhere).
 */
export function stepWetness(s: WetnessState, rain: number, dt: number): WetnessState {
  const target = Math.min(1, rain * 1.1);
  const tau = target > s.wetness ? 40 / Math.max(0.15, rain) : 240;
  const wetness = s.wetness + (target - s.wetness) * (1 - Math.exp(-dt / tau));
  const pTarget = rain > 0.3 ? Math.min(1, (wetness - 0.4) * 1.8) : 0;
  const puddle = Math.max(0, s.puddle + (pTarget - s.puddle) * (1 - Math.exp(-dt / (pTarget > s.puddle ? 90 : 400))));
  return { wetness, puddle };
}

/** Material response: wet surfaces darken albedo and drop roughness (water film). */
export function wetMaterial(dryRoughness: number, wetness: number, depression: number, puddle: number): { roughness: number; albedoScale: number; puddleCover: number } {
  const film = wetness * (0.65 + 0.35 * depression);
  const cover = Math.min(1, Math.max(0, (depression - 0.55) * 3) * puddle);
  return { roughness: Math.max(0.04, dryRoughness * (1 - 0.75 * film) * (1 - cover) + 0.04 * cover), albedoScale: 1 - 0.35 * film, puddleCover: cover };
}
