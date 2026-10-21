# HOMELESS / DARK — current state and continuation

Read this first when you resume, whether in this session or a new one. The active constitution is `HOMELESS_DARK_WEB_CONSTITUTION.md` (v3). `docs/renderer-migration.md` explains what it supersedes.

## Run it

```sh
npm install            # .npmrc sets legacy-peer-deps
npm run dev            # http://localhost:5173  (add ?quality=low or ?quality=high)
npm test               # vitest: 100 tests across packages/dark-*
npm run typecheck
npm run build          # static site in apps/homeless-web/dist (PWA)
```

**Hosting:** this is a static Vite site, so Vercel works. Import the GitHub repo in Vercel with the default settings. `vercel.json` already sets install `npm install`, build `npm run build` and output `apps/homeless-web/dist`. Netlify, GitHub Pages or any static host also work if you serve `apps/homeless-web/dist`.

**Controls:**
- Movement: WASD or arrow keys to move, Shift to run, drag to look.
- Interaction: E talks and uses things, F gets in or out of the car, Space jumps (or brakes in the car).
- Menus: Esc pauses, M opens the world panel, and the backquote key opens research.
- Touch: the left stick moves and dragging on the right side looks around.
- Top-right buttons: ⛶ toggles full screen and ☰/✕ shows or hides the dev menus. The choice is saved in your browser.

## What exists (working and committed)

- **Packages** (`packages/dark-*`, all pure TypeScript and unit-tested):
  - `dark-core`: world authority with a hash-chained journal, roles, schemas and budgets; the Motion/Event grammar (DFA plus realizability); the Plicastratum Re-Pair folds, a port proven equivalent to the university's `fold.ts`; CLOCK9 n-gram proposals; BORNE propagation; the WorldProgramCompiler; and NPC minds with World Loom tiers.
  - `dark-geo`: WGS84, ECEF and ENU conversions, Vincenty distances, solar and lunar position, GEBCO tile streaming cache, the cell resolver and a floating origin.
  - `dark-visual-grammar` (Chromastratum): sRGB, OKLab/OKLCH and CIEDE2000 colour maths, WCAG contrast checks, light profiles, the wetness model, the VisualProgram DSL and sign layout.
  - `dark-somatostratum`: haptic alphabet with budgets (off by default), acoustic grammar and six-lane telemetry.
  - `dark-travel`: the TravelProgram state machine, seats and tickets, JourneyClock (1× to 3600×, survives suspension) and fictional departures.
  - `dark-subjects`: six division adapters, the subject registry and port-equivalence fixtures against the university source.
- **Game** (`apps/homeless-web`): the playable Tampa street at N Dale Mabry Hwy & W Spruce St.
  - Roads and building footprints come from OSM (ODbL). Façades come from FacadeGrammar. The café, its sign, its mural and its interior are fictional.
  - Ana, Bo and pedestrians have schedules and memory, can refuse a ride offer, and speak captioned lines with spatial audio.
  - The car is drivable. It uses a Rapier raycast vehicle, doors that open and close, and boarding that the grammar must admit.
  - Traffic follows the lanes and stops at signals.
  - Day turns to dusk and then wet night. Sun and moon follow the ephemeris. Lighting uses PMREM sky IBL, AgX tone mapping and bounded exposure.
  - Rain triggers a BORNE chain: wet roads, puddles, splashing footsteps and headlights. When it rains, Bo reprograms the café sign through CLOCK9 and the compiler.
  - Café music is generated from interval orbits.
- **Data/assets:**
  - `tools/web/build-assets.mjs` converts the repo's CC0 FBX files to GLB with LODs. It also prepares the ambientCG and Poly Haven CC0 textures and the audio, and records all of it in `assets/web-selection.lock.json`.
  - `tools/web/build_data.py` produces the Tampa ENU cell, 648 GEBCO tiles, Natural Earth land and country rasters, and 4k airports.
- **University:** `university-source.lock.json` pins abedkadaancom at `6a0f5ea`. `docs/research/university-subject-matrix.md` covers all 62 topics. Regenerate both with `npm run university`.
- **Evidence:** real headless-Chromium (SwiftShader) captures are in `evidence/web/` (day, wet night, driving).

## Written but NOT yet wired into the UI (next step)

- `engine/globe.ts`: Natural Earth rasters, GEBCO tile cache and the cell resolver for any lat/lon.
- `engine/coarse.ts` and `engine/coarseRegion.ts`: terrain for any coordinate, with curvature drop, biome splat, sea, a safe spawn, an ocean platform and a deep-water guard.
- `engine/airliner.ts`: a generic procedural airliner.
- `ui/TravelPanel.tsx` is still a stub.

## Continue in this order

1. **TravelPanel:** add destination buttons (Tampa, plus London EGLL, Dubai OMDB, Tokyo RJTT, Sydney YSSY, São Paulo SBGR, Johannesburg FAOR, the North Pole and Point Nemo) and lat/lon input. Each one calls `engine.enterRegion(() => makeCoarseRegion(e, {...}))`.
   - Prefetch tiles before tearing down the current region, so loading can be cancelled.
   - Commit `TRAVEL`.
   - Save NPC memories with `engine.npcMemories()` before leaving Tampa, and restore them on return.
2. Set `weather.uTime.value += dt` in `engine.frame`, which the sea shader needs.
3. **Airport region:**
   - Terminal at the real OurAirports coordinates.
   - Desk NPC who issues the `TICKET_ISSUED` (fictional) ticket.
   - Departures board built from `departuresFor`.
   - Security gate, lounge and gate.
   - Board the plane into a cabin region: seat map, JourneyClock time-scale buttons, sky through the windows that follows `positionAt`, and arrival at the destination airport.
4. **Pilot sandbox:** the CoastalSixAircraft and RotorShuttle GLBs are already converted. **Harbor and boat:** HarborLaunch GLB, wave buoyancy, `WAVE_HULL` haptics.
5. **Capacitor Android APK:**
   - Write `tools/web/android-prepare.sh` and `android-build.sh`. The `package.json` scripts already exist.
   - The Android SDK is downloadable from dl.google.com in the cloud container, and JDK 21 and Gradle are present.
   - Add a GitHub Actions workflow.
6. **Playwright e2e suite** (`playwright.config.ts`, `e2e/`): drive it with `window.__dark` hooks (`freeze()`, `settle()`, `debug.enterCar()`).
   - `tools/web/shot.mjs` is the ad-hoc capture script.
   - `tools/web/view.mjs` plus `viewer.html` give an asset close-up viewer.
7. **Research contributions** under `docs/research/contributions/` (Section II-A.K).

## Honest limits

- No real GPU or phone has been measured. Every capture so far comes from software WebGL, which runs at about 3–15 fps. Mobile p95 is NOT_RUN.
- No APK has been built yet, and haptics have never been felt on a device.
- Only one area is detailed: Tampa. The rest of Earth is coarse terrain only, once it is wired.
- Weather, residents, shop names, the café and airport interiors are fictional.
- Original CLOCK9/BORNE test sources are not in the repo (22/16 checks NOT_RUN). The ports have their own tests.
