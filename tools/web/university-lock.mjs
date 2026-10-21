// Pin the Substrate University source, inventory every registered topic and
// record reference outputs of its executable math for DARK port-equivalence tests.
//
//   UNIVERSITY_REPO=/path/to/abedkadaancom npm run university
//
// Reads only. Writes (in this repository):
//   university-source.lock.json
//   docs/research/university-subject-matrix.md
//   packages/dark-subjects/src/university-subjects.json   (compact certified metadata)
//   packages/dark-subjects/test/fixtures/university-math.json

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const U = process.env.UNIVERSITY_REPO ?? path.resolve(ROOT, '../abedkadaancom');
const git = (...a) => execFileSync('git', ['-C', U, ...a], { encoding: 'utf8' }).trim();
const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

async function load(entry) {
  const r = await build({ entryPoints: [path.join(U, entry)], bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}

const head = git('rev-parse', 'HEAD');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
let remoteDefault = null;
try { remoteDefault = git('rev-parse', 'origin/claude/new-session-xd8auu'); } catch { /* absent */ }
const remoteUrl = git('config', '--get', 'remote.origin.url').replace(/\/\/[^@]*@/, '//');

const FILES = [
  'src/content/registry.ts', 'src/content/types.ts', 'src/content/glossary.ts', 'src/content/sources.ts', 'src/content/cgt.ts',
  ...['foundations', 'relational', 'languages', 'geometry', 'acoustic', 'worlds'].map((d) => `src/content/topics/${d}.ts`),
  ...['matrix', 'rational', 'bridgeGrammar', 'fold', 'addressCompiler', 'music', 'paths', 'sky', 'world', 'numberSystems'].map((m) => `src/math/${m}.ts`),
  'src/exhibits/compute.ts', 'src/exhibits/records.ts', 'src/books/compose.ts',
  'src/pages/Library.tsx', 'src/pages/Scriptorium.tsx', 'src/pages/Harness.tsx',
  'src/scene/CampusCanvas.tsx', 'src/scene/Architecture.tsx', 'src/scene/Realms.tsx',
  'tests/math.test.ts', 'tests/registry.test.ts',
].filter((f) => fs.existsSync(path.join(U, f)));

const { DIVISIONS, TOPICS } = await load('src/content/registry.ts');

// DARK adapter mapping. status: 'witnessed' = executable adapter + test + in-game witness;
// 'tested' = executable adapter + unit test, no in-game witness yet; 'proposed' = not implemented.
const MAP = {
  'transition-systems': ['dark-core/grammar MotionAndEventGrammar', 'NPC/player action admission (door, seat, ride)', 'core.test.ts › MotionAndEventGrammar', 'witnessed'],
  'finite-automata': ['dark-core/grammar MOTION_DFA', 'refused actions never reach Rapier', 'core.test.ts › inadmissible words', 'witnessed'],
  'operational-grammar': ['dark-core/grammar checkPlan (admissible × realizable)', 'car boarding plan checked against live colliders', 'core.test.ts › door→street→seat→ride→exit', 'witnessed'],
  admissibility: ['dark-core/grammar + WorldAuthority.admit', 'refusal witness shown in event log', 'core.test.ts › world authority', 'witnessed'],
  'graph-theory': ['dark-core/grammar planProduct (nav × DFA)', 'NPC route choice around blocked edges', 'core.test.ts › product planner', 'tested'],
  perturbation: ['dark-core/grammar realizer perturbation', 'blocked door / missing seat rejection', 'core.test.ts › rejects broken street', 'tested'],
  'equivalence-classes': ['dark-core/folds encodeRoute (turn/length classes)', 'route symbols invariant to rotation/translation', 'core.test.ts › route encoding', 'tested'],
  complexity: ['dark-core/grammar planProduct expansion budget', 'bounded planner cost per frame', 'core.test.ts › product planner (expansions)', 'tested'],
  'numerical-grammars': [null, 'no direct rendering relevance identified yet', null, 'proposed'],
  'substrate-theory': [null, 'house framework; no executable kernel in the university source', null, 'proposed'],
  'alphabets-words': ['dark-core/folds token words', 'façade programs as words', 'core.test.ts › Plicastratum', 'witnessed'],
  'generative-grammars': ['dark-subjects/facade FacadeGrammar', 'storefront compositions on real footprints', 'subjects.test.ts › FacadeGrammar', 'witnessed'],
  plicastratum: ['dark-core/folds Re-Pair SLP + ScenePlicaRegistry', 'promoted shopfront macro reused across district', 'subjects.test.ts › port equivalence fold', 'witnessed'],
  'alphabet-towers': ['dark-core/folds strata (rule levels)', 'fold strata reported in research overlay', 'core.test.ts › Plicastratum', 'tested'],
  ingrammatica: ['dark-core/folds ScenePlicaRegistry gates', 'motif admitted only with provenance/licence', 'core.test.ts › promotion', 'tested'],
  'constructive-admission': ['dark-core/folds promote() held-out test', 'no unproven macro reaches the scene', 'core.test.ts › promotion', 'tested'],
  'relational-generativity': ['dark-subjects/facade DistrictPaletteGrammar (interval orbit hues)', 'neighbouring districts differ in palette', 'subjects.test.ts › districts differ', 'witnessed'],
  'modal-cyclic': ['dark-subjects/music interval orbit ⟨k⟩ ⊆ ℤ/12', 'café motif cycle and sign hue cycle', 'subjects.test.ts › port equivalence music', 'witnessed'],
  'recursive-folds': ['dark-core/folds expand() with finite budget', 'bounded unfold of scene programs', 'core.test.ts › Plicastratum', 'tested'],
  'compositional-forms': [null, 'candidate for street-corner composition', null, 'proposed'],
  'uri-grammar': ['dark-core/program WorldProgramCompiler tokenizer', 'sign programs typed in-world', 'core.test.ts › WorldProgramCompiler', 'witnessed'],
  purl: ['dark-core/program PURL-like path programs (no scheme registered)', 'NPC sign change compiled before GPU update', 'core.test.ts › WorldProgramCompiler', 'witnessed'],
  seurl: ['dark-core/program START…COMMIT protocol + effect declaration', 'SIGN_LIGHT_SHIFT effect projections', 'core.test.ts › WorldProgramCompiler', 'witnessed'],
  'typed-machines': ['dark-core/program FSM idle→open→committed', 'rejected programs never execute', 'core.test.ts › protocol violations', 'witnessed'],
  'types-as-admissibility': ['dark-core/program typed args', 'out-of-range/unsafe flash rejected', 'core.test.ts › flash-unsafe', 'tested'],
  compilation: ['dark-core/program compile/format/unfold', 'canonical round trip', 'core.test.ts › round-trips canonically', 'tested'],
  'matrix-loom': ['dark-subjects/matrixLoom (port of loom:// compiler)', 'plate rewrite transform of a district overlay', 'subjects.test.ts › port equivalence address compiler', 'witnessed'],
  'grammars-as-programs': ['dark-core/program + CLOCK9 proposals', 'CLOCK9 proposes, compiler admits', 'core.test.ts › CLOCK9', 'witnessed'],
  'symbolic-composition': ['dark-core/program op composition', 'multi-op sign programs', 'core.test.ts › WorldProgramCompiler', 'tested'],
  'addressable-forms': [null, 'candidate: addressable world objects inspector', null, 'proposed'],
  'image-kernel': ['dark-subjects/lod projection-loss declarations', 'LOD levels declare what is lost', 'subjects.test.ts › PerceptualLOD', 'tested'],
  imagistratum: ['dark-subjects/lod PerceptualLOD strata', 'distance-dependent building detail', 'subjects.test.ts › PerceptualLOD', 'witnessed'],
  'rank-nullity': ['dark-subjects/lod (rank of projection)', 'documented loss of depth in camera stratum', 'subjects.test.ts › PerceptualLOD', 'tested'],
  'projective-camera': ['dark-subjects/lod screen-space error + frustum salience', 'sign legibility from camera matrix', 'subjects.test.ts › salience', 'witnessed'],
  topology: [null, 'candidate: nav graph connectivity checks', null, 'proposed'],
  curvature: ['dark-geo geodesicDistance (Vincenty on ellipsoid)', 'flight distances and great-circle tracks', 'geo.test.ts › Vincenty', 'witnessed'],
  'spatial-tensors': ['dark-geo ENU basis', 'local tangent frame for physics/render', 'geo.test.ts › ENU round trip', 'witnessed'],
  'computational-photography': ['visual-grammar adaptExposure + tone mapping', 'bounded exposure through day→night', 'chromastratum.test.ts › exposure', 'witnessed'],
  'celestial-geometry': ['dark-geo solar/moon position', 'sun direction and shadows follow time/lat/lon', 'geo.test.ts › solar ephemeris', 'witnessed'],
  'chart-correspondences': ['dark-geo WGS84↔ECEF↔ENU, floating origin', 'continent transfer without precision loss', 'geo.test.ts › WGS84 round trips', 'witnessed'],
  'rendering-mathematics': ['visual-grammar color (sRGB, OKLCH, ΔE2000)', 'linear workflow, sign colours via OKLCH gamut map', 'chromastratum.test.ts › linear colour gate', 'witnessed'],
  'invisible-sensing': [null, 'candidate: audio-only navigation cues', null, 'proposed'],
  'sound-signals': ['apps/homeless-web audio synth (Web Audio)', 'footsteps/rain/engine synthesized from events', 'e2e audio graph witness', 'witnessed'],
  'pitch-frequency': ['dark-subjects/music frequency()', 'café motif pitches', 'subjects.test.ts › port equivalence music', 'witnessed'],
  'interval-geometry': ['dark-subjects/music orbit()', 'motif cycle length = 12/gcd(12,k)', 'subjects.test.ts › port equivalence music', 'witnessed'],
  tuning: ['dark-subjects/music cents()', 'equal-temperament motif', 'subjects.test.ts › music', 'tested'],
  fourier: ['apps/homeless-web AnalyserNode spectral witness', 'rain vs dry spectral centroid', 'e2e spectral witness', 'tested'],
  'time-frequency': [null, 'candidate: onset detection for sync audits', null, 'proposed'],
  synthesis: ['dark-somatostratum footstepFor/engineTone', 'surface-specific synthesis', 'somato.test.ts › six surfaces', 'witnessed'],
  phase: [null, 'no phase-specific adapter yet', null, 'proposed'],
  phonogrammatica: [null, 'voices use existing eSpeak NG lines; no vocal-expression math ported', null, 'proposed'],
  'generative-composition': ['dark-subjects/music MusicClock', 'café music program changed by CLOCK9', 'subjects.test.ts › MusicClock', 'witnessed'],
  'cellular-automata': ['dark-subjects/loom weave() (port)', 'night window-light pattern of façades', 'subjects.test.ts › port equivalence world loom', 'witnessed'],
  'world-loom': ['dark-core/npc assignTiers + dark-subjects/loom', 'only active agents simulated individually', 'core.test.ts › tiering', 'witnessed'],
  'agent-grammars': ['dark-core/npc decide/respondToRide', 'NPC schedules, shelter in rain, refusals', 'core.test.ts › NPC minds', 'witnessed'],
  'procedural-environments': ['dark-subjects/facade', 'district composition', 'subjects.test.ts › FacadeGrammar', 'witnessed'],
  'world-models': ['dark-core/world WorldAuthority', 'single committed authority, projections only render', 'core.test.ts › world authority', 'witnessed'],
  'glm-lgm': [null, 'no executable kernel in source', null, 'proposed'],
  borne: ['dark-core/borne BorneGraph', 'RAIN_START cone: wetness → roughness, footsteps, headlights, NPC shelter', 'core.test.ts › BORNE', 'witnessed'],
  'maps-navigation': ['dark-geo + dark-travel', 'world selector, airports, great-circle flights', 'travel.test.ts', 'witnessed'],
  'simulated-populations': ['dark-core/npc tiers (identity capacity ≠ active minds)', 'bounded active NPC count', 'core.test.ts › tiering', 'tested'],
  'homeless-dark': ['apps/homeless-web', 'the game', 'e2e', 'witnessed'],
};

const fileHashes = Object.fromEntries(FILES.map((f) => [f, sha(path.join(U, f))]));
const subjects = TOPICS.map((t) => {
  const [adapter, relevance, fixture, status] = MAP[t.id] ?? [null, 'unmapped', null, 'proposed'];
  return {
    id: t.id, division: t.division, title: t.title, subject: t.subject, level: t.level, epistemic: t.status, sourceStatus: t.sourceStatus,
    domainAdapter: t.domainAdapter, prerequisites: t.prerequisites, transformations: t.transformations,
    definitions: t.definitions.map((d) => ({ term: d.term, status: d.status })), sources: t.sources.map((s) => s.title),
    challenge: t.challenge.prompt,
    location: `src/content/topics/${t.division}.ts`, dark: { adapter, relevance, fixture, status },
  };
});

const lock = {
  schema: 'dark.university-source-lock/1',
  repository: remoteUrl, branch, defaultBranchObserved: 'claude/new-session-xd8auu', commit: head, defaultBranchCommit: remoteDefault,
  inspected: new Date().toISOString(),
  note: 'Read-only pin. Topic statuses are the university\'s own labels; DARK statuses describe only this repository\'s adapters.',
  divisions: DIVISIONS.map((d) => ({ id: d.id, numeral: d.numeral, name: d.name, curriculum: d.curriculum })),
  topicCount: TOPICS.length,
  files: fileHashes,
  subjects: subjects.map((s) => ({ id: s.id, division: s.division, epistemic: s.epistemic, location: s.location, darkStatus: s.dark.status })),
};
fs.writeFileSync(path.join(ROOT, 'university-source.lock.json'), JSON.stringify(lock, null, 1) + '\n');
fs.writeFileSync(path.join(ROOT, 'packages/dark-subjects/src/university-subjects.json'), JSON.stringify({ commit: head, subjects: subjects.map((s) => ({ id: s.id, division: s.division, title: s.title, epistemic: s.epistemic, darkAdapter: s.dark.adapter, darkStatus: s.dark.status })) }, null, 1) + '\n');

// ---------------------------------------------------------------- matrix document
const EPI = { established: '[K] established', house: '[C] house construction', conjecture: '[H] conjecture', application: 'application', mythology: 'campus fiction' };
let md = `# Substrate University → DARK subject matrix\n\nGenerated by \`npm run university\` from the live registry. Do not edit by hand.\n\n- Source: ${remoteUrl}\n- Branch inspected: \`${branch}\` at \`${head}\` (default branch \`claude/new-session-xd8auu\` at \`${remoteDefault}\`)\n- Topics registered: **${TOPICS.length}** across ${DIVISIONS.length} divisions\n- Status legend: **witnessed** = executable DARK adapter + unit test + visible/audible in-game effect; **tested** = executable adapter + unit test, no in-game witness yet; **proposed** = not implemented.\n- Epistemic labels are the university's own. A DARK adapter never promotes a topic's status.\n\n`;
const counts = { witnessed: 0, tested: 0, proposed: 0 };
for (const d of DIVISIONS) {
  md += `## Division ${d.numeral} — ${d.name}\n\n| Topic | University label | Source | DARK adapter | Visual / physical / acoustic relevance | Fixture | Budget | Status |\n|---|---|---|---|---|---|---|---|\n`;
  for (const s of subjects.filter((x) => x.division === d.id)) {
    counts[s.dark.status]++;
    const budget = s.dark.status === 'proposed' ? '—' : 'bounded (see adapter)';
    md += `| \`${s.id}\` ${s.title} | ${EPI[s.epistemic] ?? s.epistemic} | \`${s.location}\` @${head.slice(0, 7)} | ${s.dark.adapter ?? '—'} | ${s.dark.relevance} | ${s.dark.fixture ?? '—'} | ${budget} | ${s.dark.status} |\n`;
  }
  md += '\n';
}
md += `## Totals\n\nwitnessed ${counts.witnessed} · tested ${counts.tested} · proposed ${counts.proposed} (of ${TOPICS.length})\n`;
fs.mkdirSync(path.join(ROOT, 'docs/research'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs/research/university-subject-matrix.md'), md);

// ---------------------------------------------------------------- reference outputs
const fold = await load('src/math/fold.ts');
const bridge = await load('src/math/bridgeGrammar.ts');
const addr = await load('src/math/addressCompiler.ts');
const music = await load('src/math/music.ts');
const world = await load('src/math/world.ts');
const words = ['abracadabra', 'mississippi', 'aaaaaaaa', 'shopawningshopawningdoor', 'abcabcabcabc'];
const fixtures = {
  universityCommit: head,
  fold: words.map((w) => { const f = fold.foldAll(fold.startFold(w)); return { word: w, rules: f.rules.map((r) => [r.left, r.right, r.count]), size: fold.grammarSize(f), unfold: fold.unfoldAll(f).join('') }; }),
  bridge: ['FRPG', 'FRPGAWF', 'FRPRF', 'FGA', 'RPAW'].map((w) => { const r = bridge.evaluateWord(w, bridge.INITIAL_BRIDGES); return { word: w, realizable: r.realizable, admissible: r.admissible, failedAt: r.failedAt }; }),
  address: ['loom://plate/START/ROTATE:90/SCALE:2/SHIFT:1,0/COMMIT', 'loom://plate/START/SHEAR:1%2F2/REFLECT:x/COMMIT', 'loom://plate/START/ROTATE:45/COMMIT', 'loom://plate/ROTATE:90/COMMIT', 'loom://plate/START/SCALE:3,1/ROTATE:270/SHIFT:-2,5/COMMIT'].map((a) => { const c = addr.compile(a); return { address: a, ok: c.ok, matrix: c.matrix ? c.matrix.map((r) => r.map((q) => q.toNumber())) : null, states: c.states }; }),
  music: [0, 1, 4, 5, 7, 9].map((k) => { const x = music.analyseInterval(k); return { k, orbit: x.orbit, orbitLength: x.orbitLength, hue: x.hue, centsDeviation: x.centsDeviation }; }),
  frequency: [57, 60, 69, 72].map((m) => [m, music.frequency(m)]),
  weave: [30, 90, 110].map((rule) => ({ rule, grid: world.weave(rule, 31, 12).map((r) => r.join('')) })),
};
fs.mkdirSync(path.join(ROOT, 'packages/dark-subjects/test/fixtures'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'packages/dark-subjects/test/fixtures/university-math.json'), JSON.stringify(fixtures, null, 1) + '\n');
console.log(`pinned ${head} (${branch}); ${TOPICS.length} topics; witnessed ${counts.witnessed}, tested ${counts.tested}, proposed ${counts.proposed}`);
