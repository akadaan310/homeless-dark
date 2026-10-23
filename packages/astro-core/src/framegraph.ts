// Framegraph (§045) and render command IR (§044, §106).
// Passes declare typed attachment reads/writes; the graph is topologically sorted,
// cycles are rejected, and attachment lifetimes are computed so transient targets can alias.

export type AttachmentFormat = 'rgba8' | 'rgba16f' | 'depth24' | 'depth32f' | 'r32f' | 'rg16f';
export interface AttachmentDesc { name: string; format: AttachmentFormat; scale: number; persistent?: boolean }
export interface PassDesc { name: string; reads: string[]; writes: string[]; optional?: boolean; budgetMs?: number }

export interface CompiledGraph {
  order: string[];
  lifetimes: Record<string, { first: number; last: number }>;
  aliases: [string, string][]; // transient attachments whose lifetimes do not overlap and share a format/scale
  culled: string[];
}

export class FrameGraph {
  private passes = new Map<string, PassDesc>();
  private attachments = new Map<string, AttachmentDesc>();
  attachment(a: AttachmentDesc) { this.attachments.set(a.name, a); return this; }
  pass(p: PassDesc) {
    if (this.passes.has(p.name)) throw new Error(`duplicate pass ${p.name}`);
    for (const r of [...p.reads, ...p.writes]) if (!this.attachments.has(r) && r !== 'backbuffer') throw new Error(`pass ${p.name} references undeclared attachment ${r}`);
    this.passes.set(p.name, p);
    return this;
  }
  /** Kahn sort over producer→consumer edges; throws on cycles. Passes writing nothing consumed and not backbuffer are culled. */
  compile(enabled: (pass: string) => boolean = () => true): CompiledGraph {
    const passes = [...this.passes.values()].filter((p) => enabled(p.name));
    const writers = new Map<string, string[]>();
    for (const p of passes) for (const w of p.writes) writers.set(w, [...(writers.get(w) ?? []), p.name]);
    // dead-pass culling: keep passes whose output reaches the backbuffer
    const live = new Set<string>();
    const need = ['backbuffer'];
    const seenRes = new Set<string>();
    while (need.length) {
      const r = need.pop()!;
      if (seenRes.has(r)) continue;
      seenRes.add(r);
      for (const pn of writers.get(r) ?? []) { if (!live.has(pn)) { live.add(pn); for (const rr of this.passes.get(pn)!.reads) need.push(rr); } }
    }
    const kept = passes.filter((p) => live.has(p.name));
    const culled = passes.filter((p) => !live.has(p.name)).map((p) => p.name);
    const indeg = new Map<string, number>(kept.map((p) => [p.name, 0]));
    const out = new Map<string, Set<string>>(kept.map((p) => [p.name, new Set()]));
    for (const p of kept) for (const r of p.reads) for (const w of writers.get(r) ?? []) {
      if (w === p.name || !live.has(w)) continue;
      if (!out.get(w)!.has(p.name)) { out.get(w)!.add(p.name); indeg.set(p.name, indeg.get(p.name)! + 1); }
    }
    const q = kept.filter((p) => indeg.get(p.name) === 0).map((p) => p.name);
    const order: string[] = [];
    while (q.length) {
      const n = q.shift()!;
      order.push(n);
      for (const m of out.get(n)!) { indeg.set(m, indeg.get(m)! - 1); if (indeg.get(m) === 0) q.push(m); }
    }
    if (order.length !== kept.length) throw new Error(`framegraph cycle among: ${kept.filter((p) => !order.includes(p.name)).map((p) => p.name).join(', ')}`);
    const lifetimes: CompiledGraph['lifetimes'] = {};
    order.forEach((pn, i) => {
      const p = this.passes.get(pn)!;
      for (const r of [...p.reads, ...p.writes]) { if (r === 'backbuffer') continue; const l = lifetimes[r] ?? { first: i, last: i }; l.first = Math.min(l.first, i); l.last = Math.max(l.last, i); lifetimes[r] = l; }
    });
    const aliases: [string, string][] = [];
    const names = Object.keys(lifetimes).filter((n) => !this.attachments.get(n)!.persistent);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const a = this.attachments.get(names[i]!)!, b = this.attachments.get(names[j]!)!, la = lifetimes[a.name]!, lb = lifetimes[b.name]!;
      if (a.format === b.format && a.scale === b.scale && (la.last < lb.first || lb.last < la.first)) aliases.push([a.name, b.name]);
    }
    return { order, lifetimes, aliases, culled };
  }
}

// ---------------------------------------------------------------- command IR
export type Effects = 'projection_only' | 'propose_world_event';
export interface SceneCommand {
  op: 'draw' | 'drawInstanced' | 'clear' | 'blit' | 'compute' | 'setPass';
  inputs: readonly string[];
  preconditions: readonly string[];
  provenance: string;
  budget: { cpuMs: number; gpuMs: number; bytes: number };
  effects: Effects;
  pipeline?: string; // shader variant key
  meshId?: number;
  count?: number;
}

/** A frame's command list. Render commands may only be projections; world mutation is never encoded here. */
export class CommandList {
  readonly commands: SceneCommand[] = [];
  push(c: SceneCommand) {
    if (c.effects !== 'projection_only') throw new Error(`render command ${c.op} declares world effects; rendering cannot mutate authority`);
    this.commands.push(c);
    return this;
  }
  stats() {
    const byOp: Record<string, number> = {};
    for (const c of this.commands) byOp[c.op] = (byOp[c.op] ?? 0) + 1;
    return { total: this.commands.length, byOp, bytes: this.commands.reduce((a, c) => a + c.budget.bytes, 0) };
  }
}

/** Compiled-artifact cache keyed by schema+source hash (§106, §109), with hit/miss trace. */
export class CompileCache<T> {
  private map = new Map<string, T>();
  hits = 0; misses = 0;
  readonly trace: { key: string; hit: boolean; ms: number }[] = [];
  get(key: string, build: () => T): T {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const v = this.map.get(key);
    if (v !== undefined) { this.hits++; this.trace.push({ key, hit: true, ms: 0 }); return v; }
    const b = build();
    this.map.set(key, b);
    this.misses++;
    this.trace.push({ key, hit: false, ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0 });
    if (this.trace.length > 500) this.trace.splice(0, 250);
    return b;
  }
  get size() { return this.map.size; }
}
