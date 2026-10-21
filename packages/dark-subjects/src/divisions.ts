// The six division adapters wired to the shared world authority, plus the
// UniversityResearchContribution record. Each adapter is small and concrete:
// it proposes a candidate, admits it through its own predicate, commits through
// WorldAuthority and projects bounded cues. [C] DARK construction.

import { checkPlan, compileProgram, BorneGraph, Clock9Proposer, NGramModel, type MotionState, type PlanStep, type Realizer, type WorldEvent } from '@dark/core';
import { cuesFor } from '@dark/somatostratum';
import { chooseLod } from './geometry';
import { composeFacade, type FacadeInput } from './facade';
import { motif } from './music';
import type { WorldSubjectAdapter } from './adapter';
import subjects from './university-subjects.json';

export const UNIVERSITY_COMMIT: string = (subjects as { commit: string }).commit;
const REV = `abedkadaancom@${UNIVERSITY_COMMIT.slice(0, 12)}`;

export function motionAdapter(realizer: () => Realizer, actor = 'player'): WorldSubjectAdapter<{ start: MotionState; plan: PlanStep[]; label: string }, ReturnType<typeof checkPlan> & { label: string; plan: PlanStep[] }> {
  return {
    subjectId: 'operational-grammar', divisionId: 'foundations', sourceRevision: REV, version: '1',
    inputAlphabet: ['WALK', 'OPEN_DOOR', 'PASS_DOOR', 'CLOSE_DOOR', 'ENTER_VEHICLE', 'SIT', 'RIDE', 'STAND', 'EXIT_VEHICLE', 'TALK', 'CHECK_IN', 'BOARD', 'DISEMBARK', 'WAIT'],
    stateSchema: 'MotionState', observables: ['admissible', 'realizable', 'failedAt'], physicalUnits: {}, computationalBudget: { maxMsPerCall: 4, maxItems: 64 },
    verification: 'checkPlan: DFA acceptance ∧ Rapier/nav realizability', provenance: 'CGT-DEF-003 two-layer check (Bridge Grammar)',
    observability: { input: 'action word + live collider/nav predicates', derived: 'DFA state path', witness: 'plan executed or refused in HUD', quantitativeTest: 'core.test.ts MotionAndEventGrammar', perceptualReview: 'character never walks through closed doors' },
    propose: (i) => ({ ...checkPlan(i.start, i.plan, realizer()), label: i.label, plan: i.plan }),
    admit: (c) => (c.accepted ? { ok: true, event: { type: 'PLAN_ADMITTED', actor, payload: { label: c.label, states: c.states, steps: c.plan.map((p) => p.action) } } } : { ok: false, reason: c.reason }),
  };
}

export function facadeAdapter(actor = 'system'): WorldSubjectAdapter<FacadeInput[], ReturnType<typeof composeFacade>[]> {
  return {
    subjectId: 'plicastratum', divisionId: 'relational', sourceRevision: REV, version: '1',
    inputAlphabet: ['plinth', 'shopfront', 'door', 'awning', 'sign', 'window', 'balcony', 'blank', 'cornice', '|'], stateSchema: 'FacadeProgram[]',
    observables: ['unique programs', 'grammar size', 'unfold identity'], physicalUnits: { bayWidth: 'm', floorHeight: 'm' }, computationalBudget: { maxMsPerCall: 40, maxItems: 600 },
    verification: 'unfold(fold(program)) = program for every façade', provenance: 'Re-Pair SLP (Larsson & Moffat 2000) via university fold.ts',
    observability: { input: 'OSM footprint frontage + district id', derived: 'bay word + palette', witness: 'distinct façades on real footprints', quantitativeTest: 'subjects.test.ts FacadeGrammar', perceptualReview: 'neighbouring districts read as different places' },
    propose: (inputs) => inputs.slice(0, 600).map(composeFacade),
    admit: (progs) => (progs.every((p) => p.unfoldOk) ? { ok: true, event: { type: 'DISTRICT_COMPOSED', actor, payload: { count: progs.length, unique: new Set(progs.map((p) => p.signature)).size } } } : { ok: false, reason: 'a façade program failed unfold identity' }),
  };
}

export function signProgramAdapter(knownTargets: () => ReadonlySet<string>, actor: string, expectedRevision: () => number): WorldSubjectAdapter<string, ReturnType<typeof compileProgram>> {
  return {
    subjectId: 'purl', divisionId: 'languages', sourceRevision: REV, version: '1',
    inputAlphabet: ['START', 'COMMIT', 'TEXT', 'HUE', 'CHROMA', 'LIGHTNESS', 'BRIGHTNESS', 'PULSE', 'CHIME'], stateSchema: 'CompiledProgram',
    observables: ['admitted ops', 'diagnostics'], physicalUnits: { BRIGHTNESS: 'relative emissive 0..1', HUE: 'OKLCH degrees' }, computationalBudget: { maxMsPerCall: 2, maxItems: 16 },
    verification: 'compileProgram FSM + typed args + target existence', provenance: 'SEURL START…COMMIT discipline; university addressCompiler.ts',
    observability: { input: 'path program text', derived: 'typed op list', witness: 'sign text/colour/brightness change in the Three.js scene', quantitativeTest: 'core.test.ts WorldProgramCompiler', perceptualReview: 'change is legible and flash-safe' },
    propose: (address) => compileProgram(address, knownTargets()),
    admit: (p) => (p.ok ? { ok: true, event: { type: 'SIGN_LIGHT_SHIFT', actor, target: `${p.resource}/${p.target}`, expectedRevision: expectedRevision(), payload: { ops: p.ops, program: p.resource + '/' + p.target } } } : { ok: false, reason: p.diagnostics.join('; ') }),
  };
}

export function lodAdapter(actor = 'system'): WorldSubjectAdapter<{ distances: number[]; fov: number; viewport: number }, { levels: number[] }> {
  return {
    subjectId: 'imagistratum', divisionId: 'geometry', sourceRevision: REV, version: '1',
    inputAlphabet: ['distance', 'fov', 'viewport'], stateSchema: 'LOD level per building', observables: ['screen-space error px', 'declared loss'],
    physicalUnits: { distance: 'm', fov: 'deg', viewport: 'px' }, computationalBudget: { maxMsPerCall: 4, maxItems: 2000 },
    verification: 'SSE ≤ tolerance for every chosen level', provenance: 'Imagistratum filtration (house) + SSE (Cozzi & Ring)',
    observability: { input: 'camera distance per building', derived: 'LOD stratum', witness: 'building detail switches with declared loss', quantitativeTest: 'subjects.test.ts PerceptualLOD', perceptualReview: 'no visible popping near the player' },
    propose: (i) => ({ levels: i.distances.slice(0, 2000).map((d) => chooseLod(d, i.fov, i.viewport).level) }),
    admit: (c) => ({ ok: true, event: { type: 'LOD_ASSIGNED', actor, payload: { histogram: [0, 1, 2].map((l) => c.levels.filter((x) => x === l).length) } } }),
  };
}

export function acousticAdapter(actor = 'system'): WorldSubjectAdapter<{ eventId: string; type: string; tick: number; k: number; root: number }, { cues: ReturnType<typeof cuesFor>; notes: ReturnType<typeof motif> }> {
  return {
    subjectId: 'generative-composition', divisionId: 'acoustic', sourceRevision: REV, version: '1',
    inputAlphabet: ['interval k ∈ ℤ/12', 'root MIDI'], stateSchema: 'motif notes', observables: ['orbit length', 'note frequencies'],
    physicalUnits: { hz: 'Hz', t: 's' }, computationalBudget: { maxMsPerCall: 2, maxItems: 32 },
    verification: 'orbit length = 12/gcd(12,k); notes equal-tempered', provenance: 'university music.ts (Tymoczko, Lewin)',
    observability: { input: 'world event + interval', derived: 'scheduled notes/cues', witness: 'café motif heard from the café position', quantitativeTest: 'subjects.test.ts music', perceptualReview: 'motif is pleasant, not fatiguing' },
    propose: (i) => ({ cues: cuesFor({ id: i.eventId, type: i.type, tick: i.tick }), notes: motif(i.root, i.k) }),
    admit: (c) => ({ ok: true, event: { type: 'MUSIC_PROGRAM', actor, payload: { notes: c.notes.map((n) => n.midi) } } }),
  };
}

export function borneAdapter(graph: BorneGraph, actor = 'system'): WorldSubjectAdapter<{ input: string; value: number; causeEventId?: string }, ReturnType<BorneGraph['set']>> {
  return {
    subjectId: 'borne', divisionId: 'worlds', sourceRevision: REV, version: '1',
    inputAlphabet: ['rain', 'hour', 'signProgram'], stateSchema: 'BorneGraph values', observables: ['borne', 'recomputed', 'moved', 'cutoff'],
    physicalUnits: { rain: '0..1 intensity', hour: 'h' }, computationalBudget: { maxMsPerCall: 3, maxItems: 128 },
    verification: 'moved ⊆ recomputed ⊆ borne', provenance: 'BORNE (house, university world.ts) + Kahn order',
    observability: { input: 'environment change', derived: 'causal cone recomputation', witness: 'wet roads, splashing steps, headlights, NPCs shelter', quantitativeTest: 'core.test.ts BORNE', perceptualReview: 'effects appear together, coherently' },
    propose: (i) => graph.set(i.input, i.value, i.causeEventId),
    admit: (w) => (w.moved.every((m) => w.recomputed.includes(m)) && w.recomputed.every((r) => w.borne.includes(r)) ? { ok: true, event: { type: 'BORNE_PROPAGATED', actor, payload: { cause: w.cause, borne: w.borne, moved: w.moved, cutoff: w.cutoff } } } : { ok: false, reason: 'witness violates moved ⊆ recomputed ⊆ borne' }),
  };
}

/** CLOCK9 proposes sign programs; only compiler-admitted ones are returned. */
export function clock9SignProposer(target: string) {
  const corpus = [
    ['HUE:200', 'BRIGHTNESS:0.8'], ['HUE:30', 'BRIGHTNESS:0.6', 'CHIME:7'], ['TEXT:OPEN LATE', 'HUE:330'], ['HUE:150', 'CHROMA:0.12'],
    ['TEXT:WARM INSIDE', 'HUE:40', 'BRIGHTNESS:0.9'], ['HUE:260', 'PULSE:0.5'], ['TEXT:COFFEE · TEA', 'HUE:20'], ['HUE:200', 'CHIME:4'],
  ];
  const model = new NGramModel(2, 0.02).train(corpus);
  const proposer = new Clock9Proposer(model, 9);
  return (tick: number, known: ReadonlySet<string>) => {
    for (let attempt = 0; attempt < 9; attempt++) {
      const p = proposer.at(tick + attempt);
      const address = `v1:sign/${target}/START/${p.tokens.map((t) => { const i = t.indexOf(':'); return `${t.slice(0, i)}:${encodeURIComponent(t.slice(i + 1))}`; }).join('/')}${p.tokens.length ? '/' : ''}COMMIT`;
      const compiled = compileProgram(address, known);
      if (compiled.ok && compiled.ops.length > 0) return { address, compiled, proposal: p, attempts: attempt + 1 };
    }
    return null;
  };
}

// ---------------------------------------------------------------- research contribution record
export interface UniversityResearchContribution {
  experimentId: string;
  subjectId: string; divisionId: string; universityCommit: string; darkCommit: string;
  establishedReferences: string[]; constructionDefinition: string; hypothesisOrQuestion: string; algorithm: string;
  inputFixtureHashes: string[]; sourceCodePaths: string[]; runCommands: string[]; outputArtifacts: string[];
  measuredBeforeAfter: Record<string, unknown>; nullOrBaseline: string; limitations: string[];
  resultStatus: '[M] measured' | '[H] hypothesis' | '[R] refuted' | 'NOT_RUN';
  visualWitnesses: string[]; audioWitnesses: string[];
  proposer: 'Claude Code (implementing research agent)'; review: 'pending co-founder acceptance';
}

export type { WorldEvent };
