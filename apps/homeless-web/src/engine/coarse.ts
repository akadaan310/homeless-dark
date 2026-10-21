// Coarse source-backed terrain for any coordinate: GEBCO 2025 6' heights (model, ~11 km
// spacing) sampled on a local ENU grid with Earth-curvature drop, Natural Earth land mask
// for coast/ocean, biome splatting by latitude/height/slope, an animated sea surface and a
// matching Rapier trimesh. It never invents street detail: near-detail is authored and labelled.
import * as THREE from 'three';
import { enuToGeodetic, tilesForSpan, MEAN_RADIUS } from '@dark/geo';
import type { SurfaceKind } from '@dark/somatostratum';
import { globe } from './globe';
import { pbrSet } from './assets';
import { weather } from './materials';
import type { Physics } from './physics';

export interface CoarseTerrain {
  group: THREE.Group;
  surfaces: Map<number, SurfaceKind>;
  heightAt(x: number, z: number): number;
  oceanAt(x: number, z: number): boolean;
  centerOcean: boolean;
  centerHeight: number;
  landFraction: number;
  water: THREE.Mesh;
  halfM: number;
  stats: { tiles: number; vertices: number; minH: number; maxH: number };
}

export async function buildCoarseTerrain(phys: Physics, lat: number, lon: number, opts: { halfKm: number; n: number; signal?: AbortSignal; onProgress?: (msg: string, p: number) => void }): Promise<CoarseTerrain> {
  const halfM = opts.halfKm * 1000;
  const halfDeg = opts.halfKm / 111 + 0.05;
  await globe.load();
  const keys = tilesForSpan(lat, lon, halfDeg);
  opts.onProgress?.(`Streaming ${keys.length} GEBCO terrain tile${keys.length > 1 ? 's' : ''}`, 0.2);
  const abort = () => keys.forEach((k) => globe.terrain.cancel(k));
  opts.signal?.addEventListener('abort', abort);
  await Promise.all(keys.map((k) => globe.terrain.request(k)));
  opts.signal?.removeEventListener('abort', abort);
  if (opts.signal?.aborted) throw new DOMException('cancelled', 'AbortError');
  globe.preparePatch(lat, lon, halfDeg);
  opts.onProgress?.('Building terrain mesh and colliders', 0.5);

  const n = opts.n;
  const origin = { lat, lon, h: 0 };
  const hs = new Float32Array(n * n), land = new Uint8Array(n * n);
  const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), splat = new Float32Array(n * n * 3);
  let minH = Infinity, maxH = -Infinity, landCount = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const e = (i / (n - 1) * 2 - 1) * halfM, nn = (j / (n - 1) * 2 - 1) * halfM;
    const g = enuToGeodetic([e, nn, 0], origin);
    const h0 = globe.height(g.lat, g.lon) ?? 0;
    const isLand = globe.isLand(g.lat, g.lon) ?? h0 > 0;
    // coast consistency between the two sources: land is at least 0.5 m above MSL, sea at least 2 m below
    const h = isLand ? Math.max(h0, 0.5 + Math.max(0, h0) * 0) : Math.min(h0, -2);
    const drop = (e * e + nn * nn) / (2 * MEAN_RADIUS);
    const k = j * n + i;
    hs[k] = h; land[k] = isLand ? 1 : 0; if (isLand) landCount++;
    minH = Math.min(minH, h); maxH = Math.max(maxH, h);
    pos.set([e, h - drop, -nn], k * 3);
    uv.set([e / 9, nn / 9], k * 2);
  }
  const absLat = Math.abs(lat);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    const h = hs[k]!;
    const hx = hs[j * n + Math.min(n - 1, i + 1)]! - hs[j * n + Math.max(0, i - 1)]!, hz = hs[Math.min(n - 1, j + 1) * n + i]! - hs[Math.max(0, j - 1) * n + i]!;
    const cell = (2 * halfM) / (n - 1);
    const slope = Math.hypot(hx, hz) / (2 * cell);
    const arid = absLat > 14 && absLat < 34 ? 0.75 : 0;
    const sand = land[k] ? Math.min(1, (h < 6 ? 0.9 : 0) + arid) : 1;
    const rock = Math.min(1, slope * 6 + (h > 1800 ? (h - 1800) / 1200 : 0));
    const snow = Math.min(1, Math.max(0, (h - (absLat > 60 ? 300 : 3200)) / 600) + (absLat > 70 ? 0.85 : 0));
    splat.set([sand, rock, snow], k * 3);
  }
  const idx: number[] = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + 1, c = a + n, d = c + 1; idx.push(a, b, c, b, d, c); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 3));
  geo.setIndex(idx);
  // winding: ENU rows go north (−z): ensure normals point up
  const p0 = new THREE.Vector3().fromArray(pos, 0), p1 = new THREE.Vector3().fromArray(pos, 3), p2 = new THREE.Vector3().fromArray(pos, n * 3);
  if (new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0)).y < 0) {
    for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]!; idx[t + 1] = idx[t + 2]!; idx[t + 2] = x; }
    geo.setIndex(idx);
  }
  geo.computeVertexNormals();
  const mat = terrainMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true; mesh.castShadow = true;
  mesh.name = 'gebco-terrain';
  const group = new THREE.Group();
  group.add(mesh);
  const surfaces = new Map<number, SurfaceKind>();
  const col = phys.fixedTrimesh(geo);
  surfaces.set(col.handle, absLat > 66 ? 'unknown' : 'grass');
  // sea surface
  const water = new THREE.Mesh(new THREE.PlaneGeometry(halfM * 2.4, halfM * 2.4, 1, 1).rotateX(-Math.PI / 2), waterMaterial());
  water.name = 'sea-surface';
  water.position.y = 0;
  water.receiveShadow = true;
  group.add(water);
  const sample = (x: number, z: number, arr: Float32Array | Uint8Array) => {
    const fi = ((x / halfM) + 1) / 2 * (n - 1), fj = ((-z / halfM) + 1) / 2 * (n - 1);
    const i = Math.max(0, Math.min(n - 2, Math.floor(fi))), j = Math.max(0, Math.min(n - 2, Math.floor(fj)));
    const tx = Math.min(1, Math.max(0, fi - i)), tz = Math.min(1, Math.max(0, fj - j));
    const v = (a: number, b: number) => arr[b * n + a]!;
    return (v(i, j) * (1 - tx) + v(i + 1, j) * tx) * (1 - tz) + (v(i, j + 1) * (1 - tx) + v(i + 1, j + 1) * tx) * tz;
  };
  const c = (n - 1) / 2;
  return {
    group, surfaces, water, halfM,
    heightAt: (x, z) => sample(x, z, hs) - (x * x + z * z) / (2 * MEAN_RADIUS),
    oceanAt: (x, z) => sample(x, z, land) < 0.5,
    centerOcean: land[c * n + c] === 0,
    centerHeight: hs[c * n + c]!,
    landFraction: landCount / (n * n),
    stats: { tiles: keys.length, vertices: n * n, minH: Math.round(minH), maxH: Math.round(maxH) },
  };
}

function terrainMaterial(): THREE.MeshStandardMaterial {
  const grass = pbrSet('grass', { repeat: 1 }), sand = pbrSet('sand', { repeat: 1 });
  const m = new THREE.MeshStandardMaterial({ map: grass.map, normalMap: grass.normalMap, roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uSand = { value: sand.map };
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aSplat; varying vec3 vSplat;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvSplat = aSplat;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uSand; varying vec3 vSplat;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 sandC = texture2D(uSand, vMapUv).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.78, 0.86, 0.7), sandC, clamp(vSplat.x, 0.0, 1.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.3, 0.28) * (0.8 + 0.4 * sandC.r), clamp(vSplat.y, 0.0, 1.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93), clamp(vSplat.z, 0.0, 1.0));`);
  };
  m.customProgramCacheKey = () => 'gebco-splat';
  return m;
}

let waterNormal: THREE.Texture | null = null;
export function waterMaterial(): THREE.MeshPhysicalMaterial {
  if (!waterNormal) {
    // tileable procedural wave normals (sum of sines), authored
    const s = 256, c = document.createElement('canvas');
    c.width = c.height = s;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      let dx = 0, dy = 0;
      for (const [kx, ky, a] of [[3, 1, 0.5], [1, 4, 0.4], [5, -2, 0.25], [-2, 7, 0.15], [9, 5, 0.1]] as const) {
        const ph = (2 * Math.PI * (kx * x + ky * y)) / s;
        dx += a * kx * Math.cos(ph); dy += a * ky * Math.cos(ph);
      }
      const nx = -dx * 0.08, ny = -dy * 0.08, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * s + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    waterNormal = new THREE.CanvasTexture(c);
    waterNormal.wrapS = waterNormal.wrapT = THREE.RepeatWrapping;
    waterNormal.colorSpace = THREE.NoColorSpace;
    waterNormal.repeat.set(400, 400);
  }
  const m = new THREE.MeshPhysicalMaterial({ color: 0x0b2f3f, roughness: 0.06, metalness: 0, normalMap: waterNormal, normalScale: new THREE.Vector2(0.5, 0.5), clearcoat: 0.6, clearcoatRoughness: 0.12, envMapIntensity: 1.1 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = weather.uTime;
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <normal_fragment_maps>', `
        vec3 n1 = texture2D(normalMap, vNormalMapUv + vec2(uTime * 0.004, uTime * 0.002)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(normalMap, vNormalMapUv * 1.7 - vec2(uTime * 0.003, -uTime * 0.005)).xyz * 2.0 - 1.0;
        vec3 mapN = normalize(vec3((n1.xy + n2.xy) * normalScale, n1.z * n2.z));
        normal = normalize(tbn * mapN);`);
  };
  m.customProgramCacheKey = () => 'sea';
  return m;
}
