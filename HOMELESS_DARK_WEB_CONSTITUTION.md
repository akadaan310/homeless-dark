# HOMELESS / DARK — CHROMASTRATUM WEB-NATIVE ENGINE CONSTITUTION 3.0
## One self-contained constitutional prompt · Chromastratum + six-division research foundry · playable worldwide Earth · cinematic sound and haptics · Android APK
**Issued 2026-10-21 · Co-founders/research authors: Abed Kadan and 7u · Product: HOMELESS · Engine: DARK · Delivery: Claude Code Cloud**

> **Mission:** Ship the first genuinely controllable, cinematic HOMELESS game on the web, with a source-backed globally addressable Earth, living NPCs and a portable web-native DARK engine. Package the **same playable presentation layer** as an installable Android APK. Work on the actual existing repository. Preserve its tested mathematics, datasets, art, gameplay semantics and event authority. The user sees and plays a world; they do not receive only another architecture report.

This document is the sole **active** constitutional prompt for the web-native rendering, packaging and integration lane. It integrates and supersedes the web-native v1/v2 prompts; no separate files are needed to understand the required behavior. Historical build and rendering requirements for other stacks are archival and are superseded. Where earlier source code contains useful data, contracts, fixtures or tested algorithms, bring them through a typed adapter; the target rendering and runtime described here have one unambiguous authority. The required stack is positively defined below. Historical files may remain versioned but cannot overrule the active executable contract. Avoid drafting another master instruction file.

**Repository:** `https://github.com/akadaan310/homeless-dark` · branch `main` when last inspected; inspect real HEAD, branch, current working state, active collaborators and tests before editing. At research time the most recent remote commit was `f596f0260d58`, and `docs/checkpoint.md` described the portable tested state. That SHA is a discovery anchor only, **never permission to reset or override newer work**. The root `HOMELESS_DARK_STANDALONE_CONSTITUTION.md` is historical under this explicit migration; preserve for audit but govern new renderer and product delivery with this versioned constitutional file.

**Host allocation:** Claude Code Cloud may use its own sandbox and GitHub access. The Oracle VM belongs to the separate Muse-managed workflow; do not install, operate or access it without separate explicit authorization. Develop the web client so its base gameplay is local and runnable with no Oracle dependency. Integrate the existing remote world authority only behind a documented optional authenticated adapter.

## I. Fixed product and implementation contract

- `DARK`: renderer-neutral simulation/math/data/protocol library, with typechecked public boundaries.
- `HOMELESS`: open-world third-person game using DARK. Visitor may simply exist, walk, observe, drive, learn, travel, interact, author, and leave/rejoin.
- `Renderer`: **Three.js**, TypeScript, React Three Fiber (stable React-compatible release) where declarative scene composition is useful. GPU-critical update loops must not cause React rerenders each frame.
- `Browser`: Vite + React + Three.js + PWA/service worker with measured streaming/cache behavior; WebGL2 baseline. Test WebGPU via Three's current WebGPURenderer as an optional measured profile and keep a working WebGL2 profile.
- `Physics`: **Rapier 3D WebAssembly**, explicit fixed-step stepping, heightfield/trimesh terrain support where appropriate, movement controller and collision groups. Keep the physics step independent of visual FPS. Use stable adapter and own tests.
- `World streaming`: geodetic WGS84 doubles, ECEF/ENU, floating local origin; global geographic tile index, source-provenance manifests, hierarchical LOD, async request budget, memory/cache quotas, content readiness, cancellation and safe fallback.
- `3D geospatial`: test **NASA-AMMOS 3d-tiles-renderer** Three.js adapter and **MapLibre GL JS + maplibre-gl-three** for global context; select one authoritative camera/georeference path. Do not overlay disconnected scenes that misalign or double-render geography. Open 3D Tiles datasets must actually be sourced and licensed.
- `Assets`: glTF 2.0 / GLB; PBR, KTX2/Basis, meshopt/Draco where device benchmarks justify them, proper skeletons, animation retargeting, LOD, instancing. Source-licensed high-resolution masters plus mobile-optimized derivatives; exact asset provenance.
- `Audio`: Web Audio + HRTF and AudioWorklet where useful; full spatial environmental sound, material and weather differentiation, voices/music/engines/interiors, timing/occlusion/dynamic mix, graceful offline and mute behavior. See II-C. Use existing sourced original sound work where lawful.
- `Native Android`: **Capacitor**, generated Android project, Android System WebView with hardware acceleration, Gradle debug-signed APK. Same TypeScript gameplay package and asset contracts as web; `@capacitor/haptics` plugin and optional appropriately tested waveform bridge. A WebView is NOT assumed faster than Chrome; benchmark both. Package initial gameplay assets; stream optional world regions with integrity/cache policies.
- `Persistent gameplay`: local IndexedDB versioned snapshots and event trace for offline solo mode; optional authenticated world service adapter preserving the authoritative semantics. Server-side C#/Python from the existing DARK project may remain as a test fixture or opt-in authority; its existing code is not the required browser render runtime.
- `Costs`: zero new purchases/subscriptions or paid API dependencies. Original procedural assets and free resources with actual compatible license terms. Avoid a catalog-only acquisition report. Existing source asset rights must be inspected for reuse in a redistributed app.
- `Security`: no credentials in browser bundles/repository. All mutation effect gates enforce identity/authority, budgets and type/schema validation. Read-only program addresses must not grant write access. No token assumptions based on URI visibility.
- `Scope`: global Earth **addressability, source-backed terrain/land/ocean, coarse global coverage, and true cross-continent world transitions** are part of the FIRST runnable product. Rich ground-level buildings and gameplay detail stream by area. Every coordinate has explicit source/data/fallback status. The travel grammar includes source-backed airport/heliport/harbor location, functional authored interiors, player-driven flight and vessels, and in-game tickets/lounges/long-duration journeys. A fictional reconstruction must not be portrayed as the verified appearance of a real street, terminal, or cabin.

**Art direction and sensory north star:** Deeply immersive, coherent open-world cinematography driven by **Chromastratum** (lighting, color, materials, perception and billboards) and **Somatostratum** (spatial audio and haptics), realistic streets and buildings, close-up PBR materials, animated people, real-looking cars and interiors, airports and functioning lounges, aircraft cabins and pilot experiences, ships, weather, wet surfaces, mountains, coastlines, sky and environmental sound. Design inspired by the ambition of contemporary AAA open worlds, with completely original art and legitimately usable source materials. No block-city scene, capsule mannequins, flat procedural cubes or title-screen image passes as a cinematic achievement. Technical primitives MAY appear in private debug fixtures; their existence cannot count as final art approval. Device profiles may reduce render cost while maintaining visual coherence.

## II. What already exists; preserve its value

The following statuses come from the last inspected repository checkpoint, **not** new measurements by this document:

- DARK server authority: SQLite World transactions, signed/scoped action sessions, HTTP discovery, real local travel, vehicles, NPC schedules, choices, entity effects, C# plate topology transformations, replay, QuickJS sandbox and prepared source media.
- Reported tests: 152 world-server, 19 content, portable C# mathematical/core tests, and compilation against official engine references. Reexecute portable tests before claiming pass.
- Geography: pinned Natural Earth global shapes; GEBCO2025-derived 0.1-degree coarse global relief; OSM-based Tampa source graph; airport data; still missing detailed global roads and buildings.
- Population: sampled demographic allocation of 8,140,897,523 for chosen 2024 source/epoch, with a separately represented nonspatial remainder. This is not 8.14B active simulated human minds.
- Art: source-rigged human masters, acquired animation sources, original fictional café, transport families, environmental objects and PCM clips. Reuse under their license where actual formats permit and track conversion from FBX/OBJ to GLB.
- Existing portable research: **CLOCK9** (grammar-clocked typed operations and n-gram proposals), **Plicastratum** (fold/unfold, admissible paths, promotion), **BORNE** (causal dependencies, reaction propagation), **World Loom** (global indexing, virtual actors and fictional world correspondence), Computational Grammar Theory, Ingrammatica, SubstrateIO, PURL and SEURL. These are contributing computation adapters, never blockers for core graphics.

Do not copy all historical attachments into the runtime. Identify exact useful modules, prove output equivalence on shared fixtures, port the minimum needed, and record independent evidence. Preserve original source history under Git. Keep research distinctions: `[K]` established, `[C]` construction, `[H]` hypothesis, `[M]` executed measurement, `[R]` refuted.

## II-A. SUBSTRATE UNIVERSITY AS THE EXECUTABLE RESEARCH FOUNDRY — six divisions, one world

**This entire section is normative and augments Sections III–X.** The user has explicitly requested that the complete current academic corpus of **Substrate University — Haq Roots** inform DARK's rendering, physics, NPCs, audio, and world engine. Claude Code is a **contributing computational research agent** to Substrate University, subject to independent verification; not a university founder, professor, or unrestricted scientific authority. The university co-founders are Abed Kadan and 7u. Contribution means implementing/tests/measurements with honest authorship and provenance; it never means declaring speculation an established theorem.

### A. Research-source admission: retrieve the full six-division corpus

**Live academic source**: `https://github.com/akadaan310/abedkadaancom`, at the verified default branch (previously `claude/new-session-xd8auu`; verify HEAD). Inspect the real university implementation rather than relying on this compressed summary. In particular read:

- `src/content/registry.ts`, `src/content/types.ts` and **all six** `src/content/topics/{foundations,relational,languages,geometry,acoustic,worlds}.ts` files; enumerate every registered topic, its known/house/conjecture/application status, definitions, source references, prerequisites, transformations and testable challenges. The inspected snapshot contained 62 topics; do not hard-code that count if the repository has advanced.
- `src/math/{matrix,rational,bridgeGrammar,fold,addressCompiler,music,paths,sky,world}.ts` and matching tests for actual executable methods. Determine which methods truly run and which are illustrations.
- `src/content/glossary.ts`, `src/exhibits/{compute,records}.ts`, and all exhibit implementations that demonstrate a subject. Existing outputs and fixture tests are evidence only for the exact bounded algorithm actually exercised.
- `src/books/compose.ts`, `src/pages/{Library,Scriptorium,Harness}.tsx` for the institution's living-library composition interface. This is the publication destination for tested DARK research, **not** a dependency for gameplay startup.
- `src/scene/{CampusCanvas,Architecture,Realms}.tsx` as examples of fast procedural browser geometry and compositional spatial design—not reusable copies of the campus's physical architecture.

Store a pinned `university-source.lock.json` with repository URL, branch, full SHA, file hashes, subject IDs, status tags and source locations. Build `docs/research/university-subject-matrix.md` automatically from the actual registry, **covering the full current topic list**, not only the six examples below. Each subject receives: source revision, whether it is existing mathematics or project construction, proposed DARK adapter, direct visual/physical/acoustic relevance, test fixture, budget and implementation status. Avoid importing all university prose or private data into runtime bundles; import only certified types, compact parameters and reusable algorithms. University pages need not become a second gameplay authority.

### B. One subject-agnostic computational interface

Implement `packages/dark-subjects` with a typed `WorldSubjectAdapter` interface and constrained evaluator. Suggested canonical fields:

```
{
  subjectId, divisionId, sourceRevision,
  inputAlphabet, stateSchema, grammar, contextGlossary,
  observables, transform, admissibility, dependencies,
  proposedEffects, physicalUnits, computationalBudget,
  verification, provenance, version, unfold, visualProjection
}
```

A unit of generated content must be **traceable in both directions**: from a rendered/played effect back to its source, program, actor authorization and verification predicate; and from an admitted program to a bounded visual/physical/acoustic outcome. `propose` computes candidate intent; `admit` checks grammar/resources/authority; `commit` changes authoritative world state; `project` updates Three.js, Rapier, audio and screen effects. Distinguish inputs, predictions, physical events, fictional effects and presentation. The same physical event can have multiple synchronized projections, but only one committed authority.

For each subject, declare an observability interface: `mathematical input → derived output → visible/physical/audio witness → quantitative test → perceptual review`. Use typed domain subspaces and sparse dependencies instead of materializing all possible combinations. Conceptual model:

```
W = (S_geo, S_actor, S_physics, S_weather, S_light,
     S_audio, S_history, S_grammar, S_render)

Commit(event) = Verify_grammar_and_rights(Propose(event, W))
Projection_j = Render_j(Observe_j(Commit(event)))
```

This product notation is an architectural construction, **not** a claim of multiplying all state spaces explicitly. `S_render` is a projection, not a second game-state authority. Use BORNE for changed-read-set propagation and a fixed timebase for causally related outputs. Avoid translating 'mathematics produces physics' into unbounded forces or visuals that bypass Rapier's contact/collision checks.

### C. Division I — Foundations of Computation: admissible physical actions and paths

**University subjects:** transition systems, finite automata, formal operational grammar, product graph search, numerical grammars, graph theory, equivalence classes, complexity and perturbation tests.

**DARK work:** A typed `MotionAndEventGrammar` governs locomotion, interactions, vehicle boarding, doors, transport, scene passage and plate rewrites. Rather than generating arbitrary descriptions, produce plans whose action sequence is admitted by the automaton **and** actually realizable on the current Rapier collision/nav graph. A visible path can be rejected for collision or authorization with an exact witness; valid actions become replayable programs. Use product-state path planning (road/navgraph × motion grammar) for corridor selection and mission approaches; never confuse admissibility with shortest-path global optimality.

**Visual dividend:** realistic character behavior, believable cause/effect, contact-aware NPC interactions, smooth entry/exit of vehicles, no characters walking through walls just because a dialogue generator says so.

**Test:** door→street→seat→ride→exit sequence passes deterministic planner and real Rapier fixture; broken street, obstructed door, missed seat and stale tile reject; accepted sequence is visibly completed in actual gameplay.

### D. Division II — Relational and Generative Mathematics: Plicastratum's art grammar

**University subjects:** Plicastratum ranks and folds/unfolds, relational generativity, In-Grammar, certified alphabet towers, recursive composition, modal/cyclic structures and constructive admission.

**DARK work:** Create a `ScenePlicaRegistry`. A plica may be a licensed photorealistic building module, architectural assembly (shopfront+awning+sign+entrance), street-corner grammar, avatar locomotion cycle, material/weather response or recurring NPC interaction. **Promote** a recurring sequence into a typed higher-level macro only after provenance, loss declaration, unfold rule, license, bounds and held-out test succeed. This is a reusable scene program, not a neural model claiming to invent an asset. Build `FacadeGrammar`, `StreetFurnitureGrammar`, `VegetationGrammar` and `DistrictPaletteGrammar` with exact sizes, UV/scale/material constraints, region tags, original authored geometry and explicit sources. Generate visually varied coherent compositions, not cloned façades or primitive cubes presented as close-up art.

**Performance dividend:** reusable verified recipes and asset references reduce duplication, enable instancing/batching and make district creation cheap relative to individually hand-authored layouts. Where content is geometric rather than reused, explicit instancing and pooling thresholds still apply.

**Test:** `unfold(fold(recipe))` recovers canonical source manifest/scene plan; repeated seeds yield repeatable scene signatures; variations must pass visual diversity checks and licensing; two neighboring districts look different in actual frames without broken contact/entrances. Measure scene bytes, memory, draw calls and frame times for hand-placed vs grammar-instanced art.

### E. Division III — Programmable Computational Languages: world programming through addresses

**University subjects:** PURL programmable URLs, SEURL typed verbs/channels, symbolic composition, Matrix Loom, addressable forms, parsing, computation-as-address and grammar-controlled execution.

**DARK work:** `WorldProgramCompiler` reads a versioned PURL-like expression (do not invent web scheme support) and compiles an authorized, bounded program of material transforms, signage typography, building/vehicle light responses, sound scenes, discovered journey patterns or geometry-preserving scene changes. SEURL-style typed effects declare inputs, authorized actor, expected revision, required resources and permitted projections. Matrix Loom may combine transforms after validating dimensions, units and data types. Clock-driven program selection can use CLOCK9 n-grams and tiny models as **proposal engines**; compilers, Rapier and world authority determine the effects.

**Visual dividend:** player/NPC contributions produce actual sign changes, lighting programs and scene transformations with temporal coherence; an LLM need not write a fresh shader or mesh for every act.

**Test:** same source address resolves to version-pinned recipe; invalid types or missing assets reject prior to execution; changed authorized sign appears on actual Three.js geometry; reading an address never mutates; operator can unfold the resulting program to admitted primitives. Benchmark compilation and replay over diverse addresses; no unjustified O(1) arbitrary execution claim.

### F. Division IV — Geometry, Physics and Representation: the cinematic image substrate

**University subjects:** Imagistratum, image/preimage/kernel, rank/nullity, projection loss, projective cameras, topology, curvature, spatial tensors, coordinate charts, image formation and invisible sensing.

**DARK work (highest direct visual impact):** Create `ImageAndWorldGeometry` to connect WGS84/ECEF/ENU with a double-precision global world and floating-origin local Three/Rapier coordinates. Define a `PerceptualLOD` compiler with view-dependent distance, screen-space error, silhouette preservation, importance of faces/vehicles, terrain and map uncertainty, collision quality and shader/memory budgets. A projection `π_r` at resolution r must declare what geometry/material/signal is lost. Fine art near the camera can use glTF PBR with KTX2/meshopt; far geometry can use decimated meshes and batched/instanced forms. Photorealistic appearance depends on actual source assets, calibrated material/lighting choices and compositing, not on the word Imagistratum.

For camera/occlusion/interaction use actual projective matrices and `three-mesh-bvh` spatial queries where benchmarked; synchronize collider/terrain geometry with Rapier independently of camera visibility. Give the scene a **camera grammar** for third-person follow, gaze, vehicle interiors, arrival cinematics and comfortable transitions. Distinguish frustum-candidate, unoccluded, rendered-visible, salient and agent-aware. Visibility alone is not NPC mind-reading. Use `3d-tiles-renderer` for licensed 3D Tiles with explicit source provenance and caching rights. The existing global coarse terrain does not certify detailed street topography.

**Visual dividend:** continuous continent-scale spatial precision, plausible close-ups and atmospheric distance, stable camera, believable view-dependent detail and interactive signs/billboards; less popping and fewer floating objects.

**Test:** WGS round trips and date-line/pole edge cases; same building retains dimensions and identity across origin shift and LOD transitions; camera avoids clipping near moving passengers; source mesh GLB loads with normal maps; screenshot comparisons show stable silhouettes, textures and shadows across mobile tiers; collision data readiness gates spawning.

### G. Division V — Acoustic and Generative Sciences: sensory mathematics

**University subjects:** sampling, Fourier/time-frequency representation, phase, envelope, interval cycles, music grammar, synthesis, spatial acoustics, Phonogrammatica as general human vocal-expression mathematics.

**DARK work:** Make `AcousticEventGrammar` produce sound from verified world events: footstep impulse on assigned surface, vehicle speed/gear load, rain intensity and roof occlusion, interior/exterior transitions, traffic distance, ocean waves, instruments and individual actor voices. Use a Web Audio spatial stack with HRTF panners on supported browsers, chosen attenuation curves, convolution/reverb where budgeted, clock-aligned sample events, ducking and readable captions. Integrate already licensed recordings with source hashes and exact rights; original DSP synthesis fills gaps. `MusicClock` may schedule motifs with deterministic event and interval grammar; an optional small model can propose dialogue but may not dictate physical facts. No external corpus is needed for the baseline.

**Sensory dividend:** ears can infer world location/material/proximity, coherent interaction sound and cinema-like atmospherics; silence can intentionally stage attention instead of meaning stalled loading.

**Test:** spectral/loudness/peak and temporal alignment checks, actor velocity → sonic Doppler/attenuation under authored constraints, door closing changes high-frequency energy, rain event changes pavement wetness and footfall samples concurrently; human listening tests sound credible; Android sound unlock/autoplay restrictions handled with user gestures.

### H. Division VI — Computational Worlds and Emergence: living global worlds

**University subjects:** World Loom, cellular automata, GLM/LGM/GWM, agent grammars, simulated populations, navigation, BORNE dependencies, generative environments and HOMELESS itself.

**DARK work:** Preserve the existing authoritative global source data and NPC identities. Implement `WorldLoomScheduler` with virtual/cohort/active/focused tiers; only active/causally relevant agents update individually. Use `recast-navigation-js` for local navmesh, crowd avoidance and dynamic obstacles where it outperforms alternatives. Use a global transportation graph for routing; Recast does not magically provide worldwide roads, aviation or marine network authority. `BORNE` computes dependency cones for traffic, relationships, store behavior, weather and diegetic signage; use bounded propagation with recorded witnesses. `PlateRewrite` transforms typed connected-graph neighborhoods and resolves inhabitants through continuous, physically legal carriage or explicit approved fictional relocation, while maintaining world identity and sound/camera cohesion. `Visit/overlay/braid` remain separate program effects, with loaded destination ready before activation.

**World dividend:** NPCs have commitments and social consequences, a street can be transformed as a playable discovery, and the whole Earth remains geographically addressable without pretending all possible actors and assets are resident in memory.

**Test:** actual walking in a detailed current region; 2+ NPCs continue distinct actions when ignored; visible causal response to one player action; continuous plate transform and inverse with animated passengers; distant region loaded with documented real vs fictional data; snapshots restore relationships and scene position; benchmark active count and CPU time on the device.

### I. The cinematic integration laboratory — six results converging in one scene

Implement a continuous **Tampa wet-night sequence** with the following exact audit trail:

1. Real world cell resolves sourced roads, material candidates, actor schedules and environment forecast/fictional weather status (Division VI).
2. The active environment emits a typed `RAIN_START` event admitted by the state machine (Division I).
3. BORNE traces dependent wetness, footwear audio, headlights, wet surfaces, fog, umbrellas/behavior and vehicle effects (Division VI).
4. ScenePlica composes calibrated pavement/curb/vegetation/façade and reuses verified textures/meshes with coherent region grammar (Division II).
5. Imagistratum maps the scene into LOD-projected meshes/materials and correct camera/lighting passes, declaring projection losses (Division IV).
6. Acoustic grammar positions tires, raindrops, footsteps and room transition sounds against actual world events (Division V).
7. A typed SEURL/PURL-style `SIGN_LIGHT_SHIFT` operation performs a consensual diegetic signage change by an NPC, compiled and admitted before the GPU reflects it (Division III).
8. Show third-person player and moving car in one unbroken native browser capture; provide event trace, asset manifest, average/p95 frame time, source-data attribution, and a separate renderer screenshot/witness list.

Do not let this scenario delay the first playable street. It is a **second visual quality milestone**, built incrementally over the same scene. The expected look is coherent rain/lighting/actors/sound with realistic sourced art; actual result must be measured and reviewed, not declared equivalent to a proprietary AAA engine.

### J. Actual library and implementation leads — verify pinned compatibility before admitting

- Three.js `WebGLRenderer` baseline; optional `WebGPURenderer`/TSL for shaders, fog, post-processing, lights, rain, reflections and GPU-assisted spatial effects **only when features and FPS actually work**. Official Three WebGPU docs note experimental behavior and non-portability of legacy shader/EffectComposer code. https://threejs.org/manual/#en/webgpurenderer and https://threejs.org/docs/pages/TSL.html
- Realistic asset input: `GLTFLoader`, `KTX2Loader`, meshopt and Draco, glTF 2.0 PBR extensions. https://threejs.org/docs/pages/GLTFLoader.html and https://threejs.org/docs/pages/KTX2Loader.html
- Render-cost control: `THREE.InstancedMesh`, `THREE.BatchedMesh`, selective LOD, resource disposal, adaptive DPR, R3F performance measurements. https://threejs.org/docs/pages/BatchedMesh.html and https://r3f.docs.pmnd.rs/advanced/scaling-performance
- Spatial queries/occlusion: `three-mesh-bvh` for geometry raycasting and proximity; it does not substitute for Rapier's physical solver. https://github.com/gkjohnson/three-mesh-bvh
- Physics/movement: `@dimforge/rapier3d-compat` or compatible Rapier entry; Rapier character/controller and vehicle APIs, checked for current version; `ecctrl` is an optional comparison for existing R3F/Rapier character/vehicle/touch integration. https://www.rapier.rs/docs/user_guides/javascript/character_controller/ and https://github.com/pmndrs/ecctrl
- Local navigation/crowds: `recast-navigation-js`, Three integration; test offline build vs runtime generation, character radius, temporary obstacles, crowd CPU costs. https://github.com/isaac-mason/recast-navigation-js
- Source-backed 3D geospatial: NASA-AMMOS `3d-tiles-renderer` with Three.js integration. Its existence does not grant access to a high-fidelity global tileset; respect each source license, cache and offline permissions. https://github.com/NASA-AMMOS/3DTilesRendererJS
- Sound: Web Audio `AudioContext`, PannerNode, ConvolverNode and offline rendering; adaptive mix after user gesture. https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- Optional game-state implementation: dedicated TypeScript ECS or sparse entity stores; benchmark small simple typed maps against ECS before selecting library. Web Workers may precompute graph/shader/asset/physics preprocessing under explicit budgets and abort rules.

**No new spending.** Sources/products are admitted by concrete compatible licenses, actual acquisition, visual validation and on-device performance—not by brand name. Existing Unity-source assets may be converted to glTF only if redistribution rights and import pipelines permit. Avoid substituting low-poly/flat-shaded hero art. Refuse to describe generated sky/roads/assets as source-verified when they are fictionally filled.

### K. Claude Code contributes to Substrate University — evidence, not just narrative

At each executable integration milestone, generate one `UniversityResearchContribution` record with:

```
{ subjectId, divisionId, universityCommit, darkCommit,
  establishedReferences[], constructionDefinition,
  hypothesisOrQuestion, algorithm, inputFixtureHashes[],
  sourceCodePaths[], runCommands[], outputArtifacts[],
  measuredBeforeAfter, nullOrBaseline, limitations[],
  resultStatus, visualWitnesses[], audioWitnesses[],
  proposer: "Claude Code (implementing research agent)",
  review: "pending co-founder acceptance" }
```

Produce `docs/research/contributions/{divisionId}/{experimentId}.md` plus machine-readable JSON in DARK. A generated recipe enters the University research catalogue only after actual tests; an academic status is not promoted merely because an agent wrote it. For example, E-01 `Grammar-Façade` compares number of unique valid storefront programs, glTF bytes and draw calls; E-02 `Imagistratum LOD` compares distance/image loss vs frame time; E-03 `BORNE wet-night` compares recomputation volume after rain; E-04 `NPC Dialogue Act` compares grammar validity, grounding and latency; E-05 `Acoustic Scene` compares event timestamp drift and listener ratings; E-06 `PURL World Program` checks typed round-trip and authorized scene effects. Include refutations and visual defects.

**Cross-repository workflow:** Existing DARK constitutional prompt remains sole executable authority for the GAME. The University's existing books, labels, and co-founder-owned subject registry remain its own identity. Read University source via pinned SHA; do not modify its deploy branch while building DARK. Where user-authorized access exists, stage a separate reviewable university contribution under `docs/research/dark-contributions/` on an independent branch after producing verified results. Never concurrently write to another agent's active university branch, change a University topic's epistemic status without co-founder review, or claim a paper was published just because a Markdown file exists. Export a versioned importable contribution manifest even without that repository access.

**External AI use:** The machine-readable university discovery manifest can list the topic IDs, executable fixtures, extension capabilities and test commands. It cannot turn a one-time Claude session into an always-on professor, guardian or world actor. Contribution is recorded work, not a claim of persistent independent agency.

### L. Execution priority and successful outcome

**The visualization must lead the work.** Begin the existing Section III playable street first, then add the wet-night integrated proof. Parallel workers can inventory and port university subjects while the renderer is being assembled, but no academic audit may block installing Three.js/Rapier, importing actual art, or obtaining the first playable screenshot. The six division inventories can be completed in parallel; implement only the immediately useful adapters first and add research contributions as each actually proves value. Demonstrate one end-to-end event that changes physics, appearance, audible atmosphere and NPC behavior and is explained through all six division traces; then measure mobile performance before expanding the world. Keep original worldwide/Capacitor APK gates intact.

**Definition of success of this section:** (i) all six actual university divisions and their current topics inventoried with source revision; (ii) at least one concrete executable world function per division with a fixture and an in-game witness (possible progressively over increments); (iii) one continuous shared-world wet-night scenario with realistic assets and typed cause/effect; (iv) performance and perceptual results honestly labeled by environment; (v) research contributions importable into the university; (vi) render and mobile APK gates remain in force. An educational exposition without playable visual consequence is `NOT_RUN` for the game acceptance.

## II-B. CHROMASTRATUM — computational grammar of lighting, color, perception and image formation

**This is a binding, first-class engine subject, not cosmetic grading after the game is written.** Research designation: `CHROMASTRATUM/0.1`, a Substrate University construction informed by established color science. Claim the proposed **integration/grammar**, not original discovery of colorimetry, PBR, or human vision. The user places high priority on deep color science, billboard appearance, lighting coherence along every walk, day/night/rain/cloud/indoor transitions, and the emotional clarity of the physical world. Optimize for perceptual coherence and immersion, not a particular console's pixel count. Respect source geometry, licensing, device budget, and user settings.

### B1. A color system is a computational contract, not an attractive RGB palette

Model the renderer as the composition of distinct transforms:

```
World/geographic state W(t) and authored visual cues
  -> illumination field E(x, direction, wavelength, t)
  -> materials and geometry: reflectance, transmission, roughness, normals
  -> camera/sensor projection and scene-linear radiance L
  -> exposure/adaptation, tone mapping, color rendering and gamut mapping
  -> display-referred pixels + measured on-screen visibility
```

Implement `Chromastratum` as reusable domain-independent contracts in `packages/dark-visual-grammar` or the existing canonical package location. Its typed registry stores `world_event_id`, `timebase`, `observer`, `geodetic_cell`, `source_status`, `light_sources`, `illuminants`, `materials`, `atmosphere`, `camera`, `exposure`, `tone_mapping`, `display_profile`, `salience_objectives`, `energy_and_gpu_budget`, `witnesses`. The grammar consumes an authoritative world event and issues a versioned `VisualProgram` with declared effects and costs. Colors have both a **scene-linear physical representation** and a **perceptual design representation**. Never mix them silently. A generated sign/light motif must carry derivation, expand/unfold rule, geometry and reference, visual verification status, and license record for every external asset.

Core state product (project construction):

`C = (L, M, A, P, V, T)` where `L` is illumination, `M` materials, `A` atmosphere, `P` camera/projector and display transforms, `V` visual salience/legibility constraints, `T` temporal transitions. A visual production `C(W, observer, quality)` yields an admitted render recipe, with observables and failure status.

Operational grammar example (illustrative DSL; implement a typed parser, not string interpretation):

```text
SCENE geography=TAMPA.source-anchored mode=NIGHT weather=RAIN
ILLUMINANT class=streetlight temperature=warm intensity=calibrated source=municipal_or_authored
SURFACE class=asphalt wetness=0.65 roughness=wet_profile source=licensed_pbr
SIGN subject=shopfront locale=en payload=validated_grammar emission=limited
CAMERA mode=third_person adaptation=smooth filmic=AgX_or_ACES_variant
PERCEPTION target=walkable_path legibility=verified comfort=reduced_flash
```

The selection should produce executable material/light uniforms, sky and atmosphere inputs, billboard glyph geometry and audio/haptic event relations. Visual programs are **composed from allowed types**, and a verifier enforces their limits. Optional small local models may propose only bounded parameters, not override established geometry, licenses, or color arithmetic.

### B2. Color science and exact color-management rules

Implement the known transforms, tests and documentation in the codebase:

- **Scene-linear sRGB** for physically meaningful BRDF, light accumulation, blending, filters and exposure. `THREE.ColorManagement.enabled` (default in current Three), explicit `SRGBColorSpace` on albedo/emissive color maps, `LinearSRGBColorSpace` on appropriately encoded open-domain HDR environment maps, `NoColorSpace` for normal, roughness, metalness, AO and data maps. Validate all imported GLBs against glTF color-space expectations; older non-glTF materials need normalization. References: https://threejs.org/manual/pages/color-management.html and https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- sRGB transfer function should be implemented/tested in the reference math, not approximated as naive gamma 2.2 for correctness tests. Forward scene-linear decode: for an sRGB channel `c` in [0,1], `linear(c)=c/12.92` if `c <= 0.04045`, else `((c+0.055)/1.055)^2.4`. Inverse output transfer: `12.92*l` for `l <= 0.0031308`, else `1.055*l^(1/2.4)-0.055`. Confirm against Three's own color transforms with tolerance. These are normalized sRGB channel rules, not HDR tone mapping.
- Perceived palette relationships in **OKLab/OKLCH**, CIE XYZ/CIELAB for diagnostic comparison where supported. OKLCH controls lightness, chroma, hue and smooth gradients; convert to device gamut with documented clipping/mapping. Do not compute physics, irradiance or BRDF in OKLCH. Record renderer/display profile separately. Reference W3C CSS Color Level 4: https://www.w3.org/TR/css-color-4/
- Add `ColorWitness` fields: scene-linear input, encoded/display output, exposure mode, transfer functions, tone map, gamut, environment/white-point assumptions, sample pixel positions and captured image hash. Implement unit tests for round-trip of sample colors, neutral-ramp behavior, clipping/gamut flags, texture color-space annotation, preventing double encoding and ensuring color-data textures remain unmodified by sRGB decode.
- Evaluate existing **AgX, ACESFilmic, Neutral or another pinned filmic mapping** through actual images rather than using tone-mapping names as a quality guarantee. Use one declared output transform at the end of a pipeline; with WebGL post-processing use Three `OutputPass` where appropriate; with WebGPU/TSL use its renderer-specific render pipeline and output transform. Never blindly mix legacy WebGL `EffectComposer` nodes with WebGPU/TSL. https://threejs.org/docs/pages/OutputPass.html https://threejs.org/manual/pages/webgpu-postprocessing.html
- Use image-based lighting via environment maps and `PMREMGenerator` (or backend-equivalent), GGX/metallic-roughness PBR; support clearcoat, transmission and anisotropy for selected hero materials when verified on target hardware. Correct specular lobes and Fresnel at oblique angles matter more than excessive bloom. https://threejs.org/docs/pages/PMREMGenerator.html and https://www.khronos.org/gltf/pbr/
- Observe accessible visual contrast for *essential controls and actionable signs*: calculate relative luminance and visible contrast against the actual composited backdrop at screenshot time, not an imagined flat CSS color. Aim to satisfy WCAG 2.2 1.4.3 minimum contrast for UI text (4.5:1 regular, 3:1 large text) and 1.4.11 for critical UI boundaries; define in-world legibility objective appropriate to distance/role and fallback captions. Color must not be the only signal. https://www.w3.org/TR/WCAG22/
- Avoid unsupported universal color psychology laws (e.g. `red = anger`, `blue = trust`). Artistic color motifs are hypotheses; register them as authorial choices and test with viewers. Cultural typography/color choices must be locally authored or grounded, not stereotypes. All physical lighting and user-salience claims are scoped to their measurable observable.

### B3. Light grammar by physical source, scene and time

Model sun/moon/sky and local lamps as different source families with provenance; include `day`, `golden_hour`, `twilight`, `night`, `indoor`, `tunnel`, `underwater` and `aircraft_cabin` lighting profiles. The time/latitude/longitude clock drives solar position and shadow direction, while weather/cloud/aerosol parameters drive sky lighting. Choose officially documented Three `Sky` (WebGL) or `SkyMesh` (TSL path) according to renderer support; both expose physically inspired turbidity/Rayleigh/Mie terms. Daylight can look cinematic without falsely claiming atmospheric radiative transfer has been measured in full. https://threejs.org/docs/pages/Sky.html https://threejs.org/docs/pages/SkyMesh.html

Use photometrically interpretable units when the underlying Three light exposes them (e.g. spot intensity in candela); camera exposure must be explicit and physically coherent across scenes. For high-level authored look profiles retain measured exposure and calibrated grayscale/color references. At least one visual test should transition from sunlit asphalt to covered shopping arcade to interior café, retaining readable faces/signage, avoiding flash/exposure pumping. Keep autoadaptation bounded and time-smoothed with configurable accessibility speed.

Local sources: daytime skylight and sun, streetlights, shop-window emitting panels, LED/neon signage, headlamps/taillamps, reflected wet roads, cabin reading lights, aircraft window illumination, airport terminal ceiling fixtures, boat lanterns, instrument screens and starlight in unpolluted sky. A glowing emissive mesh **does not automatically light nearby geometry** in conventional raster pipelines; pair significant sources with bounded explicit nearby light, probes, light maps, or a measurable illusion. A RectAreaLight can approximate broad emitters but Three's RectAreaLight currently does **not** cast shadows; use an appropriate alternative for an actual shadow requirement. https://threejs.org/docs/pages/RectAreaLight.html

**Shadow architecture:** budgeted directional cascades/CSM or carefully selected cascade alternative, stable shadow texels, screen-space contact shadows if measured, vehicle headlights at near range, baked/probe indoor approximations, shadow bias tests, stable indoor/outdoor light transitions, limited dynamic shadowed lights, and quality-tier-specific fallbacks. Dynamic weather and celestial time must change physically relevant shadow cues. Every shadow tier is judged in motion and close-up.

**Material-wetness grammar:** weather event -> wetness scalar in `[0,1]` with drying/drainage -> updated pavement and car material roughness, puddle normal/height masks, coherent reflected streetlamp/headlamp source appearance, tire-spray/footstep acoustics/haptic substrate. Real puddles arise from authored depression masks / slope / drainage, not everywhere at random. A screen-space reflection cannot show offscreen geometry; hybrid SSR/probes/cubemaps/planar reflections provide explicit bounded alternatives with source/quality labels. A 2D darkened texture alone is not sufficient for wet-night cinematic evidence.

**Camera grammar:** bounded dynamic exposure, focus/framing, roll/head bob, controlled DOF where budgeted, filmic shoulder/headroom rules, camera collision, vehicle cabin viewpoints, first/third person walking and cockpit, stable horizon and frame-time-invariant damping. Introduce modes through actual authored camera transitions with comfort settings; never shake or flash the view simply to seem cinematic. Rendering performance must retain clarity near the playable character.

### B4. Perceptual color and narrative grammar

Define **VisualEvent** and **PerceptualGoal** and connect them to actual gameplay affordances. Sample fields:

```typescript
interface VisualEvent {
  id: string; worldTick: number; originId: string; position: [number, number, number];
  worldCellId: string; causeEventId?: string; source: 'measured' | 'authored' | 'derived';
  illuminants: readonly string[]; materialState: Record<string, number>;
  colorSpace: 'linear-srgb'; moodTag?: string; // tag = authored, never physical fact
  requiredVisibility: 'critical' | 'narrative' | 'ambient';
  transitionMs: number; capabilityId?: string;
}
```

**Critical signs** must be visible/legible along the relevant approach path, and **narrative cues** must compete with ambient stimuli without hiding controls. Compute view-frustum occupancy, contrast against local background, occlusion, angular size, motion and dwell using a camera matrix; use a deterministic weighted salience proxy only after measured calibration. Do not equate an object being rendered with a human noticing it. Weather/fog/glare/smoke require alternative captions/icons for navigation-critical meaning. Alterative low-power and reduced-motion presentation preserves function.

**Perceptual invariants (tests):** identity continuity under color grading; stable signage meaning under night/rain; photometric adaptation smooth; no accidental double-encoded colors; perceptible shop door / safe pedestrian crossing even when glare and fog vary; no false path implied by red/green signs alone. Evidence includes actual player-frame screenshots + associated matrices and observed pixels, not prose or static illustrations.

### B5. BILLBOARDSTRATUM — functioning typographic architecture, not UI pasted onto a façade

Billboards are first-class world entities with `entityId`, location, mounting geometry, owner/author, text content, language/script, font license, semantic class, operating schedule, materials, electrical/power state, display emitted radiance profile, reflection contribution, weathering, asset provenance, interaction/action ID, LOD and viewer permissions. Implement a reusable `SignGrammar` for `traffic_sign`, `building_name`, `shopfront`, `transit_departures`, `flight_board`, `digital_ad`, `wayfinding`, `museum`, `artist_mural` and `diegetic_interface`. Preserve actual road/airport restrictions and fictional additions as separate overlay layers; avoid inventing real-world commercial claims.

A billboard must be able to change its **content, local typographic layout, brightness and reflection cue** in response to a typed event. Composite signed-distance-field glyphs on real 3D surfaces, correct depth/occlusion, occluded backfaces, distance/angle readability, physically plausible glass/paint/LED materials, authored emission on night surfaces, rain reflections, moving vehicle light. Evaluate `troika-three-text` for SDF in 3D. It supports kerning, ligature substitutions, bidirectional and joined scripts. Character coverage and rendering are not synonymous with accurate local translation; words must be sourced or authored. https://github.com/protectwise/troika/blob/main/packages/troika-three-text/README.md

**Layout grammar** `layout = fit(text_metrics, bounds, preferred_read_distance, safe_margins, script_direction, hierarchy, occlusion_mask, emissive_budget)`. Test long names, line break, compound words, CJK/RTL scripts, Latin numerals, Unicode combining marks, small/distant signs, dusk/rain legibility and facade angle. A sign is a navigable data source: the player can examine the source and see a grounded or fictional designation; public/private text respects permissions. A script/logo that mimics real brands requires rights review.

**Billboard examples built and verified (not merely listed):** route sign with correct distance and travel-mode icon; animated late-night storefront with wet reflection; airport departure board driven by *fictional* in-game flight schedule and local clock; programmable sign changed by an NPC and witnessed in nearby light/materials; sky-to-ground interface projection through the same typed action IDs, not arbitrary unrelated screen effects. The time-dependent signs must not flicker to the point of discomfort. Avoid seizure-risk flashing and respect reduced-motion preferences; W3C 2.3.1 is a hard safety/accessibility minimum.

### B6. Chromastratum experiment design and explicit proof gates

For every material/light hypothesis, compare at least three practical implementations on a pinned WebGL2 fallback: baseline simple PBR, enhanced tier with coherent light/reflections/weather, and an optional WebGPU/TSL specialized version only when supported. Quantify frame time, draw calls, GPU allocations, image error/ΔE against a selected reference/known transforms, legible signage pixels and rendered screenshots. Do not assert a universal 'photorealism score'. Include a human art-review matrix at actual mobile resolution: skin, asphalt, foliage, car paint, wet-night specularity, reflected signage, sea water and aircraft interior.

**First mandatory visual scene:** SOURCE-ANCHORED **TAMPA STREET, DRY DAY → WET DUSK → WET NIGHT**, continuous player movement, standing/talking NPCs, movable car, an actual emissive storefront sign, streetlight reflection and dynamic surface/audio/haptic consequences. Export 3 matching-camera captures (fixed seed), a 20-second first-person/third-person clip, source/asset hashes and quantitative telemetry. This sensory scenario may be assembled incrementally but must run in a real Three.js canvas.

**Second visual comparison:** airport exterior/terminal/lobby/lounges/aircraft cabin at arrival, daytime and night. A route board changes based on the actual in-game travel state; PBR cabin windows and sky transition match journey clock; airport source data and fictional interior decisions are inspectable separately. Validate legibility in motion and day/night; do not fake a terminal screenshot using static reference imagery.

## II-C. SOMASTRATUM — one event, coherent image, sound, haptics and physical response

The user explicitly elevates spatial sound design, tactile vibration/haptics, physical ambiance, sensory continuity and player immersion to **first-class acceptance requirements** alongside geometry and rendering. Build `Somatostratum` (working subdiscipline) as the coordinating event grammar, not an unrestricted sensory gimmick. Its content-free core receives semantic `WorldEvent` and publishes time-coded tracks: `VisualCue`, `AcousticCue`, `HapticCue`, `ParticleCue`, `MaterialCue`, `AnimationCue`, with one causal ID and event-time mapping. Both perceptual realism and player comfort are obligations.

### C1. Typed event and sensory manifestation

```typescript
type SensoryCue = {
  eventId: string;
  causedBy?: string;
  worldTick: number;
  scheduledAudioTime?: number;
  actorId?: string;
  category: 'step'|'rain'|'door'|'vehicle'|'wind'|'takeoff'|'aircraft_cabin'|'ocean'|'interface'|'story';
  intensity01: number; position?: [number,number,number];
  surface?: 'asphalt'|'wet_asphalt'|'wood'|'metal'|'carpet'|'water'|'sand'|'unknown';
  audioClipOrSynth?: string;
  hapticPattern?: string;
  visualProgramId?: string;
  sourceStatus: 'real'|'synthetic'|'authored';
};
```

Input event: `FOOTSTEP(entity, velocity, surface, gait, precipitation, footwear)`. It drives contact animation, context-specific click/crunch/splash, a very brief optionally enabled tactile cue, wet footprint/decal where appropriate and dust/water particles. At least 6 different surfaces in the demo have distinguishable audio and contact response; no hidden fake spatial model.

`CAR_DOOR_CLOSE` → animated hinge latch + doppler-matched external movement + slam/travel audio + short haptic + muffled cabin acoustic impulse. `THUNDER_FAR` → light delay if realistic, delayed rumble according to declared sound propagation approximation, mild tactile effect only with opt-in. `AIRCRAFT_TAKEOFF` → engine RPM/spool, ground-to-air acoustic change, visual acceleration/vibration cues, tactile departure confirmation with capped intensity. `WAVE_HULL` → hull response, surf audio, gentle pulse when craft pitches, wetness and wake. At least one event triggers all four channels with verified sequencing.

### C2. Sound research, acoustic grammar and codec/runtime

Baseline **Web Audio API**. `AudioContext`, user-gesture unlock, spatial listener, `PannerNode` HRTF where supported (fallback equal-power), attenuation, cone direction, mono source virtualization, band-limited filtering for occlusion, room impulse responses where budgeted, and routed buses: `world`, `voice`, `footsteps`, `vehicles`, `rain`, `water`, `music`, `ui`, `accessibility`. Use `AudioWorklet` for genuinely low-latency custom DSP; it runs on the rendering audio thread, not the main JavaScript/UI thread. References: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Web_audio_spatialization_basics and https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet

Include *dynamically occluded dialogue* from two NPCs while the player approaches, walks behind an obstruction, enters a car, closes door, then returns outside. Need actual distance attenuation, near/far EQ, listener azimuth, acoustic floor, interior low-pass/reverb, convincing scene audio even with no dialogue synthesis. Caption active voices, offer directional sound indicators, optional dynamic range preset, night mode, independently adjustable UI/music/voice volumes, muted mode and mono compatibility. A naturally audible distant siren differs from a cutscene UI alert. Claim scientific acoustic simulation only where actual filters and geometry justify it; heuristics are authored approximations.

**Sound design as computational grammar:** sound palette per biome, time-of-day, weather, material and activity; time-coded vocabulary of inhalation/foley/water/wind/engines/small crowds/footsteps. Use waveforms from existing original or licensed work with source hashes and decode evidence; procedural additive/noise/reverb generators for missing ambiance. No account, external paid audio inference, or imported private media required. Clip quality verified by loop seam, peak, short-term RMS/LUFS where measured, spatial attenuation curve, onset-to-contact error, channel masking and human listening notes.

**Clock relation:** `t_world` drives deterministic causes; `AudioContext.currentTime` schedules playback; `performance.now` drives render telemetry; graphics interpolation must not pull world authority to compensate for audio jitter. Align footprints/door impacts/engine events by measured onset difference under variable FPS. Keep audio world clock and transport flight duration separate. Suspend and recover cleanly on Android app focus/audio focus loss.

### C3. Haptics and vibration are gameplay event grammar, not noise

Use `@capacitor/haptics` for Android APK (official plugin: impact, notification, vibrate, selection), with a capability-checked browser `navigator.vibrate` fallback. Browser vibration is not universally supported and requires user activation. For sophisticated, user-authorized Android tactile envelopes, an isolated native Capacitor plugin may use Android `VibrationEffect` with hardware amplitude capability checks and OS limits. Do not assume amplitude control on all devices. Sources: https://capacitorjs.com/docs/apis/haptics ; https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate ; https://developer.android.com/reference/android/os/VibrationEffect

Define a **haptic alphabet** whose letters include `TAP`, `DOUBLE_TAP`, `SOFT_IMPACT`, `ROUGH_ROAD`, `ENGINE_RUMBLE_HINT`, `WAVE_PULSE`, `WARNING`, `WELCOME`. Each letter has physical-meaning category, duration/max repetition, intensity tier, cooldown, device capability, user opt-in and proof that it actually fired on a device. Do NOT run perpetual motor vibrations for full-length train/airplane trips. Rumble is a sparing envelope derived from low-frequency events, not an unbounded high-frequency vibration stream. A one-day multi-hour flight must be comfortable and battery aware.

Rate-limit/tame: user-selectable OFF/LOW/NORMAL; OFF default for accessibility/if preference unknown; emergency mute available always; thermal/battery throttle; cancel on menu pause, orientation/focus changes and session teardown; no tactile cues for every frame; no haptics-only mandatory gameplay information. In a 10-minute walk, verify durations, count and throttling against configured budgets. Measure actual vibration behavior on phone if accessible, rather than treating API call success as felt effect. Align to sound/animation cue onset with tolerance, recording exact device variability.

### C4. Sensory tests and cinematic immersion evaluation

Build a **six-lane sensory telemetry graph** keyed by the same event ID: time, world, animation, image, audio, haptic. Test cue stability under variable frame rates and device performance tiers. Include minimum examples: footstep dry→wet; rain entering café; moving car and closing door; standing next to illuminated billboard; terminal announcement; aircraft taxi→takeoff→cruise→landing; boat engine and wake; nighttime outdoor harbor. Provide real-time debug overlay with toggles and source/approximation status separate from player experience.

Pass requires actual sensory output/playable browser screen/audio and native haptic pulse evidence where hardware exists, with repeatable e2e tests. 3D art screenshots alone do not pass sensory integration.

## II-D. EARTH-TO-EXPERIENCE TRAVEL GRAMMAR — airports, aviation, ships, harbors and long-lived journeys

The user requires **functioning airports and functioning travel as an experience** rather than flight routes displayed on a map. Declare a shared `TravelProgram` whose state transitions bind actor agency, geographic data, real/fantasy world layers, simulation clock, asset/animation streaming, boarding entitlement, occupancy, terminal rooms, vehicles, physics, scenes, dialogue, signage, audio and haptics. The same core supports airports, heliports, ferries, yacht marinas, rail stations and road transport. The user-character DARK has unique founder identity and optional generous invitation/entourage systems within fictional world rules. Those are in-game interactions, **not real flights, lounge entitlements, airport security clearance or airline tickets**.

### D1. Data reality — real geospatial facts vs authored airport experience

Reuse already acquired `data/geography/ourairports.sqlite3`, `data/geography/sources/ourairports-airports.csv` and `data/geography/ourairports-source.json` from actual DARK source. OurAirports publishes public-domain airport and runway/navaid datasets with no accuracy guarantee; its fields alone are **not** global interior terminal plans. OSM has some airport buildings/terminals/taxiways, varying severely by airport and temporal coverage. FAA NASR covers U.S. aeronautical data, not worldwide airport floor plans. Published airline routing/schedules must be source-and-epoch marked, and OpenFlights route data is outdated since June 2014. Sources: https://ourairports.com/data/ ; https://www.faa.gov/air_traffic/flight_info/aeronav/Aero_Data/ ; https://openflights.org/data.php

`AirportRecord {icao, iata?, coords, elevation, runways[], taxiways?, stands?, known_terminals[], known_facilities[], provenance, validityEpoch, coverageFlags}`; `AirportScene {source_geometry, procedural_terminal_recipe, generated_interior, collision_graph, pathfinding_graph, asset_manifest, lighting_profile, audio_profile, interactions, source_layers}`. Make every airport **addressable globally**, with a loadable truthful exterior/ground mode, even if the interior is modeled by an authored regional archetype. Visitors may walk through a fictional immersive terminal; attach an unobtrusive source label noting when actual building/interior detail is unavailable. No claim of exact real interiors without detailed verified source data.

Terminal generator: regional form grammar influenced by available footprints and airport scale, credible internal geometry (entrance, check-in, bag drop, lounge, gate corridors, windows, washrooms, food vendors, security screening theatrical transition, jet bridges or apron bus, runway view), real physics/path connectivity, acoustic zones, accessible signage and material/lighting variation. Reuse quality source assets through standardized design kits and unique seed+source fingerprints, avoid the same low-poly interior everywhere. Distinguish `source-mapped`, `source-informed`, `author-composed`, and `unavailable` on every room and feature. Airport spaces must have working interactions rather than hollow façades; provide elevator/stairs and real colliders/navmesh.

**Security/privacy:** Airport access in DARK is entirely fictional game permission. Do not claim real-world privileges, bypass mechanisms, airport operational directions, or real boarding rights. All aviation simulation inputs represent sandbox controls, not actual flight procedures. Real-world air navigation datasets are context, not an operational pilot/navigation tool. No real live aircraft/flight tracking without explicit supported data/terms.

### D2. DARK's invitation-driven airport progression

Enter terminal while in free-roam member mode. NPC desk attendant may independently greet the player and offer **a fictional itinerary or lounge invitation**, informed by character's in-game identity, relationship, current resources, fictional economy and flight capacity. The player's avatar can accept/decline, browse departures, go to a café or lounge, choose a seat class in fictional inventory, walk to the correct gate, board and optionally explore cabin. Dark-specific special affordances remain authenticated, and never force interaction. NPC refusal, delay, overbooking, or being busy are valid world responses. Use coherent signage showing local time, gate, flight number, destination, delays and authoring source. Every boarding/check-in step has a readable status, cancel/resume, spatial animation/sound; genuine on-screen interactions are required. A static airport model and a modal 'teleport to Dubai' do not pass.

Travel access grammar should include `OFFERED -> ACCEPTED -> CHECKED_IN -> LOUNGE/WAIT -> BOARDING -> SEATED -> TAXI -> TAKEOFF -> CRUISE -> DESCENT -> LANDED -> DISEMBARKED -> ARRIVED`, with holds, refusal, cancel, reroute and offline/reconnect. Use explicit `TravelActor`, `Vehicle`, `Seat`, `Ticket`, `Leg`, `TerminalSpace`, `JourneyClock`, `ExpectedArrival`, `Offer`, `CabinActivity`, `SourceEvidence`. Keep source and fictional reservation identifiers separate; never display personal real booking codes.

### D3. Aircraft types, flight controls, and full-duration travel

**Three player-selectable modes per air itinerary:** (A) **Cinematic transfer** with controlled acceleration of simulated time and an honest duration summary; (B) **Long-haul embodied passenger journey** that supports real-clock equivalent duration chosen by player, including extended cruising, seat changing when permissible, window/aisle views, snacks/meal service, cabin light changes, social interactions, rest, restroom, music, films/authorized media, night-to-sunrise sky through window, flight progress, airport transfers, lounge/rest and safe resume after app suspension; (C) **Authorized player-pilot mode** in a dedicated fictional training/sandbox cockpit, with proportional controls and physics approximations. Aircraft variants include commercial jet, regional aircraft, small prop plane, helicopter, and player-custom aircraft where proper assets and flight controllers exist.

If LA→Dubai is scheduled at an authored representative ~16 hours, the user may choose to experience an **entire 16-hour real-time session** (at time scale 1) or accelerate by explicit scale (2×, 10×, 60× or cinematic transition). The example 16 h is not asserted to be the actual duration of every flight; calculate selected schedule by aircraft, city-pair, nominal airspeed, route geometry, wind model when licensed/current, departure/arrival epoch and authored delays; display assumptions. Arrival cannot happen earlier in world time than the travel clock permits. When device sleeps, preserve absolute UTC and committed events, resume with bounded deterministic aggregate clock progress; **do not require 16 hours of continuously rendered frames or vibration to count as journey duration**. Recover voice, NPC schedules, aircraft location, animations, optional authoring and ground streaming at arrival. Time scale changes are user-driven and logged in world state, not silently modified for performance.

Cabin features: personally walked seat selection, realistic seat/aisle/door/stairs position and animations, pilot/crew behavior, independent NPC choices, window procedural view tied to geodetic track and epoch, cloud layers and celestial position, inflight lighting and cabin attenuation, aircraft turbulence as bounded authored physical visual/audio event with opt-out for motion sensitivity, onboard information screen/billboards, available media and surface materials, flight route map, ambient chatter and scenic interactions. Ensure credible preflight→ground roll→rotation→climb→cruise→descent→approach→landing transitions. For cockpit, aircraft instruments/controls are internally consistent with simplified simulation, but do not assert real flight training or certified dynamics. Test actual keyboard/touch/gamepad control while flying; the player can ask to join the crew and choose pilot mode only under the game's fictional authority.

### D4. Global terrestrial, maritime, and unusual travel are first-class too

Bus/taxi/car: seat reservations, doors, chassis/collision, steering controls and passenger autonomy, traffic and signals, multi-modal transfers. Helicopter: rotor spin, takeoff/hover/translation/landing with audio and viewport, landing zone readiness, rotor wash and haptic cues; optional passenger vs pilot. Boats/yachts/ships: docks, mooring, buoyancy/water approximations, helm controls, wake/reflections, moving cabin/cameras, harbor route/sea travel and full-length cruise/time scaling analogous to flights; open sea surfaces are not fabricated streets. Rail: station, carriage, timetable, boarding, scripted or computed route, seats and long-duration journey. Balloon: vertical route, volume of air/height, sky sound gradient, view and safe landing; preserve historical requested experience. Each model has explicit mobility constraints and destination readiness.

**Global Earth contract:** entire valid geodetic domain addresses to land/ocean/terrain representation and source coverage. Travel across world source grids continues through streaming and coarse horizon proxies where licensed/detailed content unavailable. Never claim every exact global storefront, cockpit, lounge, yacht cabin or runway exists solely because an airport list or globe tile index exists. World source and authorship remain distinguishable. The user should see a consistent, attractive world at all coordinates, while high-detail asset quality and source authenticity are separately tested.

### D5. Asset acquisition and authentic travel scenes

A cinematic travel experience depends on **actual** high-quality source characters (faces/wardrobe), detailed road and ground meshes, realistic airport signage/terminal architecture, full cabin/flight-deck/vehicle interiors, car and aircraft animations, vegetation, rain, water and spatial recordings. The asset importer must maintain a full `assets/selection.lock.json` with license, format, source URL, acquisition/free status, attribution, version, file hash, bounding geometry, rig/bone metadata, material maps, LOD, collision status and close-up QA. Acquire concrete **free and appropriately licensed** high-fidelity Unity-independent source formats (`.glb/.gltf/.fbx/.obj` convertible with Blender tooling). Previous restrictive commercial-asset terms must not be silently bypassed; no raw source redistributing in a general SDK without permission. The commission explicitly excludes the previously rejected asset provider and anything dependent on it. Do not recommend paid service as a solution. Assets should be content-addressed/stored in legally permitted directories or object storage; avoid gigabytes in Git unless LFS/storage policy and quota verified. Each hero family receives at least one source-quality master and measured mobile optimized variant with native screenshot.

**Acquisition categories:** runway/taxiway/apron+aircraft ground operations; multiple terminal architectural styles and modular hall interiors; gate seating, signs/departure boards, shops, kiosks, lounges and restrooms; different airplane families, cockpit instruments and cabin furniture; private jets/prop planes/helicopters, car/taxi/bus/motorbike/bicycle; ferries/ships/yachts/harbor props; rain/wet PBR street skins, neon signs, signs in multiple scripts, water/lake/coast/ocean, foliage, mountain slopes and geographic region sets, sky/atmospheric effects; licensed ambient recordings and acoustic signal models. Register exact results `discovered`, `verified-free`, `rights-checked`, `downloaded`, `imported`, `render-tested`, `mobile-tested`; a source listing alone is never `acquired`. If exact assets do not exist for free, procedurally author original high-quality ones; report art-quality gaps honestly.

### D6. Travel acceptance tests — scenarios and witnesses

**Scenario T1 (airport arrival):** from the Tampa opening, move and interact with a living NPC, travel by road to a real-source airport location, walk into a 3D terminal with collision, browse a working departures board, converse with an independent NPC, accept an in-world offered ticket, visit a lounge, reach gate, board a modeled cabin, select a window seat, and observe actual movement. Record one continuous replayable set of events and capture real screenshots. Show source-authored distinctions.

**Scenario T2 (long haul):** choose LA→Dubai or another source-grounded pair, begin boarding/flight, observe timed engine/taxi/takeoff, sustain cruise at 1× for a bounded instrumented segment while the flight clock models real time, exercise 10× time scale to skip safely, then recover after app-background pause and arrive without duplicate tickets, seat loss or uncommitted NPC dialogues. Test a simulated 16-hour clock progression under a deterministic reference—no real 16-hour test necessary for initial functional check; full 16-hour physical-device soak is a separate performance/thermal test only when commissioned and practical.

**Scenario T3 (pilot + helicopter):** activate authorized fictional cockpit mode, operate real keyboard/touch controls, demonstrate takeoff, guided and manual flight, camera switch, safe landing and entity persistence. Helicopter similarly demonstrates hover/landing with appropriate sound and vibration cues. Neither scene is an automated static video.

**Scenario T4 (ocean + yacht):** walk onto a dock, board a moving vessel, choose helm or passenger, watch and hear water/wake, view coastline disappearing into open water, change time scale and return to an addressable harbor with valid collision/route state. Screenshots + audio/haptic logs tied to one event chain.

**Scenario T5 (global quality):** sample at least one airport/port in six continents and any polar/open-sea location, verifying actual global source coverage label, region-appropriate authored detailed near assets, atmospheric response, loading readiness, comfortable camera, and separately missing finer details. No claim of 'worldwide fully detailed' until full coverage manifests close.

## II-E. WORLD-LEVEL VERIFICATION MATRIX — color, signage, travel and multimodal sensory convergence

Treat Chromastratum, Billboardstratum, Somatostratum, and TravelProgram as **four interoperable subspace subjects** crossing all six Substrate University divisions. For every contribution to the university, report subject origin, math/physics known foundations, our construction, experiments, actual code paths, fixture seed, experimental result, quantified limits and links to real screenshots/audio/device evidence. Do not invent claims about novelty or all-world completion. Preserve no private/religious source material in public build.

**Independent functional gates:**

1. **Linear color:** tests for sRGB↔linear roundtrips, known RGB swatches, albedo vs normal map annotation, one output encoding, output tone map, palette gamut, no wrong ambient multiplier, optional calibrated reference colorbar from real screenshot.
2. **Light consistency:** same seeded scene at day/twilight/night with source-defined sun direction, shadow movement and exposure stability; dim interiors visibly readable; headlight/streetlamp/glowing shop window and wet reflections behave physically within declared approximations.
3. **Signs:** 2D and 3D text sampled at angled/distant camera poses; UI and critical wayfinding maintain readable contrast; digital airport board responds to game state, no z-fighting, clipping, text overflow or Unicode breakage.
4. **Water/rain:** smooth weather transition, wetness progression, drained puddle classes, rain impulse/particles, splash+footstep sound, moving reflections and bounded shader/render costs.
5. **Spatial audio:** occluded source gets filtered and quieter; camera orientation matches listener orientation; distinct traffic/footstep/aircraft/ocean classes; real decoded audio buffer; no clipping/clicks/loop gaps on tested recordings.
6. **Haptics:** typed motor cue sequence fired on device when available; disabled preference honored globally; cancellation/timer limits and motor cooldown verified; browser with no vibration continues with equivalent visible/audio cues.
7. **World travel:** walk→ticket→lounge→flight→arrival plus helicopter and yacht; 16 h fictional clock schedule test; optional accelerated and background-resume modes; seed replay, relation/vehicle persistence and fallbacks.
8. **Performance:** measured p50/p95/p99 frame and per-system costs, CPU memory, GPU texture count/bytes if available, tile downloads/cache, audio node count/dropouts, battery/thermal and haptic frequency for representative mobile routes. Capture more than a static scene.
9. **Asset realism:** license ledger actual source proof, original high-detail master, mobile GLB/PBR import with correct texture spaces and deformation; representative moving close-ups, no primitive-only hero props passed as cinematic.
10. **Global honesty:** source-backed roads/airfields vs fictional interiors traceable; no nonexistent flight/boarding entitlement mistaken for real; no inaccurate claim that source data includes global high-fidelity interiors.

**Timing and quantitative target guidance:** keep existing mobile p95 target 33.3 ms / 30 FPS where supported, report measured failures. Propose provisional actionable-sign text contrast conforming to WCAG for UI, per-frame adapted exposure caps (tuned by test), and stable audible event synchrony tolerance derived from measured device latency; do not enshrine invented industry constants. Test first on desktop/browser graphics, then Android Chrome/Capacitor and the Galaxy A16 when actually available. Compare dry-day vs wet-night render quality at same camera and a fully moving route. Screenshots alone cannot prove a haptic pulse or audio DSP.

**Universally required continuous sensory scene:** wet-night Tampa approach → street-corner sign → lit café → driving car → functional airport departure board → boarding interior → takeoff while day transitions → celestial sky and distant destination → arrival, continuing event/history authority throughout. A strict minimal playable strand is developed and tested early; the complete sequence is the integrated target. Every point must be a real interactive renderer result, not an illustrative cutscene.


## III. The first visual proof — **playable before polished prose**

**Within the first build increment**, deliver a genuine, continuously renderable third-person scene using real licensed/author-created high-quality asset masters: detailed asphalt and sidewalks, region-appropriate façades/storefronts, crosswalk, at least two animated humanoids, moving car, realistic sky and lighting, actual positional ambience and footfalls, camera collision and a player who can walk and turn on keyboard AND touch screen. Include pause, resume and reset to safe spawn. This scene starts near the source-backed Tampa anchor, with an **explicitly fictional** initial café/façade. Ground collisions must track the actual mesh; the character must not fall through unloaded tiles.

Before any extra documentation, run this in a browser and save **actual browser screenshots and a short screen recording** at desktop and Android-sized viewports. The image must contain nonblank rendered geometry. A screenshot of source code, a 3D reference image or a static composited mockup is not evidence. If high-quality art sources cannot be fetched, produce faithful authored alternatives, show provenance, and mark visual review honestly.

**Immediately afterward**, make a WORLD selector or in-world transport menu that can travel to three separated source-backed world locations (e.g., Tampa, London, and a third continent), loads the new coarse terrain and local context, updates geographic coordinates and sky/weather source clock, and preserves player world state. Realistic sourced streets are required only where actual source data exists; never invent missing data as measured streets. Show safe loading and cancel behavior. These locations are examples, not global hardcoding: the same resolver must accept valid coordinates worldwide including oceans, poles and dateline.

## IV. The renderer-independent generative core

Keep these independently testable typed modules with modular imports (names illustrative):

1. `dark-core/world`: authoritative local world state, entity registry, clock, deterministic actions, actor roles, object identity, source provenance and expected-version commits.
2. `dark-core/grammar`: operational `Σ,Q,G,I,δ,denotation,projection,V`, effect permissions, refusal witnesses and Ingrammatica contextual ranking. A legal description is not automatically an enacted event.
3. `dark-core/folds`: Plicastratum certified motifs, exact unfold paths and evidence; recurring patterns can be promoted only after tests. Preserve finite expansion and cost budgets.
4. `dark-core/clock9`: n-gram/glossary-backed proposal and typed small-program compilation; optional local compact language-model connector separated from the core. CLOCK9 proposes; world authority admits. Do not claim neural acceleration without controlled measurement.
5. `dark-core/causality`: BORNE event dependencies, causal cones, scoped observers, deterministic keyed randomness, cancellation, revision and masked effects.
6. `dark-core/protocols`: PURL/SEURL typed address/verb/resolve, pure inspection, authenticated effects, immutable result witnesses, browser-friendly serialization and protocol conformance.
7. `dark-world/geography`: WGS84, ECEF/ENU, local rebasing; authoritative source grids and transport graph overlays. Separate verified geography, model estimates, and fictional plate/portal changes.
8. `dark-world/population`: virtual identities, aggregate cohorts, nearby active NPCs with individually persisted memories and schedules, no massive per-entity JS objects; deterministic promotion/demotion and sparse relationship graphs.
9. `dark-graphics/three`: render graph, camera, sky, PBR asset streaming, instancing, LOD, day/night, water/weather, animation and audio adapters. Rendering never becomes a second authoritative world state.
10. `dark-physics/rapier`: physics bodies, joints and characters, kinematic player controller, seats, wheels and safe relocation; authoritative gameplay action witnesses govern allowed physics effects.
11. `dark-content`: HOMELESS-specific scenes, optional storylets, NPC behaviors, cinematic opening, vehicles, music, ambient events and contributions.
12. `dark-platform/capacitor`: same game built for Android with local assets and source-confirmed remote fetches.

**Seven-strata adapter** remains a documented optional checklist for each computational subject—metastratum, epistratum, superstratum, substratum, hyposubstratum, infrasubstratum, cryptosubstratum—not an assumed cosmic law. No arbitrary numerical symbolism may override tests.

## V. Planetary source data and quality promises

Use the existing pinned global datasets FIRST. Define a `WorldCellManifest` with stable global ID, tile bounding region, WGS84 transform, source release/epoch/datum, provenance/license, terrain LOD, road/building source state, asset bundles and checksums, collision readiness, local active NPC budget, cache status and quality tier.

- **Land/sea:** Natural Earth shape plus GEBCO global relief at its declared resolution; where finer verified elevation is legally available, composite with datum-aware rules. Treat GEBCO as a model with missing precision and do not use it for navigation safety.
- **Roads/buildings/addresses:** use Overture's partitioned transportation/building/address data and explicitly licensed OSM-derived extracts. Query/index only the demanded partitions; build real geometry from measured footprints where available, then add regional authored façades and quality-scored artist assets. Licenses vary, especially ODbL-derived material; produce `licenses.lock.json` and attribution. Existing original Tampa graph is a first fixture, not the universal map implementation.
- **3D tiles:** OGC 3D Tiles via `3d-tiles-renderer` or a verified compatible adapter. Tile-server rights, quota, caching and offline terms must be explicitly checked. A renderer library alone is not a worldwide photogrammetry dataset. Zero-cost core launch cannot depend on a paid map service.
- **Weather and sky:** seeded offline physical approximation with a source-status flag; optional licensed live forecast feed. Real celestial ephemeris/star catalogs where available, epoch-dependent visibility, observer lat/lon and atmospheric limitations. Fictional effects as explicit overlay.
- **Ocean and mountains:** true land/sea boundaries, water surface, terrain meshes with triangle/texture LOD, normal/tangent quality and collision only where geom readiness verified. Oceans and polar regions remain valid world cells, not imaginary roads.
- **Transport:** road, walk, aircraft and marine networks are separate; speed/route constraints and collision readiness are real predicates. Air travel can switch simulation fidelity, then stream target region before landing. A cinematic plane animation is not a tested flight system.

**Reality contract:** A location may be source-backed in one layer and fictional in another. Every visible object has a data-status class: verified, derived/interpolated, authored, or unavailable. Do not claim Google-Earth-equivalent photographic truth, complete interiors, every human resident, or AAA-wide scene detail without source evidence and measurable implementation.

## VI. Art acquisition, animation and quality

Create a `content-lock.json` with per-asset source URL/license/allowed redistribution, file SHA, original format, materials, triangles, LOD status, import status, native render status, and quality reviewer. Categories:
- hero human faces, hair, garments and 25+ everyday actions; independently rigged bodies, correct scale, tracked feet, seated contact;
- cinematic street surfaces, shop windows, masonry, signs, benches, streetlights, urban clutter, plants and trees by biome;
- cars with proper wheels, steering, lighting, doors and at least one usable interior; buses, bikes and trucks;
- aircraft, helicopter, boats and marinas with playable interactions and progressively improved interior completeness;
- terrain/coasts/mountains, foliage, water, weather, clouds, sky, night reflections;
- regional acoustic atmospheres, footsteps, traffic, voice performances and vehicle sounds.

Start by inspecting actually acquired assets and source code in `/assets`, `/data`, and `/unity` of the existing repo **for formats and rights**; the renderer imports supported FBX/OBJ through offline Blender conversion to optimized glTF/GLB. Use original artwork or specifically verified free high-fidelity assets from legitimate suppliers. Do not move restricted masters into a distributable SDK; attach fetch/conversion scripts when redistribution is limited. Generic procedural cubes/capsules are instrumentation, not final cinematic assets.

**GPU fidelity tiers:** low-power device 30 fps target, streamed/static PBR and conservative shadow/reflection costs; desktop richer shadows, post-processing and detail. Record device-specific fidelity tradeoffs. DO NOT use bloom/fog or a static sky to conceal missing close-up detail. Maintain one coherent authored look, not unrelated pack styles.

## VII. Physics and believable agents

Run Rapier with a fixed 60-Hz desired simulation step and measured substep catch-up cap; benchmark whether 30/60 Hz authoritative simulation is preferable on low-end phones. Use WASM feature detection, fallbacks and immutable state packets to render interpolation. Gravity, collision, slopes, stairs, kerbs, foot placement, camera obstacle avoidance and grounded/airborne transition must work. Moving vehicles have checked driver/passenger ownership, safe doors/seats, ordinary traffic behavior and explicit manual/autonomous choice. Scripted cinematic movement may not pass through collision geometry. Implement observation radius, environmental interest levels, speech distance/occlusion and readable NPC behavior.

Implement active NPCs with real schedules/goals/refusals and authored interactions. A globally addressable virtual population can be huge, but live CPU simulation stays limited to active and causally relevant agents with bounded cohort summaries. Every user-visible statement of scope must distinguish identity capacity, measured active agents and worldwide source coverage.

Use a stable schema so a third-party AI or agent can propose typed game actions without running the same code as the renderer. It can observe public facts and make valid requests; independent authorization gates enforce writes. Offline solo gameplay works without agent APIs.

## VIII. First three playable generative mechanics — minimum early proofs under the six-division foundry

Deliver at least **three playable** domain-generation features using actual mathematical kernels, each with visible player effects and reproducible witnesses. These are the early integration proofs; implement the complete six-division subject mapping and progressive demonstrations specified in Section II-A without waiting for every academic topic to be ported:

1. **Plicastratum street walks.** Encode player route into turns/junctions/length features, match source-backed candidate routes across distant regions with a saved tolerance/null baseline; learn a symbolic traversal. Allow an explicitly fictional `visit`, `overlay`, or `braid` transition that truly changes rendered experience, subject to loading and user choice. Use existing checked Plicastratum tests, not only a text paragraph.
2. **BORNE reaction propagation.** A committed local act (help, traffic interaction, NPC social event, authored shop change) has causal dependencies; nearby and distant affected systems recompute only when dependencies change. NPC memories and world cues change; graph/replay verification proves which actions caused which effects.
3. **CLOCK9-authored world operation.** Tiny non-neural grammar generates/chooses a typed world program (light/color/approved sign change, alternate ambient music, admissible navigation cue), validates it, executes safely, records provenance and optionally promotes reusable motifs. Pure n-gram generation is enough for baseline; neural augmentation is optional. The effect must be perceptible in the **actual Three.js world**.

Use one shared `SubjectAdapter` family so external generators can eventually create signs, music, sound, assets, and world behaviors, but implement concrete primitives with tests first. Rendering quality is independent from generative proposal validity.

## IX. Android installation and packaging

The same web source must build and run in:
- desktop Chrome/Firefox (document versions);
- Android Chrome mobile browser;
- **Capacitor Android debug APK** using locally generated Gradle/Android project with no app-store signing credentials required.

Prefer a supported Android SDK/JDK/Gradle path in Claude's actual environment. If not present, implement `npm run android:prepare` and `npm run android:build` plus a **zero-new-cost** Android GitHub Actions build workflow with a reproducible lockfile and artifact upload (no production signing keys). Keep the job under repository-owner approved workflows and current free quota; never activate paid compute without explicit permission. Bundle playable offline opening and WASM runtime assets; remote tiles use versioned manifests, bounded disk cache, expiry and observable failures. Test Android back-button, app pause/resume, orientation, audio focus, WebGL context loss, touch controls, minimum storage, and network interruption.

Measure Browser vs APK on the same phone. An APK is not a claim of native graphics acceleration beyond what Android WebView offers. If a genuine native renderer profile becomes useful, evaluate it only as a separate evidence-based experimental adapter after the web+Capacitor route is playable.

## X. Test program and evidence

**Tests are executed behavior, not wishes.** Use Vitest/Node for portable contracts, Playwright with real Chromium WebGL for graphics integration, and Android instrumentation/ADB on any actually accessible device. Report `PASS`, `FAIL`, `BLOCKED` or `NOT_RUN`, with command, environment, revision, artifact and screenshot hash.

**Required numeric/math tests:**
- deterministic CLOCK9 baseline (22 previously executed checks), world-engine contract (7), BORNE (16), Plicastratum (13); rerun from bundled original sources or port fixtures after importing them;
- WGS84 geodetic↔ECEF↔ENU roundtrips including poles, ocean, high mountains and antimeridian; distance/error bound explicitly specified;
- Rapier ground contact/settling, collision groups, kinematic player slope movement, fixed-step replay under seeded fixtures;
- fold/unfold identity and finite expansion, typed grammar refusals, prefix-address roundtrip, no write from reads;
- causal graph propagation, saved/restored NPC identity across tile retirement and return, selected actor replay;
- tile load ordering; cancellation/disconnect/duplicate response; availability and collision readiness before spawn;
- recorded source-to-display provenance, missing map details never represented as verified geometry.

**Required real Three.js/browser integration tests:**
- actual `THREE.Scene`, `PerspectiveCamera`, `WebGLRenderer` and a GLB asset imported successfully;
- visible shaded geometry pixels in a WebGL screenshot, not a black/blank frame;
- raycast intersects a known street collider and not a hidden/non-interactive object;
- `InstancedMesh` transforms correspond to physics/canonical source objects;
- textures/geometry and 3D tiles disposed/evicted without growth beyond declared memory budget;
- context loss/recovery; screenshot of day and night PBR, rain, two animated humans, one moving vehicle;
- third-person keyboard and touch movement, arrival, conversation and learned world transform;
- continent-to-continent terrain transition with measured source metadata and target cell readiness.

**Performance gates:** set budgets from actual device memory/GPU and verify on phone, not emulator alone. Provisional mobile target **sustained 30 fps; p95 ≤ 33.3 ms** over a 10–20 minute representative route at the chosen adaptive tier. Record resolution, tier, p99, thermal state, peak heap/GL allocations, network bytes, tile latency, hitch intervals and audio glitches. Benchmark WebGL2 and WebGPU only on devices that support both. Smoothness, fidelity and download size are distinct axes. When not measured, report `NOT_RUN` rather than fabricated values.

**Visual gate:** continuous gameplay recording at user-visible quality, inspected close-up PBR textures and character deformations, camera, traffic, lighting and atmosphere. Do not claim photorealism by shader names or asset screenshots alone.

**Global gate:** coordinate resolution anywhere, source-backed world surface, sampled worldwide safe transfers, land/ocean and elevation tests, geographic coverage report. Detailed world photo-accuracy and every building's interior are explicitly separate unsatisfied gates until actual data proves them.

## XI. Immediate execution order for the NEXT Claude Code Cloud run

0. `git status`, branch, origin and current checkpoint; confirm active HEAD. Preserve previous tested work, commit history and any concurrent edits. Read `CLOCK9` and `BORNE` sources when available and re-run their tests. Do not wait on historical attachments that aren't mounted.
1. Write this as the one **active** `HOMELESS_DARK_WEB_CONSTITUTION.md` (v3), commit normally and mark previous renderer-specific requirements superseded in one short `docs/renderer-migration.md`. Historic specs remain archival evidence, not operative instructions. Determine selected npm versions from current upstream compatibility; write lockfile. Pin current Substrate University repo SHA and start the complete six-division subject inventory in parallel with visual startup (Section II-A).
2. Bootstrap `apps/homeless-web` and `packages/dark-*` TypeScript monorepo modules with Vite, React, Three, React Three Fiber, Rapier, assets, input and world-state. Make `npm run dev` work as early as possible and fix actual errors. Add meaningful npm scripts `test`, `typecheck`, `build`, `test:e2e`, `android:prepare`, `android:build`.
3. Import initial cinematic source art, actual camera, locomotion, scene-linear physically credible lighting/color and billboard grammars, physics, spatial audio, browser and native haptic adapters, and keyboard/touch controls. Produce first **real** browser screenshot and short recording, inspect artifacts and fix flaws. Do not stop at code generation.
4. Wire source-backed initial geography, global coarse Earth view, source manifest, new-world location selection and continent transfer. Show real streamed world visuals at multiple continents under valid source-resolution constraints.
5. Wire actual NPC interactions, airport/ticket/lounge/cabin/flight/ship travel modes and travel time controls, event witnesses, Plicastratum/BORNE/CLOCK9/Chromastratum/Somatostratum perceptible mechanics and the six-division foundry adapters. Implement each through one concrete before/after playable scenario and tests. In parallel, implement II-B Chromastratum and II-C Somatostratum so wet daylight/night lighting, functional billboard geometry, audio and opt-in haptic contract form part of the first immersive street rather than later visual polish. Then implement functioning in-game airport/travel interactions under II-D.
6. Ship first actual Android debug APK from the same source via local Android build or free available CI. If environment lacks Android build, record exact tool prerequisite and deploy tested web URL while completing independently actionable tasks. Never rename source code as an APK.
7. Capture screenshots and clips from actual browser and any actual APK run; record six-division research contribution manifests with verified artifacts, keep image and source hashes with a concise capability report. Commit tested work and leave a clean resumable checkpoint only after significant executable progress.

**First acceptance checkpoint:** I can open HOMELESS on a URL, move a high-quality character through a genuinely rendered street with real collision, see/approach another active character, hear spatial audio, and travel to another globally addressed location while the scene streams without losing control. This experience must be built before expending most of the session on documents, research lists or dashboards. This is an incremental proof, not a claim that every worldwide AAA surface is already complete.

**Second acceptance checkpoint:** Same game launches as a locally installable debug APK; tested native Android behavior and measured quality are reported truthfully.

**Ultimate commission:** worldwide, high-fidelity, generatively evolving HOMELESS powered by the renderer-neutral DARK engine, preserving all playable world, transport, social, sky/audio, programmable-language and source-data obligations. The incremental deliverables do not reduce this target.

## XI-A. Non-interruption and execution sequencing: playing HOMELESS is the measure of progress

Claude must deliver executable progress **within this run**, not exit after writing a design paper. The migration starts with a playable web route (existing assets and collision); then qualitative color, billboards, directional sound and weather with real screenshots; next airport/boarding and authored cabin travel; then global coverage/travel, sky and ship modes; Android build after the web experience works. Native APK delivery and long-duration simulation are parallel testable lanes after a running browser game exists. Blockers are scoped to their lane; an unavailable paid tile service or Android build host does not block walking/audio/lighting/airport procedural authoring.

Use read-only first to inspect the latest repository state, check `git diff`, and preserve concurrent work. Create an issue/checkpoint only for a genuinely uncompleted acceptance gate, not to replace coding. Each concrete user-facing feature requires at least one source file, test result and ideally a real screen/audio capture; screenshots must be taken from an **actually running engine**. If one subsystem misses its test, record that failure and continue independent authorized tasks. Follow the single canonical source of truth for geography, actor identities, and signed/authorized world writes.

**No tooling sleight of hand:** Use the available supported JS/WebGL2/Capacitor path; do not suggest costly external services, changing the renderer, substituting a static cutscene, or quoting consumer AAA-game visuals as built proof. The user explicitly says Three.js-level visual quality can be acceptable if **immersion**—lighting, atmospheric color, contextual sound, tactile feedback, signs, travel and living social behavior—is strong. Prioritize those strongly. Never downgrade to primitive-only hero art and call it complete.

## XII. Completion response contract

Report (1) playable URL and controls, (2) real screenshots/recordings with exact commit, (3) which worldwide data is ingested vs missing, (4) passing/failing tests actually executed, (5) Android APK path + SHA256 if built, (6) Chromastratum color-science and signed billboard evidence, spatial-audio and haptic evidence, (7) airport/terminal/cabin/flight and boat experiences that are genuinely interactive, including 1× and accelerated time controls, (8) known visual/performance/source-data limits, (9) actionable outstanding work, and (10) source commits. Give exact evidence, no arbitrary completion percentage. A successful program build does not mean a complete world, and a failed APK build does not negate verified world-engine progress.

**Execute the work now. The game must become playable.**

## XIII. Research-source ledger — primary technical references checked 2026-10-21

This bibliography is part of the commission's executable research mandate. These sources support the named **existing technologies**. Our proposed `Chromastratum`, `Billboardstratum`, and `Somatostratum` composition layers are project constructions, not claimed publications or universal theorems. On integration day, recheck exact versions/terms; link source snapshots in an asset/technology registry. Do not fetch large libraries that are irrelevant to the next playable acceptance milestone.

| Field | Verified primary documentation | Technical bearing |
| --- | --- | --- |
| Three linear color | https://threejs.org/manual/pages/color-management.html | Color spaces, proper map annotations, linear working representation, output conversion and double-encoding pitfalls |
| Three filmic output | https://threejs.org/docs/pages/OutputPass.html and https://threejs.org/docs/pages/global.html | Tone mapping/output and available AgX/ACES options |
| Color appearance | https://www.w3.org/TR/css-color-4/ | OKLab/OKLCH, gamut mapping, chroma and lightness |
| glTF PBR | https://www.khronos.org/gltf/pbr/ and https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html | Metallic/roughness, transmission, emission, normal/occlusion, BRDF material logic |
| Environment lighting | https://threejs.org/docs/pages/PMREMGenerator.html | GGX roughness-aware prefiltered environment maps |
| Sky | https://threejs.org/docs/pages/Sky.html and https://threejs.org/docs/pages/SkyMesh.html | Atmosphere and current renderer-specific sky models |
| Area lights | https://threejs.org/docs/pages/RectAreaLight.html | Area-light rendering and the lack of native shadow support |
| WebGPU graphics | https://threejs.org/manual/pages/webgpurenderer and https://threejs.org/manual/pages/webgpu-postprocessing.html | Experimental renderer path, TSL, optimized postprocessing, WebGL2 fallback |
| Compressed textures | https://threejs.org/docs/pages/KTX2Loader.html | KTX2/Basis Universal transcoding to GPU formats |
| Draw calls | https://threejs.org/docs/pages/InstancedMesh.html and https://threejs.org/docs/pages/BatchedMesh.html | Large compatible instanced/batched scene populations |
| 3D text and joined scripts | https://github.com/protectwise/troika/blob/main/packages/troika-three-text/README.md | SDF 3D text, kerning, bidirectional and joined scripts |
| Spatial sound | https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Web_audio_spatialization_basics | HRTF PannerNode, distance and cone attenuation |
| Custom DSP | https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet | Dedicated low-latency audio thread |
| Haptics | https://capacitorjs.com/docs/apis/haptics and https://developer.android.com/reference/android/os/VibrationEffect | Plugin and native waveform envelopes |
| Browser vibration | https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate | Feature detection, user activation, unsupported-device fallback |
| Visual accessibility | https://www.w3.org/TR/WCAG22/ | Contrast, non-text, animation, and flashing requirements |
| Airport records | https://ourairports.com/data/ | Public-domain airports/runways/navaids; not full terminals or real schedules |
| US aviation geometry | https://www.faa.gov/air_traffic/flight_info/aeronav/Aero_Data/ | US aeronautical data; epoch/regional boundaries |
| Historical routes limit | https://openflights.org/data.php | Route dataset updates stopped in 2014; cannot claim current schedules |
| Worldwide tiling | https://github.com/NASA-AMMOS/3DTilesRendererJS | Streaming/rendering licensed 3D Tiles in Three/Babylon; no universal license for source tiles |
| Restricted tiles example | https://developers.google.com/maps/documentation/tile/policies | Some photorealistic tiles forbid unapproved caching/extraction/offline use; a zero-cost offline native game cannot assume rights |
| Sky position source | https://ssd-api.jpl.nasa.gov/doc/horizons.html | Epoch-dependent solar system ephemeris service; data-provider usage policy applies |

**Source/code separation:** University formalism and portable tested research are user/project sources; this source ledger is external background verified on the date shown. Measured outputs from Claude must be tagged `[M]` only after a matching executed instrument/fixture, whereas speculative aesthetic benefits stay `[H]`.
