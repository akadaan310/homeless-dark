// dark-subjects: one subject-agnostic computational interface for all six
// Substrate University divisions. [C] DARK construction (constitution v3 §II-A.B).
//
//   propose(input, W)  → candidate intent        (pure)
//   admit(candidate, W) → verdict + witness       (grammar/resources/authority)
//   commit             → WorldAuthority.commit    (the ONLY state change)
//   project(committed) → render/physics/audio cues (never writes state)
//
// Every committed effect keeps a bidirectional trace: effect → program → actor →
// verification predicate, and program → bounded projections.

import type { WorldAuthority, CommittedEvent, WorldEvent } from '@dark/core';

export type DivisionId = 'foundations' | 'relational' | 'languages' | 'geometry' | 'acoustic' | 'worlds';

export interface Observability { input: string; derived: string; witness: string; quantitativeTest: string; perceptualReview: string }

export interface WorldSubjectAdapter<I = unknown, C = unknown, P = unknown> {
  subjectId: string;
  divisionId: DivisionId;
  sourceRevision: string;
  inputAlphabet: string[];
  stateSchema: string;
  observables: string[];
  physicalUnits: Record<string, string>;
  computationalBudget: { maxMsPerCall: number; maxItems: number };
  verification: string; // named predicate / test
  provenance: string;
  version: string;
  observability: Observability;
  propose(input: I): C;
  admit(candidate: C): { ok: true; event: WorldEvent } | { ok: false; reason: string };
  project?(ev: CommittedEvent): P;
}

export interface TraceRecord {
  subjectId: string;
  divisionId: DivisionId;
  input: unknown;
  candidate: unknown;
  verdict: 'admitted' | 'refused' | 'over-budget';
  reason?: string;
  committedEventId?: string;
  projection?: unknown;
  ms: number;
}

export class SubjectRegistry {
  private adapters = new Map<string, WorldSubjectAdapter<any, any, any>>();
  readonly traces: TraceRecord[] = [];
  constructor(private world: WorldAuthority) {}

  register(a: WorldSubjectAdapter<any, any, any>): this { this.adapters.set(a.subjectId, a); return this; }
  get(id: string) { return this.adapters.get(id); }
  list() { return [...this.adapters.values()]; }

  /** Run the full pipeline for one subject; returns the trace (also retained). */
  run<I>(subjectId: string, input: I): TraceRecord {
    const a = this.adapters.get(subjectId);
    if (!a) throw new Error(`no adapter ${subjectId}`);
    const t0 = now();
    const candidate = a.propose(input);
    const v = a.admit(candidate);
    const ms = now() - t0;
    const base = { subjectId, divisionId: a.divisionId, input, candidate, ms };
    if (ms > a.computationalBudget.maxMsPerCall) return this.keep({ ...base, verdict: 'over-budget', reason: `${ms.toFixed(2)} ms > ${a.computationalBudget.maxMsPerCall} ms` });
    if (!v.ok) return this.keep({ ...base, verdict: 'refused', reason: v.reason });
    const committed = this.world.commit(v.event);
    if (!('hash' in committed)) return this.keep({ ...base, verdict: 'refused', reason: committed.reason });
    const projection = a.project?.(committed);
    return this.keep({ ...base, verdict: 'admitted', committedEventId: committed.id, projection });
  }

  /** Effect → source: find the trace that produced a committed event. */
  explain(eventId: string): TraceRecord | undefined { return this.traces.find((t) => t.committedEventId === eventId); }

  private keep(t: TraceRecord): TraceRecord {
    this.traces.push(t);
    if (this.traces.length > 500) this.traces.shift();
    return t;
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
