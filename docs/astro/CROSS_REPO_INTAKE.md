# Cross-repository source manifest and intake decisions (§003, §009)

Inspected read-only on 2026-10-23 (blobless clone, no pushes). Exact refs: `evidence/astro/baseline-before.json`.

| Repository / ref | SHA | Content | Intake decision |
|---|---|---|---|
| akadaan310/homeless-dark `main` = `ccr-b3bb984f-7etq1r` | 622e868cf3a4 | v3 web client, DARK packages, data, Unity lane | **Base of this work.** |
| akadaan310/HOMELESS `main` | 371491980b53 | Unity-native fixture (45 files), `portable/` Python kernels (geo, life, plates, population), governance | Reference only. Portable kernels overlap `dark-geo`/`dark-core`; not re-ported. |
| akadaan310/HOMELESS `codex/one-shot-implementation` (ahead 6 / behind 4 of main) | d9f6b54caec5 | Android app, voice artifacts, `unreal/Homeless` C++ project, `web/src/*.mjs`, `data/sky` (HYG 4.1, JPL Horizons fixtures) | `data/sky/horizons_references.json` (4 JPL Horizons DE441 RA/Dec records, public data) **imported** as the ephemeris test fixture. HYG 4.1 (CC BY-SA 4.0) **not imported** (share-alike obligations unreviewed). `unreal/Homeless` **not imported**: Unreal-dependent project, Epic EULA boundary (§008, §117). Android/voice artifacts deferred (mobile is later scope, §122). |
| akadaan310/HOMELESS `codex/ollama-a1-homeless-2026-10-20` (behind main) | fdd5776b0cf3 | single README handoff | Nothing to take. |
| akadaan310/abedkadaancom (pinned 6a0f5eaa) | 6a0f5eaa8dd3 | Substrate University registry, math, `src/data/stars.json` | `stars.json` (d3-celestial 0.7.35, BSD-3-Clause, Hipparcos mag ≤ 5) **imported** as `data/sky/hipparcos-mag5-d3celestial.json`. Registry stays read-only. |
| isnaad / snad / anwaa / purl | — | not cloned | Methods only (§020); no content ingested. |
| ASTRO_UI_SOURCE_PACK_V4.zip | see `audit/FILE_MANIFEST_SHA256.json` in the pack | 118 opaque symbols, 702 abstract templates, schemas, WebGL2 lab, CHEMISTRATUM bundles | Symbol list, template schema, pixel/tetrad schemas and O-Chem `atlas.json` **imported as reference data** into `packages/astro-glyphs/data/`; algorithms re-implemented and tested in TypeScript. |
