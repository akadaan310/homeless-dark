// ASTRO analytic sky (§067–§069). Single-scattering Rayleigh + Henyey–Greenstein Mie with
// Kasten–Young air mass, written for this repository from the textbook formulation
// (Rayleigh/Mie coefficients at sea level, scale heights 8 km / 1.2 km). It is a
// physically-motivated visualisation, NOT a radiative-transfer solution: no multiple
// scattering, ozone, or measured aerosol. The GLSL in shaders.ts mirrors these functions
// exactly; this CPU twin feeds SH irradiance and is unit-tested.

export interface SkyParams {
  sunDir: [number, number, number]; // unit, world (y up)
  sunE: number; // sky radiance scale (authored calibration of the profile's sun intensity)
  rayleigh: number; // multiplier on sea-level Rayleigh β
  turbidity: number; // multiplier basis for Mie β (6 = clear day)
  mieG: number; // HG asymmetry
  cloud: number; // 0..1 overcast cover
  cloudColor: [number, number, number]; // linear radiance of the overcast layer
  night: number; // 0 day … 1 night (airglow floor)
}

export const BETA_R = [5.8e-6, 13.5e-6, 33.1e-6] as const; // 1/m at ~680/550/440 nm
export const BETA_M = 21e-6; // 1/m, clear-sky aerosol (turbidity 6)
export const H_R = 8000, H_M = 1200;
/** Authored: maps profile sun intensity to sky radiance so a clear zenith reads ≈0.3–0.5 (scene-linear). */
export const SKY_RADIANCE_SCALE = 6.5;
export const SUN_ANGULAR_RADIUS = 0.00465; // rad

export function airMass(cosZenith: number): number {
  const c = Math.max(0, cosZenith);
  const zDeg = (Math.acos(c) * 180) / Math.PI;
  return 1 / (c + 0.50572 * Math.pow(Math.max(0.0001, 96.07995 - zDeg), -1.6364));
}
export const rayleighPhase = (mu: number) => (3 / (16 * Math.PI)) * (1 + mu * mu);
export const hgPhase = (mu: number, g: number) => ((1 - g * g) / (4 * Math.PI)) / Math.pow(Math.max(1e-4, 1 + g * g - 2 * g * mu), 1.5);

/** Linear radiance of the sky in direction d (unit, y up). Sun disc optional (clamped by caller). */
export function skyRadiance(d: [number, number, number], p: SkyParams, sunDisc = true): [number, number, number] {
  const dy = Math.max(0.0, d[1]);
  const mu = d[0] * p.sunDir[0] + d[1] * p.sunDir[1] + d[2] * p.sunDir[2];
  const mView = airMass(dy), mSun = airMass(p.sunDir[1]);
  // sun below the horizon: fade the scattering source (twilight band ≈ 6°)
  const sunUp = Math.min(1, Math.max(0, (p.sunDir[1] + 0.1) / 0.16));
  const E = p.sunE * sunUp * sunUp;
  const pr = rayleighPhase(mu), pm = hgPhase(mu, p.mieG);
  const bm = BETA_M * (p.turbidity / 6);
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const br = BETA_R[c]! * p.rayleigh;
    const tauView = br * H_R * mView + bm * H_M * mView;
    const tauSun = br * H_R * mSun + bm * H_M * mSun;
    const scatter = (br * pr + bm * pm) / (br + bm);
    let L = E * scatter * (1 - Math.exp(-tauView)) * Math.exp(-0.5 * tauSun);
    if (sunDisc && mu > Math.cos(SUN_ANGULAR_RADIUS * 1.6)) {
      const disc = Math.min(1, Math.max(0, (mu - Math.cos(SUN_ANGULAR_RADIUS * 1.6)) / (Math.cos(SUN_ANGULAR_RADIUS) - Math.cos(SUN_ANGULAR_RADIUS * 1.6))));
      L += E * 400 * disc * Math.exp(-tauView);
    }
    L += [0.00025, 0.0004, 0.0009][c]! * p.night; // airglow / light-pollution floor (authored)
    // overcast layer replaces the clear sky in proportion to cover
    L = L * (1 - p.cloud) + p.cloudColor[c]! * p.cloud;
    out[c] = L;
  }
  // below the horizon: dimmed horizon radiance (ground is normally drawn by geometry)
  if (d[1] < 0) { const k = Math.max(0.15, 1 + d[1] * 3); for (let c = 0; c < 3; c++) out[c] = out[c]! * k; }
  return out;
}

/** Order-2 SH projection (9 RGB coefficients) of the sky radiance, for irradiance E(n). */
export function projectSH(p: SkyParams, nTheta = 24, nPhi = 48): Float32Array {
  const sh = new Float32Array(27);
  let wsum = 0;
  for (let i = 0; i < nTheta; i++) {
    const th = ((i + 0.5) / nTheta) * Math.PI, st = Math.sin(th), ct = Math.cos(th);
    for (let j = 0; j < nPhi; j++) {
      const ph = ((j + 0.5) / nPhi) * Math.PI * 2;
      const d: [number, number, number] = [st * Math.sin(ph), ct, -st * Math.cos(ph)];
      const L = skyRadiance(d, p, false);
      const dw = (Math.PI / nTheta) * ((2 * Math.PI) / nPhi) * st;
      wsum += dw;
      const [x, y, z] = d;
      const Y = [0.282095, 0.488603 * y, 0.488603 * z, 0.488603 * x, 1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z, 0.546274 * (x * x - y * y)];
      for (let k = 0; k < 9; k++) for (let c = 0; c < 3; c++) sh[k * 3 + c]! += L[c]! * Y[k]! * dw;
    }
  }
  // normalise the quadrature to exactly 4π
  const f = (4 * Math.PI) / wsum;
  for (let k = 0; k < 27; k++) sh[k] = sh[k]! * f;
  return sh;
}

/** Irradiance from SH (Ramamoorthi & Hanrahan 2001 convolution constants). */
export function shIrradiance(sh: Float32Array, n: [number, number, number]): [number, number, number] {
  const [x, y, z] = n;
  const b = [0.886227, 1.023328 * y, 1.023328 * z, 1.023328 * x, 0.858086 * x * y, 0.858086 * y * z, 0.247708 * (3 * z * z - 1), 0.858086 * x * z, 0.429043 * (x * x - y * y)];
  const out: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 9; k++) for (let c = 0; c < 3; c++) out[c] = out[c]! + sh[k * 3 + c]! * b[k]!;
  return out;
}

export const defaultSky = (): SkyParams => ({ sunDir: [0, 0.7071, -0.7071], sunE: 5.2 * SKY_RADIANCE_SCALE, rayleigh: 1.4, turbidity: 6, mieG: 0.8, cloud: 0, cloudColor: [0.4, 0.42, 0.45], night: 0 });
