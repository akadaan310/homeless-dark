// dark-core/world: the single local world authority.
//
// propose -> admit -> commit -> project. Rendering, physics and audio are
// projections that subscribe to committed events; they never write state.
// [C] DARK construction over standard event sourcing with a hash-chained journal.

import { canonical, fingerprint } from './util';

export type Role = 'player' | 'npc' | 'system' | 'visitor' | 'agent';

export interface Actor { id: string; role: Role; displayName?: string }

export interface Entity<T = Record<string, unknown>> { id: string; kind: string; rev: number; data: T; source: 'verified' | 'derived' | 'authored' }

export interface WorldEvent<P = Record<string, unknown>> {
  type: string;
  actor: string;
  target?: string;
  payload: P;
  expectedRevision?: number; // optimistic concurrency on target
  causedBy?: string;
}

export interface CommittedEvent<P = Record<string, unknown>> extends WorldEvent<P> {
  id: string;
  seq: number;
  tick: number;
  worldTime: number; // seconds of world clock
  prevHash: string;
  hash: string;
}

export interface Refusal { ok: false; reason: string; witness: Record<string, unknown> }
export interface Admission<P> { ok: true; event: WorldEvent<P>; witness: Record<string, unknown> }

export interface EventRule<P = any> {
  type: string;
  roles: Role[]; // who may cause it
  validate(payload: unknown): string | null; // schema/type validation
  /** Domain admissibility against current state (grammar, resources). */
  admit?(world: WorldAuthority, ev: WorldEvent<P>): string | null;
  apply(world: WorldMutator, ev: CommittedEvent<P>): void;
  /** Resource budget: max commits per minute of world time for this actor. */
  budgetPerMinute?: number;
}

export interface WorldMutator {
  put(e: Entity): void;
  patch(id: string, data: Record<string, unknown>): void;
  remove(id: string): void;
  get(id: string): Entity | undefined;
}

export type Listener = (ev: CommittedEvent) => void;

export class WorldAuthority {
  private entities = new Map<string, Entity>();
  private actors = new Map<string, Actor>();
  private rules = new Map<string, EventRule>();
  private listeners = new Set<Listener>();
  private budgetLog = new Map<string, number[]>();
  readonly journal: CommittedEvent[] = [];
  tick = 0;
  worldTime = 0;
  head = 'genesis';
  refusals: { ev: WorldEvent; reason: string }[] = [];

  register(rule: EventRule): this { this.rules.set(rule.type, rule); return this; }
  addActor(a: Actor): this { this.actors.set(a.id, a); return this; }
  actor(id: string): Actor | undefined { return this.actors.get(id); }
  subscribe(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }

  /** Read-only inspection. Returns a deep copy; reading never mutates or advances anything. */
  inspect<T = Record<string, unknown>>(id: string): Entity<T> | undefined {
    const e = this.entities.get(id);
    return e ? (JSON.parse(JSON.stringify(e)) as Entity<T>) : undefined;
  }
  query(kind: string): Entity[] { return [...this.entities.values()].filter((e) => e.kind === kind).map((e) => JSON.parse(JSON.stringify(e))); }

  seed(e: Entity): void { this.entities.set(e.id, { ...e }); }

  advance(dtSeconds: number): void { this.tick++; this.worldTime += dtSeconds; }

  admit<P>(ev: WorldEvent<P>): Admission<P> | Refusal {
    const rule = this.rules.get(ev.type);
    if (!rule) return { ok: false, reason: `unknown event type ${ev.type}`, witness: { type: ev.type } };
    const actor = this.actors.get(ev.actor);
    if (!actor) return { ok: false, reason: `unknown actor ${ev.actor}`, witness: {} };
    if (!rule.roles.includes(actor.role)) return { ok: false, reason: `role ${actor.role} may not cause ${ev.type}`, witness: { allowed: rule.roles } };
    const schemaError = rule.validate(ev.payload);
    if (schemaError) return { ok: false, reason: `schema: ${schemaError}`, witness: { payload: ev.payload } };
    if (ev.target !== undefined && ev.expectedRevision !== undefined) {
      const cur = this.entities.get(ev.target)?.rev ?? 0;
      if (cur !== ev.expectedRevision) return { ok: false, reason: `stale revision: expected ${ev.expectedRevision}, current ${cur}`, witness: { current: cur } };
    }
    if (rule.budgetPerMinute !== undefined) {
      const key = `${ev.actor}|${ev.type}`;
      const recent = (this.budgetLog.get(key) ?? []).filter((t) => this.worldTime - t < 60);
      if (recent.length >= rule.budgetPerMinute) return { ok: false, reason: `budget: ${rule.budgetPerMinute}/min exhausted`, witness: { recent: recent.length } };
    }
    const domain = rule.admit?.(this, ev as WorldEvent<any>);
    if (domain) return { ok: false, reason: domain, witness: {} };
    return { ok: true, event: ev, witness: { rule: rule.type, actorRole: actor.role } };
  }

  /** Admit then commit. Refusals are recorded and returned, never thrown. */
  commit<P>(ev: WorldEvent<P>): CommittedEvent<P> | Refusal {
    const a = this.admit(ev);
    if (!a.ok) { this.refusals.push({ ev: ev as WorldEvent, reason: a.reason }); return a; }
    const rule = this.rules.get(ev.type)!;
    const seq = this.journal.length;
    const body = { ...ev, seq, tick: this.tick, worldTime: round6(this.worldTime) };
    const hash = fingerprint(this.head + canonical(body));
    const committed: CommittedEvent<P> = { ...body, id: `ev:${seq}:${hash.slice(0, 8)}`, prevHash: this.head, hash };
    rule.apply(this.mutator(), committed as CommittedEvent);
    if (rule.budgetPerMinute !== undefined) {
      const key = `${ev.actor}|${ev.type}`;
      this.budgetLog.set(key, [...(this.budgetLog.get(key) ?? []), this.worldTime]);
    }
    this.journal.push(committed as CommittedEvent);
    this.head = hash;
    for (const l of this.listeners) l(committed as CommittedEvent);
    return committed;
  }

  private mutator(): WorldMutator {
    return {
      put: (e) => this.entities.set(e.id, { ...e, rev: (this.entities.get(e.id)?.rev ?? 0) + 1 }),
      patch: (id, data) => {
        const e = this.entities.get(id);
        if (!e) throw new Error(`patch of missing entity ${id}`);
        this.entities.set(id, { ...e, rev: e.rev + 1, data: { ...e.data, ...data } });
      },
      remove: (id) => { this.entities.delete(id); },
      get: (id) => this.entities.get(id),
    };
  }

  snapshot(): WorldSnapshot {
    return JSON.parse(JSON.stringify({ schema: 'dark.world-snapshot/1', tick: this.tick, worldTime: this.worldTime, head: this.head, entities: [...this.entities.values()], journalLength: this.journal.length }));
  }

  restore(s: WorldSnapshot): void {
    if (s.schema !== 'dark.world-snapshot/1') throw new Error('unknown snapshot schema');
    this.entities = new Map(s.entities.map((e) => [e.id, e]));
    this.tick = s.tick; this.worldTime = s.worldTime; this.head = s.head;
  }
}

export interface WorldSnapshot { schema: 'dark.world-snapshot/1'; tick: number; worldTime: number; head: string; entities: Entity[]; journalLength: number }

/** Verify a journal's hash chain; returns index of the first broken link or -1. */
export function verifyJournal(journal: CommittedEvent[], genesis = 'genesis'): number {
  let head = genesis;
  for (let i = 0; i < journal.length; i++) {
    const { id: _id, prevHash, hash, ...rest } = journal[i]!;
    if (prevHash !== head) return i;
    if (fingerprint(head + canonical(rest)) !== hash) return i;
    head = hash;
  }
  return -1;
}

function round6(x: number) { return Math.round(x * 1e6) / 1e6; }
