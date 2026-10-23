// ASTRO renderer conformance lab (§110): a fixed scene exercising every renderer feature
// on the production backend, used for visual evidence and browser tests. Query params:
// ?mode=day|dusk|night  ?lens=normal|anaglyph|sbs  ?tone=neutral|aces  ?wet=0..1
import { Scene, Camera, Mesh, Group, InstancedMesh, Material, DirectionalLight, PointLight, SpotLight, HemisphereLight, Vec3, Mat4, Quat, Color, planeGeometry, sphereGeometry, boxGeometry, cylinderGeometry } from '@astro/core';
import { Mixer } from '@astro/geometry';
import { Renderer, FontAtlas, Text, GpuWaveField, SKY_RADIANCE_SCALE, type SkyParams } from '@astro/render-webgl2';
import { probeWebGPU } from '@astro/render-webgpu';
import { WaveField } from '@astro/pixels';
import { stereoRig, DEFAULT_STEREO } from '@astro/optics';
import { loadGLB, pbrSet, url, pendingTextures } from './engine/assets';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'day';
const canvas = document.getElementById('c') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const r = new Renderer(canvas, { antialias: q.get('aa') !== '0', preserveDrawingBuffer: true });
r.setPixelRatio(Math.min(devicePixelRatio, Number(q.get('dpr') ?? 2)));
r.setSize(innerWidth, innerHeight);
r.toneOp = (q.get('tone') as 'neutral' | 'aces') ?? 'neutral';
r.lensMode = q.get('lens') === 'anaglyph' ? 'anaglyph' : 'normal';
const stereo = q.get('lens') === 'anaglyph' || q.get('lens') === 'sbs';

const scene = new Scene();
const cam = new Camera();
cam.fov = 50; cam.aspect = (innerWidth / (stereo ? 2 : 1)) / innerHeight; cam.near = 0.1; cam.far = 2000; cam.updateProjectionMatrix();
cam.position.set(7.5, 3.4, 9.5);
cam.lookAt(new Vec3(0, 1.0, 0));

const elev = mode === 'night' ? -14 : mode === 'dusk' ? 3 : 38;
const sunDir = new Vec3(Math.cos((elev * Math.PI) / 180) * 0.55, Math.sin((elev * Math.PI) / 180), -Math.cos((elev * Math.PI) / 180) * 0.83).normalize();
const sunI = mode === 'night' ? 0 : mode === 'dusk' ? 0.9 : 5.2;
const sky: SkyParams = { sunDir: [sunDir.x, sunDir.y, sunDir.z], sunE: Math.max(sunI, 0.06) * SKY_RADIANCE_SCALE, rayleigh: mode === 'dusk' ? 2.4 : 1.4, turbidity: mode === 'dusk' ? 8 : 6, mieG: 0.8, cloud: 0, cloudColor: [0.4, 0.42, 0.45], night: mode === 'night' ? 1 : 0 };
r.sky = sky;
r.updateEnvironment(sky, mode);
r.exposure = 2 ** (mode === 'night' ? 1.9 : mode === 'dusk' ? 0.8 : 0);
scene.environmentIntensity = mode === 'night' ? 0.05 : 0.6;
scene.fog = mode === 'night' ? { color: new Color(0.012, 0.014, 0.02), density: 0.006 } : { color: new Color(0.55, 0.6, 0.68), density: 0.004 };
r.globals.uWetness = Number(q.get('wet') ?? (mode === 'night' ? 0.8 : 0.0));
r.globals.uPuddle = r.globals.uWetness * 0.8;
r.globals.uNight = mode === 'night' ? 1 : 0;

const sun = new DirectionalLight(0xfff1e0, sunI);
sun.castShadow = sunI > 0;
sun.position.copy(sunDir.clone().multiplyScalar(60)); sun.shadow.extent = 14; sun.shadow.mapSize = 2048;
scene.add(sun, sun.target, new HemisphereLight(0xbfd4ff, 0x4a4036, mode === 'night' ? 0.05 : 0.3));

// ground: wet-capable asphalt
const asphalt = pbrSet('asphalt', { repeat: 6 });
const ground = new Mesh(planeGeometry(40, 40).rotateX(-Math.PI / 2), new Material({ feature: 'wet', map: asphalt.map, normalMap: asphalt.normalMap, roughnessMap: asphalt.roughnessMap, color: 0x8d8d8d, roughness: 1, metalness: 0 }));
ground.receiveShadow = true; scene.add(ground);

// PBR grid: roughness → (x), metal 0/1 rows
for (let m = 0; m < 2; m++) for (let i = 0; i < 6; i++) {
  const s = new Mesh(sphereGeometry(0.42, 40, 24), new Material({ color: m ? 0xd8b46a : 0xb8222a, roughness: 0.05 + i * 0.19, metalness: m, clearcoat: i === 0 && !m ? 1 : 0 }));
  s.position.set(-3.2 + i * 1.05, 0.45 + m * 1.05, -2.6); s.castShadow = s.receiveShadow = true; scene.add(s);
}
// instanced columns (§064)
const cols = new InstancedMesh(cylinderGeometry(0.12, 0.15, 2.4, 14).translate(0, 1.2, 0), new Material({ color: 0x9aa0a8, roughness: 0.5, metalness: 0.6 }), 24);
for (let i = 0; i < 24; i++) cols.setMatrixAt(i, new Mat4().compose(new Vec3(-9 + (i % 12) * 1.6, 0, i < 12 ? -6 : 6), new Quat(), new Vec3(1, 0.6 + (i % 5) * 0.2, 1)));
cols.castShadow = cols.receiveShadow = true; scene.add(cols);
// a shadow-casting wall and glass
const wall = new Mesh(boxGeometry(3, 2.4, 0.25), new Material({ color: 0xd6cfc2, roughness: 0.9 })); wall.position.set(-4.6, 1.2, 1.2); wall.rotation.y = 0.5; wall.castShadow = wall.receiveShadow = true; scene.add(wall);
const glass = new Mesh(boxGeometry(1.8, 1.6, 0.04), new Material({ color: 0x9fb4c0, roughness: 0.04, transparent: true, opacity: 0.32, depthWrite: false })); glass.position.set(2.6, 0.95, 2.4); glass.rotation.y = -0.4; scene.add(glass);
// lights for night
const lamp = new PointLight(0xffc28a, mode === 'night' ? 40 : 0, 12, 2); lamp.position.set(-1.5, 2.6, 1.5); scene.add(lamp);
const spot = new SpotLight(0xffc98f, mode === 'night' ? 300 : 0, 30, 0.6, 0.5, 1.4); spot.position.set(3, 6, 0); spot.target.position.set(2, 0, 1); scene.add(spot, spot.target);
const bulb = new Mesh(sphereGeometry(0.08, 12, 8), new Material({ color: 0x111111, emissive: 0xffc98a, emissiveIntensity: mode === 'night' ? 8 : 0 })); bulb.position.copy(lamp.position); scene.add(bulb);

const t0 = performance.now();
const ready = (async () => {
  const atlas = await FontAtlas.load(url('assets/fonts/inter-latin-700-normal.woff'));
  const panel = new Mesh(boxGeometry(4.2, 0.9, 0.1), new Material({ color: 0x15181d, roughness: 0.35, metalness: 0.3 }));
  panel.position.set(-0.6, 3.2, -3.6); panel.castShadow = true; scene.add(panel);
  const text = new Text(atlas, new Material({ feature: 'text', color: 0xffe6b0, emissive: 0xffe6b0, emissiveIntensity: mode === 'night' ? 2.6 : 0.4, roughness: 0.4 }));
  text.text = 'ASTRO · SDF TEXT ✓\nWebGL2 forward PBR'; text.fontSize = 0.26; text.maxWidth = 3.9; text.sync();
  text.position.set(-0.6, 3.2, -3.54); scene.add(text);
  const [sedan, citizen] = await Promise.all([loadGLB('sedan'), loadGLB('citizen')]);
  const car = sedan.scene; car.position.set(1.6, 0, 0.2); car.rotation.y = -0.6; scene.add(car);
  const human = citizen.scene.clone(); human.position.set(-1.6, 0, 0.6); human.rotation.y = 0.5;
  human.traverse((n) => { if (n instanceof Mesh) n.frustumCulled = false; });
  scene.add(human);
  const mixer = new Mixer(human);
  const clip = citizen.clips.find((c) => /WalkInPlace/.test(c.name)) ?? citizen.clips[0]!;
  mixer.clipAction(clip).setEffectiveWeight(1).play();
  await Promise.all([...pendingTextures]);
  return { atlas, mixer, clips: citizen.clips.map((c) => c.name), glb: { sedan: sedan.stats, citizen: citizen.stats } };
})();

const frameTimes: number[] = [];
let lastT = performance.now();
let mixerRef: Mixer | null = null;
function frame(now: number) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  frameTimes.push(dt * 1000); if (frameTimes.length > 300) frameTimes.shift();
  mixerRef?.update(dt);
  r.globals.uTime = now / 1000;
  if (stereo) {
    const rig = stereoRig({ position: cam.position, quaternion: cam.quaternion }, { ...DEFAULT_STEREO, ipd: 0.4, vergenceDistance: 10, focalLengthMm: 22 }, cam.aspect);
    const L = new Camera(), R = new Camera();
    for (const [c, e] of [[L, rig.left], [R, rig.right]] as const) { c.position.copy(e.position); c.quaternion.copy(e.quaternion); c.fov = cam.fov; c.aspect = cam.aspect; c.near = cam.near; c.far = cam.far; c.updateProjectionMatrix(); }
    r.render(scene, cam, [L, R]);
  } else r.render(scene, cam);
  const i = r.info;
  hud.textContent = `ASTRO lab · ${mode} · ${r.backend} · ${i.hdr ? 'HDR' : 'LDR'} · MSAA ${i.msaa}\ncalls ${i.calls}  tris ${Math.round(i.triangles)}  shadow ${i.shadowCalls}  culled ${i.culled}\nprograms ${i.programs}  passes ${i.passes.join('→')}\ncpu ${i.cpuMs.toFixed(2)} ms  gpu ${i.gpuMs?.toFixed(2) ?? 'n/a'} ms\n${r.caps.renderer}`;
  if (!frozen) requestAnimationFrame(frame);
}
let frozen = false;
requestAnimationFrame(frame);

async function gpuWaveCheck(n = 64, steps = 40) {
  const P = { c: 1, damping: 0.25, dt: 0.02, dx: 0.05 };
  const gpu = new GpuWaveField(r.gl, n, n, P), cpu = new WaveField(n, n, P);
  gpu.impulse(20, 30, 1, 2); cpu.impulse(20, 30, 1, 2);
  gpu.step(steps); for (let k = 0; k < steps; k++) cpu.step();
  const { h } = gpu.read();
  let maxErr = 0, maxH = 0;
  for (let k = 0; k < h.length; k++) { maxErr = Math.max(maxErr, Math.abs(h[k]! - cpu.h[k]!)); maxH = Math.max(maxH, Math.abs(cpu.h[k]!)); }
  const w = gpu.witness(20, 30, 'lab-impulse');
  gpu.dispose();
  return { n, steps, maxErr, maxH, witness: w, digests: gpu.digests };
}

ready.then((x) => {
  mixerRef = x.mixer;
  (window as unknown as Record<string, unknown>).__astroLab = {
    renderer: r, scene, info: () => ({ ...r.info }), caps: r.caps, glb: x.glb, clips: x.clips, loadMs: performance.now() - t0, atlasFallback: x.atlas.fallback,
    gpuWaveCheck, probeWebGPU, shaderDigests: () => r.shaderDigests(), graph: () => r.lastGraph,
    frameTimes: () => [...frameTimes],
    freeze: () => { frozen = true; mixerRef?.update(0.4); r.render(scene, cam); },
  };
  document.body.dataset.ready = '1';
}).catch((e) => { hud.textContent = `ASTRO lab error: ${(e as Error).message}`; document.body.dataset.error = String((e as Error).message); console.error(e); });
