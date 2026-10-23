// ASTRO material laboratory (v4.1 §04, Gate A) — DIAGNOSTIC fixture, not production art.
// Runs the production FieldSystem (same kernels, same GPU passes, same render features) on a
// 16 m grass patch with a scripted walker and a puddle strip, stepping the independent CPU
// reference (GrassField) in lockstep for numerical comparison. ?frames=N runs headless-fast.
import { Scene, Camera, Mesh, Material, DirectionalLight, HemisphereLight, Vec3, planeGeometry, boxGeometry } from '@astro/core';
import { Renderer, SKY_RADIANCE_SCALE, type SkyParams } from '@astro/render-webgl2';
import { GrassField, DEFAULT_GRASS, GRASS_STEP, CONTACT_STAMP, type Contact } from '@astro/pixels';
import { FieldSystem, rasterMask } from './engine/fields';
import { wetSurface } from './engine/materials';
import { pendingTextures } from './engine/assets';

const q0 = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement, hud = document.getElementById('hud')!;
const r = new Renderer(canvas, { antialias: false, preserveDrawingBuffer: true });
r.setSize(innerWidth, innerHeight);
const scene = new Scene(), cam = new Camera();
cam.fov = 45; cam.aspect = innerWidth / innerHeight; cam.near = 0.05; cam.far = 500; cam.updateProjectionMatrix();
cam.position.set(Number(q0.get('cx') ?? 1.1), Number(q0.get('cy') ?? 0.95), Number(q0.get('cz') ?? 1.6)); cam.lookAt(new Vec3(0.1, 0, 0));
const sky: SkyParams = { sunDir: [0.4, 0.75, -0.53], sunE: 5.2 * SKY_RADIANCE_SCALE, rayleigh: 1.4, turbidity: 6, mieG: 0.8, cloud: 0, cloudColor: [0.4, 0.42, 0.45], night: 0 };
r.sky = sky; r.updateEnvironment(sky, 'lab'); r.exposure = 2 ** -1.2; scene.environmentIntensity = 0.6;
const sun = new DirectionalLight(0xfff1e0, 5.2); sun.castShadow = true; sun.position.set(8, 15, -10); sun.shadow.extent = 8;
scene.add(sun, sun.target, new HemisphereLight(0xbfd4ff, 0x4a4036, 0.3));
const ground = new Mesh(planeGeometry(40, 40).rotateX(-Math.PI / 2), wetSurface('grass', { repeat: 12, tint: 0x9aa58a, puddles: false })); ground.position.y = -0.005; ground.receiveShadow = true; scene.add(ground);
// a paved strip with standing water (blocks grass; puddles on)
const strip = new Mesh(planeGeometry(1.6, 16).rotateX(-Math.PI / 2), wetSurface('asphalt', { repeat: 2, tint: 0x8d8d8d })); strip.position.set(-2.2, 0.002, 0); scene.add(strip);
const blocker = planeGeometry(1.6, 16).rotateX(-Math.PI / 2).translate(-2.2, 0, 0);
const mask = rasterMask(40, 640, [-20, -20], [blocker]);
const fields = new FieldSystem(r, { tex: mask.tex, origin: [-20, -20], size: 40 }, 30000);
if (fields.blades) scene.add(fields.blades);
const foot = new Mesh(boxGeometry(0.1, 0.06, 0.26), new Material({ color: 0x7a4a2a, roughness: 0.6 })); scene.add(foot);
r.globals.uWetness = 0.8; r.globals.uPuddle = 0.9;

// CPU reference on the same cell grid, same contacts
const cpu = new GrassField(fields.N, DEFAULT_GRASS);
const q = new URLSearchParams(location.search);
const total = Number(q.get('frames') ?? 0);
let f = 0;
const series: { f: number; bendGpu: number; bendCpu: number; press: number }[] = [];
const contactAt = (fr: number) => {
  // a walker crossing the patch: alternating soles, 0.7 m stride, stance 0.45 s, 60 fps fixed
  const step = Math.floor(fr / 27), stance = fr % 27 < 20;
  const x = -1.2 + step * 0.35, z = (step % 2 ? 0.12 : -0.12);
  return stance && step < 8 ? [{ x, z, r: Number(q0.get('footR') ?? 0.13), p: 1 }] : [];
};
function tick() {
  const feet = contactAt(f);
  fields.update(1 / 60, new Vec3(0, 0, 0), feet, 0.9, 0);
  cpu.org = [fields.origin[0] / fields.dx, fields.origin[1] / fields.dx];
  const cells: Contact[] = feet.map((c) => ({ x: (c.x - fields.origin[0]) / fields.dx - 0.5, y: (c.z - fields.origin[1]) / fields.dx - 0.5, radius: c.r / fields.dx, pressure: c.p }));
  cpu.stamp(cells); cpu.step();
  if (feet[0]) foot.position.set(feet[0].x, 0.03, feet[0].z); else foot.position.y = -1;
  // splash once per stance start on the paved strip
  if (f % 27 === 0) fields.splash(-2.2, -1.5 + (f / 27) * 0.4, 0.9, 1);
  f++;
}
function compare() {
  const st = fields.grass!.read('state');
  let maxErr = 0, maxB = 0;
  for (let i = 0; i < st.length; i++) { maxErr = Math.max(maxErr, Math.abs(st[i]! - cpu.state[i]!)); maxB = Math.max(maxB, Math.abs(cpu.state[i]!)); }
  return { maxErr, maxBend: maxB };
}
function render() {
  r.globals.uTime = f / 60;
  r.render(scene, cam);
  hud.textContent = `ASTRO material lab (diagnostic) · frame ${f}\ngrass ${fields.N}² @ ${fields.dx} m · blades ${fields.tel.blades} · contacts ${fields.tel.contacts}\nripple ${fields.RN}² @ ${fields.rdx} m · splashes ${fields.tel.splashes}\nGPU pass ${fields.tel.gpuPassMs.toFixed(2)} ms · render cpu ${r.info.cpuMs.toFixed(1)} ms\n${r.caps.renderer}`;
}
void Promise.all([...pendingTextures]).then(() => {
  const t0 = performance.now();
  if (total > 0) {
    for (let i = 0; i < total; i++) { tick(); if (i % 9 === 0) { const w = fields.grassWitness(-0.5, 0); const cx = Math.floor((-0.5 - fields.origin[0]) / fields.dx), cz = Math.floor((0 - fields.origin[1]) / fields.dx), R = Math.ceil(0.4 / fields.dx); let c = 0; for (let j = cz - R; j <= cz + R; j++) for (let k = cx - R; k <= cx + R; k++) c = Math.max(c, cpu.bendAt(k, j)); series.push({ f, bendGpu: w!.maxBendRad, bendCpu: c, press: w!.maxPressure }); } }
    render();
  }
  const cmp = compare();
  (window as unknown as Record<string, unknown>).__matLab = { frames: f, compare: cmp, series, tel: fields.tel, simMs: performance.now() - t0, caps: r.caps, blocked: fields.blocked, digests: { grass: fields.grass?.digest(GRASS_STEP), contact: fields.grass?.digest(CONTACT_STAMP) } };
  document.body.dataset.ready = '1';
  const loop = () => { tick(); render(); requestAnimationFrame(loop); };
  if (!total) requestAnimationFrame(loop);
});
