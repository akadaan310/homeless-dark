// Chromastratum runtime: the illumination field E(x, t). Sun/moon from the observer's
// ephemeris (lat, lon, UTC), the ASTRO analytic sky (single-scattering Rayleigh/Mie,
// @astro/render-webgl2 skyModel), image-based lighting re-baked from that sky (SH
// diffuse + prefiltered equirect specular), one declared output transform (Khronos PBR
// Neutral → sRGB), bounded time-smoothed exposure, rain and wetness.
import { Scene, Mesh, InstancedMesh, Material, DirectionalLight, HemisphereLight, Geometry, Attribute, Mat4, Vec3, Color, planeGeometry, type Camera } from '@astro/core';
import { SKY_RADIANCE_SCALE, type Renderer, type SkyParams } from '@astro/render-webgl2';
import { sunPosition, moonPosition } from '@dark/geo';
import { outdoorBlend, blendProfiles, adaptExposure, kelvinToLinear, stepWetness, PROFILES, type LightProfileId, type WetnessState } from '@dark/visual-grammar';
import { weather } from './materials';

export interface AtmosphereState {
  sunElevation: number; sunAzimuth: number; moonElevation: number; moonIllum: number;
  profile: LightProfileId | 'blend'; weights: Partial<Record<LightProfileId, number>>;
  exposureEV: number; targetEV: number; night: number; rain: number; cloud: number; wet: WetnessState; streetLights: number;
}

export class Atmosphere {
  readonly sun = new DirectionalLight(0xffffff, 3);
  readonly moon = new DirectionalLight(0x9fb4ff, 0.05);
  readonly hemi = new HemisphereLight(0xbfd4ff, 0x4a4036, 0.6);
  readonly stars: Mesh;
  readonly rainMesh: InstancedMesh;
  /** Analytic sky parameters (the renderer draws the sky and bakes IBL from them). */
  readonly sky: SkyParams = { sunDir: [0, 1, 0], sunE: 30, rayleigh: 1.4, turbidity: 6, mieG: 0.8, cloud: 0, cloudColor: [0.42, 0.44, 0.47], night: 0 };
  private lastEnvKey = '';
  private rainOffsets: Float32Array;
  /** Lightning flash level (decays); capped and disabled under reduced-flash comfort. */
  flash = 0;
  reducedFlash = false;
  interiorFactor = 0; // 0 outdoors … 1 inside a building/vehicle (exposure + rain audibility)
  readonly state: AtmosphereState = {
    sunElevation: 30, sunAzimuth: 180, moonElevation: -10, moonIllum: 0.5, profile: 'day', weights: { day: 1 },
    exposureEV: 0, targetEV: 0, night: 0, rain: 0, cloud: 0.15, wet: { wetness: 0, puddle: 0 }, streetLights: 0,
  };
  maxEVPerSecond = 0.75;
  /**
   * Output calibration (declared, measured): the light profiles were authored against an AgX
   * view transform; under PBR Neutral the same scene reads ≈1.5 EV brighter at the median
   * (oracle comparison, evidence/astro/compare). The camera applies this bias; scene-linear
   * light values are unchanged.
   */
  exposureBiasEV = -1.2;

  constructor(private renderer: Renderer, private scene: Scene, private quality: 'low' | 'high') {
    const s = this.sun;
    s.castShadow = true;
    s.shadow.mapSize = quality === 'low' ? 1024 : 2048;
    s.shadow.near = 1; s.shadow.far = 260;
    s.shadow.extent = quality === 'low' ? 38 : 55;
    s.shadow.bias = -0.00025; s.shadow.normalBias = 0.035;
    scene.add(s, s.target, this.moon, this.moon.target, this.hemi);
    // stars: deterministic field, visible only when the sky is dark (no catalogue claim; the
    // catalogue-backed sky is the ASTRO sky lens)
    const n = 2500, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 8000;
      const y = Math.abs(u);
      pos.set([Math.sqrt(1 - y * y) * Math.cos(th) * r, y * r, Math.sqrt(1 - y * y) * Math.sin(th) * r], i * 3);
      const b = 0.4 + rnd() * 0.6;
      col.set([b, b, b * (0.9 + rnd() * 0.2)], i * 3);
    }
    const sg = new Geometry();
    sg.setAttribute('position', new Attribute(pos, 3));
    sg.setAttribute('color', new Attribute(col, 3));
    this.stars = new Mesh(sg, new Material({ feature: 'stars', vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: 'additive', pointSize: 2, name: 'stars' }));
    this.stars.mode = 'points';
    this.stars.frustumCulled = false;
    this.stars.epistemic = 'authored';
    scene.add(this.stars);
    // rain streaks (instanced), recycled around the camera
    const count = quality === 'low' ? 1400 : 5000;
    const rm = new Material({ feature: 'rain', color: 0x9fb0c2, transparent: true, opacity: 0.22, depthWrite: false, side: 'double', name: 'rain' });
    this.rainMesh = new InstancedMesh(planeGeometry(0.008, 0.42), rm, count);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    this.rainOffsets = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this.rainOffsets.set([Math.random() * 40 - 20, Math.random() * 22, Math.random() * 40 - 20], i * 3);
    scene.add(this.rainMesh);
    scene.fog = { color: new Color(0.72, 0.77, 0.82), density: 0.0012 };
    renderer.toneOp = 'neutral';
    renderer.sky = this.sky;
  }

  /** Update from absolute UTC + observer; dt in seconds of real time. */
  update(date: Date, lat: number, lon: number, dt: number, focus: Vec3, camera: Camera, worldDt = dt): void {
    const st = this.state;
    const sp = sunPosition(date, lat, lon), mp = moonPosition(date, lat, lon);
    st.sunElevation = sp.elevation; st.sunAzimuth = sp.azimuth; st.moonElevation = mp.elevation; st.moonIllum = mp.illumination;
    st.weights = outdoorBlend(sp.elevation);
    const keys = Object.keys(st.weights) as LightProfileId[];
    st.profile = keys.length === 1 ? keys[0]! : 'blend';
    const p = blendProfiles(st.weights);
    st.night = Math.min(1, Math.max(0, (2 - sp.elevation) / 10));
    st.streetLights = Math.max(p.streetLights, st.rain > 0.5 && sp.elevation < 15 ? 0.6 : 0);
    // Rain darkens and flattens the sky (cloud cover).
    const cloud = Math.max(st.cloud, st.rain * 0.9);
    const dir = azElToVec(sp.azimuth, Math.max(-20, sp.elevation));
    // analytic sky inputs follow the blended light profile
    const sky = this.sky;
    sky.sunDir = [dir.x, dir.y, dir.z];
    sky.sunE = Math.max(0.05, p.sunIntensityLux) * SKY_RADIANCE_SCALE;
    sky.turbidity = p.skyTurbidity + cloud * 8;
    sky.rayleigh = p.rayleigh * (1 - cloud * 0.6);
    sky.mieG = p.mieDirectionalG;
    sky.night = st.night;
    // overcast layer: day overcast is grey; night overcast carries a faint warm sky-glow from the city
    sky.cloud = Math.min(0.96, cloud * 1.15);
    const dim = 1 / (1 + st.night * 3);
    sky.cloudColor = [(0.42 * (1 - st.night) + 0.018) * dim, (0.44 * (1 - st.night) + 0.016) * dim, (0.47 * (1 - st.night) + 0.017) * dim];
    // key light: sun above horizon, otherwise moon
    const k = kelvinToLinear(p.colorTempK);
    this.sun.color.setRGB(k[0], k[1], k[2]);
    const sunUp = Math.max(0, Math.min(1, (sp.elevation + 1) / 6));
    this.sun.intensity = p.sunIntensityLux * sunUp * (1 - cloud * 0.75);
    this.sun.position.copy(focus).addScaledVector(dir, 120);
    this.sun.target.position.copy(focus);
    // stable shadow texels: snap the shadow camera to its texel grid
    const texel = (2 * this.sun.shadow.extent) / this.sun.shadow.mapSize;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
    this.sun.position.x = this.sun.target.position.x + dir.x * 120;
    this.sun.position.z = this.sun.target.position.z + dir.z * 120;
    this.sun.castShadow = sunUp > 0.02;
    const md = azElToVec(mp.azimuth, Math.max(1, mp.elevation));
    this.moon.position.copy(focus).addScaledVector(md, 100);
    this.moon.target.position.copy(focus);
    this.moon.intensity = mp.elevation > 0 ? 0.08 * mp.illumination * st.night * (1 - cloud * 0.8) : 0;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.hemi.intensity = p.hemiIntensity * (1 - cloud * 0.35) + (this.reducedFlash ? 0 : this.flash * 0.9);
    this.hemi.color.setRGB(0.6 + 0.2 * (1 - st.night), 0.7, 0.85 + 0.1 * st.night);
    this.stars.material.opacity = Math.max(0, st.night - cloud) * 0.9;
    this.stars.position.copy(camera.position);
    // fog colour follows the horizon; rain thickens it
    const fog = this.scene.fog!;
    fog.density = p.fogDensity * (1 + st.rain * 3.5);
    fog.color.setRGB(0.55 * (1 - st.night) + 0.04, 0.6 * (1 - st.night) + 0.05, 0.68 * (1 - st.night) + 0.07).multiplyScalar(1 - cloud * 0.35);
    // exposure: bounded adaptation; indoor raises exposure toward the indoor profile
    st.targetEV = p.exposureEV * (1 - this.interiorFactor) + PROFILES.indoor.exposureEV * this.interiorFactor + cloud * 0.4;
    st.exposureEV = adaptExposure(st.exposureEV, st.targetEV, dt, this.maxEVPerSecond);
    this.renderer.exposure = 2 ** (st.exposureEV + this.exposureBiasEV);
    // wetness dynamics → material uniforms
    st.wet = stepWetness(st.wet, st.rain, worldDt); // wetting/drying follow world time
    weather.uWetness.value = st.wet.wetness;
    weather.uPuddle.value = st.wet.puddle;
    weather.uNight.value = Math.min(1, st.night * 1.2 + cloud * 0.25);
    this.updateRain(dt, camera);
    this.updateEnvironment(sp.elevation, cloud);
  }

  private updateRain(dt: number, camera: Camera) {
    const on = this.state.rain > 0.02;
    this.rainMesh.visible = on;
    if (!on) return;
    const count = Math.floor(this.rainMesh.count * Math.min(1, this.state.rain));
    const m = new Mat4();
    const c = camera.position;
    const fall = 9 * dt;
    for (let i = 0; i < this.rainMesh.count; i++) {
      let y = this.rainOffsets[i * 3 + 1]! - fall;
      if (y < -2) y += 24;
      this.rainOffsets[i * 3 + 1] = y;
      if (i >= count) { m.makeScale(0, 0, 0); this.rainMesh.setMatrixAt(i, m); continue; }
      const ox = wrap(this.rainOffsets[i * 3]! - c.x, 40), oz = wrap(this.rainOffsets[i * 3 + 2]! - c.z, 40);
      if (ox * ox + oz * oz < 4) { m.makeScale(0, 0, 0); this.rainMesh.setMatrixAt(i, m); continue; } // no streaks across the lens
      m.makeTranslation(ox + c.x, c.y + y - 6, oz + c.z);
      this.rainMesh.setMatrixAt(i, m);
    }
  }

  private updateEnvironment(elev: number, cloud: number) {
    const key = `${Math.round(elev * 2)}|${Math.round(cloud * 10)}`;
    if (key === this.lastEnvKey) return;
    this.lastEnvKey = key;
    this.renderer.updateEnvironment(this.sky, key);
    // night IBL must not be brighter than the scene can justify
    this.scene.environmentIntensity = Math.max(0.05, Math.min(0.6, (elev + 6) / 30)) * (1 - cloud * 0.4);
  }

  settle(worldSeconds: number) {
    for (let t = 0; t < worldSeconds; t++) this.state.wet = stepWetness(this.state.wet, this.state.rain, 1);
    this.state.exposureEV = this.state.targetEV;
    this.renderer.exposure = 2 ** (this.state.exposureEV + this.exposureBiasEV);
    weather.uWetness.value = this.state.wet.wetness;
    weather.uPuddle.value = this.state.wet.puddle;
  }

  dispose() { /* GPU resources belong to the renderer */ }
}

function azElToVec(azDeg: number, elDeg: number): Vec3 {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  // azimuth clockwise from north; scene: x = east, z = −north
  return new Vec3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}
const wrap = (v: number, s: number) => ((((v + s / 2) % s) + s) % s) - s / 2;
