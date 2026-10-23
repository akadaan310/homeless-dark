// Optional ASTRO WebGPU backend (§042, §107). Production rendering is WebGL2; this backend
// proves the shader DSL's WGSL path on real adapters by running the pixel-field programs
// and reading the state back. When no adapter exists the gate is NOT_RUN — never PASS.
/// <reference types="@webgpu/types" />
import { toWGSL, type ShaderProgram, type DType } from '@astro/core';

export interface WebGPUProbe { available: boolean; reason: string; adapter?: { vendor: string; architecture: string; description: string }; features?: string[]; maxTexture2D?: number }

export async function probeWebGPU(): Promise<WebGPUProbe> {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (!nav || !('gpu' in nav) || !nav.gpu) return { available: false, reason: 'navigator.gpu absent (browser/flags without WebGPU)' };
  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) return { available: false, reason: 'requestAdapter() returned null (no compatible GPU/driver)' };
    const info = (adapter as unknown as { info?: GPUAdapterInfo }).info;
    return { available: true, reason: 'adapter acquired', adapter: { vendor: info?.vendor ?? '', architecture: info?.architecture ?? '', description: info?.description ?? '' }, features: [...adapter.features], maxTexture2D: adapter.limits.maxTextureDimension2D };
  } catch (e) { return { available: false, reason: `requestAdapter threw: ${(e as Error).message}` }; }
}

const SIZE: Record<DType, number> = { f32: 4, vec2: 8, vec3: 12, vec4: 16 };
const ALIGN: Record<DType, number> = { f32: 4, vec2: 8, vec3: 16, vec4: 16 };
/** WGSL uniform layout for the DSL's struct U { resolution, time, ...uniforms } (host-shareable rules). */
export function uniformLayout(p: ShaderProgram): { offsets: Record<string, number>; size: number } {
  const members: { name: string; t: DType }[] = [{ name: 'resolution', t: 'vec2' }, { name: 'time', t: 'f32' }, ...p.uniforms];
  const offsets: Record<string, number> = {};
  let o = 0, maxAlign = 4;
  for (const m of members) { const a = ALIGN[m.t]; o = Math.ceil(o / a) * a; offsets[m.name] = o; o += SIZE[m.t]; maxAlign = Math.max(maxAlign, a); }
  return { offsets, size: Math.max(16, Math.ceil(o / Math.max(16, maxAlign)) * Math.max(16, maxAlign)) };
}
export function packUniforms(p: ShaderProgram, values: Record<string, number | number[]>, resolution: [number, number], time = 0): ArrayBuffer {
  const { offsets, size } = uniformLayout(p);
  const buf = new ArrayBuffer(size), f = new Float32Array(buf);
  const put = (name: string, v: number | number[]) => { const o = offsets[name]! / 4; if (typeof v === 'number') f[o] = v; else v.forEach((x, i) => { f[o + i] = x; }); };
  put('resolution', resolution); put('time', time);
  for (const u of p.uniforms) if (values[u.name] !== undefined) put(u.name, values[u.name]!);
  return buf;
}

export interface PassRunner { run(p: ShaderProgram, values: Record<string, number | number[]>): void; read(): Promise<Float32Array>; device: GPUDevice; destroy(): void }

/** Ping-pong RGBA32F full-screen passes over an nx×ny grid (single sampler programs). */
export async function createPassRunner(nx: number, ny: number): Promise<PassRunner | null> {
  const probe = await probeWebGPU();
  if (!probe.available) return null;
  const adapter = (await navigator.gpu.requestAdapter())!;
  const device = await adapter.requestDevice();
  const tex = [0, 1].map(() => device.createTexture({ size: [nx, ny], format: 'rgba32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST }));
  const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'non-filtering' } },
  ] });
  const pipelines = new Map<string, GPURenderPipeline>();
  let cur = 0;
  const pipe = (p: ShaderProgram) => {
    let pl = pipelines.get(p.name);
    if (!pl) {
      const module = device.createShaderModule({ code: toWGSL(p) });
      pl = device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba32float' }] }, primitive: { topology: 'triangle-list' } });
      pipelines.set(p.name, pl);
    }
    return pl;
  };
  return {
    device,
    run(p, values) {
      const data = packUniforms(p, values, [nx, ny]);
      const ub = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(ub, 0, data);
      const bg = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: ub } }, { binding: 1, resource: tex[cur]!.createView() }, { binding: 2, resource: sampler }] });
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex[1 - cur]!.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(pipe(p)); pass.setBindGroup(0, bg); pass.draw(3); pass.end();
      device.queue.submit([enc.finish()]);
      cur = 1 - cur;
    },
    async read() {
      const bpr = Math.ceil((nx * 16) / 256) * 256;
      const out = device.createBuffer({ size: bpr * ny, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: tex[cur]! }, { buffer: out, bytesPerRow: bpr }, [nx, ny]);
      device.queue.submit([enc.finish()]);
      await out.mapAsync(GPUMapMode.READ);
      const src = new Float32Array(out.getMappedRange());
      const res = new Float32Array(nx * ny * 4);
      for (let y = 0; y < ny; y++) res.set(src.subarray((y * bpr) / 4, (y * bpr) / 4 + nx * 4), y * nx * 4);
      out.unmap();
      return res;
    },
    destroy() { for (const t of tex) t.destroy(); device.destroy(); },
  };
}
