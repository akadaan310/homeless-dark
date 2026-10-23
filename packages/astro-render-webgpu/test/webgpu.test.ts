import { describe, it, expect } from 'vitest';
import { uniformLayout, packUniforms, probeWebGPU } from '@astro/render-webgpu';
import { WAVE_STEP, WAVE_IMPULSE } from '@astro/render-webgl2';

describe('WebGPU backend (host-side)', () => {
  it('uniform layout follows WGSL alignment', () => {
    const l = uniformLayout(WAVE_STEP); // resolution vec2 @0, time @8, texel vec2 @16, k @24, dt @28, damp @32
    expect(l.offsets).toEqual({ resolution: 0, time: 8, texel: 16, k: 24, dt: 28, damp: 32 });
    expect(l.size % 16).toBe(0);
    const li = uniformLayout(WAVE_IMPULSE);
    expect(li.offsets.center! % 8).toBe(0);
    const f = new Float32Array(packUniforms(WAVE_STEP, { k: 400, dt: 0.02, damp: 0.1, texel: [0.5, 0.25] }, [64, 32]));
    expect([f[0], f[1], f[4], f[5], f[6]]).toEqual([64, 32, 0.5, 0.25, 400]);
  });
  it('probe reports NOT available without navigator.gpu (Node): gate stays NOT_RUN', async () => {
    const p = await probeWebGPU();
    expect(p.available).toBe(false);
    expect(p.reason).toMatch(/navigator\.gpu/);
  });
});
