// dark-core/causality: BORNE dependency propagation (Division VI).
//
// [K] dependency DAGs, Kahn topological order, incremental recomputation with
//     early cutoff (as in build systems / self-adjusting computation).
// [C] BORNE (house application term, Substrate University world.ts): a fact is
//     "born" only after its dependencies; a change propagates only through its
//     causal cone, and each propagation records a witness: which nodes were in
//     the cone (borne), which actually recomputed, and which changed value
//     (moved). Invariant tested: moved ⊆ recomputed ⊆ borne.

export type Value = number | string | boolean | null | readonly (number | string | boolean)[] | { readonly [k: string]: unknown };

export interface BorneNode {
  id: string;
  deps: string[];
  compute?: (get: (id: string) => Value) => Value; // absent = input
  equals?: (a: Value, b: Value) => boolean;
}

export interface PropagationWitness {
  cause: string;
  causeEventId?: string;
  borne: string[]; // causal cone in topological order
  recomputed: string[];
  moved: string[];
  cutoff: string[]; // recomputed but unchanged → stopped propagation
  values: Record<string, Value>;
}

const defaultEq = (a: Value, b: Value) => JSON.stringify(a) === JSON.stringify(b);

export class BorneGraph {
  private nodes = new Map<string, BorneNode>();
  private values = new Map<string, Value>();
  private dependents = new Map<string, Set<string>>();
  private order: string[] = [];
  readonly witnesses: PropagationWitness[] = [];

  add(node: BorneNode, initial?: Value): this {
    if (this.nodes.has(node.id)) throw new Error(`duplicate node ${node.id}`);
    for (const d of node.deps) if (!this.nodes.has(d)) throw new Error(`${node.id} depends on unknown ${d} (facts are born after dependencies)`);
    this.nodes.set(node.id, node);
    for (const d of node.deps) {
      const s = this.dependents.get(d) ?? new Set();
      s.add(node.id);
      this.dependents.set(d, s);
    }
    this.order.push(node.id); // insertion respects dependency order → valid topological order
    this.values.set(node.id, node.compute ? node.compute((id) => this.get(id)) : (initial ?? null));
    return this;
  }

  get(id: string): Value {
    if (!this.values.has(id)) throw new Error(`unknown node ${id}`);
    return this.values.get(id)!;
  }

  /** Causal cone: everything reachable from `id` through dependents, in topological order. */
  cone(id: string): string[] {
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of this.dependents.get(u) ?? []) if (!seen.has(v)) { seen.add(v); stack.push(v); }
    }
    return this.order.filter((x) => seen.has(x));
  }

  /** Set an input and propagate with early cutoff. */
  set(id: string, value: Value, causeEventId?: string): PropagationWitness {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`unknown node ${id}`);
    if (node.compute) throw new Error(`${id} is derived; only inputs can be set`);
    const eq = node.equals ?? defaultEq;
    const borne = this.cone(id);
    const w: PropagationWitness = { cause: id, causeEventId, borne, recomputed: [], moved: [], cutoff: [], values: {} };
    if (eq(this.values.get(id)!, value)) { this.witnesses.push(w); return w; }
    this.values.set(id, value);
    const dirty = new Set<string>(this.dependents.get(id) ?? []);
    for (const n of borne) {
      if (!dirty.has(n)) continue;
      const nd = this.nodes.get(n)!;
      const next = nd.compute!((x) => this.get(x));
      w.recomputed.push(n);
      if ((nd.equals ?? defaultEq)(this.values.get(n)!, next)) { w.cutoff.push(n); continue; }
      this.values.set(n, next);
      w.moved.push(n);
      w.values[n] = next;
      for (const d of this.dependents.get(n) ?? []) dirty.add(d);
    }
    this.witnesses.push(w);
    return w;
  }

  /** Kahn topological order over all nodes (verification of acyclicity). */
  topological(): string[] {
    const indeg = new Map<string, number>();
    for (const n of this.nodes.values()) indeg.set(n.id, n.deps.length);
    const q = [...this.nodes.keys()].filter((k) => indeg.get(k) === 0);
    const out: string[] = [];
    while (q.length) {
      const u = q.shift()!;
      out.push(u);
      for (const v of this.dependents.get(u) ?? []) { indeg.set(v, indeg.get(v)! - 1); if (indeg.get(v) === 0) q.push(v); }
    }
    return out;
  }

  snapshot(): Record<string, Value> { return Object.fromEntries(this.values); }
  size(): number { return this.nodes.size; }
}
