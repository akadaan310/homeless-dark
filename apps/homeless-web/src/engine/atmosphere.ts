// Chromastratum runtime: the illumination field E(x, t). Sun/moon from the observer's
// ephemeris (lat, lon, UTC), physically inspired Sky (Rayleigh/Mie, three Sky.js),
// PMREM image-based lighting regenerated from that sky, one declared output transform
// (AgX tone mapping → sRGB), bounded time-smoothed exposure, rain and wetness.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { sunPosition, moonPosition } from '@dark/geo';
import { outdoorBlend, blendProfiles, adaptExposure, kelvinToLinear, stepWetness, PROFILES, type LightProfileId, type WetnessState } from '@dark/visual-grammar';
import { weather } from './materials';

export interface AtmosphereState {
  sunElevation: number; sunAzimuth: number; moonElevation: number; moonIllum: number;
  profile: LightProfileId | 'blend'; weights: Partial<Record<LightProfileId, number>>;
  exposureEV: number; targetEV: number; night: number; rain: number; cloud: number; wet: WetnessState; streetLights: number;
}

export class Atmosphere {
  readonly sky = new Sky();
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly moon = new THREE.DirectionalLight(0x9fb4ff, 0.05);
  readonly hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a4036, 0.6);
  readonly stars: THREE.Points;
  readonly rainMesh: THREE.InstancedMesh;
  /** Overcast layer: rain clouds hide the clear-sky model (Sky.js has no cloud term). */
  readonly cloudDome: THREE.Mesh;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private skyScene = new THREE.Scene();
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

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private quality: 'low' | 'high') {
    this.sky.scale.setScalar(9000);
    scene.add(this.sky);
    this.skyScene.add(new Sky().copy(this.sky as never));
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const s = this.sun;
    s.castShadow = true;
    const size = quality === 'low' ? 1024 : 2048;
    s.shadow.mapSize.set(size, size);
    s.shadow.camera.near = 1; s.shadow.camera.far = 260;
    const ext = quality === 'low' ? 38 : 55;
    Object.assign(s.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext });
    s.shadow.bias = -0.00025; s.shadow.normalBias = 0.035;
    scene.add(s, s.target, this.moon, this.moon.target, this.hemi);
    // stars: deterministic field, visible only when the sky is dark (no catalogue claim)
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
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    scene.add(this.stars);
    // rain streaks (instanced), recycled around the camera
    const count = quality === 'low' ? 1400 : 5000;
    const streak = new THREE.PlaneGeometry(0.008, 0.42);
    const rm = new THREE.MeshBasicMaterial({ color: 0x9fb0c2, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: true });
    this.rainMesh = new THREE.InstancedMesh(streak, rm, count);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    this.rainOffsets = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) this.rainOffsets.set([Math.random() * 40 - 20, Math.random() * 22, Math.random() * 40 - 20], i * 3);
    scene.add(this.rainMesh);
    this.cloudDome = new THREE.Mesh(new THREE.SphereGeometry(7000, 32, 16), new THREE.MeshBasicMaterial({ color: 0x777b80, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.cloudDome.renderOrder = -1;
    scene.add(this.cloudDome);
    scene.fog = new THREE.FogExp2(0xb8c4d0, 0.0012);
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  /** Update from absolute UTC + observer; dt in seconds of real time. */
  update(date: Date, lat: number, lon: number, dt: number, focus: THREE.Vector3, camera: THREE.Camera, worldDt = dt): void {
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
    const u = this.sky.material.uniforms as Record<string, { value: unknown }>;
    (u.sunPosition!.value as THREE.Vector3).copy(dir);
    u.turbidity!.value = p.skyTurbidity + cloud * 8;
    u.rayleigh!.value = p.rayleigh * (1 - cloud * 0.6);
    u.mieCoefficient!.value = p.mieCoefficient + cloud * 0.02;
    u.mieDirectionalG!.value = p.mieDirectionalG;
    // key light: sun above horizon, otherwise moon
    const k = kelvinToLinear(p.colorTempK);
    this.sun.color.setRGB(k[0], k[1], k[2], THREE.LinearSRGBColorSpace);
    const sunUp = Math.max(0, Math.min(1, (sp.elevation + 1) / 6));
    this.sun.intensity = p.sunIntensityLux * sunUp * (1 - cloud * 0.75);
    this.sun.position.copy(focus).addScaledVector(dir, 120);
    this.sun.target.position.copy(focus);
    // stable shadow texels: snap the shadow camera to its texel grid
    const texel = (this.sun.shadow.camera.right - this.sun.shadow.camera.left) / this.sun.shadow.mapSize.x;
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
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, st.night - cloud) * 0.9;
    const dome = this.cloudDome.material as THREE.MeshBasicMaterial;
    dome.opacity = Math.min(0.96, cloud * 1.15);
    // day overcast is grey; night overcast carries a faint warm sky-glow from the city
    dome.color.setRGB(0.42 * (1 - st.night) + 0.018, 0.44 * (1 - st.night) + 0.016, 0.47 * (1 - st.night) + 0.017, THREE.LinearSRGBColorSpace).multiplyScalar(1 / (1 + st.night * 3));
    this.cloudDome.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    // fog colour follows the horizon; rain thickens it
    const fog = this.scene.fog as THREE.FogExp2;
    fog.density = p.fogDensity * (1 + st.rain * 3.5);
    fog.color.setRGB(0.55 * (1 - st.night) + 0.04, 0.6 * (1 - st.night) + 0.05, 0.68 * (1 - st.night) + 0.07, THREE.LinearSRGBColorSpace).multiplyScalar(1 - cloud * 0.35);
    // exposure: bounded adaptation; indoor raises exposure toward the indoor profile
    st.targetEV = p.exposureEV * (1 - this.interiorFactor) + PROFILES.indoor.exposureEV * this.interiorFactor + cloud * 0.4;
    st.exposureEV = adaptExposure(st.exposureEV, st.targetEV, dt, this.maxEVPerSecond);
    this.renderer.toneMappingExposure = 2 ** st.exposureEV;
    // wetness dynamics → material uniforms
    st.wet = stepWetness(st.wet, st.rain, worldDt); // wetting/drying follow world time
    weather.uWetness.value = st.wet.wetness;
    weather.uPuddle.value = st.wet.puddle;
    weather.uNight.value = Math.min(1, st.night * 1.2 + cloud * 0.25);
    this.updateRain(dt, camera);
    this.updateEnvironment(sp.elevation, cloud);
  }

  private updateRain(dt: number, camera: THREE.Camera) {
    const on = this.state.rain > 0.02;
    this.rainMesh.visible = on;
    if (!on) return;
    const count = Math.floor(this.rainMesh.count * Math.min(1, this.state.rain));
    const m = new THREE.Matrix4();
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
    this.rainMesh.instanceMatrix.needsUpdate = true;
  }

  private updateEnvironment(elev: number, cloud: number) {
    const key = `${Math.round(elev * 2)}|${Math.round(cloud * 10)}`;
    if (key === this.lastEnvKey) return;
    this.lastEnvKey = key;
    const skyCopy = this.skyScene.children[0] as Sky;
    const su = skyCopy.material.uniforms as Record<string, { value: unknown }>;
    const u = this.sky.material.uniforms as Record<string, { value: unknown }>;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) su[k]!.value = u[k]!.value;
    (su.sunPosition!.value as THREE.Vector3).copy(u.sunPosition!.value as THREE.Vector3);
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(this.skyScene, 0, 0.1, 10000);
    this.scene.environment = this.envRT.texture;
    // night IBL must not be brighter than the scene can justify
    this.scene.environmentIntensity = Math.max(0.05, Math.min(0.6, (elev + 6) / 30)) * (1 - cloud * 0.4);
  }

  settle(worldSeconds: number) {
    for (let t = 0; t < worldSeconds; t++) this.state.wet = stepWetness(this.state.wet, this.state.rain, 1);
    this.state.exposureEV = this.state.targetEV;
    weather.uWetness.value = this.state.wet.wetness;
    weather.uPuddle.value = this.state.wet.puddle;
  }

  dispose() { this.envRT?.dispose(); this.pmrem.dispose(); }
}

function azElToVec(azDeg: number, elDeg: number): THREE.Vector3 {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  // azimuth clockwise from north; three: x = east, z = −north
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}
const wrap = (v: number, s: number) => ((((v + s / 2) % s) + s) % s) - s / 2;
