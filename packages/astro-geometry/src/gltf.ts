// glTF 2.0 / GLB reader for ASTRO (§065, §066). Independently written against the Khronos
// specification. Supports: GLB container, accessors (sparse excluded), interleaved views,
// KHR_mesh_quantization (dequantized to Float32 on load), EXT_meshopt_compression and
// KHR_meshopt_compression (decoded with `meshoptimizer`, MIT), EXT_texture_webp, PBR
// metallic-roughness, normal/emissive maps, alpha modes, double-sided, node TRS/matrix,
// skins and animations (LINEAR/STEP/CUBICSPLINE).
import { MeshoptDecoder } from 'meshoptimizer';
import { Node, Group, Mesh, Material, Texture, Skin, Attribute, Geometry, Mat4, Color, type TypedArray } from '@astro/core';
import { Clip, type Track } from './animation';

export interface GLTFResult { scene: Group; clips: Clip[]; json: GltfJson; stats: { meshes: number; primitives: number; triangles: number; textures: number; skins: number; bytes: number; extensions: string[] } }

interface GltfJson {
  asset: { version: string; generator?: string };
  scene?: number; scenes?: { nodes: number[] }[];
  nodes?: { name?: string; mesh?: number; skin?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; normalized?: boolean; count: number; type: string; sparse?: unknown }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; extensions?: Record<string, MeshoptExt> }[];
  buffers?: { byteLength: number; uri?: string }[];
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: { index: number }; metallicFactor?: number; roughnessFactor?: number; metallicRoughnessTexture?: { index: number } }; normalTexture?: { index: number; scale?: number }; emissiveTexture?: { index: number }; emissiveFactor?: number[]; alphaMode?: string; doubleSided?: boolean }[];
  textures?: { source?: number; sampler?: number; extensions?: Record<string, { source: number }> }[];
  images?: { bufferView?: number; mimeType?: string; uri?: string }[];
  samplers?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }[];
  skins?: { joints: number[]; inverseBindMatrices?: number; skeleton?: number }[];
  animations?: { name?: string; channels: { sampler: number; target: { node?: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[] }[];
  extensionsUsed?: string[]; extensionsRequired?: string[];
}
interface MeshoptExt { buffer: number; byteOffset?: number; byteLength: number; byteStride: number; count: number; mode: 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES'; filter?: 'NONE' | 'OCTAHEDRAL' | 'QUATERNION' | 'EXPONENTIAL' }

const SUPPORTED = new Set(['KHR_mesh_quantization', 'EXT_meshopt_compression', 'KHR_meshopt_compression', 'EXT_texture_webp', 'KHR_materials_emissive_strength']);
const COMP: Record<number, new (b: ArrayBuffer, o: number, n: number) => TypedArray> = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export type ImageDecoder = (bytes: Uint8Array, mime: string) => Promise<TexImageSource | null>;
export const browserImageDecoder: ImageDecoder = async (bytes, mime) => {
  if (typeof createImageBitmap === 'undefined') return null;
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  return createImageBitmap(new Blob([copy.buffer], { type: mime }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
};

export async function parseGLB(buf: ArrayBuffer, decodeImage: ImageDecoder | null = browserImageDecoder, label = 'glb'): Promise<GLTFResult> {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${label}: not a GLB (bad magic)`);
  if (dv.getUint32(4, true) !== 2) throw new Error(`${label}: unsupported GLB version`);
  let off = 12, json: GltfJson | null = null, bin: ArrayBuffer | null = null;
  while (off < dv.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
    else if (type === 0x004e4942) bin = buf.slice(off + 8, off + 8 + len);
    off += 8 + len;
  }
  if (!json) throw new Error(`${label}: missing JSON chunk`);
  for (const r of json.extensionsRequired ?? []) if (!SUPPORTED.has(r)) throw new Error(`${label}: required extension ${r} not supported`);
  const buffers = (json.buffers ?? []).map((b, i) => { if (i === 0 && bin) return bin; if (b.uri) throw new Error(`${label}: external buffers are not loaded (security: no data/URL fetches from assets)`); return new ArrayBuffer(b.byteLength); });
  await MeshoptDecoder.ready;
  const views: Uint8Array[] = (json.bufferViews ?? []).map((v) => {
    const ext = v.extensions?.EXT_meshopt_compression ?? v.extensions?.KHR_meshopt_compression;
    if (ext) {
      const src = new Uint8Array(buffers[ext.buffer]!, ext.byteOffset ?? 0, ext.byteLength);
      const out = new Uint8Array(ext.count * ext.byteStride);
      MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, src, ext.mode, ext.filter ?? 'NONE');
      return out;
    }
    return new Uint8Array(buffers[v.buffer]!, v.byteOffset ?? 0, v.byteLength);
  });
  const accessorCache = new Map<number, Attribute>();
  const accessor = (i: number): Attribute => {
    const c = accessorCache.get(i);
    if (c) return c;
    const a = json!.accessors![i]!;
    if (a.sparse) throw new Error(`${label}: sparse accessors not supported`);
    const size = SIZE[a.type]!, Ctor = COMP[a.componentType]!;
    const esz = new Ctor(new ArrayBuffer(0), 0, 0).BYTES_PER_ELEMENT;
    const out = new Ctor(new ArrayBuffer(a.count * size * esz), 0, a.count * size);
    if (a.bufferView !== undefined) {
      const view = views[a.bufferView]!, bv = json!.bufferViews![a.bufferView]!;
      const stride = (bv.extensions?.EXT_meshopt_compression ?? bv.extensions?.KHR_meshopt_compression)?.byteStride ?? bv.byteStride ?? size * esz;
      const base = a.byteOffset ?? 0;
      const src = new DataView(view.buffer, view.byteOffset, view.byteLength);
      for (let k = 0; k < a.count; k++) for (let c2 = 0; c2 < size; c2++) {
        const o = base + k * stride + c2 * esz;
        let v: number;
        switch (a.componentType) {
          case 5120: v = src.getInt8(o); break; case 5121: v = src.getUint8(o); break;
          case 5122: v = src.getInt16(o, true); break; case 5123: v = src.getUint16(o, true); break;
          case 5125: v = src.getUint32(o, true); break; default: v = src.getFloat32(o, true);
        }
        out[k * size + c2] = v;
      }
    }
    const attr = new Attribute(out, size, !!a.normalized);
    accessorCache.set(i, attr);
    return attr;
  };
  // textures
  const images = await Promise.all((json.images ?? []).map(async (im) => {
    if (im.bufferView === undefined || !decodeImage) return null;
    return decodeImage(views[im.bufferView]!, im.mimeType ?? 'image/png');
  }));
  const texCache = new Map<string, Texture>();
  const texture = (i: number | undefined, cs: 'srgb' | 'linear'): Texture | null => {
    if (i === undefined) return null;
    const t = json!.textures![i]!;
    const src = t.extensions?.EXT_texture_webp?.source ?? t.source;
    if (src === undefined) return null;
    const key = `${src}|${cs}`;
    let tex = texCache.get(key);
    if (!tex) {
      const img = images[src];
      tex = new Texture(img ? { kind: 'image', image: img, width: (img as ImageBitmap).width, height: (img as ImageBitmap).height } : null, cs, `${label}#img${src}`);
      const s = t.sampler !== undefined ? json!.samplers?.[t.sampler] : undefined;
      tex.wrap = s?.wrapS === 33071 ? 'clamp' : 'repeat';
      texCache.set(key, tex);
    }
    return tex;
  };
  const materials = (json.materials ?? []).map((m) => {
    const p = m.pbrMetallicRoughness ?? {};
    const bc = p.baseColorFactor ?? [1, 1, 1, 1];
    const mat = new Material({
      name: m.name ?? '', color: new Color(bc[0], bc[1], bc[2]), opacity: bc[3], roughness: p.roughnessFactor ?? 1, metalness: p.metallicFactor ?? 1,
      map: texture(p.baseColorTexture?.index, 'srgb'), roughnessMap: texture(p.metallicRoughnessTexture?.index, 'linear'), normalMap: texture(m.normalTexture?.index, 'linear'),
      emissiveMap: texture(m.emissiveTexture?.index, 'srgb'), emissive: new Color(...((m.emissiveFactor ?? [0, 0, 0]) as [number, number, number])),
      transparent: m.alphaMode === 'BLEND', side: m.doubleSided ? 'double' : 'front', normalScale: m.normalTexture?.scale ?? 1,
    });
    if (m.alphaMode === 'BLEND') mat.depthWrite = false;
    return mat;
  });
  const defaultMat = new Material({ name: 'default', roughness: 0.8, metalness: 0 });
  // nodes
  let triangles = 0, primitives = 0;
  const nodes: Node[] = (json.nodes ?? []).map((n) => {
    const node = new Group();
    node.name = n.name ?? '';
    if (n.matrix) new Mat4().fromArray(n.matrix).decompose(node.position, node.quaternion, node.scale);
    if (n.translation) node.position.set(n.translation[0]!, n.translation[1]!, n.translation[2]!);
    if (n.rotation) node.quaternion.set(n.rotation[0]!, n.rotation[1]!, n.rotation[2]!, n.rotation[3]!);
    if (n.scale) node.scale.set(n.scale[0]!, n.scale[1]!, n.scale[2]!);
    return node;
  });
  const skinned: { node: Node; skinIndex: number; meshes: Mesh[] }[] = [];
  (json.nodes ?? []).forEach((n, i) => {
    const node = nodes[i]!;
    for (const c of n.children ?? []) node.add(nodes[c]!);
    if (n.mesh === undefined) return;
    const meshes: Mesh[] = [];
    for (const prim of json!.meshes![n.mesh]!.primitives) {
      if ((prim.mode ?? 4) !== 4) continue; // triangles only
      const g = new Geometry();
      for (const [name, ai] of Object.entries(prim.attributes)) {
        const key = name === 'POSITION' ? 'position' : name === 'NORMAL' ? 'normal' : name === 'TEXCOORD_0' ? 'uv' : name === 'JOINTS_0' ? 'skinIndex' : name === 'WEIGHTS_0' ? 'skinWeight' : name === 'COLOR_0' ? 'color' : name === 'TANGENT' ? 'tangent' : null;
        if (!key) continue;
        const a = accessor(ai);
        g.setAttribute(key, key === 'skinIndex' ? new Attribute(Float32Array.from(a.array as ArrayLike<number>), a.itemSize) : a.toFloat());
      }
      if (prim.indices !== undefined) { const ia = accessor(prim.indices); g.index = new Attribute(ia.array instanceof Uint32Array || ia.array instanceof Uint16Array ? ia.array : Uint32Array.from(ia.array as ArrayLike<number>), 1); }
      if (!g.hasAttribute('normal')) g.computeVertexNormals();
      const mesh = new Mesh(g, prim.material !== undefined ? materials[prim.material]! : defaultMat);
      mesh.name = json!.meshes![n.mesh]!.name ?? node.name;
      mesh.epistemic = 'source_derived';
      node.add(mesh);
      meshes.push(mesh);
      triangles += g.triangleCount; primitives++;
    }
    if (n.skin !== undefined) skinned.push({ node, skinIndex: n.skin, meshes });
  });
  for (const s of skinned) {
    const sk = json.skins![s.skinIndex]!;
    const ibm = sk.inverseBindMatrices !== undefined ? accessor(sk.inverseBindMatrices) : null;
    const inv = sk.joints.map((_, j) => (ibm ? new Mat4().fromArray(Array.from({ length: 16 }, (_, k) => ibm.getComponent(j * 4 + Math.floor(k / 4), k % 4))) : new Mat4()));
    // MAT4 accessor: itemSize 16 → index j holds 16 floats
    if (ibm && ibm.itemSize === 16) for (let j = 0; j < inv.length; j++) inv[j]!.fromArray(ibm.array as ArrayLike<number>, j * 16);
    for (const m of s.meshes) m.skin = new Skin(sk.joints.map((j) => nodes[j]!), inv);
  }
  const scene = new Group();
  scene.name = label;
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i).filter((i) => !nodes[i]!.parent);
  for (const r of roots) scene.add(nodes[r]!);
  // animations
  const clips = (json.animations ?? []).map((an, ai) => {
    const tracks: Track[] = [];
    for (const ch of an.channels) {
      if (ch.target.node === undefined || ch.target.path === 'weights') continue;
      const smp = an.samplers[ch.sampler]!;
      const times = accessor(smp.input).toFloat().array as Float32Array;
      const values = accessor(smp.output).toFloat().array as Float32Array;
      tracks.push({ nodeName: nodes[ch.target.node]!.name, path: ch.target.path as Track['path'], times, values, interpolation: (smp.interpolation ?? 'LINEAR') as Track['interpolation'] });
    }
    return new Clip(an.name ?? `clip${ai}`, tracks);
  });
  return {
    scene, clips, json,
    stats: { meshes: json.meshes?.length ?? 0, primitives, triangles, textures: images.filter(Boolean).length, skins: json.skins?.length ?? 0, bytes: buf.byteLength, extensions: json.extensionsUsed ?? [] },
  };
}
