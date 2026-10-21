// Close-up asset review page (dev/evidence only): renders one GLB with the same loader,
// colour management, tone mapping and IBL as the game. /viewer.html?model=sedan&consolidate=1
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadGLB } from './engine/assets';
import { consolidate } from './engine/geom';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
r.setSize(innerWidth, innerHeight, false);
r.toneMapping = THREE.AgXToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2f37);
scene.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(4, 8, 6); scene.add(sun);
const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 200);
const g = await loadGLB(q.get('model') ?? 'sedan');
let obj: THREE.Object3D = g.scene;
if (q.get('consolidate')) obj = consolidate(g.scene, () => false);
scene.add(obj);
const box = new THREE.Box3().setFromObject(obj);
const size = box.getSize(new THREE.Vector3()).length();
const c = box.getCenter(new THREE.Vector3());
const az = Number(q.get('az') ?? 35) * Math.PI / 180;
cam.position.set(c.x + Math.sin(az) * size * 0.9, c.y + size * 0.35, c.z + Math.cos(az) * size * 0.9);
cam.lookAt(c);
r.render(scene, cam);
(window as unknown as { __viewerReady: boolean }).__viewerReady = true;
