// HOMELESS engine: one authoritative world (WorldAuthority), Rapier physics at a fixed
// 60 Hz step, the ASTRO WebGL2 projection (own renderer; no Three.js), Web Audio + haptics
// projections, and a throttled HUD store for React. No React rerender happens per frame.
import { Scene, Camera, Vec3 } from '@astro/core';
import { Renderer } from '@astro/render-webgl2';
import { probeWebGPU, type WebGPUProbe } from '@astro/render-webgpu';
import { stereoRig, DEFAULT_STEREO } from '@astro/optics';
import { formatView, observe, type LensId } from '@astro/world-adapter';
import { GlobeView, SkyView, GlyphView, PixelLens } from './lenses';
import { applyWeather, weather } from './materials';
import { BorneGraph, type CommittedEvent } from '@dark/core';
import { SubjectRegistry } from '@dark/subjects';
import { HapticScheduler, SensoryTelemetry, cuesFor, thunderDelay, type SurfaceKind } from '@dark/somatostratum';
import { parseVisualProgram } from '@dark/visual-grammar';
import { Physics, Character, GROUP } from './physics';
import { Atmosphere } from './atmosphere';
import { AudioEngine, type SpeechLine } from './audio';
import { pickHapticDriver } from './haptics';
import { Input } from './input';
import { CameraRig } from './camera';
import { SignSystem } from './signs';
import { makeHuman, type Human } from './characters';
import { createWorld } from './rules';
import { loadJSON, colorAudit } from './assets';
import * as persist from './persist';
import type { Region, Interactable } from './region';

export type Quality = 'low' | 'high';

export interface HudState {
  ready: boolean; loading: string | null; loadProgress: number; error: string | null;
  fps: number; p50: number; p95: number; p99: number; drawCalls: number; triangles: number; heapMB: number | null;
  region: string; regionKind: string; lat: number; lon: number; localTime: string; utc: string; timeScale: number;
  profile: string; exposureEV: number; wetness: number; puddle: number; rain: number; sunElevation: number;
  prompt: string | null; captions: { speaker: string; text: string; until: number }[];
  dialog: { npc: string; name: string; options: { id: string; label: string }[] } | null;
  mode: string; speedKmh: number; paused: boolean; audio: boolean; hrtf: boolean; haptics: string; hapticDriver: string;
  events: { id: string; type: string; actor: string; t: string }[];
  refusals: { type: string; reason: string }[];
  trace: { division: string; text: string }[];
  sources: { id: string; status: string; note: string }[];
  cell: { id: string; surface: string; layers: { layer: string; status: string; note: string }[] } | null;
  extra: Record<string, unknown>;
  signal: string;
}

const START_UTC = Date.UTC(2026, 9, 21, 21, 35); // 17:35 EDT in Tampa: dry late afternoon

export class Engine {
  renderer!: Renderer;
  scene = new Scene();
  camera = (() => { const c = new Camera(); c.fov = 60; c.near = 0.1; c.far = 12000; c.updateProjectionMatrix(); return c; })();
  /** Active ASTRO lens (§057–§061): every lens projects the same committed world. */
  lens: LensId = 'player';
  private lenses: { globe?: GlobeView; sky?: SkyView; glyph?: GlyphView; pixel?: PixelLens } = {};
  webgpu: WebGPUProbe | null = null;
  phys = new Physics();
  atmo!: Atmosphere;
  audio = new AudioEngine();
  haptics = new HapticScheduler(null);
  telemetry = new SensoryTelemetry();
  input!: Input;
  rig!: CameraRig;
  signs = new SignSystem();
  world = createWorld();
  borne = new BorneGraph();
  research!: SubjectRegistry;
  region: Region | null = null;
  player!: Character;
  avatar!: Human;
  onFoot = true;
  quality: Quality;
  gameUtc = START_UTC;
  timeScale = 20;
  paused = false;
  speech: SpeechLine[] = [];
  private frameTimes: number[] = [];
  private last = 0;
  private hudListeners = new Set<() => void>();
  private hudTimer = 0;
  hud: HudState;
  private captions: HudState['captions'] = [];
  dialog: HudState['dialog'] = null;
  private stepTimer = 0;
  private saveTimer = 0;
  private interactNear: Interactable | null = null;
  private rainScheduled = true;
  private thunderTimer = 30;
  private canvas: HTMLCanvasElement;
  contextLost = false;
  readonly witness: Record<string, unknown> = {};
  private loopHandle = 0;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.canvas = canvas;
    this.quality = quality;
    this.hud = {
      ready: false, loading: 'Starting DARK', loadProgress: 0, error: null, fps: 0, p50: 0, p95: 0, p99: 0, drawCalls: 0, triangles: 0, heapMB: null,
      region: '', regionKind: '', lat: 0, lon: 0, localTime: '', utc: '', timeScale: this.timeScale, profile: '', exposureEV: 0, wetness: 0, puddle: 0, rain: 0, sunElevation: 0,
      prompt: null, captions: [], dialog: null, mode: 'walk', speedKmh: 0, paused: false, audio: false, hrtf: false, haptics: 'OFF', hapticDriver: 'none',
      events: [], refusals: [], trace: [], sources: [], cell: null, extra: {}, signal: '',
    };
  }

  // ---------------------------------------------------------------- HUD store
  subscribe = (l: () => void) => { this.hudListeners.add(l); return () => { this.hudListeners.delete(l); }; };
  getHud = () => this.hud;
  private publish() { this.hud = { ...this.hud }; for (const l of this.hudListeners) l(); }
  setLoading(msg: string | null, progress = 0) { this.hud.loading = msg; this.hud.loadProgress = progress; this.publish(); }

  async init(): Promise<void> {
    const r = new Renderer(this.canvas, { antialias: this.quality === 'high', powerPreference: 'high-performance', preserveDrawingBuffer: true });
    r.pixelRatio = Math.min(window.devicePixelRatio, this.quality === 'high' ? 2 : 1.25);
    this.renderer = r;
    void probeWebGPU().then((p) => { this.webgpu = p; });
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; this.hud.error = 'Graphics context lost — restoring…'; this.publish(); });
    this.canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; this.hud.error = null; this.publish(); });
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.atmo = new Atmosphere(r, this.scene, this.quality);
    this.input = new Input(this.canvas);
    await this.signs.init();
    this.setLoading('Initialising Rapier physics (WASM)', 0.05);
    await this.phys.init();
    this.rig = new CameraRig(this.camera, this.phys);
    this.haptics.setDriver(pickHapticDriver());
    this.audio.onCaption = (speaker, text, seconds) => { this.captions.push({ speaker, text, until: performance.now() + seconds * 1000 }); };
    this.setLoading('Loading people (MakeHuman CC0 masters)', 0.15);
    this.speech = await loadJSON<SpeechLine[]>('assets/speech.json');
    this.avatar = await makeHuman('citizen', 0xe8e0cc);
    this.research = new SubjectRegistry(this.world);
    this.setupBorne();
    this.world.subscribe((ev) => this.project(ev));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(true); });
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- BORNE wiring (Division VI)
  private setupBorne() {
    const b = this.borne;
    b.add({ id: 'rain', deps: [] }, 0)
      .add({ id: 'hour', deps: [] }, 17)
      .add({ id: 'signRev', deps: [] }, 1)
      .add({ id: 'surfaceClass', deps: ['rain'], compute: (g) => ((g('rain') as number) > 0.2 ? 'wet' : 'dry') })
      .add({ id: 'footwear', deps: ['surfaceClass'], compute: (g) => (g('surfaceClass') === 'wet' ? 'splash' : 'dry-step') })
      .add({ id: 'headlights', deps: ['hour', 'rain'], compute: (g) => (g('hour') as number) >= 19 || (g('hour') as number) < 7 || (g('rain') as number) > 0.2 })
      .add({ id: 'streetlights', deps: ['hour'], compute: (g) => (g('hour') as number) >= 19 || (g('hour') as number) < 7 })
      .add({ id: 'npcShelter', deps: ['rain'], compute: (g) => (g('rain') as number) > 0.2 })
      .add({ id: 'fog', deps: ['rain'], compute: (g) => Math.round((1 + (g('rain') as number) * 3.5) * 100) / 100 })
      .add({ id: 'cafeMusic', deps: ['hour', 'signRev'], compute: (g) => ((g('hour') as number) >= 20 ? `late:${g('signRev')}` : `day:${g('signRev')}`) })
      .add({ id: 'vehicleSpray', deps: ['surfaceClass', 'headlights'], compute: (g) => g('surfaceClass') === 'wet' && g('headlights') === true });
  }

  trace(division: string, text: string) {
    this.hud.trace = [{ division, text }, ...this.hud.trace].slice(0, 40);
  }

  /** Projection of committed events onto image, audio, haptics (never back into state). */
  private project(ev: CommittedEvent) {
    const t = performance.now() / 1000;
    this.telemetry.log(ev.id, 'world', t, ev.type);
    this.hud.events = [{ id: ev.id, type: ev.type, actor: ev.actor, t: new Date(this.gameUtc).toISOString().slice(11, 19) }, ...this.hud.events].slice(0, 30);
    for (const cue of cuesFor({ id: ev.id, type: ev.type, tick: ev.tick, actor: ev.actor })) {
      if (cue.hapticPattern) { const rec = this.haptics.request(cue.hapticPattern, performance.now(), ev.id); if (rec.fired) this.telemetry.log(ev.id, 'haptic', t, cue.hapticPattern); }
    }
    if (ev.type === 'RAIN_START' || ev.type === 'RAIN_STOP') {
      const intensity = ev.type === 'RAIN_START' ? (ev.payload as { intensity: number }).intensity : 0;
      this.atmo.state.rain = intensity;
      const w = this.borne.set('rain', intensity, ev.id);
      this.world.commit({ type: 'BORNE_PROPAGATED', actor: 'system', payload: { cause: 'rain', borne: w.borne, moved: w.moved, cutoff: w.cutoff }, causedBy: ev.id });
      this.trace('I Foundations', `${ev.type} admitted by environment state machine (${ev.id})`);
      this.trace('VI Worlds', `BORNE cone of rain: ${w.borne.join(', ')} — moved ${w.moved.length}, cutoff ${w.cutoff.length}`);
      this.witness.lastBorne = w;
    }
    if (ev.type === 'THUNDER_FAR') {
      const d = (ev.payload as { distanceM: number }).distanceM;
      this.atmo.flash = 1;
      this.audio.thunder(thunderDelay(d), ev.id);
      this.trace('V Acoustic', `thunder at ${(d / 1000).toFixed(1)} km: sound delayed ${thunderDelay(d).toFixed(1)} s after light (c = 343 m/s)`);
    }
  }

  // ---------------------------------------------------------------- regions
  async enterRegion(make: () => Promise<Region>): Promise<void> {
    this.setLoading('Loading region', 0.3);
    if (this.region) {
      this.scene.remove(this.region.group);
      this.region.dispose();
      for (const s of [...this.signs.signs.keys()]) this.signs.signs.delete(s);
      this.phys.world.free();
      await this.phys.init();
      this.rig = new CameraRig(this.camera, this.phys);
    }
    const region = await make();
    this.region = region;
    this.scene.add(region.group);
    this.scene.add(this.avatar.root);
    this.player = new Character(this.phys, region.spawn, { member: GROUP.PLAYER });
    this.rig.yaw = region.spawnYaw;
    this.rig.snap();
    this.onFoot = true;
    this.avatar.root.visible = true;
    this.hud.sources = region.sourceLabels;
    this.hud.region = region.name; this.hud.regionKind = region.kind; this.hud.lat = region.lat; this.hud.lon = region.lon;
    this.setLoading(null, 1);
    this.hud.ready = true;
    this.publish();
  }

  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      this.loopHandle = requestAnimationFrame(loop);
      const real = now - this.last;
      const dt = Math.min(0.1, real / 1000);
      this.last = now;
      this.lastRealMs = real;
      if (!this.contextLost) this.frame(dt, now);
    };
    this.loopHandle = requestAnimationFrame(loop);
  }

  stop() { cancelAnimationFrame(this.loopHandle); }

  /** Test/capture hook: stop the loop and render exactly one frame (deterministic screenshots on slow GPUs). */
  freeze(): void { this.stop(); this.draw(0); }
  thaw(): void { this.start(); }

  /** Capture helper: advance wetness and exposure dynamics by `worldSeconds` in closed form (no frames rendered). */
  settle(worldSeconds: number): void {
    this.atmo.settle(worldSeconds);
  }

  pause(p: boolean) {
    this.paused = p;
    this.hud.paused = p;
    if (p) { this.haptics.cancel('pause'); this.audio.suspend(); void this.saveGame(); }
    else { this.haptics.resume(); this.audio.resume(); this.last = performance.now(); }
    this.publish();
  }

  async unlockAudio() { await this.audio.unlock(); this.hud.audio = this.audio.unlocked; this.hud.hrtf = this.audio.hrtf; this.publish(); }

  localHour(): number {
    const lon = this.region?.lon ?? -82.5;
    const d = new Date(this.gameUtc);
    return (((d.getUTCHours() + d.getUTCMinutes() / 60 + lon / 15) % 24) + 24) % 24;
  }

  playerPos(): Vec3 { return this.player.feet(); }

  resetToSpawn() {
    if (!this.region) return;
    if (!this.onFoot) this.region.controlsPlayer && this.forceOnFoot();
    this.player.teleport(this.region.spawn);
    this.rig.yaw = this.region.spawnYaw;
    this.rig.snap();
  }
  forceOnFoot: () => void = () => { this.onFoot = true; this.avatar.root.visible = true; this.player.setEnabled(true); };

  // ---------------------------------------------------------------- frame
  frames = 0;
  lastRealMs = 16;
  renderMs = 0;
  private frame(dt: number, now: number) {
    this.frames++;
    if (!this.region) { this.draw(dt); return; }
    if (this.paused) { this.draw(dt); return; }
    const region = this.region;
    this.gameUtc += dt * 1000 * this.timeScale;
    const worldDt = dt * this.timeScale;
    this.world.advance(worldDt);
    const inp = this.input.read();
    this.rig.look(inp.look.dx, inp.look.dy);
    if (inp.zoom) this.rig.distance = Math.max(2.2, Math.min(12, this.rig.distance + inp.zoom * 0.5));
    const hour = this.localHour();
    if (Math.floor(hour) !== this.borne.get('hour')) {
      const w = this.borne.set('hour', Math.floor(hour));
      if (w.moved.length) this.trace('VI Worlds', `hour ${Math.floor(hour)}: ${w.moved.join(', ')} recomputed`);
    }
    this.scheduleWeather(hour, dt);

    // fixed-step simulation
    const regionDrives = region.controlsPlayer?.() ?? false;
    this.phys.update(dt, (h) => {
      if (!regionDrives && this.onFoot) {
        const f = this.rig.forward(), r = this.rig.right();
        const speed = inp.run ? 4.6 : 1.55;
        const v = f.multiplyScalar(inp.move.y).add(r.multiplyScalar(inp.move.x));
        if (v.lengthSq() > 1) v.normalize();
        v.multiplyScalar(speed);
        this.player.move(v.x, v.z, h, inp.jump);
        this.playerVel.set(v.x, 0, v.z);
      }
      region.fixed?.(h, this);
    });

    // interactions
    this.interactNear = null;
    if (this.onFoot || regionDrives) {
      const p = this.player.feet();
      let best = Infinity;
      for (const it of region.interactables(this)) {
        const d = it.pos.distanceTo(p);
        if (d < it.radius && d < best) { best = d; this.interactNear = it; }
      }
      if (this.interactNear && ((inp.interact && (this.interactNear.key ?? 'interact') === 'interact') || (inp.vehicle && this.interactNear.key === 'vehicle'))) this.interactNear.action(this);
    }
    region.frame?.(dt, this);
    this.lastInput = inp;

    // avatar projection
    const feet = this.player.feet();
    if (this.onFoot && !regionDrives) {
      this.avatar.root.position.copy(feet);
      const sp = Math.hypot(this.playerVel.x, this.playerVel.z);
      if (sp > 0.1) {
        const yaw = Math.atan2(this.playerVel.x, this.playerVel.z);
        let d = yaw - this.avatar.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
        this.avatar.root.rotation.y += d * (1 - Math.exp(-dt * 12));
        this.avatar.setPose(sp > 3 ? 'run' : 'walk', sp);
      } else this.avatar.setPose('idle');
      const { stepped } = this.avatar.update(dt);
      if (stepped && this.player.grounded) this.footstep('player', feet, sp);
    } else this.avatar.update(dt);

    // camera
    const focus = region.focus?.();
    if (focus) {
      this.rig.setMode(focus.mode);
      this.rig.update(dt, focus.pos, focus.heading, focus.eye, focus.quat);
    } else {
      this.rig.setMode('follow');
      this.rig.update(dt, new Vec3(feet.x, feet.y + 1.55, feet.z));
    }
    // interior detection (exposure + audio muffling + rain roof)
    const inside = region.interiors.some((b) => b.containsPoint(new Vec3(feet.x, 1, feet.z))) || (!!focus && (focus.mode === 'vehicle' || focus.mode === 'cabin' || focus.mode === 'cockpit') && !this.onFoot);
    this.atmo.interiorFactor += ((inside ? 1 : 0) - this.atmo.interiorFactor) * (1 - Math.exp(-dt * 2.5));
    this.audio.setInterior(this.atmo.interiorFactor * 0.85);
    this.audio.setRain(this.atmo.state.rain, inside);
    this.audio.updateListener(this.camera);

    this.atmo.update(new Date(this.gameUtc), region.lat, region.lon, dt, feet, this.camera, dt * Math.min(this.timeScale, 60));
    this.signs.update(now / 1000, this.atmo.state.night, this.atmo.state.wet.wetness, hour);
    weather.uTime.value = (this.gameUtc - START_UTC) / 1000;
    const r0 = performance.now();
    this.draw(dt);
    this.renderMs = performance.now() - r0;

    // telemetry
    this.frameTimes.push(this.lastRealMs); // real wall-clock frame time (dt is capped for simulation only)
    if (this.frameTimes.length > 600) this.frameTimes.shift();
    this.hudTimer += dt;
    this.saveTimer += dt;
    if (this.saveTimer > 20) { this.saveTimer = 0; void this.saveGame(); }
    if (this.hudTimer > 0.2) { this.hudTimer = 0; this.updateHud(hour, inside); }
  }

  playerVel = new Vec3();

  // ---------------------------------------------------------------- ASTRO projection
  setLens(l: LensId) {
    this.lens = l;
    if (l !== 'pixel') this.lenses.pixel?.step(false);
    this.trace('IV Imagistratum', `lens → ${l} (projection only; world authority unchanged)`);
    this.publish();
  }
  /** Shareable read-only view address of what is on screen (§102). */
  viewAddress(): string {
    return formatView({ region: this.region?.id ?? 'none', lens: this.lens, utc: new Date(this.gameUtc).toISOString().slice(0, 19) + 'Z', lat: this.region?.lat ?? 0, lon: this.region?.lon ?? 0, yaw: this.rig?.yaw ?? 0, pitch: this.rig?.pitch ?? 0 });
  }
  /** Project a world point to normalised screen coordinates (0..1, y up) or null if behind. */
  screenOf(p: Vec3): [number, number] | null {
    this.camera.updateView();
    const v = p.clone().applyMatrix4(this.camera.view);
    if (v.z > -0.1) return null;
    const c = v.applyMatrix4(this.camera.projection);
    return [(c.x + 1) / 2, (c.y + 1) / 2];
  }
  private draw(dt: number) {
    if (this.noDraw) return;
    const r = this.renderer;
    applyWeather(r.globals);
    const w = r.width, h = r.height, utc = new Date(this.gameUtc);
    const lat = this.region?.lat ?? 27.96, lon = this.region?.lon ?? -82.5, yaw = this.rig?.yaw ?? 0, pitch = this.rig?.pitch ?? 0;
    r.lensMode = 'normal';
    if (this.lens === 'stereo' || this.lens === 'anaglyph') {
      const ana = this.lens === 'anaglyph';
      r.lensMode = ana ? 'anaglyph' : 'sideBySide';
      const aspect = ana ? w / h : w / 2 / h;
      const rig = stereoRig({ position: this.camera.position, quaternion: this.camera.quaternion }, { ...DEFAULT_STEREO, vergenceDistance: Math.max(2, this.rig?.distance ?? 6) }, aspect);
      const eyes = [rig.left, rig.right].map((e) => { const c = new Camera(); c.position.copy(e.position); c.quaternion.copy(e.quaternion); Object.assign(c, { fov: this.camera.fov, aspect, near: this.camera.near, far: this.camera.far }); c.updateProjectionMatrix(); return c; });
      r.render(this.scene, this.camera, eyes);
      return;
    }
    if (this.lens === 'globe' || this.lens === 'sky' || this.lens === 'glyph') {
      const sky = r.sky; r.sky = null; // space/catalogue lenses have no atmosphere
      const shadows = r.shadowsEnabled; r.shadowsEnabled = this.lens !== 'sky';
      if (this.lens === 'globe') { const g = (this.lenses.globe ??= new GlobeView()); g.update(lat, lon, utc, w / h, yaw, pitch); r.render(g.scene, g.camera); this.witness.globe = g.facts; }
      else if (this.lens === 'sky') { const s = (this.lenses.sky ??= new SkyView(this.signs.atlas)); s.update(lat, lon, utc, w / h, yaw, pitch); r.render(s.scene, s.camera); this.witness.sky = s.facts; }
      else { const g = (this.lenses.glyph ??= new GlyphView(this.signs.atlas)); g.update(dt, w / h); r.render(g.scene, g.camera); this.witness.glyph = g.facts; }
      r.sky = sky; r.shadowsEnabled = shadows;
      return;
    }
    if (this.lens === 'pixel') {
      const px = (this.lenses.pixel ??= new PixelLens(r));
      if (this.atmo.state.rain > 0.1) for (let i = 0; i < 3; i++) px.impulse(Math.random(), Math.random() * 0.45, 0.25 * this.atmo.state.rain, null);
      px.step(true);
      this.witness.pixel = px.facts;
    }
    r.render(this.scene, this.camera);
  }
  /** Pixel lens: a committed event at a world point becomes a field impulse at its screen sample. */
  private fieldEvent(pos: Vec3, amp: number, id: string | undefined) {
    if (this.lens !== 'pixel' || !this.lenses.pixel) return;
    const s = this.screenOf(pos);
    if (s) this.lenses.pixel.impulse(s[0], s[1], amp, id ?? null);
  }
  pixelWitness() { return this.lenses.pixel?.witness() ?? null; }
  projection() { return observe(this.world as never, performance.now()); }

  // ---------------------------------------------------------------- deterministic replay (§101)
  /** Drive N fixed frames with scripted input (no rAF): the legacy oracle runs the identical script. */
  replay(script: (frame: number) => Partial<ReturnType<Input['read']>>, frames: number, dt = 1 / 60, render = false): void {
    this.stop();
    const base = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, run: false, jump: false, interact: false, vehicle: false, brake: false, up: false, down: false, zoom: 0 };
    for (let f = 0; f < frames; f++) {
      this.input.scripted = () => ({ ...base, ...script(f) });
      this.lastRealMs = dt * 1000;
      if (render) this.frame(dt, f * dt * 1000); else this.frameNoDraw(dt, f * dt * 1000);
    }
    this.input.scripted = null;
  }
  private noDraw = false;
  private frameNoDraw(dt: number, now: number) { this.noDraw = true; try { this.frame(dt, now); } finally { this.noDraw = false; } }
  /** Scenario/test handle set by the active region (not used by gameplay). */
  debug: Record<string, any> = {};
  programSign: ((address: string) => { ok: boolean; reason: string }) | null = null;
  onDialogChoice: ((npc: string, choice: string) => void) | null = null;
  openTravel: (() => void) | null = null;
  openSignConsole: (() => void) | null = null;
  restoreNpcs: (m: { id: string; memory: unknown[]; relationship: Record<string, number> }[]) => void = () => {};

  choose(npc: string, choice: string) { this.onDialogChoice?.(npc, choice); this.hud.dialog = this.dialog; this.publish(); }
  closeDialog() { this.dialog = null; this.hud.dialog = null; this.publish(); }
  lastInput: ReturnType<Input['read']> | null = null;

  footstep(actor: string, pos: Vec3, speed: number) {
    const surface = this.surfaceAt(pos);
    const ev = this.world.commit({ type: 'FOOTSTEP', actor, payload: { surface, speed: Math.round(speed * 10) / 10, wet: Math.round(this.atmo.state.wet.wetness * 100) / 100 } });
    const id = 'id' in ev ? ev.id : undefined;
    this.audio.footstep(surface, pos, speed, this.atmo.state.wet.wetness, 0, id);
    this.fieldEvent(pos, 0.6, id);
    if (id) { const t = performance.now() / 1000; this.telemetry.log(id, 'animation', t, 'foot contact'); this.telemetry.log(id, 'audio', t, `footstep:${surface}`); }
    this.stepTimer++;
  }

  surfaceAt(pos: Vec3): SurfaceKind {
    const hit = this.phys.ray(new Vec3(pos.x, pos.y + 0.5, pos.z), new Vec3(0, -1, 0), 2, GROUP.STATIC, this.player?.collider);
    const s = hit ? this.region?.surfaces.get(hit.collider.handle) ?? 'unknown' : 'unknown';
    return s === 'asphalt' && this.atmo.state.wet.wetness > 0.35 ? 'wet_asphalt' : s;
  }

  // ---------------------------------------------------------------- weather (fictional, seeded)
  private scheduleWeather(hour: number, dt: number) {
    const env = this.world.inspect<{ rain: number }>('env')!;
    if (this.rainScheduled && this.region?.kind === 'street' && hour >= 18.75 && hour < 23 && env.data.rain === 0) {
      this.rainScheduled = false;
      this.world.commit({ type: 'RAIN_START', actor: 'system', payload: { intensity: 0.8, source: 'fictional weather schedule' } });
    }
    if (env.data.rain > 0.5) {
      this.thunderTimer -= dt;
      if (this.thunderTimer < 0) { this.thunderTimer = 40 + Math.random() * 40; this.world.commit({ type: 'THUNDER_FAR', actor: 'system', payload: { distanceM: 3000 + Math.random() * 6000 } }); }
    }
  }

  toggleRain() {
    const env = this.world.inspect<{ rain: number }>('env')!;
    this.rainScheduled = false;
    if (env.data.rain > 0) this.world.commit({ type: 'RAIN_STOP', actor: 'system', payload: {} });
    else this.world.commit({ type: 'RAIN_START', actor: 'system', payload: { intensity: 0.85, source: 'player weather director (fictional)' } });
  }

  setTimeOfDay(localHour: number) {
    const lon = this.region?.lon ?? -82.5;
    const d = new Date(this.gameUtc);
    const utcHour = (((localHour - lon / 15) % 24) + 24) % 24;
    this.gameUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0) + utcHour * 3600000;
    if (localHour < 18.75) this.rainScheduled = true;
  }

  // ---------------------------------------------------------------- HUD
  private updateHud(hour: number, inside: boolean) {
    const ft = [...this.frameTimes].sort((a, b) => a - b);
    const q = (p: number) => ft[Math.min(ft.length - 1, Math.floor(ft.length * p))] ?? 0;
    const info = this.renderer.info;
    const ri = { backend: this.renderer.backend, hdr: info.hdr, msaa: info.msaa, gpuMs: info.gpuMs === null ? null : +info.gpuMs.toFixed(2), cpuMs: +info.cpuMs.toFixed(2), programs: info.programs, passes: info.passes.join('→'), shadowCalls: info.shadowCalls, culled: info.culled, device: this.renderer.caps.renderer, webgpu: this.webgpu ? (this.webgpu.available ? 'available' : `NOT_RUN: ${this.webgpu.reason}`) : 'probing', lens: this.lens };
    const st = this.atmo.state;
    const now = performance.now();
    this.captions = this.captions.filter((c) => c.until > now);
    const hh = Math.floor(hour), mm = Math.floor((hour - hh) * 60);
    Object.assign(this.hud, {
      fps: ft.length ? Math.round(1000 / q(0.5)) : 0, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1),
      drawCalls: info.calls, triangles: Math.round(info.triangles),
      heapMB: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory ? Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576) : null,
      localTime: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} local solar`, utc: new Date(this.gameUtc).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      timeScale: this.timeScale, profile: st.profile === 'blend' ? Object.entries(st.weights).map(([k, v]) => `${k} ${(v! * 100).toFixed(0)}%`).join(' / ') : st.profile,
      exposureEV: +st.exposureEV.toFixed(2), wetness: +st.wet.wetness.toFixed(2), puddle: +st.wet.puddle.toFixed(2), rain: st.rain, sunElevation: +st.sunElevation.toFixed(1),
      prompt: this.interactNear ? `${this.interactNear.key === 'vehicle' ? '[F]' : '[E]'} ${this.interactNear.label}` : null,
      captions: [...this.captions], dialog: this.dialog,
      audio: this.audio.unlocked, hrtf: this.audio.hrtf, haptics: this.haptics.preference, hapticDriver: this.haptics.driverName,
      refusals: this.world.refusals.slice(-6).reverse().map((r) => ({ type: r.ev.type, reason: r.reason })),
      extra: { ...(this.region?.hudExtra?.() ?? {}), inside, colorAuditOk: colorAudit.every((c) => c.ok), colorAuditCount: colorAudit.length, physicsStepMs: +this.phys.stepMs.toFixed(2), journal: this.world.journal.length, renderer: ri, view: this.viewAddress() },
    });
    this.publish();
  }

  // ---------------------------------------------------------------- persistence
  async saveGame(): Promise<boolean> {
    if (!this.region || !this.player) return false;
    const p = this.player.feet();
    return persist.save('auto', {
      schema: 'homeless.save/1', savedAt: Date.now(), gameUtc: this.gameUtc,
      location: { name: this.region.name, lat: this.region.lat, lon: this.region.lon },
      player: { x: p.x, y: p.y, z: p.z, yaw: this.rig.yaw }, world: this.world.snapshot(), npcs: this.npcMemories(), travel: this.travelSnapshot(), settings: { haptics: this.haptics.preference, timeScale: this.timeScale },
    });
  }
  npcMemories: () => { id: string; memory: unknown[]; relationship: Record<string, number> }[] = () => [];
  travelSnapshot: () => unknown = () => null;

  visualProgram() {
    const st = this.atmo.state;
    const mode = st.profile === 'night' ? 'NIGHT' : st.profile === 'twilight' ? 'TWILIGHT' : st.profile === 'golden_hour' ? 'GOLDEN' : 'DAY';
    return parseVisualProgram(`SCENE geography=TAMPA.source-anchored mode=${mode} weather=${st.rain > 0 ? 'RAIN' : 'CLEAR'}
ILLUMINANT class=sun temperature=neutral intensity=calibrated source=derived
ILLUMINANT class=streetlight temperature=warm intensity=calibrated source=municipal_or_authored
ILLUMINANT class=shopfront temperature=warm intensity=medium source=authored
SURFACE class=asphalt wetness=${st.wet.wetness.toFixed(2)} roughness=wet_profile source=licensed_pbr
SIGN subject=shopfront locale=en payload=validated_grammar emission=limited
CAMERA mode=third_person adaptation=smooth filmic=AgX
PERCEPTION target=walkable_path legibility=verified comfort=reduced_flash`);
  }
}

export { cuesFor };
