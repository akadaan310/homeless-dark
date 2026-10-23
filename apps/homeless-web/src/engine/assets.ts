// Asset loading with explicit colour-space annotation (Chromastratum linear gate):
// albedo/emissive maps → sRGB (decoded by the GPU); normal/roughness/AO → linear.
// GLBs are read by the ASTRO GLB reader (meshopt decoder, no Three).
import { Texture, Mesh, type Material } from '@astro/core';
import { parseGLB, browserImageDecoder, type GLTFResult } from '@astro/geometry';

export const BASE = import.meta.env.BASE_URL;
export const url = (p: string) => `${BASE}${p}`;

const glbCache = new Map<string, Promise<GLTFResult>>();
export function loadGLB(id: string): Promise<GLTFResult> {
  let p = glbCache.get(id);
  if (!p) {
    p = (async () => {
      const r = await fetch(url(`assets/models/${id}.glb`));
      if (!r.ok) throw new Error(`model ${id}: HTTP ${r.status}`);
      const g = await parseGLB(await r.arrayBuffer(), browserImageDecoder, id);
      g.scene.traverse((o) => {
        if (o instanceof Mesh) { o.castShadow = true; o.receiveShadow = true; auditMaterial(o.material, id); }
      });
      return g;
    })();
    glbCache.set(id, p);
  }
  return p;
}

export const colorAudit: { asset: string; map: string; colorSpace: string; ok: boolean }[] = [];
function auditMaterial(mat: Material, asset: string) {
  const check = (slot: string, tex: Texture | null, expected: 'srgb' | 'linear') => {
    if (!tex) return;
    colorAudit.push({ asset, map: slot, colorSpace: tex.colorSpace, ok: tex.colorSpace === expected });
  };
  check('map', mat.map, 'srgb');
  check('emissiveMap', mat.emissiveMap, 'srgb');
  check('normalMap', mat.normalMap, 'linear');
  check('roughnessMap', mat.roughnessMap, 'linear');
}

export interface PBRSet { map: Texture; normalMap?: Texture; roughnessMap?: Texture; aoMap?: Texture }

const texCache = new Map<string, Texture>();
export const pendingTextures = new Set<Promise<void>>();
/** Texture handle returned immediately; pixels stream in (the renderer binds a neutral texel until then). */
export function loadTexture(path: string, color: boolean, repeat = 1, anisotropy = 4): Texture {
  const key = `${path}|${repeat}|${color}`;
  let t = texCache.get(key);
  if (!t) {
    const tex = new Texture(null, color ? 'srgb' : 'linear', path);
    tex.wrap = 'repeat';
    tex.repeat = { x: repeat, y: repeat };
    tex.anisotropy = anisotropy;
    const job = (async () => {
      const r = await fetch(url(path));
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      // procedural UVs put the image top at v = 1: decode bottom-up
      const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: 'flipY' });
      tex.source = { kind: 'image', image: bmp, width: bmp.width, height: bmp.height, url: path };
      tex.version++;
    })().catch((e) => { console.warn('[assets]', (e as Error).message); });
    pendingTextures.add(job);
    void job.finally(() => pendingTextures.delete(job));
    texCache.set(key, tex);
    t = tex;
  }
  return t;
}

export function pbrSet(id: string, opts: { repeat?: number; ao?: boolean; anisotropy?: number } = {}): PBRSet {
  const r = opts.repeat ?? 1, a = opts.anisotropy ?? 4;
  return {
    map: loadTexture(`assets/textures/${id}/color.jpg`, true, r, a),
    normalMap: loadTexture(`assets/textures/${id}/normal.jpg`, false, r, a),
    roughnessMap: loadTexture(`assets/textures/${id}/rough.jpg`, false, r, a),
    aoMap: opts.ao ? loadTexture(`assets/textures/${id}/ao.jpg`, false, r, a) : undefined,
  };
}

/** Canvas → sRGB texture (procedural murals, generated normal maps use colorSpace 'linear'). */
export function canvasTexture(c: HTMLCanvasElement | OffscreenCanvas, color = true): Texture {
  const t = new Texture({ kind: 'canvas', image: c as TexImageSource, width: c.width, height: c.height }, color ? 'srgb' : 'linear', 'canvas');
  t.flipY = true;
  return t;
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
