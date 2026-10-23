// ASTRO optics (§057–§060, §097, §116). [K] pinhole projection, rectified stereo,
// sampling theory. Fusion views are SIMULATED displays, never clinical vision claims;
// nothing here asks anyone to look at the Sun or train their eyes.
import { Vec3, Quat, Mat4 } from '@astro/core';

export interface StereoParams { ipd: number; focalLengthMm: number; sensorHeightMm: number; vergenceDistance: number; near: number; far: number }
export const DEFAULT_STEREO: StereoParams = { ipd: 0.063, focalLengthMm: 24, sensorHeightMm: 24, vergenceDistance: 6, near: 0.1, far: 12000 };

export const fovFromFocal = (f: number, sensor: number) => (2 * Math.atan(sensor / (2 * f)) * 180) / Math.PI;

export interface EyeCamera { eye: 'left' | 'right' | 'cyclopean'; position: Vec3; quaternion: Quat; toeIn: number; projection: Mat4; view: Mat4 }

/**
 * Binocular rig around a cyclopean pose. Eyes are offset ±ipd/2 along the head's right
 * axis and toe in to converge at the vergence distance (symmetric vergence).
 */
export function stereoRig(head: { position: Vec3; quaternion: Quat }, p: StereoParams, aspect: number): Record<'left' | 'right' | 'cyclopean', EyeCamera> {
  const fov = fovFromFocal(p.focalLengthMm, p.sensorHeightMm);
  const right = new Vec3(1, 0, 0).applyQuaternion(head.quaternion);
  const up = new Vec3(0, 1, 0).applyQuaternion(head.quaternion);
  const toe = Math.atan(p.ipd / 2 / p.vergenceDistance);
  const mk = (eye: 'left' | 'right' | 'cyclopean', s: number): EyeCamera => {
    const position = head.position.clone().addScaledVector(right, (s * p.ipd) / 2);
    const quaternion = new Quat().setFromAxisAngle(up, s * toe).multiply(head.quaternion);
    const world = new Mat4().compose(position, quaternion, new Vec3(1, 1, 1));
    return { eye, position, quaternion, toeIn: s * toe, projection: new Mat4().perspective(fov, aspect, p.near, p.far), view: world.clone().invert() };
  };
  return { left: mk('left', -1), right: mk('right', 1), cyclopean: mk('cyclopean', 0) };
}

/** Rectified disparity d = f·b·(1/Z − 1/Z₀) in pixels relative to fixation (signed). */
export function disparityPixels(baseline: number, depth: number, fixation: number, focalPixels: number): number {
  if (![baseline, depth, fixation, focalPixels].every((v) => Number.isFinite(v) && v > 0)) throw new RangeError('stereo values must be positive');
  return focalPixels * baseline * (1 / depth - 1 / fixation);
}
/** Inverse: depth from disparity. */
export function depthFromDisparity(baseline: number, disparity: number, fixation: number, focalPixels: number): number {
  return 1 / (disparity / (focalPixels * baseline) + 1 / fixation);
}
export const focalPixels = (fovDeg: number, heightPx: number) => heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));

/**
 * Far-field angular overlap of two eyes with horizontal FOV h whose axes are toed in by θ
 * (θ > 0 converging). Left eye spans [−h/2+θ, h/2+θ], right eye [−h/2−θ, h/2−θ].
 */
export function binocularOverlap(hfovDeg: number, toeInDeg: number): { overlapDeg: number; totalDeg: number; monocularEachDeg: number } {
  if (!(hfovDeg > 0 && hfovDeg < 180) || Math.abs(toeInDeg) >= 90) throw new RangeError('invalid FOV');
  const overlap = Math.max(0, hfovDeg - 2 * Math.abs(toeInDeg));
  const total = hfovDeg + 2 * Math.abs(toeInDeg);
  return { overlapDeg: overlap, totalDeg: total, monocularEachDeg: (total - overlap) / 2 };
}

/** Per-pixel overlap mask for asymmetric eye fields: 1 = both eyes see this cyclopean direction. */
export function overlapMask(width: number, leftHalfFovDeg: [number, number], rightHalfFovDeg: [number, number], totalFovDeg: number): Uint8Array {
  // fields are [nasal, temporal] half-angles; the cyclopean image spans ±totalFov/2
  const m = new Uint8Array(width);
  for (let x = 0; x < width; x++) {
    const a = (x / (width - 1) - 0.5) * totalFovDeg; // negative = left of centre
    const inLeft = a >= -leftHalfFovDeg[1] && a <= leftHalfFovDeg[0];
    const inRight = a <= rightHalfFovDeg[1] && a >= -rightHalfFovDeg[0];
    m[x] = inLeft && inRight ? 1 : 0;
  }
  return m;
}

// ---------------------------------------------------------------- PSF and sampling (§057, §058)
export type Kernel = { size: number; weights: Float32Array; name: string };
export function gaussianKernel(sigma: number, radius = Math.ceil(3 * sigma)): Kernel {
  const size = 2 * radius + 1, w = new Float32Array(size);
  let s = 0;
  for (let i = 0; i < size; i++) { const x = i - radius; w[i] = Math.exp(-(x * x) / (2 * sigma * sigma)); s += w[i]!; }
  for (let i = 0; i < size; i++) w[i] = w[i]! / s;
  return { size, weights: w, name: `gaussian σ=${sigma}` };
}
export const boxKernel = (n: number): Kernel => ({ size: n, weights: new Float32Array(n).fill(1 / n), name: `box ${n}` });

export function convolve1D(signal: Float32Array, k: Kernel): Float32Array {
  const r = (k.size - 1) / 2, out = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) { let s = 0; for (let j = 0; j < k.size; j++) { const x = Math.min(signal.length - 1, Math.max(0, i + j - r)); s += signal[x]! * k.weights[j]!; } out[i] = s; }
  return out;
}

/** Decimate by `factor` with an optional prefilter. Returns the sampled signal. */
export function downsample(signal: Float32Array, factor: number, prefilter: Kernel | null): Float32Array {
  const src = prefilter ? convolve1D(signal, prefilter) : signal;
  const out = new Float32Array(Math.floor(src.length / factor));
  for (let i = 0; i < out.length; i++) out[i] = src[i * factor]!;
  return out;
}

/** Checkerboard/Nyquist fixture: a period-p square wave sampled every `factor` texels aliases when p < 2·factor. */
export function nyquistFixture(periodTexels: number, factor: number, prefilter: Kernel | null) {
  const n = 4096, s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.floor(i / (periodTexels / 2)) % 2;
  const d = downsample(s, factor, prefilter);
  let mean = 0; for (const v of d) mean += v; mean /= d.length;
  let varc = 0; for (const v of d) varc += (v - mean) ** 2; varc /= d.length;
  const aliased = periodTexels < 2 * factor;
  return { periodTexels, factor, nyquistOk: !aliased, sampleVariance: varc, note: aliased ? 'pattern above Nyquist: samples alias (false low-frequency or constant)' : 'below Nyquist: pattern representable' };
}

export interface ZoomReport { sourceTexels: number; displayPixels: number; dpr: number; mipLevel: number; footprintTexelsPerPixel: number; reconstruction: 'nearest' | 'bilinear' | 'trilinear'; highFrequencyLost: boolean; recoverable: boolean; explanation: string }
/** §058: distinguish texel, display pixel, DPR, mip level and sampling footprint. */
export function zoomInterpretation(sourceTexels: number, cssPixels: number, dpr: number, reconstruction: ZoomReport['reconstruction'] = 'trilinear'): ZoomReport {
  const displayPixels = Math.round(cssPixels * dpr);
  const footprint = sourceTexels / displayPixels;
  const mip = Math.max(0, Math.log2(Math.max(1, footprint)));
  const lost = footprint > 1;
  return {
    sourceTexels, displayPixels, dpr, mipLevel: +mip.toFixed(3), footprintTexelsPerPixel: +footprint.toFixed(4), reconstruction, highFrequencyLost: lost,
    recoverable: !lost,
    explanation: lost ? `each display pixel integrates ${footprint.toFixed(2)} texels (mip ${mip.toFixed(2)}): detail above the display Nyquist limit is filtered out and cannot be recovered by zooming the screenshot`
      : `magnified ${(1 / footprint).toFixed(2)}× : every texel is visible; interpolation adds no verified detail`,
  };
}

/** Sun safety (§116): rendered solar disc luminance is clamped; no viewing exercise is ever prescribed. */
export const SUN_DISPLAY_CLAMP = 16; // linear scene units before tone mapping
export const clampSunRadiance = (l: number) => Math.min(l, SUN_DISPLAY_CLAMP);
