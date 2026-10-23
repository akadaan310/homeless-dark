// Bounded typed shader DSL (§046): a small expression AST compiled to GLSL ES 3.00 and WGSL.
// No string evaluation, no recursion, loops only with constant bounds ≤ 64, every
// identifier must be declared (input, uniform, sampler or let). Used for ASTRO
// full-screen passes (pixel-field wave step, tone-map/composite) on both backends.

export type DType = 'f32' | 'vec2' | 'vec3' | 'vec4';
export type Expr =
  | { k: 'num'; v: number }
  | { k: 'ref'; name: string }
  | { k: 'bin'; op: '+' | '-' | '*' | '/'; a: Expr; b: Expr }
  | { k: 'call'; fn: Builtin; args: Expr[] }
  | { k: 'sample'; tex: string; uv: Expr }
  | { k: 'swz'; e: Expr; s: string }
  | { k: 'ctor'; t: DType; args: Expr[] };
export type Builtin = 'sin' | 'cos' | 'exp' | 'abs' | 'min' | 'max' | 'clamp' | 'mix' | 'dot' | 'normalize' | 'length' | 'pow' | 'sqrt' | 'step' | 'smoothstep' | 'fract' | 'floor';
export type Stmt =
  | { k: 'let'; name: string; t: DType; e: Expr }
  | { k: 'set'; name: string; e: Expr }
  | { k: 'for'; v: string; from: number; to: number; body: Stmt[] }
  | { k: 'out'; e: Expr };
export interface ShaderProgram {
  name: string;
  uniforms: { name: string; t: DType }[];
  samplers: string[];
  body: Stmt[];
}

export const num = (v: number): Expr => ({ k: 'num', v });
export const ref = (name: string): Expr => ({ k: 'ref', name });
export const bin = (op: '+' | '-' | '*' | '/', a: Expr, b: Expr): Expr => ({ k: 'bin', op, a, b });
export const call = (fn: Builtin, ...args: Expr[]): Expr => ({ k: 'call', fn, args });
export const sample = (tex: string, uv: Expr): Expr => ({ k: 'sample', tex, uv });
export const swz = (e: Expr, s: string): Expr => ({ k: 'swz', e, s });
export const ctor = (t: DType, ...args: Expr[]): Expr => ({ k: 'ctor', t, args });

const BUILTINS = new Set<Builtin>(['sin', 'cos', 'exp', 'abs', 'min', 'max', 'clamp', 'mix', 'dot', 'normalize', 'length', 'pow', 'sqrt', 'step', 'smoothstep', 'fract', 'floor']);
const IDENT = /^[a-z][A-Za-z0-9_]{0,31}$/;

export interface ValidationResult { ok: boolean; errors: string[] }

/** Static validator: declared identifiers only, bounded loops, finite literals, no unknown builtins. */
export function validate(p: ShaderProgram): ValidationResult {
  const errors: string[] = [];
  const scope = new Set<string>(['uv', 'resolution', 'time', ...p.uniforms.map((u) => u.name)]);
  const samplers = new Set(p.samplers);
  for (const u of p.uniforms) if (!IDENT.test(u.name)) errors.push(`bad uniform name ${u.name}`);
  let outs = 0;
  const ex = (e: Expr): void => {
    switch (e.k) {
      case 'num': if (!Number.isFinite(e.v)) errors.push('non-finite literal'); break;
      case 'ref': if (!scope.has(e.name)) errors.push(`undeclared identifier ${e.name}`); break;
      case 'bin': ex(e.a); ex(e.b); break;
      case 'call': if (!BUILTINS.has(e.fn)) errors.push(`forbidden function ${e.fn}`); e.args.forEach(ex); break;
      case 'sample': if (!samplers.has(e.tex)) errors.push(`undeclared buffer/sampler ${e.tex}`); ex(e.uv); break;
      case 'swz': if (!/^[xyzw]{1,4}$/.test(e.s)) errors.push(`bad swizzle ${e.s}`); ex(e.e); break;
      case 'ctor': e.args.forEach(ex); break;
    }
  };
  const st = (s: Stmt, depth: number): void => {
    if (depth > 2) { errors.push('loop nesting deeper than 2'); return; }
    switch (s.k) {
      case 'let': if (!IDENT.test(s.name)) errors.push(`bad identifier ${s.name}`); ex(s.e); scope.add(s.name); break;
      case 'set': if (!scope.has(s.name)) errors.push(`assignment to undeclared ${s.name}`); ex(s.e); break;
      case 'for':
        if (!Number.isInteger(s.from) || !Number.isInteger(s.to) || s.to - s.from > 64 || s.to < s.from) errors.push(`loop ${s.v} must have constant bounds with ≤ 64 iterations`);
        scope.add(s.v); s.body.forEach((b) => st(b, depth + 1)); break;
      case 'out': outs++; ex(s.e); break;
    }
  };
  p.body.forEach((s) => st(s, 0));
  if (outs !== 1) errors.push(`exactly one out statement required (found ${outs})`);
  return { ok: errors.length === 0, errors };
}

const lit = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const glslT: Record<DType, string> = { f32: 'float', vec2: 'vec2', vec3: 'vec3', vec4: 'vec4' };
const wgslT: Record<DType, string> = { f32: 'f32', vec2: 'vec2f', vec3: 'vec3f', vec4: 'vec4f' };

function glslExpr(e: Expr): string {
  switch (e.k) {
    case 'num': return lit(e.v);
    case 'ref': return e.name === 'uv' ? 'vUv' : e.name === 'resolution' ? 'uResolution' : e.name === 'time' ? 'uTime' : e.name;
    case 'bin': return `(${glslExpr(e.a)} ${e.op} ${glslExpr(e.b)})`;
    case 'call': return `${e.fn}(${e.args.map(glslExpr).join(', ')})`;
    case 'sample': return `texture(${e.tex}, ${glslExpr(e.uv)})`;
    case 'swz': return `${glslExpr(e.e)}.${e.s}`;
    case 'ctor': return `${glslT[e.t]}(${e.args.map(glslExpr).join(', ')})`;
  }
}
function wgslExpr(e: Expr): string {
  switch (e.k) {
    case 'num': return lit(e.v);
    case 'ref': return e.name === 'uv' ? 'in.uv' : e.name === 'resolution' ? 'u.resolution' : e.name === 'time' ? 'u.time' : e.name;
    case 'bin': return `(${wgslExpr(e.a)} ${e.op} ${wgslExpr(e.b)})`;
    case 'call': return `${e.fn === 'fract' ? 'fract' : e.fn}(${e.args.map(wgslExpr).join(', ')})`;
    case 'sample': return `textureSample(${e.tex}, ${e.tex}Sampler, ${wgslExpr(e.uv)})`;
    case 'swz': return `${wgslExpr(e.e)}.${e.s}`;
    case 'ctor': return `${wgslT[e.t]}(${e.args.map(wgslExpr).join(', ')})`;
  }
}

export function toGLSL(p: ShaderProgram): string {
  const v = validate(p);
  if (!v.ok) throw new Error(`shader ${p.name} rejected: ${v.errors.join('; ')}`);
  const lines = ['#version 300 es', 'precision highp float;', 'in vec2 vUv;', 'uniform vec2 uResolution;', 'uniform float uTime;', 'out vec4 outColor;'];
  for (const u of p.uniforms) lines.push(`uniform ${glslT[u.t]} ${u.name};`);
  for (const s of p.samplers) lines.push(`uniform sampler2D ${s};`);
  lines.push('void main() {');
  const st = (s: Stmt, ind: string): void => {
    if (s.k === 'let') lines.push(`${ind}${glslT[s.t]} ${s.name} = ${glslExpr(s.e)};`);
    else if (s.k === 'set') lines.push(`${ind}${s.name} = ${glslExpr(s.e)};`);
    else if (s.k === 'out') lines.push(`${ind}outColor = ${glslExpr(s.e)};`);
    else { lines.push(`${ind}for (int ${s.v}_i = ${s.from}; ${s.v}_i < ${s.to}; ${s.v}_i++) { float ${s.v} = float(${s.v}_i);`); s.body.forEach((b) => st(b, ind + '  ')); lines.push(`${ind}}`); }
  };
  p.body.forEach((s) => st(s, '  '));
  lines.push('}');
  return lines.join('\n');
}

export function toWGSL(p: ShaderProgram): string {
  const v = validate(p);
  if (!v.ok) throw new Error(`shader ${p.name} rejected: ${v.errors.join('; ')}`);
  const lines = ['struct U { resolution: vec2f, time: f32,'];
  for (const u of p.uniforms) lines.push(`  ${u.name}: ${wgslT[u.t]},`);
  lines.push('};', '@group(0) @binding(0) var<uniform> u: U;');
  p.samplers.forEach((s, i) => lines.push(`@group(0) @binding(${1 + i * 2}) var ${s}: texture_2d<f32>;`, `@group(0) @binding(${2 + i * 2}) var ${s}Sampler: sampler;`));
  lines.push('struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };',
    '@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut { var o: VOut; let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2f(p.x, 1.0 - p.y); return o; }',
    '@fragment fn fs(in: VOut) -> @location(0) vec4f {');
  for (const u of p.uniforms) lines.push(`  let ${u.name} = u.${u.name};`);
  const st = (s: Stmt, ind: string): void => {
    if (s.k === 'let') lines.push(`${ind}var ${s.name}: ${wgslT[s.t]} = ${wgslExpr(s.e)};`);
    else if (s.k === 'set') lines.push(`${ind}${s.name} = ${wgslExpr(s.e)};`);
    else if (s.k === 'out') lines.push(`${ind}return ${wgslExpr(s.e)};`);
    else { lines.push(`${ind}for (var ${s.v}_i: i32 = ${s.from}; ${s.v}_i < ${s.to}; ${s.v}_i++) { let ${s.v} = f32(${s.v}_i);`); s.body.forEach((b) => st(b, ind + '  ')); lines.push(`${ind}}`); }
  };
  p.body.forEach((s) => st(s, '  '));
  lines.push('}');
  return lines.join('\n');
}

/** Stable digest of a program's source form (cache key, shader digest in witnesses). */
export function shaderDigest(src: string): string {
  let h1 = 0x811c9dc5, h2 = 0x9747b28c;
  for (let i = 0; i < src.length; i++) { h1 = Math.imul(h1 ^ src.charCodeAt(i), 0x01000193) >>> 0; h2 = Math.imul(h2 ^ src.charCodeAt(i), 0x5bd1e995) >>> 0; }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
