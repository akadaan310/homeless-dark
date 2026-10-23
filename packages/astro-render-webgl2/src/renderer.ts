// ASTRO native WebGL2 renderer (§041–§050, §057–§060, §064–§069, §104–§109).
// Forward PBR on a typed scene graph: sun shadow map (hardware PCF), pooled point/spot
// lights, analytic sky with SH diffuse + prefiltered equirect specular IBL, GPU skinning
// from a bone texture, instancing, SDF text, HDR target with MSAA, bloom, and one declared
// output transform (Khronos PBR Neutral → sRGB). Rendering is a projection only: it
// reads committed state and never writes world authority (CommandList enforces it).
import { Mat4, Vec3, Node, Mesh, InstancedMesh, Camera, Scene, Material, Texture, Geometry, Light, DirectionalLight, PointLight, SpotLight, HemisphereLight, FrameGraph, CommandList, CompileCache, shaderDigest, type Attribute } from '@astro/core';
import { frustumPlanes, sphereInFrustum, type Plane } from '@astro/geometry';
import { FORWARD_VS, FORWARD_FS, DEPTH_VS, DEPTH_FS, FULLSCREEN_VS, SKY_FS, ENV_FS, BLOOM_PREFILTER_FS, BLOOM_DOWN_FS, BLOOM_UP_FS, OUTPUT_FS, BLIT_FS, ATTR, UNIT, MAX_POINT, MAX_SPOT, withDefines } from './shaders';
import { SUN_DISPLAY_CLAMP } from '@astro/optics';
import { projectSH, type SkyParams } from './skyModel';

export interface RendererOptions { antialias?: boolean; pixelRatio?: number; preserveDrawingBuffer?: boolean; powerPreference?: WebGLPowerPreference; forceLDR?: boolean }
export type ToneOp = 'neutral' | 'aces' | 'clip';
export type LensMode = 'normal' | 'anaglyph' | 'sideBySide';

export interface Caps { floatRT: boolean; maxSamples: number; anisotropy: number; timer: boolean; maxTexture: number; renderer: string; vendor: string; floatLinear: boolean }
export interface RenderInfo {
  frame: number; calls: number; triangles: number; points: number; shadowCalls: number; culled: number; instances: number;
  programs: number; textures: number; geometries: number; gpuMs: number | null; cpuMs: number; hdr: boolean; msaa: number;
  passes: string[]; programCacheHits: number; programCacheMisses: number; commands: number;
}

interface Prog { p: WebGLProgram; loc: Map<string, WebGLUniformLocation | null>; frame: number; view: number; key: string; digest: string }
interface GeoRes { vao: WebGLVertexArrayObject; buffers: WebGLBuffer[]; versions: number[]; attrs: Attribute[]; index: WebGLBuffer | null; indexType: number; count: number; lastUsed: number; instVersion: number; inst: WebGLBuffer | null }
interface TexRes { t: WebGLTexture; version: number; lastUsed: number }
interface Target { fbo: WebGLFramebuffer; tex: WebGLTexture | null; depth: WebGLRenderbuffer | null; w: number; h: number; msaaFbo?: WebGLFramebuffer; msaaColor?: WebGLRenderbuffer; msaaDepth?: WebGLRenderbuffer }
interface DrawItem { mesh: Mesh; mat: Material; depth: number; key: string }

const FEATURE_DEFINE: Record<string, string | null> = { grass: 'FEATURE_GRASS', standard: null, wet: 'FEATURE_WET', facade: 'FEATURE_FACADE', water: 'FEATURE_WATER', terrain: 'FEATURE_TERRAIN', unlit: 'FEATURE_UNLIT', rain: 'FEATURE_UNLIT', stars: 'FEATURE_UNLIT', skyDome: 'FEATURE_UNLIT', text: 'FEATURE_TEXT', windows: 'FEATURE_WINDOWS' };

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly caps: Caps;
  readonly canvas: HTMLCanvasElement;
  pixelRatio = 1;
  width = 1; height = 1; // CSS px
  exposure = 1;
  toneOp: ToneOp = 'neutral';
  bloomStrength = 0.045;
  bloomThreshold = 1.0;
  lensMode: LensMode = 'normal';
  field: { texture: WebGLTexture; gain: number } | null = null;
  /** Simulation fields sampled by material features (blade state, puddle ripples). */
  readonly fieldTextures: { grassState: WebGLTexture | null; ripple: WebGLTexture | null } = { grassState: null, ripple: null };
  shadowsEnabled = true;
  /** Feature uniforms shared by all programs (wetness field, night factor, time). */
  readonly globals: Record<string, number> = { uWetness: 0, uPuddle: 0, uNight: 0, uTime: 0 };
  sky: SkyParams | null = null;
  readonly info: RenderInfo;
  readonly hdr: boolean;
  readonly msaa: number;
  contextLost = false;
  onContextRestored: (() => void) | null = null;
  readonly programs = new CompileCache<Prog>();
  /** Last frame's graph (§045) and command list (§044) — inspectable evidence. */
  lastGraph: ReturnType<FrameGraph['compile']> | null = null;
  lastCommands: CommandList | null = null;

  private geos = new Map<string, GeoRes>();
  private texs = new Map<number, TexRes>();
  private bones = new Map<number, { t: WebGLTexture; n: number; version: number }>();
  private fallback!: { white: WebGLTexture; normal: WebGLTexture; black: WebGLTexture; env: WebGLTexture; depth: WebGLTexture };
  private emptyVao!: WebGLVertexArrayObject;
  private targets: { hdr: Target | null; bloom: Target[]; shadow: Target | null; shadowSize: number; env: Target | null } = { hdr: null, bloom: [], shadow: null, shadowSize: 0, env: null };
  private post = new Map<string, Prog>();
  private envSH: Float32Array = new Float32Array(27);
  private envKey = '';
  private envEncode = 1;
  private frameNo = 0;
  private timerExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private queries: WebGLQuery[] = [];
  private anisoExt: { TEXTURE_MAX_ANISOTROPY_EXT: number } | null = null;
  private state = { program: null as WebGLProgram | null, cull: -1, depthMask: true, blend: -1, offset: 0 };
  private readonly opts: Required<Pick<RendererOptions, 'antialias' | 'preserveDrawingBuffer'>> & RendererOptions;

  constructor(canvas: HTMLCanvasElement, opts: RendererOptions = {}) {
    this.canvas = canvas;
    this.opts = { antialias: false, preserveDrawingBuffer: false, ...opts };
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: opts.powerPreference ?? 'high-performance', preserveDrawingBuffer: this.opts.preserveDrawingBuffer, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 unavailable: ASTRO requires a WebGL2 context (no fallback renderer is shipped)');
    this.gl = gl;
    const floatRT = !opts.forceLDR && !!gl.getExtension('EXT_color_buffer_float');
    const floatLinear = !!gl.getExtension('OES_texture_float_linear');
    this.anisoExt = gl.getExtension('EXT_texture_filter_anisotropic') as { TEXTURE_MAX_ANISOTROPY_EXT: number } | null;
    this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.caps = {
      floatRT, floatLinear, maxSamples: gl.getParameter(gl.MAX_SAMPLES) as number, anisotropy: this.anisoExt ? Number(gl.getParameter((this.anisoExt as unknown as { MAX_TEXTURE_MAX_ANISOTROPY_EXT: number }).MAX_TEXTURE_MAX_ANISOTROPY_EXT)) || 1 : 1,
      timer: !!this.timerExt, maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      renderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)), vendor: dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : String(gl.getParameter(gl.VENDOR)),
    };
    this.hdr = floatRT;
    this.msaa = this.hdr && this.opts.antialias ? Math.min(4, this.caps.maxSamples) : 0;
    this.info = { frame: 0, calls: 0, triangles: 0, points: 0, shadowCalls: 0, culled: 0, instances: 0, programs: 0, textures: 0, geometries: 0, gpuMs: null, cpuMs: 0, hdr: this.hdr, msaa: this.msaa, passes: [], programCacheHits: 0, programCacheMisses: 0, commands: 0 };
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; this.reset(); this.onContextRestored?.(); });
    this.initState();
  }

  get backend() { return 'webgl2' as const; }

  /** Drop every GPU object (after context restore) and recreate defaults lazily. */
  private reset() {
    this.geos.clear(); this.texs.clear(); this.bones.clear(); this.post.clear();
    (this.programs as unknown as { map: Map<string, Prog> }).map.clear();
    this.targets = { hdr: null, bloom: [], shadow: null, shadowSize: 0, env: null };
    this.envKey = ''; this.queries = [];
    this.state = { program: null, cull: -1, depthMask: true, blend: -1, offset: 0 };
    this.initState();
  }

  private initState() {
    const gl = this.gl;
    const px = (rgba: number[]) => { const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba)); return t; };
    // a sampler2DShadow must always see a depth texture with compare mode, even with shadows off
    const depth = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, depth);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, 1, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.fallback = { white: px([255, 255, 255, 255]), normal: px([128, 128, 255, 255]), black: px([0, 0, 0, 255]), env: px([0, 0, 0, 255]), depth };
    this.emptyVao = gl.createVertexArray()!;
    // constant attribute defaults for meshes lacking an attribute (context state, set once)
    gl.vertexAttrib4f(ATTR.normal, 0, 1, 0, 0);
    gl.vertexAttrib4f(ATTR.uv, 0, 0, 0, 0);
    gl.vertexAttrib4f(ATTR.color, 1, 1, 1, 1);
    gl.vertexAttrib4f(ATTR.custom, 0, 0, 0, 0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  setPixelRatio(r: number) { this.pixelRatio = r; this.setSize(this.width, this.height); }
  setSize(w: number, h: number) {
    this.width = Math.max(1, w); this.height = Math.max(1, h);
    const dw = Math.max(1, Math.floor(this.width * this.pixelRatio)), dh = Math.max(1, Math.floor(this.height * this.pixelRatio));
    if (this.canvas.width !== dw || this.canvas.height !== dh) { this.canvas.width = dw; this.canvas.height = dh; }
  }
  get drawingBufferWidth() { return this.canvas.width; }
  get drawingBufferHeight() { return this.canvas.height; }

  // ------------------------------------------------------------------ programs
  private compile(vs: string, fs: string, label: string): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(s) ?? '';
        const line = Number(/ERROR: \d+:(\d+)/.exec(log)?.[1] ?? 0);
        const excerpt = src.split('\n').slice(Math.max(0, line - 3), line + 2).map((l, i) => `${Math.max(1, line - 2) + i}: ${l}`).join('\n');
        throw new Error(`ASTRO shader ${label} (${type === gl.VERTEX_SHADER ? 'vs' : 'fs'}) failed: ${log}\n${excerpt}`);
      }
      return s;
    };
    const p = gl.createProgram()!;
    const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, v); gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`ASTRO program ${label} link failed: ${gl.getProgramInfoLog(p)}`);
    gl.deleteShader(v); gl.deleteShader(f);
    return p;
  }
  private makeProg(vs: string, fs: string, key: string): Prog {
    return this.programs.get(key, () => ({ p: this.compile(vs, fs, key), loc: new Map(), frame: -1, view: -1, key, digest: shaderDigest(vs + fs) }));
  }
  private postProg(name: string, fs: string, defines: string[] = []): Prog {
    const key = `post:${name}:${defines.join(',')}`;
    let p = this.post.get(key);
    if (!p) { p = this.makeProg(withDefines(FULLSCREEN_VS, defines), withDefines(fs, defines), key); this.post.set(key, p); }
    return p;
  }
  /** Shader digest set for the evidence manifest (§104). */
  shaderDigests(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of (this.programs as unknown as { map: Map<string, Prog> }).map) out[k] = v.digest;
    return out;
  }

  private defines(mesh: Mesh, mat: Material, depthOnly: boolean): string[] {
    const d: string[] = [];
    const g = mesh.geometry;
    if (mesh.skin && g.hasAttribute('skinIndex') && g.hasAttribute('skinWeight')) d.push('SKIN');
    if (mesh instanceof InstancedMesh) d.push('INSTANCED');
    if (mat.alphaTest > 0) d.push('ALPHATEST');
    if (depthOnly) return d;
    const f = FEATURE_DEFINE[mat.feature];
    if (f) d.push(f);
    if (mat.map && mat.feature !== 'text') d.push('MAP');
    if (mat.normalMap) d.push('NORMALMAP');
    if (mat.roughnessMap) d.push('ROUGHMAP');
    if (mat.emissiveMap) d.push('EMISSIVEMAP');
    if (mat.vertexColors && g.hasAttribute('color')) d.push('VCOLOR');
    if (mesh.mode === 'points') d.push('POINTS');
    if (!this.hdr) d.push('INLINE_TONEMAP');
    return d;
  }
  private forwardProg(mesh: Mesh, mat: Material): Prog {
    const d = this.defines(mesh, mat, false);
    const key = `fwd:${d.join(',')}`;
    return this.makeProg(withDefines(FORWARD_VS, d), withDefines(FORWARD_FS, d), key);
  }
  private depthProg(mesh: Mesh, mat: Material): Prog {
    const d = this.defines(mesh, mat, true);
    const key = `depth:${d.join(',')}`;
    return this.makeProg(withDefines(DEPTH_VS, d), withDefines(DEPTH_FS, d), key);
  }
  private loc(p: Prog, name: string) {
    let l = p.loc.get(name);
    if (l === undefined) { l = this.gl.getUniformLocation(p.p, name); p.loc.set(name, l); }
    return l;
  }
  private use(p: Prog) { if (this.state.program !== p.p) { this.gl.useProgram(p.p); this.state.program = p.p; } }
  private u1f(p: Prog, n: string, v: number) { const l = this.loc(p, n); if (l) this.gl.uniform1f(l, v); }
  private u1i(p: Prog, n: string, v: number) { const l = this.loc(p, n); if (l) this.gl.uniform1i(l, v); }
  private u2f(p: Prog, n: string, a: number, b: number) { const l = this.loc(p, n); if (l) this.gl.uniform2f(l, a, b); }
  private u3f(p: Prog, n: string, a: number, b: number, c: number) { const l = this.loc(p, n); if (l) this.gl.uniform3f(l, a, b, c); }
  private u3fv(p: Prog, n: string, v: Float32Array) { const l = this.loc(p, n); if (l) this.gl.uniform3fv(l, v); }
  private u4fv(p: Prog, n: string, v: Float32Array) { const l = this.loc(p, n); if (l) this.gl.uniform4fv(l, v); }
  private uMat4(p: Prog, n: string, m: Float32Array) { const l = this.loc(p, n); if (l) this.gl.uniformMatrix4fv(l, false, m); }
  private uMat3(p: Prog, n: string, m: Float32Array) { const l = this.loc(p, n); if (l) this.gl.uniformMatrix3fv(l, false, m); }

  // ------------------------------------------------------------------ resources
  private geo(mesh: Mesh): GeoRes {
    const gl = this.gl, g = mesh.geometry;
    const inst = mesh instanceof InstancedMesh;
    const key = inst ? `${g.id}:${mesh.id}` : String(g.id);
    let r = this.geos.get(key);
    const names = ['position', 'normal', 'uv', 'color', g.hasAttribute('aFacade') ? 'aFacade' : 'aSplat', 'skinIndex', 'skinWeight'];
    const slots = [ATTR.position, ATTR.normal, ATTR.uv, ATTR.color, ATTR.custom, ATTR.skinIndex, ATTR.skinWeight];
    const attrs = names.map((n) => g.attributes[n]);
    const stale = r && (attrs.some((a, i) => a !== r!.attrs[i] || (a && a.version !== r!.versions[i])) || (g.index && g.index.version !== r.versions[7]));
    if (r && stale) { this.freeGeo(key); r = undefined; }
    if (!r) {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const buffers: WebGLBuffer[] = [], versions: number[] = [];
      attrs.forEach((a, i) => {
        versions.push(a?.version ?? -1);
        if (!a) return;
        const b = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, a.array, gl.STATIC_DRAW);
        const type = a.array instanceof Float32Array ? gl.FLOAT : a.array instanceof Uint8Array ? gl.UNSIGNED_BYTE : a.array instanceof Int8Array ? gl.BYTE : a.array instanceof Uint16Array ? gl.UNSIGNED_SHORT : a.array instanceof Int16Array ? gl.SHORT : gl.UNSIGNED_INT;
        gl.enableVertexAttribArray(slots[i]!);
        gl.vertexAttribPointer(slots[i]!, a.itemSize, type, a.normalized, 0, 0);
        buffers.push(b);
      });
      let index: WebGLBuffer | null = null, indexType = 0;
      if (g.index) {
        index = gl.createBuffer()!;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.index.array, gl.STATIC_DRAW);
        indexType = g.index.array instanceof Uint32Array ? gl.UNSIGNED_INT : g.index.array instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;
      }
      versions[7] = g.index?.version ?? -1;
      let instBuf: WebGLBuffer | null = null;
      if (inst) {
        instBuf = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
        gl.bufferData(gl.ARRAY_BUFFER, (mesh as InstancedMesh).instanceMatrices, gl.DYNAMIC_DRAW);
        for (let c = 0; c < 4; c++) { gl.enableVertexAttribArray(ATTR.instance + c); gl.vertexAttribPointer(ATTR.instance + c, 4, gl.FLOAT, false, 64, c * 16); gl.vertexAttribDivisor(ATTR.instance + c, 1); }
      }
      gl.bindVertexArray(null);
      r = { vao, buffers, versions, attrs: attrs as Attribute[], index, indexType, count: g.index ? g.index.count : g.vertexCount, lastUsed: this.frameNo, instVersion: inst ? (mesh as InstancedMesh).instanceVersion : 0, inst: instBuf };
      this.geos.set(key, r);
    }
    if (inst && r.inst && r.instVersion !== (mesh as InstancedMesh).instanceVersion) {
      gl.bindBuffer(gl.ARRAY_BUFFER, r.inst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, (mesh as InstancedMesh).instanceMatrices);
      r.instVersion = (mesh as InstancedMesh).instanceVersion;
    }
    r.lastUsed = this.frameNo;
    return r;
  }
  private freeGeo(key: string) {
    const r = this.geos.get(key); if (!r) return;
    const gl = this.gl;
    gl.deleteVertexArray(r.vao); for (const b of r.buffers) gl.deleteBuffer(b); if (r.index) gl.deleteBuffer(r.index); if (r.inst) gl.deleteBuffer(r.inst);
    this.geos.delete(key);
  }

  private texture(t: Texture | null, fb: WebGLTexture): WebGLTexture {
    if (!t || !t.source) return fb;
    const gl = this.gl;
    let r = this.texs.get(t.id);
    if (r && r.version === t.version) { r.lastUsed = this.frameNo; return r.t; }
    const tex = r?.t ?? gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const s = t.source;
    const single = s.kind === 'data' && s.channels === 1;
    const srgb = t.colorSpace === 'srgb' && !single;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, t.flipY);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, single ? 1 : 4);
    if (s.kind === 'data' && s.data) {
      if (single) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, s.width, s.height, 0, gl.RED, gl.UNSIGNED_BYTE, s.data as Uint8Array);
      else if (s.data instanceof Float32Array) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, s.width, s.height, 0, gl.RGBA, gl.FLOAT, s.data);
      else gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, s.width, s.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, s.data);
    } else if (s.image) gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, s.image);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    const wrap = t.wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    const mip = t.mipmaps && !(s.data instanceof Float32Array);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, t.filter === 'nearest' ? gl.NEAREST : mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, t.filter === 'nearest' ? gl.NEAREST : gl.LINEAR);
    if (this.anisoExt && mip && this.caps.anisotropy > 1) gl.texParameterf(gl.TEXTURE_2D, this.anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.max(1, Math.min(this.caps.anisotropy, t.anisotropy)));
    this.texs.set(t.id, { t: tex, version: t.version, lastUsed: this.frameNo });
    return tex;
  }
  private bind(unit: number, t: WebGLTexture) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); }

  private boneTexture(mesh: Mesh): WebGLTexture {
    const gl = this.gl, sk = mesh.skin!;
    let r = this.bones.get(mesh.id);
    const n = sk.bones.length;
    if (!r || r.n !== n) {
      const t = r?.t ?? gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n * 4, 1, 0, gl.RGBA, gl.FLOAT, sk.boneMatrices);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      r = { t, n, version: sk.version };
      this.bones.set(mesh.id, r);
    } else if (r.version !== sk.version) {
      gl.bindTexture(gl.TEXTURE_2D, r.t);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n * 4, 1, gl.RGBA, gl.FLOAT, sk.boneMatrices);
      r.version = sk.version;
    }
    return r.t;
  }

  private colorTarget(w: number, h: number, depth: boolean, msaa: number, prev: Target | null, format: 'hdr' | 'rgba8' = 'hdr', mips = false): Target {
    const gl = this.gl;
    if (prev && prev.w === w && prev.h === h) return prev;
    if (prev) this.freeTarget(prev);
    const internal = format === 'hdr' && this.hdr ? gl.RGBA16F : gl.RGBA8;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1, internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mips ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let dep: WebGLRenderbuffer | null = null;
    const t: Target = { fbo, tex, depth: null, w, h };
    if (depth && !msaa) {
      dep = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, dep);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, dep);
      t.depth = dep;
    }
    if (msaa) {
      t.msaaFbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.msaaFbo);
      t.msaaColor = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.msaaColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, msaa, internal, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, t.msaaColor);
      t.msaaDepth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.msaaDepth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, msaa, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.msaaDepth);
    }
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`ASTRO framebuffer incomplete (0x${st.toString(16)}) ${w}x${h}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return t;
  }
  private freeTarget(t: Target) {
    const gl = this.gl;
    gl.deleteFramebuffer(t.fbo); if (t.tex) gl.deleteTexture(t.tex); if (t.depth) gl.deleteRenderbuffer(t.depth);
    if (t.msaaFbo) gl.deleteFramebuffer(t.msaaFbo); if (t.msaaColor) gl.deleteRenderbuffer(t.msaaColor); if (t.msaaDepth) gl.deleteRenderbuffer(t.msaaDepth);
  }
  private shadowTarget(size: number): Target {
    const gl = this.gl;
    if (this.targets.shadow && this.targets.shadowSize === size) return this.targets.shadow;
    if (this.targets.shadow) this.freeTarget(this.targets.shadow);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.targets.shadow = { fbo, tex, depth: null, w: size, h: size };
    this.targets.shadowSize = size;
    return this.targets.shadow;
  }

  // ------------------------------------------------------------------ environment (§068)
  /** Re-bake sky IBL when the sky key changes: equirect specular on the GPU, SH diffuse on the CPU. */
  updateEnvironment(sky: SkyParams, key: string) {
    if (key === this.envKey && this.targets.env) return;
    this.envKey = key;
    const gl = this.gl;
    this.envSH = projectSH(sky, 16, 32);
    this.envEncode = this.hdr ? 1 : 1 / 8;
    const t = this.colorTarget(256, 128, false, 0, this.targets.env, 'hdr', true);
    this.targets.env = t;
    const p = this.postProg('env', ENV_FS);
    this.use(p);
    this.skyUniforms(p, sky);
    this.u1f(p, 'envEncode', this.envEncode);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); this.state.blend = 0;
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.enable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  get environmentSH() { return this.envSH; }
  private skyUniforms(p: Prog, s: SkyParams) {
    this.u3f(p, 'skySunDir', s.sunDir[0], s.sunDir[1], s.sunDir[2]);
    this.u1f(p, 'skySunE', s.sunE); this.u1f(p, 'skyRayleigh', s.rayleigh); this.u1f(p, 'skyTurbidity', s.turbidity); this.u1f(p, 'skyG', s.mieG);
    this.u1f(p, 'skyCloud', s.cloud); this.u3f(p, 'skyCloudColor', s.cloudColor[0], s.cloudColor[1], s.cloudColor[2]); this.u1f(p, 'skyNight', s.night);
    this.u1f(p, 'skySunClamp', SUN_DISPLAY_CLAMP); // §116: rendered solar disc radiance is bounded
  }

  // ------------------------------------------------------------------ frame
  private frameData = {
    view: new Float32Array(16), proj: new Float32Array(16), cam: new Vec3(), shadowM: new Float32Array(16), shadowOn: 0, shadowTexel: 0, shadowBias: 0, shadowNormalBias: 0,
    sunDir: new Vec3(0, 1, 0), sunRad: new Vec3(), moonDir: new Vec3(0, 1, 0), moonRad: new Vec3(), hemiSky: new Vec3(), hemiGround: new Vec3(),
    numPoint: 0, pointPos: new Float32Array(MAX_POINT * 4), pointColor: new Float32Array(MAX_POINT * 4),
    numSpot: 0, spotPos: new Float32Array(MAX_SPOT * 4), spotDir: new Float32Array(MAX_SPOT * 4), spotColor: new Float32Array(MAX_SPOT * 4), spotParams: new Float32Array(MAX_SPOT * 4),
    fogColor: new Vec3(), fogDensity: 0, envIntensity: 1, viewIndex: 0,
  };
  private tmpM = new Mat4();
  private m32 = new Float32Array(16);
  private n9 = new Float32Array(9);

  /**
   * Render a scene. `views` renders several cameras into horizontal slices of one target
   * (stereo left|right); the output transform then composites per lensMode.
   */
  render(scene: Scene, camera: Camera, views?: Camera[]): void {
    if (this.contextLost || this.gl.isContextLost()) return;
    const t0 = performance.now();
    const gl = this.gl;
    this.frameNo++;
    const info = this.info;
    Object.assign(info, { frame: this.frameNo, calls: 0, triangles: 0, points: 0, shadowCalls: 0, culled: 0, instances: 0 });
    this.pollTimers();
    let query: WebGLQuery | null = null;
    if (this.timerExt && this.queries.length < 3) { query = gl.createQuery(); if (query) gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, query); }

    scene.updateMatrixWorld(true);
    const cams = views && views.length ? views : [camera];
    // collect
    const meshes: Mesh[] = [], lights: Light[] = [];
    scene.traverseVisible((n: Node) => { if (n instanceof Mesh) meshes.push(n); else if (n instanceof Light) lights.push(n); });
    for (const m of meshes) if (m.skin) m.skin.update(m.matrixWorld);
    const W = this.canvas.width, H = this.canvas.height;

    // framegraph declaration (§045): culled/ordered passes are evidence and drive execution order
    const fg = new FrameGraph()
      .attachment({ name: 'shadow', format: 'depth24', scale: 1, persistent: true })
      .attachment({ name: 'env', format: 'rgba16f', scale: 1, persistent: true })
      .attachment({ name: 'hdr', format: 'rgba16f', scale: 1 })
      .attachment({ name: 'bloom', format: 'rgba16f', scale: 0.5 });
    const sun = lights.find((l): l is DirectionalLight => l instanceof DirectionalLight && l.castShadow) ?? null;
    const doShadow = this.shadowsEnabled && !!sun && sun.intensity > 0;
    if (doShadow) fg.pass({ name: 'shadow', reads: [], writes: ['shadow'] });
    fg.pass({ name: 'forward', reads: doShadow ? ['shadow', 'env'] : ['env'], writes: this.hdr ? ['hdr'] : ['backbuffer'] });
    if (this.hdr) {
      if (this.bloomStrength > 0) { fg.pass({ name: 'bloom', reads: ['hdr'], writes: ['bloom'] }); fg.pass({ name: 'output', reads: ['hdr', 'bloom'], writes: ['backbuffer'] }); }
      else fg.pass({ name: 'output', reads: ['hdr'], writes: ['backbuffer'] });
    }
    const graph = fg.compile();
    this.lastGraph = graph;
    info.passes = graph.order;
    const commands = new CommandList();

    this.frameData.shadowOn = 0;
    this.setupLights(lights, cams[0]!, scene);
    if (this.sky && !this.targets.env) this.updateEnvironment(this.sky, 'init');

    for (const pass of graph.order) {
      if (pass === 'shadow') this.shadowPass(sun!, meshes, commands);
      else if (pass === 'forward') this.forwardPass(scene, cams, meshes, W, H, commands);
      else if (pass === 'bloom') this.bloomPass(W, H, commands);
      else if (pass === 'output') this.outputPass(W, H, commands);
    }
    this.lastCommands = commands;
    info.commands = commands.commands.length;
    if (query && this.timerExt) { gl.endQuery(this.timerExt.TIME_ELAPSED_EXT); this.queries.push(query); }
    info.programs = this.programs.size; info.textures = this.texs.size; info.geometries = this.geos.size;
    info.programCacheHits = this.programs.hits; info.programCacheMisses = this.programs.misses;
    info.cpuMs = performance.now() - t0;
    if (this.frameNo % 600 === 0) this.collectGarbage(600);
  }

  private pollTimers() {
    if (!this.timerExt || !this.queries.length) return;
    const gl = this.gl;
    const q = this.queries[0]!;
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return;
    const disjoint = gl.getParameter(this.timerExt.GPU_DISJOINT_EXT) as boolean;
    if (!disjoint) this.info.gpuMs = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
    gl.deleteQuery(q);
    this.queries.shift();
  }

  /** Release GPU resources unused for `frames` frames (region changes, LOD swaps). */
  collectGarbage(frames: number) {
    const gl = this.gl;
    for (const [k, r] of this.geos) if (this.frameNo - r.lastUsed > frames) this.freeGeo(k);
    for (const [k, r] of this.texs) if (this.frameNo - r.lastUsed > frames) { gl.deleteTexture(r.t); this.texs.delete(k); }
  }

  private setupLights(lights: Light[], cam: Camera, scene: Scene) {
    const f = this.frameData;
    f.sunRad.set(0, 0, 0); f.moonRad.set(0, 0, 0); f.hemiSky.set(0, 0, 0); f.hemiGround.set(0, 0, 0);
    const camPos = cam.getWorldPosition(new Vec3());
    const points: { l: PointLight; d: number }[] = [], spots: { l: SpotLight; d: number }[] = [];
    const dirs: DirectionalLight[] = [];
    const wp = new Vec3(), tp = new Vec3();
    for (const l of lights) {
      if (l.intensity <= 0) continue;
      if (l instanceof DirectionalLight) dirs.push(l);
      else if (l instanceof HemisphereLight) {
        f.hemiSky.x += l.color.r * l.intensity; f.hemiSky.y += l.color.g * l.intensity; f.hemiSky.z += l.color.b * l.intensity;
        f.hemiGround.x += l.groundColor.r * l.intensity; f.hemiGround.y += l.groundColor.g * l.intensity; f.hemiGround.z += l.groundColor.b * l.intensity;
      } else if (l instanceof PointLight) points.push({ l, d: l.getWorldPosition(wp).distanceTo(camPos) });
      else if (l instanceof SpotLight) spots.push({ l, d: l.getWorldPosition(wp).distanceTo(camPos) });
    }
    // key light = the shadow-casting directional (else the first); a second directional is the fill (moon)
    const key = dirs.find((d) => d.castShadow) ?? dirs[0];
    const fill = dirs.find((d) => d !== key);
    for (const [l, dir, rad] of [[key, f.sunDir, f.sunRad], [fill, f.moonDir, f.moonRad]] as const) {
      if (!l) continue;
      l.getWorldPosition(wp); l.target.getWorldPosition(tp);
      dir.copy(wp.clone().sub(tp).normalize());
      rad.set(l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity);
    }
    points.sort((a, b) => a.d - b.d); spots.sort((a, b) => a.d - b.d);
    f.numPoint = Math.min(MAX_POINT, points.length);
    for (let i = 0; i < f.numPoint; i++) {
      const l = points[i]!.l; l.getWorldPosition(wp);
      f.pointPos.set([wp.x, wp.y, wp.z, l.distance], i * 4);
      f.pointColor.set([l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity, l.decay], i * 4);
    }
    f.numSpot = Math.min(MAX_SPOT, spots.length);
    for (let i = 0; i < f.numSpot; i++) {
      const l = spots[i]!.l; l.getWorldPosition(wp); l.target.getWorldPosition(tp);
      const d = tp.clone().sub(wp).normalize();
      const outer = Math.cos(l.angle), inner = Math.cos(l.angle * (1 - l.penumbra));
      f.spotPos.set([wp.x, wp.y, wp.z, 0], i * 4);
      f.spotDir.set([d.x, d.y, d.z, 0], i * 4);
      f.spotColor.set([l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity, 0], i * 4);
      f.spotParams.set([l.distance, l.decay, outer, inner], i * 4);
    }
    if (scene.fog) { f.fogColor.set(scene.fog.color.r, scene.fog.color.g, scene.fog.color.b); f.fogDensity = scene.fog.density; } else f.fogDensity = 0;
    f.envIntensity = this.sky ? scene.environmentIntensity : 0;
  }

  private shadowPass(sun: DirectionalLight, meshes: Mesh[], cmds: CommandList) {
    const gl = this.gl, f = this.frameData, s = sun.shadow;
    const t = this.shadowTarget(s.mapSize);
    const pos = sun.getWorldPosition(new Vec3()), tgt = sun.target.getWorldPosition(new Vec3());
    const view = new Mat4().lookAt(pos, tgt, Math.abs(pos.clone().sub(tgt).normalize().y) > 0.99 ? new Vec3(0, 0, 1) : new Vec3(0, 1, 0));
    view.setPosition(pos);
    view.invert();
    const proj = new Mat4().orthographic(-s.extent, s.extent, -s.extent, s.extent, s.near, s.far);
    const vp = proj.clone().multiply(view);
    const bias = new Mat4().fromArray([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.5, 0.5, 0.5, 1]);
    bias.multiply(vp).toFloat32(f.shadowM, 0);
    f.shadowOn = 1; f.shadowTexel = 1 / s.mapSize; f.shadowBias = s.bias; f.shadowNormalBias = s.normalBias;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.viewport(0, 0, t.w, t.h);
    gl.depthMask(true); this.state.depthMask = true;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND); this.state.blend = 0;
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2);
    this.setCull(gl.BACK);
    const planes = frustumPlanes(vp);
    const vp32 = new Float32Array(16), id32 = new Float32Array(16);
    view.toFloat32(vp32, 0);
    const proj32 = new Float32Array(16); proj.toFloat32(proj32, 0);
    new Mat4().toFloat32(id32, 0);
    for (const m of meshes) {
      if (!m.castShadow || m.mode !== 'triangles' || m.material.transparent) continue;
      if (m.frustumCulled && !this.visible(m, planes)) continue;
      const p = this.depthProg(m, m.material);
      this.use(p);
      this.uMat4(p, 'viewMatrix', vp32); this.uMat4(p, 'projectionMatrix', proj32);
      this.objectUniforms(p, m);
      if (m.material.alphaTest > 0) { this.bind(UNIT.map, this.texture(m.material.map, this.fallback.white)); this.u1i(p, 'map', UNIT.map); this.u1f(p, 'alphaTest', m.material.alphaTest); }
      this.setCull(m.material.side === 'double' ? 0 : gl.BACK);
      this.draw(m, true);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    cmds.push({ op: 'setPass', inputs: [], preconditions: ['sun.castShadow'], provenance: 'astro:shadow', budget: { cpuMs: 0, gpuMs: 0, bytes: t.w * t.h * 3 }, effects: 'projection_only' });
  }

  private visible(m: Mesh, planes: Plane[]): boolean {
    const b = m.geometry.computeBoundingBox();
    if (b.isEmpty()) return true;
    const c = b.getCenter(new Vec3());
    let r = b.getSize(new Vec3()).length() / 2;
    if (m instanceof InstancedMesh) {
      // union of instance spheres (cached per instance version)
      const cache = m.userData.__bounds as { v: number; c: Vec3; r: number } | undefined;
      if (!cache || cache.v !== m.instanceVersion) {
        const a = m.instanceMatrices, lo = new Vec3(Infinity, Infinity, Infinity), hi = new Vec3(-Infinity, -Infinity, -Infinity);
        let ms = 0;
        for (let i = 0; i < m.instanceCount; i++) {
          const o = i * 16;
          ms = Math.max(ms, Math.hypot(a[o]!, a[o + 1]!, a[o + 2]!), Math.hypot(a[o + 4]!, a[o + 5]!, a[o + 6]!));
          lo.min(new Vec3(a[o + 12]!, a[o + 13]!, a[o + 14]!)); hi.max(new Vec3(a[o + 12]!, a[o + 13]!, a[o + 14]!));
        }
        const cc = lo.clone().add(hi).multiplyScalar(0.5);
        m.userData.__bounds = { v: m.instanceVersion, c: cc.add(c.clone().multiplyScalar(ms)), r: lo.distanceTo(hi) / 2 + (r + c.length()) * ms };
      }
      const bb = m.userData.__bounds as { c: Vec3; r: number };
      c.copy(bb.c); r = bb.r;
    }
    c.applyMatrix4(m.matrixWorld);
    const e = m.matrixWorld.elements;
    const s = Math.max(Math.hypot(e[0]!, e[1]!, e[2]!), Math.hypot(e[4]!, e[5]!, e[6]!), Math.hypot(e[8]!, e[9]!, e[10]!));
    return sphereInFrustum(planes, c, r * s);
  }

  private setCull(mode: number) {
    const gl = this.gl;
    if (mode === this.state.cull) return;
    if (mode === 0) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(mode); }
    this.state.cull = mode;
  }
  private setBlend(mode: 0 | 1 | 2) {
    const gl = this.gl;
    if (mode === this.state.blend) return;
    if (mode === 0) gl.disable(gl.BLEND);
    else { gl.enable(gl.BLEND); if (mode === 1) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE); }
    this.state.blend = mode;
  }

  private objectUniforms(p: Prog, m: Mesh) {
    m.matrixWorld.toFloat32(this.m32, 0);
    this.uMat4(p, 'modelMatrix', this.m32);
    // normal matrix = inverse transpose of the upper 3×3
    const inv = this.tmpM.copy(m.matrixWorld).invert().elements, n = this.n9;
    n[0] = inv[0]!; n[1] = inv[4]!; n[2] = inv[8]!; n[3] = inv[1]!; n[4] = inv[5]!; n[5] = inv[9]!; n[6] = inv[2]!; n[7] = inv[6]!; n[8] = inv[10]!;
    this.uMat3(p, 'normalMatrix', n);
    if (m.skin) { this.bind(UNIT.boneTex, this.boneTexture(m)); this.u1i(p, 'boneTex', UNIT.boneTex); }
  }

  private draw(m: Mesh, shadow = false) {
    const gl = this.gl;
    const r = this.geo(m);
    gl.bindVertexArray(r.vao);
    const mode = m.mode === 'points' ? gl.POINTS : m.mode === 'lines' ? gl.LINES : gl.TRIANGLES;
    const inst = m instanceof InstancedMesh ? m.instanceCount : 0;
    if (inst) { if (r.index) gl.drawElementsInstanced(mode, r.count, r.indexType, 0, inst); else gl.drawArraysInstanced(mode, 0, r.count, inst); }
    else if (r.index) gl.drawElements(mode, r.count, r.indexType, 0); else gl.drawArrays(mode, 0, r.count);
    if (shadow) this.info.shadowCalls++;
    else {
      this.info.calls++;
      if (mode === gl.POINTS) this.info.points += r.count * Math.max(1, inst);
      else this.info.triangles += (r.count / 3) * Math.max(1, inst);
      this.info.instances += inst;
    }
  }

  private frameUniforms(p: Prog) {
    const f = this.frameData;
    if (p.frame === this.frameNo && p.view === f.viewIndex) return;
    p.frame = this.frameNo; p.view = f.viewIndex;
    this.uMat4(p, 'viewMatrix', f.view); this.uMat4(p, 'projectionMatrix', f.proj);
    this.u3f(p, 'cameraPosition', f.cam.x, f.cam.y, f.cam.z);
    this.u3f(p, 'sunDir', f.sunDir.x, f.sunDir.y, f.sunDir.z); this.u3f(p, 'sunRadiance', f.sunRad.x, f.sunRad.y, f.sunRad.z);
    this.u3f(p, 'moonDir', f.moonDir.x, f.moonDir.y, f.moonDir.z); this.u3f(p, 'moonRadiance', f.moonRad.x, f.moonRad.y, f.moonRad.z);
    this.u3f(p, 'hemiSky', f.hemiSky.x, f.hemiSky.y, f.hemiSky.z); this.u3f(p, 'hemiGround', f.hemiGround.x, f.hemiGround.y, f.hemiGround.z);
    this.u1i(p, 'numPoint', f.numPoint); this.u4fv(p, 'pointPos', f.pointPos); this.u4fv(p, 'pointColor', f.pointColor);
    this.u1i(p, 'numSpot', f.numSpot); this.u4fv(p, 'spotPos', f.spotPos); this.u4fv(p, 'spotDir', f.spotDir); this.u4fv(p, 'spotColor', f.spotColor); this.u4fv(p, 'spotParams', f.spotParams);
    this.uMat4(p, 'shadowMatrix', f.shadowM); this.u1f(p, 'shadowOn', f.shadowOn); this.u2f(p, 'shadowTexel', f.shadowTexel, f.shadowTexel); this.u1f(p, 'shadowBias', f.shadowBias); this.u1f(p, 'shadowNormalBias', f.shadowNormalBias);
    this.u1i(p, 'shadowMap', UNIT.shadowMap); this.u1i(p, 'envMap', UNIT.envMap);
    this.u1f(p, 'envMaxLod', 7); this.u1f(p, 'envScale', 1 / this.envEncode); this.u3fv(p, 'sh[0]', this.envSH); this.u1f(p, 'sceneEnvIntensity', f.envIntensity);
    this.u3f(p, 'fogColor', f.fogColor.x, f.fogColor.y, f.fogColor.z); this.u1f(p, 'fogDensity', f.fogDensity);
    this.u1f(p, 'exposure', this.exposure); this.u1i(p, 'toneOp', this.toneOp === 'aces' ? 1 : this.toneOp === 'clip' ? 2 : 0);
    for (const [k, v] of Object.entries(this.globals)) this.u1f(p, k, v);
    this.u1i(p, 'grassState', UNIT.grassState); this.u1i(p, 'rippleField', UNIT.ripple);
    this.u1i(p, 'map', UNIT.map); this.u1i(p, 'normalMap', UNIT.normalMap); this.u1i(p, 'roughnessMap', UNIT.roughnessMap); this.u1i(p, 'emissiveMap', UNIT.emissiveMap); this.u1i(p, 'detailMap', UNIT.detailMap);
  }

  private materialUniforms(p: Prog, m: Mesh, mat: Material) {
    this.u3f(p, 'baseColor', mat.color.r, mat.color.g, mat.color.b);
    this.u1f(p, 'opacity', mat.opacity); this.u1f(p, 'roughness', mat.roughness); this.u1f(p, 'metalness', mat.metalness);
    this.u3f(p, 'emissive', mat.emissive.r, mat.emissive.g, mat.emissive.b); this.u1f(p, 'emissiveIntensity', mat.emissiveIntensity);
    this.u1f(p, 'normalScale', mat.normalScale); this.u1f(p, 'clearcoat', mat.clearcoat); this.u1f(p, 'clearcoatRoughness', mat.clearcoatRoughness);
    this.u1f(p, 'envIntensity', mat.envIntensity); this.u1f(p, 'alphaTest', mat.alphaTest); this.u1f(p, 'uvScale', mat.uvScale);
    this.u1f(p, 'pointSize', mat.pointSize * this.pixelRatio);
    const rep = mat.map ?? mat.normalMap;
    this.u2f(p, 'uvRepeat', rep ? rep.repeat.x : 1, rep ? rep.repeat.y : 1); this.u2f(p, 'uvOffset', rep ? rep.offset.x : 0, rep ? rep.offset.y : 0);
    this.u1f(p, 'uPuddles', 1);
    for (const [k, v] of Object.entries(mat.uniforms)) { if (Array.isArray(v)) this.u3f(p, k, v[0], v[1], v[2]); else this.u1f(p, k, v); }
    this.bind(UNIT.map, this.texture(mat.map, this.fallback.white));
    this.bind(UNIT.normalMap, this.texture(mat.normalMap, this.fallback.normal));
    this.bind(UNIT.roughnessMap, this.texture(mat.roughnessMap, this.fallback.white));
    this.bind(UNIT.emissiveMap, this.texture(mat.emissiveMap, this.fallback.white));
    this.bind(UNIT.detailMap, this.texture(mat.detailMap, this.fallback.white));
    void m;
  }

  private forwardPass(scene: Scene, cams: Camera[], meshes: Mesh[], W: number, H: number, cmds: CommandList) {
    const gl = this.gl, f = this.frameData;
    let target: Target | null = null;
    if (this.hdr) { target = this.colorTarget(W, H, true, this.msaa, this.targets.hdr); this.targets.hdr = target; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? (target.msaaFbo ?? target.fbo) : null);
    gl.viewport(0, 0, W, H);
    gl.depthMask(true); this.state.depthMask = true;
    const bg = scene.background;
    gl.clearColor(bg?.r ?? 0, bg?.g ?? 0, bg?.b ?? 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.shadowsEnabled || f.shadowOn === 0) f.shadowOn = 0;
    this.bind(UNIT.shadowMap, this.targets.shadow && f.shadowOn ? this.targets.shadow.tex! : this.fallback.depth);
    this.bind(UNIT.envMap, this.targets.env?.tex ?? this.fallback.env);
    this.bind(UNIT.grassState, this.fieldTextures.grassState ?? this.fallback.black);
    this.bind(UNIT.ripple, this.fieldTextures.ripple ?? this.fallback.black);
    if (!this.fieldTextures.ripple) this.globals.uRippleOn = 0;
    const sliceW = Math.floor(W / cams.length);
    cams.forEach((cam, vi) => {
      gl.viewport(vi * sliceW, 0, sliceW, H);
      if (cams.length > 1) { gl.enable(gl.SCISSOR_TEST); gl.scissor(vi * sliceW, 0, sliceW, H); }
      cam.updateView();
      f.viewIndex = vi;
      cam.view.toFloat32(f.view, 0); cam.projection.toFloat32(f.proj, 0); cam.getWorldPosition(f.cam);
      const vp = cam.projection.clone().multiply(cam.view);
      const planes = frustumPlanes(vp);
      const opaque: DrawItem[] = [], transparent: DrawItem[] = [];
      const camPos = f.cam;
      for (const m of meshes) {
        if (m.frustumCulled && !this.visible(m, planes)) { this.info.culled++; continue; }
        const mat = m.material;
        const item: DrawItem = { mesh: m, mat, depth: 0, key: '' };
        if (mat.transparent || mat.feature === 'text') {
          const c = new Vec3().setFromMatrixPosition(m.matrixWorld);
          item.depth = c.distanceTo(camPos);
          transparent.push(item);
        } else { item.key = mat.variantKey(); opaque.push(item); }
      }
      opaque.sort((a, b) => a.mesh.renderOrder - b.mesh.renderOrder || (a.key < b.key ? -1 : a.key > b.key ? 1 : a.mat.id - b.mat.id));
      transparent.sort((a, b) => a.mesh.renderOrder - b.mesh.renderOrder || b.depth - a.depth);
      this.setBlend(0);
      for (const it of opaque) this.drawItem(it);
      // sky after opaque: fills only untouched (far-plane) pixels
      if (this.sky) this.drawSky(cam, scene);
      for (const it of transparent) this.drawItem(it);
      gl.depthMask(true); this.state.depthMask = true;
      cmds.push({ op: 'draw', inputs: ['scene', 'camera'], preconditions: [], provenance: `astro:forward:view${vi}`, budget: { cpuMs: 0, gpuMs: 0, bytes: 0 }, effects: 'projection_only', count: opaque.length + transparent.length });
    });
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.POLYGON_OFFSET_FILL); this.state.offset = 0;
    if (target?.msaaFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.msaaFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.fbo);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
  }

  private drawItem(it: DrawItem) {
    const gl = this.gl, m = it.mesh, mat = it.mat;
    const p = this.forwardProg(m, mat);
    this.use(p);
    this.frameUniforms(p);
    this.objectUniforms(p, m);
    this.materialUniforms(p, m, mat);
    const transparent = mat.transparent || mat.feature === 'text';
    this.setBlend(transparent ? (mat.blending === 'additive' ? 2 : 1) : 0);
    const dm = transparent ? mat.depthWrite && mat.feature !== 'text' : mat.depthWrite;
    if (dm !== this.state.depthMask) { gl.depthMask(dm); this.state.depthMask = dm; }
    this.setCull(mat.side === 'double' || m.mode !== 'triangles' ? 0 : mat.side === 'back' ? gl.FRONT : gl.BACK);
    const off = mat.polygonOffset || (mat.feature === 'text' ? -2 : 0);
    if (off !== this.state.offset) { if (off) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(off, off); } else gl.disable(gl.POLYGON_OFFSET_FILL); this.state.offset = off; }
    this.draw(m);
  }

  private drawSky(cam: Camera, scene: Scene) {
    const gl = this.gl, s = this.sky!;
    const p = this.postProg('sky', SKY_FS, this.hdr ? [] : ['INLINE_TONEMAP']);
    this.use(p);
    this.skyUniforms(p, s);
    const rot = cam.view.clone(); rot.setPosition(new Vec3(0, 0, 0));
    const ivp = cam.projection.clone().multiply(rot).invert();
    ivp.toFloat32(this.m32, 0);
    this.uMat4(p, 'invViewProj', this.m32);
    const fog = scene.fog;
    this.u3f(p, 'fogColor', fog?.color.r ?? 0, fog?.color.g ?? 0, fog?.color.b ?? 0);
    this.u1f(p, 'fogHorizon', fog ? Math.min(0.9, fog.density * 400) : 0);
    this.u1f(p, 'exposure', this.exposure); this.u1i(p, 'toneOp', this.toneOp === 'aces' ? 1 : this.toneOp === 'clip' ? 2 : 0);
    this.setBlend(0); this.setCull(0);
    if (this.state.depthMask) { gl.depthMask(false); this.state.depthMask = false; }
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.info.calls++;
  }

  private fullscreen(target: Target | null, w: number, h: number) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private bloomPass(W: number, H: number, cmds: CommandList) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST); this.setCull(0); this.setBlend(0);
    const levels = 5;
    const sizes: [number, number][] = [];
    for (let i = 0; i < levels; i++) sizes.push([Math.max(1, W >> (i + 1)), Math.max(1, H >> (i + 1))]);
    for (let i = 0; i < levels; i++) this.targets.bloom[i] = this.colorTarget(sizes[i]![0], sizes[i]![1], false, 0, this.targets.bloom[i] ?? null);
    const pre = this.postProg('bloomPre', BLOOM_PREFILTER_FS);
    this.use(pre);
    this.bind(0, this.targets.hdr!.tex!); this.u1i(pre, 'src', 0);
    this.u2f(pre, 'texel', 1 / W, 1 / H); this.u1f(pre, 'exposure', this.exposure); this.u1f(pre, 'threshold', this.bloomThreshold); this.u1f(pre, 'knee', 0.5);
    this.fullscreen(this.targets.bloom[0]!, sizes[0]![0], sizes[0]![1]);
    const down = this.postProg('bloomDown', BLOOM_DOWN_FS);
    this.use(down);
    for (let i = 1; i < levels; i++) {
      this.bind(0, this.targets.bloom[i - 1]!.tex!); this.u1i(down, 'src', 0); this.u2f(down, 'texel', 1 / sizes[i - 1]![0], 1 / sizes[i - 1]![1]);
      this.fullscreen(this.targets.bloom[i]!, sizes[i]![0], sizes[i]![1]);
    }
    const up = this.postProg('bloomUp', BLOOM_UP_FS);
    this.use(up);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); this.state.blend = 3 as never;
    for (let i = levels - 1; i > 0; i--) {
      this.bind(0, this.targets.bloom[i]!.tex!); this.u1i(up, 'src', 0); this.u2f(up, 'texel', 1 / sizes[i]![0], 1 / sizes[i]![1]); this.u1f(up, 'radius', 1);
      this.fullscreen(this.targets.bloom[i - 1]!, sizes[i - 1]![0], sizes[i - 1]![1]);
    }
    gl.disable(gl.BLEND); this.state.blend = 0;
    gl.enable(gl.DEPTH_TEST);
    cmds.push({ op: 'blit', inputs: ['hdr'], preconditions: ['hdr'], provenance: 'astro:bloom', budget: { cpuMs: 0, gpuMs: 0, bytes: 0 }, effects: 'projection_only' });
  }

  private outputPass(W: number, H: number, cmds: CommandList) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST); this.setCull(0); this.setBlend(0);
    const p = this.postProg('output', OUTPUT_FS);
    this.use(p);
    this.bind(0, this.targets.hdr!.tex!); this.u1i(p, 'hdr', 0);
    this.bind(1, this.bloomStrength > 0 && this.targets.bloom[0] ? this.targets.bloom[0].tex! : this.fallback.black); this.u1i(p, 'bloom', 1);
    this.bind(2, this.field?.texture ?? this.fallback.black); this.u1i(p, 'field', 2);
    this.u1f(p, 'fieldOn', this.field ? 1 : 0); this.u1f(p, 'fieldGain', this.field?.gain ?? 0);
    this.u1f(p, 'exposure', this.exposure); this.u1f(p, 'bloomStrength', this.bloomStrength);
    this.u1i(p, 'toneOp', this.toneOp === 'aces' ? 1 : this.toneOp === 'clip' ? 2 : 0);
    this.u1i(p, 'lensMode', this.lensMode === 'anaglyph' ? 1 : 0);
    this.fullscreen(null, W, H);
    gl.enable(gl.DEPTH_TEST);
    cmds.push({ op: 'blit', inputs: ['hdr', 'bloom'], preconditions: [], provenance: `astro:output:${this.toneOp}:${this.lensMode}`, budget: { cpuMs: 0, gpuMs: 0, bytes: 0 }, effects: 'projection_only' });
  }

  /** Blit an arbitrary texture to the canvas (debug lenses, WebGPU comparison). */
  blitTexture(tex: WebGLTexture) {
    const p = this.postProg('blit', BLIT_FS);
    this.use(p); this.bind(0, tex); this.u1i(p, 'src', 0);
    this.gl.disable(this.gl.DEPTH_TEST);
    this.fullscreen(null, this.canvas.width, this.canvas.height);
    this.gl.enable(this.gl.DEPTH_TEST);
  }

  /** Read back the displayed frame (requires preserveDrawingBuffer or same-task call). */
  readPixels(x = 0, y = 0, w = this.canvas.width, h = this.canvas.height): Uint8Array {
    const gl = this.gl, out = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }

  dispose() {
    for (const k of [...this.geos.keys()]) this.freeGeo(k);
    for (const r of this.texs.values()) this.gl.deleteTexture(r.t);
    this.texs.clear();
    for (const t of [this.targets.hdr, this.targets.shadow, this.targets.env, ...this.targets.bloom]) if (t) this.freeTarget(t);
  }
}

export type { Geometry };
