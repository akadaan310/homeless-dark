# Renderer migration (2026-10-21)

`HOMELESS_DARK_WEB_CONSTITUTION.md` (Chromastratum Web-Native Engine Constitution 3.0) is the single **active** constitutional prompt for rendering, packaging and product delivery.

Superseded as operative instructions (kept as archival evidence, unchanged):

- `HOMELESS_DARK_STANDALONE_CONSTITUTION.md` — Unity 6 / URP renderer, Unity-only asset acquisition and the native Unity Android route.
- `docs/unity-build.md`, `docs/native-install-options.md`, `unity/` — the Unity client project and its build notes.

What carries forward through typed adapters rather than being discarded:

| Earlier work | Web-native use |
|---|---|
| `unity/Assets/HOMELESS/Content/**/*.fbx` (CC0 original authoring, MakeHuman CC0 humans with Walk/Talk/Wave/Seated clips) | converted to optimized GLB by `tools/web/build-assets.mjs` |
| ambientCG CC0 PBR sets (`unity/Assets/HOMELESS/Art/Materials`) | downsampled to 1K web textures |
| original PCM audio and English eSpeak NG speech cache | copied with hashes; captions preserved |
| `data/geography` (OSM Tampa fixture, GEBCO 2025 grid, Natural Earth, OurAirports) | derived into browser runtime data by `tools/web/build_data.py` |
| `packages/dark_server` (Python world authority) and `packages/com.homeless.dark` (C#) | remain test fixtures / opt-in authority; **not** the browser runtime |

The browser runtime is `apps/homeless-web` (Vite + React HUD + imperative Three.js + Rapier) over renderer-neutral `packages/dark-*`.
