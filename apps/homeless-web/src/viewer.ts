// Close-up asset review page (dev/evidence only): renders one GLB with the same ASTRO loader,
// colour management, output transform and sky IBL as the game. /viewer.html?model=sedan&consolidate=1
import { Scene, Camera, DirectionalLight, Box3, Vec3, Color, type Node } from '@astro/core';
import { Renderer, defaultSky } from '@astro/render-webgl2';
import { loadGLB, pendingTextures } from './engine/assets';
import { consolidate } from './engine/geom';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new Renderer(canvas, { antialias: true, preserveDrawingBuffer: true });
r.setSize(innerWidth, innerHeight);
const scene = new Scene();
scene.background = new Color(0.024, 0.028, 0.036);
r.sky = { ...defaultSky(), cloud: 0.85, cloudColor: [0.5, 0.52, 0.56] }; // soft studio-like overcast
r.updateEnvironment(r.sky, 'viewer');
scene.environmentIntensity = 0.8;
const sun = new DirectionalLight(0xffffff, 2.5); sun.position.set(4, 8, 6); sun.castShadow = true; sun.shadow.extent = 6; scene.add(sun, sun.target);
const cam = new Camera(); cam.fov = 40; cam.aspect = innerWidth / innerHeight; cam.near = 0.05; cam.far = 200; cam.updateProjectionMatrix();
const g = await loadGLB(q.get('model') ?? 'sedan');
let obj: Node = g.scene;
if (q.get('consolidate')) obj = consolidate(g.scene, () => false);
scene.add(obj);
const box = new Box3().setFromObject(obj);
const size = box.getSize(new Vec3()).length();
const c = box.getCenter(new Vec3());
const az = Number(q.get('az') ?? 35) * Math.PI / 180;
cam.position.set(c.x + Math.sin(az) * size * 0.9, c.y + size * 0.35, c.z + Math.cos(az) * size * 0.9);
cam.lookAt(c);
await Promise.all([...pendingTextures]);
r.render(scene, cam);
(window as unknown as { __viewerReady: boolean }).__viewerReady = true;
