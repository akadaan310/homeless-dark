// dark-core/grammar: MotionAndEventGrammar (Division I, Foundations of Computation).
//
// [K] finite automata and product-graph breadth-first search.
// [C] the university's two-layer check (Bridge Grammar, CGT-DEF-003): a plan is
//     ADMISSIBLE when its action word is accepted by the DFA, and REALIZABLE when
//     every step exists in the current physical structure (nav graph edges that
//     are unobstructed, colliders and seats that exist). Both are required; a
//     refusal returns the exact failing step as witness. Admissibility is not
//     shortest-path optimality.

export type MotionAction =
  | 'WALK' | 'OPEN_DOOR' | 'PASS_DOOR' | 'CLOSE_DOOR' | 'ENTER_VEHICLE' | 'SIT' | 'RIDE' | 'STAND' | 'EXIT_VEHICLE'
  | 'TALK' | 'CHECK_IN' | 'BOARD' | 'DISEMBARK' | 'WAIT';

export type MotionState = 'street' | 'at_door' | 'door_open' | 'interior' | 'at_vehicle' | 'in_vehicle' | 'seated' | 'riding' | 'terminal' | 'aboard' | 'dead';

/** Deterministic transition table δ: Q × Σ → Q (missing entries go to dead). */
export const MOTION_DFA: Record<Exclude<MotionState, 'dead'>, Partial<Record<MotionAction, MotionState>>> = {
  street: { WALK: 'street', TALK: 'street', WAIT: 'street', OPEN_DOOR: 'door_open', ENTER_VEHICLE: 'in_vehicle', CHECK_IN: 'terminal' },
  at_door: { OPEN_DOOR: 'door_open', WALK: 'street' },
  door_open: { PASS_DOOR: 'interior', CLOSE_DOOR: 'street', WALK: 'street', ENTER_VEHICLE: 'in_vehicle' },
  interior: { WALK: 'interior', TALK: 'interior', SIT: 'seated', OPEN_DOOR: 'door_open', WAIT: 'interior' },
  at_vehicle: { ENTER_VEHICLE: 'in_vehicle' },
  in_vehicle: { SIT: 'seated', EXIT_VEHICLE: 'street', CLOSE_DOOR: 'in_vehicle' },
  seated: { RIDE: 'riding', STAND: 'interior', EXIT_VEHICLE: 'street', TALK: 'seated', WAIT: 'seated' },
  riding: { RIDE: 'riding', STAND: 'in_vehicle', EXIT_VEHICLE: 'street', TALK: 'riding', WAIT: 'riding' },
  terminal: { WALK: 'terminal', TALK: 'terminal', WAIT: 'terminal', SIT: 'seated', BOARD: 'aboard' },
  aboard: { SIT: 'seated', WALK: 'aboard', DISEMBARK: 'street' },
};

export const ACCEPTING: ReadonlySet<MotionState> = new Set(['street', 'interior', 'seated', 'riding', 'terminal', 'aboard', 'in_vehicle']);

export function step(q: MotionState, a: MotionAction): MotionState {
  if (q === 'dead') return 'dead';
  return MOTION_DFA[q][a] ?? 'dead';
}

export interface PlanStep { action: MotionAction; edge?: string; target?: string }

/** The physical structure a plan must be realizable in (injected from Rapier/nav state). */
export interface Realizer {
  edgeOpen(edgeId: string): { ok: boolean; reason?: string };
  targetReady(targetId: string, action: MotionAction): { ok: boolean; reason?: string };
}

export interface PlanVerdict {
  admissible: boolean;
  realizable: boolean;
  accepted: boolean;
  states: MotionState[];
  failedAt: number | null;
  reason: string;
}

export function checkPlan(start: MotionState, plan: PlanStep[], world: Realizer): PlanVerdict {
  const states: MotionState[] = [start];
  let q = start;
  let failedAt: number | null = null;
  let reason = 'accepted';
  let realizable = true;
  for (let i = 0; i < plan.length; i++) {
    const s = plan[i]!;
    q = step(q, s.action);
    states.push(q);
    if (q === 'dead' && failedAt === null) { failedAt = i; reason = `step ${i} ${s.action} is not admissible from ${states[i]}`; }
    if (s.edge) {
      const r = world.edgeOpen(s.edge);
      if (!r.ok && realizable) { realizable = false; if (failedAt === null) { failedAt = i; reason = `step ${i} ${s.action}: edge ${s.edge} not realizable (${r.reason ?? 'blocked'})`; } }
    }
    if (s.target) {
      const r = world.targetReady(s.target, s.action);
      if (!r.ok && realizable) { realizable = false; if (failedAt === null) { failedAt = i; reason = `step ${i} ${s.action}: target ${s.target} not ready (${r.reason ?? 'unavailable'})`; } }
    }
  }
  const admissible = ACCEPTING.has(q) && !states.includes('dead');
  return { admissible, realizable, accepted: admissible && realizable, states, failedAt, reason: admissible && realizable ? 'accepted: admissible and realizable' : reason };
}

/** A navigation graph: nodes with an associated motion context and labelled edges. */
export interface NavNode { id: string; x: number; z: number }
export interface NavEdge { id: string; from: string; to: string; action: MotionAction; cost: number }

/**
 * Product-state planner over (nav node × DFA state). Breadth-first by number of
 * actions with Dijkstra on cost; returns the cheapest ADMISSIBLE and REALIZABLE
 * plan from (start, q0) to the goal node in an accepting state, or null.
 */
export function planProduct(nodes: NavNode[], edges: NavEdge[], startNode: string, q0: MotionState, goalNode: string, world: Realizer, maxExpansions = 20000): { plan: PlanStep[]; cost: number; expansions: number } | null {
  const key = (n: string, q: MotionState) => `${n}|${q}`;
  const dist = new Map<string, number>([[key(startNode, q0), 0]]);
  const prev = new Map<string, { k: string; edge: NavEdge }>();
  const open: { k: string; n: string; q: MotionState; c: number }[] = [{ k: key(startNode, q0), n: startNode, q: q0, c: 0 }];
  const out = new Map<string, NavEdge[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  let expansions = 0;
  while (open.length && expansions < maxExpansions) {
    open.sort((a, b) => a.c - b.c);
    const cur = open.shift()!;
    expansions++;
    if (cur.c > (dist.get(cur.k) ?? Infinity)) continue;
    if (cur.n === goalNode && ACCEPTING.has(cur.q)) {
      const plan: PlanStep[] = [];
      let k = cur.k;
      while (prev.has(k)) { const p = prev.get(k)!; plan.unshift({ action: p.edge.action, edge: p.edge.id }); k = p.k; }
      return { plan, cost: cur.c, expansions };
    }
    for (const e of out.get(cur.n) ?? []) {
      const q2 = step(cur.q, e.action);
      if (q2 === 'dead') continue;
      if (!world.edgeOpen(e.id).ok) continue;
      const k2 = key(e.to, q2);
      const c2 = cur.c + e.cost;
      if (c2 < (dist.get(k2) ?? Infinity)) {
        dist.set(k2, c2);
        prev.set(k2, { k: cur.k, edge: e });
        open.push({ k: k2, n: e.to, q: q2, c: c2 });
      }
    }
  }
  return null;
}
