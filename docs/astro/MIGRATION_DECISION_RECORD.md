# ASTRO v4 migration decision record (§001, §049)

Active commission: `HOMELESS_DARK_ASTRO_UI_CONSTITUTION_V4.md` (installed 2026-10-23, SHA-256 in `evidence/astro/baseline-*.json`).
`HOMELESS_DARK_WEB_CONSTITUTION.md` (v3) is immutable history; every non-render v3 obligation carries forward.

## Superseded by v4

| v3 clause | Status under v4 |
|---|---|
| §I `Renderer: Three.js … React Three Fiber` | **Superseded.** Production draw path is `packages/astro-render-webgl2` on a raw `WebGL2RenderingContext`; optional `packages/astro-render-webgpu`. |
| §II-A.J Three.js leads (`WebGLRenderer`, `GLTFLoader`, `KTX2Loader`, `InstancedMesh`, `three-mesh-bvh`, `3d-tiles-renderer`, `Sky`/`SkyMesh`, `OutputPass`, `PMREMGenerator`) | **Superseded** by ASTRO equivalents: own GLB reader (meshopt decoding via `meshoptimizer`, MIT), own instancing, own sky scattering shader and SH/IBL, own tone-map pass. 3D Tiles adapter remains NOT_RUN. |
| §II-B5 `troika-three-text` | **Superseded** by ASTRO SDF glyph atlas (canvas raster → Euclidean distance transform). |
| §X "Real Three.js/browser integration tests" | Re-expressed against the ASTRO canvas; the Three.js app is an oracle only. |

## Carried forward unchanged (semantics, not code paths)

World authority and journal (`packages/dark-core`), BORNE, Motion/Event grammar, Plicastratum, CLOCK9, WorldProgramCompiler, NPC minds and tiers, WGS84/ECEF/ENU and terrain streaming (`dark-geo`), Chromastratum colour/light/wetness/sign grammar (`dark-visual-grammar`), Somatostratum audio/haptics, TravelProgram, six-division subject adapters, all source data and asset locks, Rapier physics, Web Audio, captions, haptics, persistence, controls, Tampa origin.

## Legacy oracle (§049)

`apps/homeless-legacy` is a byte-for-byte copy of the v3 Three.js client at `622e868` with the PWA removed. It builds with `npm run build:legacy`, is never deployed, and is not imported by `apps/homeless-web`. The production bundle audit (`tools/astro/bundle-audit.mjs`) fails if any `three` module appears in the production graph.
