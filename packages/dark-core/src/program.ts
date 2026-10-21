// dark-core/protocols: WorldProgramCompiler (Division III, Programmable Languages).
//
// A world program is a versioned, PURL-like PATH expression (no URI scheme is
// registered or invented):
//     v1:sign/cafe-sign/START/TEXT:OPEN%20LATE/HUE:200/BRIGHTNESS:0.8/COMMIT
// [K] finite-state protocol (Harel statechart reduced to an FSM), typed tokens.
// [C] SEURL-style typed effect declaration (actor, expected revision, resources,
//     permitted projections) after Substrate University src/math/addressCompiler.ts
//     (loom:// START…COMMIT discipline). Compiling/inspecting never mutates; only
//     WorldAuthority.commit of a PROGRAM_APPLY event changes state.

export type Resource = 'sign' | 'light' | 'music';
export type Projection = 'visual' | 'acoustic' | 'haptic';

interface OpSpec { arg: 'text' | 'number' | 'int'; min?: number; max?: number; maxLen?: number; projection: Projection }

export const OPS: Record<Resource, Record<string, OpSpec>> = {
  sign: {
    TEXT: { arg: 'text', maxLen: 28, projection: 'visual' },
    HUE: { arg: 'int', min: 0, max: 359, projection: 'visual' },
    CHROMA: { arg: 'number', min: 0, max: 0.3, projection: 'visual' },
    LIGHTNESS: { arg: 'number', min: 0.2, max: 0.95, projection: 'visual' },
    BRIGHTNESS: { arg: 'number', min: 0, max: 1, projection: 'visual' },
    // Photosensitivity: WCAG 2.3.1 caps flashing at 3 per second; DARK caps pulses at 1 Hz.
    PULSE: { arg: 'number', min: 0, max: 1, projection: 'visual' },
    CHIME: { arg: 'int', min: 0, max: 11, projection: 'acoustic' },
  },
  light: {
    TEMP: { arg: 'int', min: 1800, max: 6500, projection: 'visual' },
    INTENSITY: { arg: 'number', min: 0, max: 1, projection: 'visual' },
  },
  music: {
    MOTIF: { arg: 'int', min: 0, max: 11, projection: 'acoustic' },
    TEMPO: { arg: 'int', min: 50, max: 140, projection: 'acoustic' },
  },
};

const TEXT_RE = /^[A-Za-z0-9 .,'&:!?·\-]+$/;

export interface ProgramOp { op: string; arg: string | number; projection: Projection }

export interface CompiledProgram {
  ok: boolean;
  version: string | null;
  resource: Resource | null;
  target: string | null;
  ops: ProgramOp[];
  states: string[];
  diagnostics: string[];
  effect: { resources: string[]; projections: Projection[]; cost: number } | null;
}

export function compileProgram(address: string, knownTargets?: ReadonlySet<string>): CompiledProgram {
  const fail = (d: string, partial: Partial<CompiledProgram> = {}): CompiledProgram => ({ ok: false, version: null, resource: null, target: null, ops: [], states: ['idle', 'rejected'], diagnostics: [d], effect: null, ...partial });
  const m = /^(v\d+):([a-z]+)\/([a-z0-9-]{1,40})((?:\/[^/\s]+)*)\/?$/.exec(address.trim());
  if (!m) return fail('a program has the form v1:<resource>/<target>/START/<OP>:<arg>/…/COMMIT');
  const [, version, res, target, rest] = m as unknown as [string, string, string, string, string];
  if (version !== 'v1') return fail(`unsupported version ${version}`);
  if (!(res in OPS)) return fail(`unknown resource ${res}`);
  const resource = res as Resource;
  if (knownTargets && !knownTargets.has(`${resource}/${target}`)) return fail(`target ${resource}/${target} does not exist (rejected before execution)`, { version, resource, target });
  const parts = rest.split('/').filter(Boolean);
  let state: 'idle' | 'open' | 'committed' | 'rejected' = 'idle';
  const states: string[] = [state];
  const ops: ProgramOp[] = [];
  const diagnostics: string[] = [];
  for (const [i, raw] of parts.entries()) {
    if (state === 'rejected') break;
    const c = raw.indexOf(':');
    const name = (c < 0 ? raw : raw.slice(0, c)).toUpperCase();
    let argRaw = c < 0 ? null : raw.slice(c + 1);
    try { if (argRaw !== null) argRaw = decodeURIComponent(argRaw); } catch { diagnostics.push(`step ${i + 1}: malformed percent-encoding`); state = 'rejected'; break; }
    if (name === 'START') { if (state !== 'idle') { diagnostics.push(`step ${i + 1}: START only from idle`); state = 'rejected'; } else state = 'open'; }
    else if (name === 'COMMIT') { if (state !== 'open') { diagnostics.push(`step ${i + 1}: COMMIT only from open`); state = 'rejected'; } else state = 'committed'; }
    else {
      const spec = OPS[resource][name];
      if (!spec) { diagnostics.push(`step ${i + 1}: ${name} is not an operation of ${resource}`); state = 'rejected'; }
      else if (state !== 'open') { diagnostics.push(`step ${i + 1}: ${name} only between START and COMMIT`); state = 'rejected'; }
      else {
        const v = typed(spec, argRaw);
        if (typeof v === 'object') { diagnostics.push(`step ${i + 1}: ${name} ${v.error}`); state = 'rejected'; }
        else ops.push({ op: name, arg: v, projection: spec.projection });
      }
    }
    states.push(state);
  }
  if (state === 'open') diagnostics.push('never COMMITs: nothing is applied');
  if (state === 'idle') diagnostics.push('never STARTs');
  const ok = state === 'committed';
  const projections = [...new Set(ops.map((o) => o.projection))];
  return { ok, version, resource, target, ops, states, diagnostics: ok ? [...diagnostics, `admitted: ${ops.length} typed ops`] : diagnostics, effect: ok ? { resources: [`${resource}/${target}`], projections, cost: ops.length } : null };
}

function typed(spec: OpSpec, raw: string | null): string | number | { error: string } {
  if (raw === null) return { error: 'requires an argument' };
  if (spec.arg === 'text') {
    if (raw.length === 0 || raw.length > (spec.maxLen ?? 32)) return { error: `text length must be 1..${spec.maxLen}` };
    if (!TEXT_RE.test(raw)) return { error: 'text uses characters outside the sign glyph set' };
    return raw;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return { error: 'expects a number' };
  if (spec.arg === 'int' && !Number.isInteger(n)) return { error: 'expects an integer' };
  if ((spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max)) return { error: `out of range [${spec.min}, ${spec.max}]` };
  return n;
}

/** Canonical source form of a compiled program: format(compile(x)) is a fixed point. */
export function formatProgram(p: CompiledProgram): string {
  if (!p.ok) throw new Error('only admitted programs have a canonical form');
  const ops = p.ops.map((o) => `${o.op}:${typeof o.arg === 'string' ? encodeURIComponent(o.arg) : o.arg}`);
  return `${p.version}:${p.resource}/${p.target}/START/${ops.join('/')}${ops.length ? '/' : ''}COMMIT`;
}

/** Unfold an admitted program into its admitted primitive operations (operator inspection). */
export function unfoldProgram(p: CompiledProgram): string[] {
  return p.ops.map((o) => `${p.resource}/${p.target}.${o.op}(${JSON.stringify(o.arg)}) → ${o.projection}`);
}
