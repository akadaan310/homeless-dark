// GPU pixel-field solver (§051–§056): the damped wave of @astro/pixels stepped on the GPU
// with RGBA32F ping-pong targets. Both passes are written in the bounded shader DSL and
// compiled to GLSL here (and to WGSL by the WebGPU backend), so CPU, WebGL2 and WebGPU
// execute the same declared program. Readback produces PixelFieldWitness records.
import { toGLSL, num, ref, bin, call, sample, swz, ctor, shaderDigest, type ShaderProgram, type PixelFieldWitness, type Epistemic } from '@astro/core';
import { FULLSCREEN_VS, withDefines } from './shaders';

const tx = swz(ref('texel'), 'x'), ty = swz(ref('texel'), 'y');
const at = (dx: number, dy: number) => swz(sample('state', bin('+', ref('uv'), ctor('vec2', bin('*', tx, num(dx)), bin('*', ty, num(dy))))), 'x');
const interior = bin('*', bin('*', call('step', tx, swz(ref('uv'), 'x')), call('step', swz(ref('uv'), 'x'), bin('-', num(1), tx))), bin('*', call('step', ty, swz(ref('uv'), 'y')), call('step', swz(ref('uv'), 'y'), bin('-', num(1), ty))));

export const WAVE_STEP: ShaderProgram = {
  name: 'wave_step',
  uniforms: [{ name: 'texel', t: 'vec2' }, { name: 'k', t: 'f32' }, { name: 'dt', t: 'f32' }, { name: 'damp', t: 'f32' }],
  samplers: ['state'],
  body: [
    { k: 'let', name: 's', t: 'vec4', e: sample('state', ref('uv')) },
    { k: 'let', name: 'lap', t: 'f32', e: bin('-', bin('+', bin('+', at(-1, 0), at(1, 0)), bin('+', at(0, -1), at(0, 1))), bin('*', num(4), swz(ref('s'), 'x'))) },
    { k: 'let', name: 'mask', t: 'f32', e: interior },
    { k: 'let', name: 'v', t: 'f32', e: bin('*', bin('/', bin('+', swz(ref('s'), 'y'), bin('*', bin('*', ref('dt'), ref('k')), ref('lap'))), bin('+', num(1), bin('*', ref('damp'), ref('dt')))), ref('mask')) },
    { k: 'let', name: 'h', t: 'f32', e: bin('*', bin('+', swz(ref('s'), 'x'), bin('*', ref('dt'), ref('v'))), ref('mask')) },
    { k: 'out', e: ctor('vec4', ref('h'), ref('v'), num(0), num(1)) },
  ],
};

export const WAVE_IMPULSE: ShaderProgram = {
  name: 'wave_impulse',
  uniforms: [{ name: 'texel', t: 'vec2' }, { name: 'center', t: 'vec2' }, { name: 'amp', t: 'f32' }, { name: 'rad', t: 'f32' }, { name: 'res', t: 'vec2' }],
  samplers: ['state'],
  body: [
    { k: 'let', name: 's', t: 'vec4', e: sample('state', ref('uv')) },
    { k: 'let', name: 'd', t: 'vec2', e: bin('-', bin('-', bin('*', ref('uv'), ref('res')), ctor('vec2', num(0.5), num(0.5))), ref('center')) },
    { k: 'let', name: 'inside', t: 'f32', e: bin('*', bin('*', call('step', call('abs', swz(ref('d'), 'x')), bin('+', ref('rad'), num(0.001))), call('step', call('abs', swz(ref('d'), 'y')), bin('+', ref('rad'), num(0.001)))), interior) },
    { k: 'let', name: 'add', t: 'f32', e: bin('*', bin('*', ref('amp'), call('exp', bin('/', bin('*', num(-1), call('dot', ref('d'), ref('d'))), bin('+', bin('*', bin('*', ref('rad'), ref('rad')), num(0.5)), num(1e-6))))), ref('inside')) },
    { k: 'out', e: ctor('vec4', bin('+', swz(ref('s'), 'x'), ref('add')), swz(ref('s'), 'y'), num(0), num(1)) },
  ],
};

export interface WaveGpuParams { c: number; damping: number; dt: number; dx: number }

export class GpuWaveField {
  readonly tex: [WebGLTexture, WebGLTexture];
  private fbo: [WebGLFramebuffer, WebGLFramebuffer];
  private cur = 0;
  private stepP: WebGLProgram; private impP: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  t = 0; steps = 0;
  readonly digests: { step: string; impulse: string };
  constructor(private gl: WebGL2RenderingContext, readonly nx: number, readonly ny: number, readonly p: WaveGpuParams = { c: 1, damping: 0.05, dt: 0.02, dx: 0.05 }) {
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('GPU pixel field requires EXT_color_buffer_float (RGBA32F render targets)');
    if ((p.c * p.dt * Math.SQRT2) / p.dx >= 1) throw new RangeError('CFL ≥ 1: unstable explicit scheme rejected');
    const mk = () => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, nx, ny);
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
    this.tex = [a[0], b[0]]; this.fbo = [a[1], b[1]];
    const vs = withDefines(FULLSCREEN_VS, []);
    const stepFs = toGLSL(WAVE_STEP), impFs = toGLSL(WAVE_IMPULSE);
    this.digests = { step: shaderDigest(stepFs), impulse: shaderDigest(impFs) };
    this.stepP = this.link(vs, stepFs); this.impP = this.link(vs, impFs);
    this.vao = gl.createVertexArray()!;
  }
  private link(vs: string, fs: string) {
    const gl = this.gl, p = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`wave shader: ${gl.getShaderInfoLog(s)}\n${src}`);
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`wave link: ${gl.getProgramInfoLog(p)}`);
    return p;
  }
  get texture(): WebGLTexture { return this.tex[this.cur]!; }
  private run(prog: WebGLProgram, set: (l: (n: string) => WebGLUniformLocation | null) => void) {
    const gl = this.gl;
    const src = this.cur, dst = 1 - this.cur;
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[dst]!);
    gl.viewport(0, 0, this.nx, this.ny);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex[src]!);
    const l = (n: string) => gl.getUniformLocation(prog, n);
    gl.uniform1i(l('state'), 0);
    gl.uniform2f(l('texel'), 1 / this.nx, 1 / this.ny);
    gl.uniform2f(l('uResolution'), this.nx, this.ny);
    set(l);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
    this.cur = dst;
  }
  impulse(x: number, y: number, amp = 1, radius = 2) {
    this.run(this.impP, (l) => { const g = this.gl; g.uniform2f(l('center'), x, y); g.uniform1f(l('amp'), amp); g.uniform1f(l('rad'), radius); g.uniform2f(l('res'), this.nx, this.ny); });
  }
  step(n = 1) {
    const { c, damping, dt, dx } = this.p;
    for (let i = 0; i < n; i++) {
      this.run(this.stepP, (l) => { const g = this.gl; g.uniform1f(l('k'), (c * c) / (dx * dx)); g.uniform1f(l('dt'), dt); g.uniform1f(l('damp'), damping); });
      this.t += dt; this.steps++;
    }
  }
  /** Read the (h, v) state into typed arrays (rows bottom-up = CPU row order). */
  read(): { h: Float32Array; v: Float32Array } {
    const gl = this.gl, px = new Float32Array(this.nx * this.ny * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[this.cur]!);
    gl.readPixels(0, 0, this.nx, this.ny, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const h = new Float32Array(this.nx * this.ny), v = new Float32Array(this.nx * this.ny);
    for (let i = 0; i < h.length; i++) { h[i] = px[i * 4]!; v[i] = px[i * 4 + 1]!; }
    return { h, v };
  }
  witness(x: number, y: number, eventId: string | null, epistemic: Epistemic = 'simulation'): PixelFieldWitness & { h: number; v: number; backend: 'webgl2' } {
    const { h, v } = this.read();
    let d = 0x811c9dc5; const b = new Uint8Array(h.buffer); for (let i = 0; i < b.length; i += 7) d = Math.imul(d ^ b[i]!, 0x01000193) >>> 0;
    const k = y * this.nx + x;
    return { x, y, resolution: [this.nx, this.ny], t: this.t, model: 'damped-wave-2d/leapfrog', gridId: `wave:${this.nx}x${this.ny}`, fieldVersion: String(this.steps), inputEventId: eventId, stateDigest: d.toString(16).padStart(8, '0'), epistemic, h: h[k]!, v: v[k]!, backend: 'webgl2' };
  }
  dispose() { const gl = this.gl; for (const t of this.tex) gl.deleteTexture(t); for (const f of this.fbo) gl.deleteFramebuffer(f); gl.deleteProgram(this.stepP); gl.deleteProgram(this.impP); }
}
