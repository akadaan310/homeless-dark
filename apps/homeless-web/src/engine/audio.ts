// Somatostratum acoustic runtime on Web Audio. HRTF PannerNodes where supported
// (equal-power fallback), routed buses, user-gesture unlock, clock-aligned events
// (AudioContext.currentTime), occlusion low-pass, interior muffling, analyser witness.
// Synthesis parameters come from @dark/somatostratum; recordings are the repository's
// original CC0 clips and English eSpeak NG speech lines (hash-pinned).
import { Vec3, type Camera } from '@astro/core';
import { footstepFor, distanceGain, engineTone, occlusionCutoff, type SurfaceKind } from '@dark/somatostratum';
import { url } from './assets';

export type Bus = 'world' | 'voice' | 'footsteps' | 'vehicles' | 'rain' | 'water' | 'music' | 'ui';

export interface SpeechLine { id: string; speaker: string; act: string; caption: string; path: string; duration: number }

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private comp!: DynamicsCompressorNode;
  readonly buses = new Map<Bus, GainNode>();
  private interiorFilter!: BiquadFilterNode;
  analyser!: AnalyserNode;
  private noise!: AudioBuffer;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private rain: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private engine: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode; panner: PannerNode } | null = null;
  private ambience: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private hum: { gain: GainNode; filter: BiquadFilterNode; osc: OscillatorNode } | null = null;
  private surf: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  hrtf = false;
  muted = false;
  volumes: Record<Bus, number> = { world: 0.9, voice: 1, footsteps: 0.8, vehicles: 0.8, rain: 0.8, water: 0.8, music: 0.5, ui: 0.6 };
  readonly events: { t: number; kind: string; eventId?: string }[] = [];
  onCaption: ((speaker: string, text: string, seconds: number) => void) | null = null;
  activeVoices = 0;

  get unlocked() { return !!this.ctx && this.ctx.state === 'running'; }
  now() { return this.ctx?.currentTime ?? 0; }

  /** Must be called from a user gesture (autoplay policies on Chrome/Android WebView). */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new C({ latencyHint: 'interactive' });
      const ctx = this.ctx;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14; this.comp.ratio.value = 3;
      this.master = ctx.createGain();
      this.interiorFilter = ctx.createBiquadFilter();
      this.interiorFilter.type = 'lowpass'; this.interiorFilter.frequency.value = 20000;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.master.connect(this.comp).connect(this.analyser).connect(ctx.destination);
      for (const b of Object.keys(this.volumes) as Bus[]) {
        const g = ctx.createGain();
        g.gain.value = this.volumes[b];
        // interior muffling applies to the outside world, not to UI/voices of people inside
        if (b === 'world' || b === 'rain' || b === 'vehicles' || b === 'water') g.connect(this.interiorFilter); else g.connect(this.master);
        this.buses.set(b, g);
      }
      this.interiorFilter.connect(this.master);
      this.noise = this.makeNoise(2);
      const p = ctx.createPanner();
      this.hrtf = 'panningModel' in p;
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.startBeds();
  }

  suspend() { void this.ctx?.suspend(); }
  resume() { void this.ctx?.resume(); }
  setMuted(m: boolean) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 1; }
  setVolume(b: Bus, v: number) { this.volumes[b] = v; const g = this.buses.get(b); if (g) g.gain.value = v; }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
    return buf;
  }

  panner(pos: Vec3, refDistance = 1.5, rolloff = 1.2, maxDistance = 250): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance; p.rolloffFactor = rolloff; p.maxDistance = maxDistance;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    return p;
  }

  updateListener(cam: Camera): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const f = new Vec3(0, 0, -1).applyQuaternion(cam.quaternion), u = new Vec3(0, 1, 0).applyQuaternion(cam.quaternion);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(cam.position.x, t, 0.02); l.positionY.setTargetAtTime(cam.position.y, t, 0.02); l.positionZ.setTargetAtTime(cam.position.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02); l.forwardY.setTargetAtTime(f.y, t, 0.02); l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.setTargetAtTime(u.x, t, 0.02); l.upY.setTargetAtTime(u.y, t, 0.02); l.upZ.setTargetAtTime(u.z, t, 0.02);
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(cam.position.x, cam.position.y, cam.position.z);
    }
  }

  /** Interior / vehicle cabin: outside sounds are low-passed and attenuated. */
  setInterior(amount: number): void {
    if (!this.ctx) return;
    const f = 20000 * (1 - amount) + 700 * amount;
    this.interiorFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.12);
  }

  private log(kind: string, eventId?: string) {
    this.events.push({ t: this.now(), kind, eventId });
    if (this.events.length > 600) this.events.splice(0, 200);
  }

  // ---------------------------------------------------------------- events
  footstep(surface: SurfaceKind, pos: Vec3, speed: number, wetness: number, when = 0, eventId?: string): void {
    if (!this.unlocked) return;
    const ctx = this.ctx!;
    const f = footstepFor(surface, speed, wetness);
    const t = Math.max(ctx.currentTime, when || ctx.currentTime);
    const pan = this.panner(pos, 1, 1.5, 60);
    pan.connect(this.buses.get('footsteps')!);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = f.noiseCutoffHz; bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55 * f.gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + f.decay);
    src.connect(bp).connect(g).connect(pan);
    src.start(t, Math.random() * 1.5, f.decay + 0.05);
    const body = ctx.createOscillator(); body.type = 'sine'; body.frequency.setValueAtTime(f.bodyHz * 1.6, t); body.frequency.exponentialRampToValueAtTime(f.bodyHz, t + 0.03);
    const bg = ctx.createGain(); bg.gain.setValueAtTime(0.0, t); bg.gain.linearRampToValueAtTime(0.35 * f.gain, t + 0.003); bg.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    body.connect(bg).connect(pan); body.start(t); body.stop(t + 0.08);
    if (f.splash > 0) {
      const s2 = ctx.createBufferSource(); s2.buffer = this.noise;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      const sg = ctx.createGain(); sg.gain.setValueAtTime(0, t + 0.01); sg.gain.linearRampToValueAtTime(0.4 * f.splash, t + 0.02); sg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      s2.connect(hp).connect(sg).connect(pan); s2.start(t + 0.01, Math.random(), 0.25);
    }
    if (f.crunch > 0) {
      const s3 = ctx.createBufferSource(); s3.buffer = this.noise;
      const bp3 = ctx.createBiquadFilter(); bp3.type = 'bandpass'; bp3.frequency.value = 3800; bp3.Q.value = 2;
      const cg = ctx.createGain(); cg.gain.setValueAtTime(0.25 * f.crunch * f.gain, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      s3.connect(bp3).connect(cg).connect(pan); s3.start(t, Math.random(), 0.1);
    }
    this.log(`footstep:${f.surface}`, eventId);
  }

  doorSlam(pos: Vec3, eventId?: string): void {
    if (!this.unlocked) return;
    const ctx = this.ctx!, t = ctx.currentTime;
    const pan = this.panner(pos, 2, 1, 80); pan.connect(this.buses.get('vehicles')!);
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(lp).connect(g).connect(pan); src.start(t, 0.3, 0.3);
    const thump = ctx.createOscillator(); thump.frequency.setValueAtTime(90, t); thump.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    const tg = ctx.createGain(); tg.gain.setValueAtTime(0.8, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    thump.connect(tg).connect(pan); thump.start(t); thump.stop(t + 0.2);
    this.log('door', eventId);
  }

  chime(pos: Vec3, semitone: number, eventId?: string): void {
    if (!this.unlocked) return;
    const ctx = this.ctx!, t = ctx.currentTime;
    const pan = this.panner(pos, 2, 1, 60); pan.connect(this.buses.get('world')!);
    for (const [k, d] of [[0, 0], [7, 0.12]] as const) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 440 * 2 ** ((semitone + k - 9) / 12) * 2;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.25, t + d + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + d + 1.2);
      o.connect(g).connect(pan); o.start(t + d); o.stop(t + d + 1.3);
    }
    this.log('chime', eventId);
  }

  thunder(delayS: number, eventId?: string): void {
    if (!this.unlocked) return;
    const ctx = this.ctx!, t = ctx.currentTime + delayS;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9, t + 0.4); g.gain.exponentialRampToValueAtTime(0.001, t + 4.5);
    src.connect(lp).connect(g).connect(this.buses.get('world')!); src.start(t); src.stop(t + 4.6);
    this.log('thunder', eventId);
  }

  /** Musical note (MusicClock), positional and occludable. */
  pluck(pos: Vec3, hz: number, when: number, velocity: number, cutoff: number): void {
    if (!this.unlocked) return;
    const ctx = this.ctx!;
    const pan = this.panner(pos, 2.5, 1.4, 70); pan.connect(this.buses.get('music')!);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = hz * 2.001;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(0.16 * velocity, when + 0.008); g.gain.exponentialRampToValueAtTime(0.001, when + 1.6);
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(pan);
    o.start(when); o2.start(when); o.stop(when + 1.7); o2.stop(when + 1.7);
  }

  async speech(line: SpeechLine, pos: Vec3, occlusion = 0, eventId?: string): Promise<number> {
    if (!this.unlocked) { this.onCaption?.(line.speaker, line.caption, line.duration + 1); return line.duration; }
    const ctx = this.ctx!;
    const buf = await this.buffer(line.path);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const pan = this.panner(pos, 1.6, 1.1, 50);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = occlusionCutoff(occlusion, false);
    // near/far EQ: distant voices lose presence
    src.connect(lp).connect(pan).connect(this.buses.get('voice')!);
    src.start();
    this.activeVoices++;
    src.onended = () => { this.activeVoices--; };
    this.onCaption?.(line.speaker, line.caption, buf.duration + 0.8);
    this.log(`speech:${line.id}`, eventId);
    return buf.duration;
  }

  buffer(path: string): Promise<AudioBuffer> {
    let b = this.buffers.get(path);
    if (!b) {
      b = fetch(url(path)).then((r) => r.arrayBuffer()).then((a) => this.ctx!.decodeAudioData(a));
      this.buffers.set(path, b);
    }
    return b;
  }

  async playClip(path: string, bus: Bus = 'ui', gain = 1, eventId?: string): Promise<void> {
    if (!this.unlocked) return;
    const buf = await this.buffer(path);
    const s = this.ctx!.createBufferSource(); s.buffer = buf;
    const g = this.ctx!.createGain(); g.gain.value = gain;
    s.connect(g).connect(this.buses.get(bus)!); s.start();
    this.log(`clip:${path}`, eventId);
  }

  // ---------------------------------------------------------------- continuous beds
  private startBeds(): void {
    const ctx = this.ctx!;
    if (!this.ambience) {
      // distant traffic/city bed: band-limited noise, gain driven by proximity to the highway
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 420;
      const gain = ctx.createGain(); gain.gain.value = 0.0;
      src.connect(filter).connect(gain).connect(this.buses.get('world')!); src.start();
      this.ambience = { gain, filter };
    }
    if (!this.rain) {
      void this.buffer('assets/audio/synthetic_rain_wind_loop.wav').then((buf) => {
        if (this.rain) return;
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const filter = ctx.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = 200;
        const gain = ctx.createGain(); gain.gain.value = 0;
        src.connect(filter).connect(gain).connect(this.buses.get('rain')!); src.start();
        // add synthesized hiss for intensity above the loop
        const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true;
        const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 6000; nf.Q.value = 0.5;
        n.connect(nf).connect(gain); n.start();
        this.rain = { src, gain, filter };
      });
    }
    if (!this.surf) {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 700;
      const gain = ctx.createGain(); gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.buses.get('water')!); src.start();
      this.surf = { gain, filter };
    }
  }

  setRain(intensity: number, roofed: boolean): void {
    if (!this.rain || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.rain.gain.gain.setTargetAtTime(Math.min(1, intensity) * (roofed ? 0.35 : 0.8), t, 0.4);
    this.rain.filter.frequency.setTargetAtTime(roofed ? 900 : 200, t, 0.3);
  }
  setAmbience(cityProximity: number): void {
    if (!this.ambience || !this.ctx) return;
    this.ambience.gain.gain.setTargetAtTime(0.06 + 0.22 * cityProximity, this.ctx.currentTime, 0.5);
  }
  setSurf(level: number, t: number): void {
    if (!this.surf || !this.ctx) return;
    const swell = 0.6 + 0.4 * Math.sin(t * 0.5) * Math.sin(t * 0.17 + 1);
    this.surf.gain.gain.setTargetAtTime(level * 0.5 * swell, this.ctx.currentTime, 0.3);
    this.surf.filter.frequency.setTargetAtTime(400 + 900 * swell, this.ctx.currentTime, 0.3);
  }

  /** Player vehicle engine (car, aircraft, helicopter, boat) as a two-oscillator synth. */
  setEngine(on: boolean, pos: Vec3, speedMps: number, throttle: number, kind: 'car' | 'jet' | 'prop' | 'rotor' | 'boat' = 'car'): void {
    if (!this.unlocked) return;
    const ctx = this.ctx!;
    if (!on) { if (this.engine) { this.engine.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15); } return; }
    if (!this.engine) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      const osc2 = ctx.createOscillator(); osc2.type = 'square';
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 600;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const panner = this.panner(pos, 2, 1, 120);
      osc.connect(filter); osc2.connect(filter); filter.connect(gain).connect(panner).connect(this.buses.get('vehicles')!);
      osc.start(); osc2.start();
      this.engine = { osc, osc2, gain, filter, panner };
    }
    const e = this.engine, t = ctx.currentTime;
    let hz: number, cutoff: number, level: number;
    if (kind === 'car') { const tone = engineTone(Math.abs(speedMps), throttle); hz = tone.hz; cutoff = 300 + tone.load * 1400; level = 0.12 + tone.load * 0.12; }
    else if (kind === 'jet') { hz = 60 + throttle * 90; cutoff = 800 + throttle * 4000; level = 0.12 + throttle * 0.2; }
    else if (kind === 'prop') { hz = 70 + throttle * 60; cutoff = 500 + throttle * 1200; level = 0.14 + throttle * 0.16; }
    else if (kind === 'rotor') { hz = 22 + throttle * 6; cutoff = 380; level = 0.25; }
    else { hz = 40 + throttle * 40 + speedMps; cutoff = 400 + throttle * 700; level = 0.12 + throttle * 0.15; }
    e.osc.frequency.setTargetAtTime(hz, t, 0.08);
    e.osc2.frequency.setTargetAtTime(hz * 0.5, t, 0.08);
    e.filter.frequency.setTargetAtTime(cutoff, t, 0.08);
    e.gain.gain.setTargetAtTime(level, t, 0.1);
    e.panner.positionX.setTargetAtTime(pos.x, t, 0.02); e.panner.positionY.setTargetAtTime(pos.y, t, 0.02); e.panner.positionZ.setTargetAtTime(pos.z, t, 0.02);
  }

  /** Aircraft cabin hum (inside the fuselage), separate from the engine synth. */
  setCabinHum(level: number): void {
    if (!this.unlocked) return;
    const ctx = this.ctx!;
    if (!this.hum) {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 320;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const osc = ctx.createOscillator(); osc.frequency.value = 118; const og = ctx.createGain(); og.gain.value = 0.15;
      osc.connect(og).connect(gain);
      src.connect(filter).connect(gain).connect(this.buses.get('ui')!); src.start(); osc.start();
      this.hum = { gain, filter, osc };
    }
    this.hum.gain.gain.setTargetAtTime(level * 0.35, ctx.currentTime, 0.6);
  }

  /** Spectral centroid (Hz) of the current master output — a measurable acoustic witness. */
  spectralCentroid(): number {
    if (!this.analyser) return 0;
    const n = this.analyser.frequencyBinCount;
    const d = new Float32Array(n);
    this.analyser.getFloatFrequencyData(d);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { const p = 10 ** (d[i]! / 10); num += p * (i * this.ctx!.sampleRate) / (2 * n); den += p; }
    return den > 0 ? num / den : 0;
  }
  rms(): number {
    if (!this.analyser) return 0;
    const d = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(d);
    let s = 0; for (const x of d) s += x * x;
    return Math.sqrt(s / d.length);
  }

  static distanceGain = distanceGain;
}
