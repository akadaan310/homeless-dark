# v4.1 audit — what the first ASTRO game frame proves, and what it does not

Checkpoint: `7a029bd` on `ccr-b3bb984f-7etq1r` (parent `71e9f584`; `main` = `622e868`, untouched).
Frame: `evidence/astro/game-first.png` (Chromium 141 headless, SwiftShader Vulkan, 1280×720, DPR 1, quality=high).

| Area | Status at checkpoint | Evidence / gap |
|---|---|---|
| Native WebGL2 renderer (no Three in production) | IMPLEMENTED | app imports: 0 `three`/`troika`; frame drawn by `@astro/render-webgl2` |
| Typed scene, framegraph, command IR, compile cache | IMPLEMENTED | `lastGraph` = shadow→forward→bloom→output; CommandList rejects world effects |
| Shader DSL → GLSL/WGSL/CPU | IMPLEMENTED for the wave kernel only | DSL wave = CPU solver (<1e-5); GPU = CPU (4e-8, lab) |
| Pixel/field physics in gameplay | NOT IMPLEMENTED | wave field only drives a diagnostic overlay lens; no material reads it |
| Grass | RENDERABLE ONLY | a textured ground plane; no blades, no contact, no recovery |
| Glass | RENDERABLE ONLY | transparent boxes with static colliders; no damage state |
| Wet roads | PARTIAL (appearance) | wetness/puddle shader driven by BORNE; friction, spray, splash: absent |
| Water | PARTIAL (appearance) | scrolling normals; no fluid coupling |
| Buildings | PLACEHOLDER | extruded footprints + shader windows; no parapets, openings, doors (except café) |
| Characters | PLACEHOLDER-GRADE motion | in-place clips, cadence matched to speed; no foot IK/lock; NPCs visibly similar |
| NPC agency / memory / traffic / car | PRESERVED from v3 | same dark-core authority and Rapier; not yet re-verified on ASTRO by replay |
| UI | FAILS §14 | HTML dashboard (World/Rain/Time/Settings/Research/Pause, perf) visible in play |
| Sky / celestial | PARTIAL | analytic sky; player-view stars are decorative random points (not catalogue); sky lens = catalogue above horizon; no full-sphere lens |
| Oracle comparison | NOT RUN | legacy capture not yet taken |
| WebGPU | NOT RUN | `requestAdapter()` null on this runner |

The screenshot is an engine-capability witness, not a production or physical-world acceptance.
