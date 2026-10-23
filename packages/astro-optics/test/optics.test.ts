import { describe, it, expect } from 'vitest';
import { Vec3, Quat } from '@astro/core';
import { stereoRig, DEFAULT_STEREO, disparityPixels, depthFromDisparity, focalPixels, binocularOverlap, overlapMask, gaussianKernel, nyquistFixture, zoomInterpretation, clampSunRadiance, SUN_DISPLAY_CLAMP } from '@astro/optics';

describe('stereo', () => {
  it('eyes are separated by the IPD and converge at the vergence distance', () => {
    const rig = stereoRig({ position: new Vec3(0, 1.6, 0), quaternion: new Quat() }, DEFAULT_STEREO, 1);
    expect(rig.left.position.distanceTo(rig.right.position)).toBeCloseTo(0.063, 9);
    const fix = new Vec3(0, 1.6, -DEFAULT_STEREO.vergenceDistance);
    for (const e of [rig.left, rig.right]) {
      const fwd = new Vec3(0, 0, -1).applyQuaternion(e.quaternion);
      const to = fix.clone().sub(e.position).normalize();
      expect(fwd.dot(to)).toBeGreaterThan(0.999999);
    }
  });
  it('disparity is zero at fixation and inverts exactly', () => {
    const f = focalPixels(60, 1080);
    expect(disparityPixels(0.063, 6, 6, f)).toBe(0);
    const d = disparityPixels(0.063, 2, 6, f);
    expect(d).toBeGreaterThan(0);
    expect(depthFromDisparity(0.063, d, 6, f)).toBeCloseTo(2, 9);
    expect(() => disparityPixels(0.063, -1, 6, f)).toThrow();
  });
  it('overlap shrinks with toe-in and the mask agrees', () => {
    expect(binocularOverlap(100, 0).overlapDeg).toBe(100);
    const o = binocularOverlap(100, 5);
    expect(o.overlapDeg).toBe(90); expect(o.totalDeg).toBe(110); expect(o.monocularEachDeg).toBe(10);
    const m = overlapMask(201, [60, 90], [60, 90], 180);
    const frac = m.reduce((a, b) => a + b, 0) / m.length;
    expect(frac).toBeCloseTo(120 / 180, 1);
  });
});

describe('sampling', () => {
  it('gaussian kernel is normalised', () => {
    expect(gaussianKernel(2).weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
  it('Nyquist fixture flags aliasing and the prefilter removes contrast', () => {
    expect(nyquistFixture(16, 4, null).nyquistOk).toBe(true);
    const raw = nyquistFixture(6, 4, null), filt = nyquistFixture(6, 4, gaussianKernel(3));
    expect(raw.nyquistOk).toBe(false);
    expect(filt.sampleVariance).toBeLessThan(raw.sampleVariance);
  });
  it('zoom interpretation never claims recovered detail', () => {
    const z = zoomInterpretation(4096, 1024, 2);
    expect(z.displayPixels).toBe(2048); expect(z.mipLevel).toBe(1); expect(z.recoverable).toBe(false);
    expect(zoomInterpretation(256, 1024, 1).explanation).toMatch(/no verified detail/);
  });
  it('sun radiance is clamped', () => { expect(clampSunRadiance(1e6)).toBe(SUN_DISPLAY_CLAMP); });
});
