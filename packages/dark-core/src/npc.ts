// dark-core/population: living NPC minds and the World Loom scheduler (Division VI).
//
// [C] DARK construction. Identities are stable ids; only active/focused agents
// update individually. Decisions are deterministic functions of (schedule,
// memory, relationship, environment) so they replay exactly. Utterances are
// chosen from authored speech acts, never generated physical facts.

export type Activity = 'work' | 'talk' | 'coffee' | 'walk' | 'rest' | 'shelter' | 'travel';

export interface ScheduleEntry { from: number; to: number; activity: Activity; place: string }

export interface NpcMind {
  id: string;
  name: string;
  role: string;
  schedule: ScheduleEntry[];
  memory: { tick: number; fact: string; about?: string }[];
  relationship: Record<string, number>; // -1..1 towards other actor ids
  busyUntil: number; // world seconds
  fictional: true;
}

export interface NpcContext { hour: number; worldTime: number; raining: boolean; playerDistance: number; playerId: string }

export interface NpcIntent { activity: Activity; place: string; speechAct?: string; reason: string }

export function scheduled(m: NpcMind, hour: number): ScheduleEntry {
  const h = ((hour % 24) + 24) % 24;
  return m.schedule.find((s) => (s.from <= s.to ? h >= s.from && h < s.to : h >= s.from || h < s.to)) ?? { from: 0, to: 24, activity: 'rest', place: 'home' };
}

export function decide(m: NpcMind, c: NpcContext): NpcIntent {
  const s = scheduled(m, c.hour);
  if (c.raining && (s.activity === 'walk' || s.activity === 'talk')) return { activity: 'shelter', place: 'awning', reason: 'rain: outdoor activity moves under cover (BORNE weather dependency)' };
  if (c.playerDistance < 4 && c.worldTime >= m.busyUntil && (m.relationship[c.playerId] ?? 0) >= 0) {
    const met = m.memory.some((x) => x.about === c.playerId);
    return { activity: s.activity, place: s.place, speechAct: met ? 'socialize' : 'greeting', reason: met ? 'recognizes the player from memory' : 'first encounter' };
  }
  return { activity: s.activity, place: s.place, reason: `schedule ${s.from}-${s.to}h` };
}

/** Ride offer: NPC autonomy — accept, decline or refuse with an authored act. */
export function respondToRide(m: NpcMind, c: NpcContext): { accepted: boolean; speechAct: string; reason: string } {
  const s = scheduled(m, c.hour);
  const rel = m.relationship[c.playerId] ?? 0;
  if (c.worldTime < m.busyUntil) return { accepted: false, speechAct: 'continue_task', reason: 'busy with a commitment' };
  if (s.activity === 'work') return { accepted: false, speechAct: 'decline_ride', reason: 'scheduled to work now' };
  if (rel < 0.2) return { accepted: false, speechAct: 'refuse_ride', reason: `relationship ${rel.toFixed(2)} below trust threshold 0.20` };
  return { accepted: true, speechAct: 'pair_reply', reason: 'free time and sufficient trust' };
}

export function remember(m: NpcMind, tick: number, fact: string, about?: string, delta = 0): NpcMind {
  const rel = { ...m.relationship };
  if (about) rel[about] = Math.max(-1, Math.min(1, (rel[about] ?? 0) + delta));
  return { ...m, memory: [...m.memory.slice(-31), { tick, fact, about }], relationship: rel };
}

// ---------------------------------------------------------------- World Loom scheduler
export type Tier = 'virtual' | 'cohort' | 'active' | 'focused';

export interface LoomAgent { id: string; x: number; z: number; causallyRelevant: boolean }

export interface LoomBudget { focusedRadius: number; activeRadius: number; cohortRadius: number; maxActive: number }

/** Assign tiers; individually updated agents never exceed maxActive (closest/causal first). */
export function assignTiers(agents: LoomAgent[], px: number, pz: number, b: LoomBudget): Map<string, Tier> {
  const scored = agents.map((a) => ({ a, d: Math.hypot(a.x - px, a.z - pz) })).sort((p, q) => (Number(q.a.causallyRelevant) - Number(p.a.causallyRelevant)) || p.d - q.d);
  const out = new Map<string, Tier>();
  let active = 0;
  for (const { a, d } of scored) {
    let t: Tier = d <= b.focusedRadius ? 'focused' : d <= b.activeRadius || a.causallyRelevant ? 'active' : d <= b.cohortRadius ? 'cohort' : 'virtual';
    if (t === 'focused' || t === 'active') { if (active >= b.maxActive) t = d <= b.cohortRadius ? 'cohort' : 'virtual'; else active++; }
    out.set(a.id, t);
  }
  return out;
}
