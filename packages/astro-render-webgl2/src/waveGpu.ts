// GPU material fields (§051–§056, v4.1 §04): named RGBA32F ping-pong fields stepped by
// shader-DSL kernels from @astro/pixels — the SAME declared programs the CPU evaluator and
// the WebGPU backend execute. Readback yields witnesses; nothing here touches world authority.
import { toGLSL, shaderDigest, type ShaderProgram, type PixelFieldWitness, type Epistemic } from '@astro/core';
import { WAVE_STEP, WAVE_IMPULSE } from '@astro/pixels';
import { FULLSCREEN_VS, withDefines } from './shaders';

export { WAVE_STEP, WAVE_IMPULSE };
type U = Record<string, number | number[]>;

export class GpuFieldSet {
  private fields = new Map<string, { tex: [WebGLTexture, WebGLTexture]; fbo: [WebGLFramebuffer, WebGLFramebuffer]; cur: number }>();
  private progs = new Map<string, { p: WebGLProgram; loc: Map<string, WebGLUniformLocation | null>; digest: string }>();
  private vao: WebGLVertexArrayObject;
  passes = 0; lastMs = 0;
  constructor(private gl: WebGL2RenderingContext, readonly nx: number, readonly ny: number, names: string[]) {
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('GPU fields require EXT_color_buffer_float (RGBA32F render targets)');
    for (const n of names) this.add(n);
    this.vao = gl.createVertexArray()!;
  }
  private add(name: string) {
    const gl = this.gl;
    const mk = () => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, this.nx, this.ny);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const f = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return [t, f] as const;
    };
    const a = mk(), b = mk();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fields.set(name, { tex: [a[0], b[0]], fbo: [a[1], b[1]], cur: 0 });
  }
  /** Initialise a field from CPU data (RGBA float, rows = y). */
  upload(name: string, data: Float32Array) {
    const f = this.fields.get(name)!, gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, f.tex[f.cur]!);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.nx, this.ny, gl.RGBA, gl.FLOAT, data);
  }
  texture(name: string): WebGLTexture { const f = this.fields.get(name)!; return f.tex[f.cur]!; }
  digest(p: ShaderProgram) { return this.prog(p).digest; }
  private prog(p: ShaderProgram) {
    let r = this.progs.get(p.name);
    if (!r) {
      const gl = this.gl, prog = gl.createProgram()!;
      const fs = toGLSL(p);
      for (const [type, src] of [[gl.VERTEX_SHADER, withDefines(FULLSCREEN_VS, [])], [gl.FRAGMENT_SHADER, fs]] as const) {
        const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`field kernel ${p.name}: ${gl.getShaderInfoLog(s)}\n${src}`);
        gl.attachShader(prog, s);
      }
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`field kernel ${p.name} link: ${gl.getProgramInfoLog(prog)}`);
      r = { p: prog, loc: new Map(), digest: shaderDigest(fs) };
      this.progs.set(p.name, r);
    }
    return r;
  }
  /** Run kernel `p` writing `target`; `inputs` maps DSL sampler names to fields (the target may be read). */
  run(p: ShaderProgram, target: string, uniforms: U, inputs: Record<string, string>) {
    const gl = this.gl, t0 = performance.now();
    const r = this.prog(p), tf = this.fields.get(target)!;
    gl.useProgram(r.p);
    const loc = (n: string) => { let l = r.loc.get(n); if (l === undefined) { l = gl.getUniformLocation(r.p, n); r.loc.set(n, l); } return l; };
    p.samplers.forEach((s, i) => {
      const src = this.fields.get(inputs[s] ?? s);
      if (!src) throw new Error(`kernel ${p.name}: no field bound to sampler ${s}`);
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, src.tex[src.cur]!);
      gl.uniform1i(loc(s), i);
    });
    const l0 = loc('uResolution'); if (l0) gl.uniform2f(l0, this.nx, this.ny);
    const lt = loc('texel'); if (lt) gl.uniform2f(lt, 1 / this.nx, 1 / this.ny);
    for (const u of p.uniforms) {
      const v = uniforms[u.name]; const l = loc(u.name);
      if (v === undefined || !l) continue;
      if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v.length === 2) gl.uniform2f(l, v[0]!, v[1]!); else if (v.length === 3) gl.uniform3f(l, v[0]!, v[1]!, v[2]!); else gl.uniform4f(l, v[0]!, v[1]!, v[2]!, v[3]!);
    }
    const dst = 1 - tf.cur;
    gl.bindFramebuffer(gl.FRAMEBUFFER, tf.fbo[dst]!);
    gl.viewport(0, 0, this.nx, this.ny);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
    tf.cur = dst;
    this.passes++; this.lastMs = performance.now() - t0;
  }
  read(name: string): Float32Array {
    const gl = this.gl, f = this.fields.get(name)!, px = new Float32Array(this.nx * this.ny * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo[f.cur]!);
    gl.readPixels(0, 0, this.nx, this.ny, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px;
  }
  dispose() {
    const gl = this.gl;
    for (const f of this.fields.values()) { for (const t of f.tex) gl.deleteTexture(t); for (const b of f.fbo) gl.deleteFramebuffer(b); }
    for (const r of this.progs.values()) gl.deleteProgram(r.p);
    gl.deleteVertexArray(this.vao);
  }
}

export const fieldDigest = (a: Float32Array) => { let d = 0x811c9dc5; const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < b.length; i += 7) d = Math.imul(d ^ b[i]!, 0x01000193) >>> 0; return d.toString(16).padStart(8, '0'); };

export interface WaveGpuParams { c: number; damping: number; dt: number; dx: number }

/** Damped-wave field (ripples) on the GPU — same kernels as the CPU WaveField reference. */
export class GpuWaveField {
  readonly set: GpuFieldSet;
  t = 0; steps = 0;
  readonly digests: { step: string; impulse: string };
  constructor(gl: WebGL2RenderingContext, readonly nx: number, readonly ny: number, readonly p: WaveGpuParams = { c: 1, damping: 0.05, dt: 0.02, dx: 0.05 }) {
    if ((p.c * p.dt * Math.SQRT2) / p.dx >= 1) throw new RangeError('CFL ≥ 1: unstable explicit scheme rejected');
    this.set = new GpuFieldSet(gl, nx, ny, ['state']);
    this.digests = { step: this.set.digest(WAVE_STEP), impulse: this.set.digest(WAVE_IMPULSE) };
  }
  get texture(): WebGLTexture { return this.set.texture('state'); }
  impulse(x: number, y: number, amp = 1, radius = 2) { this.set.run(WAVE_IMPULSE, 'state', { center: [x, y], amp, rad: radius, res: [this.nx, this.ny] }, {}); }
  step(n = 1) {
    const { c, damping, dt, dx } = this.p;
    for (let i = 0; i < n; i++) { this.set.run(WAVE_STEP, 'state', { k: (c * c) / (dx * dx), dt, damp: damping }, {}); this.t += dt; this.steps++; }
  }
  read(): { h: Float32Array; v: Float32Array } {
    const px = this.set.read('state'), h = new Float32Array(this.nx * this.ny), v = new Float32Array(this.nx * this.ny);
    for (let i = 0; i < h.length; i++) { h[i] = px[i * 4]!; v[i] = px[i * 4 + 1]!; }
    return { h, v };
  }
  witness(x: number, y: number, eventId: string | null, epistemic: Epistemic = 'simulation'): PixelFieldWitness & { h: number; v: number; backend: 'webgl2' } {
    const { h, v } = this.read(), k = y * this.nx + x;
    return { x, y, resolution: [this.nx, this.ny], t: this.t, model: 'damped-wave-2d/leapfrog', gridId: `wave:${this.nx}x${this.ny}`, fieldVersion: String(this.steps), inputEventId: eventId, stateDigest: fieldDigest(h), epistemic, h: h[k]!, v: v[k]!, backend: 'webgl2' };
  }
  dispose() { this.set.dispose(); }
}
