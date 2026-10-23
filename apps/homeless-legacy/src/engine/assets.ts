// Asset loading with explicit colour-space annotation (Chromastratum linear gate):
// albedo/emissive maps → SRGBColorSpace; normal/roughness/AO → NoColorSpace.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export const BASE = import.meta.env.BASE_URL;
export const url = (p: string) => `${BASE}${p}`;

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();

const gltfCache = new Map<string, Promise<GLTF>>();
export function loadGLB(id: string): Promise<GLTF> {
  let p = gltfCache.get(id);
  if (!p) {
    p = gltfLoader.loadAsync(url(`assets/models/${id}.glb`)).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
          for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) auditMaterial(mat, id);
        }
      });
      return g;
    });
    gltfCache.set(id, p);
  }
  return p;
}

export const colorAudit: { asset: string; map: string; colorSpace: string; ok: boolean }[] = [];
function auditMaterial(mat: THREE.MeshStandardMaterial, asset: string) {
  const check = (slot: string, tex: THREE.Texture | null, expected: string) => {
    if (!tex) return;
    colorAudit.push({ asset, map: slot, colorSpace: tex.colorSpace, ok: tex.colorSpace === expected });
  };
  check('map', mat.map, THREE.SRGBColorSpace);
  check('emissiveMap', mat.emissiveMap, THREE.SRGBColorSpace);
  check('normalMap', mat.normalMap, THREE.NoColorSpace);
  check('roughnessMap', mat.roughnessMap, THREE.NoColorSpace);
}

export interface PBRSet { map: THREE.Texture; normalMap?: THREE.Texture; roughnessMap?: THREE.Texture; aoMap?: THREE.Texture }

const texCache = new Map<string, THREE.Texture>();
function tex(path: string, color: boolean, repeat: number, anisotropy: number): THREE.Texture {
  const key = `${path}|${repeat}`;
  let t = texCache.get(key);
  if (!t) {
    t = texLoader.load(url(path));
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = anisotropy;
    texCache.set(key, t);
  }
  return t;
}

export function pbrSet(id: string, opts: { repeat?: number; ao?: boolean; anisotropy?: number } = {}): PBRSet {
  const r = opts.repeat ?? 1, a = opts.anisotropy ?? 4;
  return {
    map: tex(`assets/textures/${id}/color.jpg`, true, r, a),
    normalMap: tex(`assets/textures/${id}/normal.jpg`, false, r, a),
    roughnessMap: tex(`assets/textures/${id}/rough.jpg`, false, r, a),
    aoMap: opts.ao ? tex(`assets/textures/${id}/ao.jpg`, false, r, a) : undefined,
  };
}

export async function loadJSON<T>(path: string): Promise<T> {
  const r = await fetch(url(path));
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export async function loadImageData(path: string): Promise<ImageData> {
  const r = await fetch(url(path));
  const blob = await r.blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}
