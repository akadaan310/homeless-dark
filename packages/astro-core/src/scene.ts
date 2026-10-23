// ASTRO scene graph: a minimal, renderer-neutral transform tree. It is a PROJECTION of
// committed world state (constitution v4 invariant 1); nothing here writes world authority.
import { Vec3, Quat, Euler, Mat4, Color, toColor, type ColorLike } from './math';
import { Geometry } from './geometry';

let nodeId = 0;

export class Node {
  readonly id = ++nodeId;
  name = '';
  parent: Node | null = null;
  children: Node[] = [];
  readonly position = new Vec3();
  readonly quaternion = new Quat();
  readonly rotation = new Euler();
  readonly scale = new Vec3(1, 1, 1);
  readonly matrix = new Mat4();
  readonly matrixWorld = new Mat4();
  visible = true;
  castShadow = false;
  receiveShadow = false;
  frustumCulled = true;
  renderOrder = 0;
  userData: Record<string, unknown> = {};
  /** Data status for the reality contract (§077, §100). */
  epistemic: 'observed' | 'source_derived' | 'measured' | 'simulation' | 'abstract' | 'hypothesis' | 'authored' | 'unknown' = 'authored';

  constructor() {
    this.rotation._onChange = () => { this.quaternion._onChange = null; this.quaternion.setFromEuler(this.rotation); this.quaternion._onChange = syncEuler; };
    const syncEuler = () => { /* quaternion edited directly: euler becomes stale; we keep quaternion authoritative */ };
    this.quaternion._onChange = syncEuler;
  }

  add(...nodes: Node[]) {
    for (const n of nodes) { if (n === this) continue; n.parent?.remove(n); n.parent = this; this.children.push(n); }
    return this;
  }
  remove(...nodes: Node[]) {
    for (const n of nodes) { const i = this.children.indexOf(n); if (i >= 0) { this.children.splice(i, 1); n.parent = null; } }
    return this;
  }
  traverse(cb: (n: Node) => void) { cb(this); for (const c of this.children) c.traverse(cb); }
  traverseVisible(cb: (n: Node) => void) { if (!this.visible) return; cb(this); for (const c of this.children) c.traverseVisible(cb); }
  getObjectByName(name: string): Node | undefined {
    if (this.name === name) return this;
    for (const c of this.children) { const r = c.getObjectByName(name); if (r) return r; }
    return undefined;
  }
  updateMatrix() { this.matrix.compose(this.position, this.quaternion, this.scale); }
  updateMatrixWorld(_force = false) {
    this.updateMatrix();
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix); else this.matrixWorld.copy(this.matrix);
    for (const c of this.children) c.updateMatrixWorld(true);
  }
  /** Ensure world matrices of ancestors are current for this node only. */
  updateWorldMatrixUpward() {
    if (this.parent) this.parent.updateWorldMatrixUpward();
    this.updateMatrix();
    if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix); else this.matrixWorld.copy(this.matrix);
  }
  getWorldPosition(out = new Vec3()) { this.updateWorldMatrixUpward(); return out.setFromMatrixPosition(this.matrixWorld); }
  getWorldQuaternion(out = new Quat()) { this.updateWorldMatrixUpward(); const p = new Vec3(), s = new Vec3(); this.matrixWorld.decompose(p, out, s); return out; }
  /** Re-parent keeping the world transform. */
  attach(n: Node) {
    this.updateWorldMatrixUpward();
    n.updateWorldMatrixUpward();
    const inv = this.matrixWorld.clone().invert();
    const m = inv.multiply(n.matrixWorld);
    this.add(n);
    m.decompose(n.position, n.quaternion, n.scale);
    return this;
  }
  lookAt(target: Vec3) {
    this.updateWorldMatrixUpward();
    const eye = new Vec3().setFromMatrixPosition(this.matrixWorld);
    const m = new Mat4().lookAt(eye, target, new Vec3(0, 1, 0));
    this.quaternion.setFromRotationMatrix(m);
  }
  clone(deep = true): Node { const map = new Map<Node, Node>(); const n = cloneNode(this, deep, map); remapSkins(n, map); return n; }
}

export class Group extends Node {}

export type Side = 'front' | 'back' | 'double';
export type MaterialFeature = 'standard' | 'wet' | 'facade' | 'water' | 'terrain' | 'unlit' | 'text' | 'skyDome' | 'rain' | 'stars' | 'windows' | 'grass';

export interface TextureSource { kind: 'image' | 'canvas' | 'data'; image?: TexImageSource; data?: Uint8Array | Float32Array; width: number; height: number; url?: string; channels?: 1 | 4 }

let texId = 0;
export class Texture {
  readonly id = ++texId;
  version = 0;
  repeat = { x: 1, y: 1 };
  offset = { x: 0, y: 0 };
  wrap: 'repeat' | 'clamp' = 'repeat';
  anisotropy = 4;
  mipmaps = true;
  filter: 'linear' | 'nearest' = 'linear';
  /** Upload rows bottom-up (image top at v = 1) — procedural/canvas UV convention; glTF textures keep false. */
  flipY = false;
  /** Colour textures are sRGB-encoded and decoded by the GPU; data maps are linear (normal/roughness/AO). */
  constructor(public source: TextureSource | null, public colorSpace: 'srgb' | 'linear' = 'srgb', public label = '') {}
  set needsUpdate(_v: boolean) { this.version++; }
  get ready() { return !!this.source; }
}

let matId = 0;
export interface MaterialParams {
  color?: ColorLike; roughness?: number; metalness?: number; map?: Texture | null; normalMap?: Texture | null; roughnessMap?: Texture | null;
  emissive?: ColorLike; emissiveIntensity?: number; emissiveMap?: Texture | null; opacity?: number; transparent?: boolean; side?: Side; vertexColors?: boolean;
  clearcoat?: number; clearcoatRoughness?: number; depthWrite?: boolean; feature?: MaterialFeature; normalScale?: number; fog?: boolean; name?: string; toneMapped?: boolean;
  uvScale?: number; envIntensity?: number; alphaTest?: number; polygonOffset?: number; blending?: 'normal' | 'additive'; pointSize?: number; detailMap?: Texture | null;
}
export class Material {
  readonly id = ++matId;
  name = '';
  color = new Color(1, 1, 1);
  roughness = 1;
  metalness = 0;
  map: Texture | null = null;
  normalMap: Texture | null = null;
  roughnessMap: Texture | null = null;
  emissiveMap: Texture | null = null;
  emissive = new Color(0, 0, 0);
  emissiveIntensity = 1;
  opacity = 1;
  transparent = false;
  side: Side = 'front';
  vertexColors = false;
  clearcoat = 0;
  clearcoatRoughness = 0;
  depthWrite = true;
  fog = true;
  normalScale = 1;
  uvScale = 1;
  envIntensity = 1;
  alphaTest = 0;
  /** Depth offset factor/units (negative pulls toward the camera: decals, lane paint). */
  polygonOffset = 0;
  blending: 'normal' | 'additive' = 'normal';
  pointSize = 1;
  /** Second colour map for features that blend two surfaces (terrain sand). */
  detailMap: Texture | null = null;
  feature: MaterialFeature = 'standard';
  /** Extra per-material uniforms consumed by the feature's shader (bounded, typed numbers only). */
  uniforms: Record<string, number | [number, number, number]> = {};
  constructor(p: MaterialParams = {}) { this.setValues(p); }
  setValues(p: MaterialParams) {
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) continue;
      if (k === 'color' || k === 'emissive') (this as unknown as Record<string, Color>)[k] = toColor(v as ColorLike);
      else (this as unknown as Record<string, unknown>)[k] = v;
    }
    return this;
  }
  clone() { const m = new Material(); Object.assign(m, this, { id: ++matId, color: this.color.clone(), emissive: this.emissive.clone(), uniforms: { ...this.uniforms } }); return m; }
  /** Shader permutation key (finite, §109). */
  variantKey(): string {
    return [this.feature, this.map ? 'M' : '', this.normalMap ? 'N' : '', this.roughnessMap ? 'R' : '', this.emissiveMap ? 'E' : '', this.vertexColors ? 'V' : '', this.clearcoat > 0 ? 'C' : '', this.alphaTest > 0 ? 'A' : '', this.detailMap ? 'D' : ''].join('');
  }
}

export class Mesh extends Node {
  skin: Skin | null = null;
  mode: 'triangles' | 'points' | 'lines' = 'triangles';
  constructor(public geometry: Geometry, public material: Material) { super(); }
}

export class InstancedMesh extends Mesh {
  readonly instanceMatrices: Float32Array;
  instanceVersion = 0;
  /** Per-instance identity for the reality contract (§064): instancing never aliases identities. */
  readonly instanceIds: string[];
  constructor(geometry: Geometry, material: Material, public instanceCount: number) {
    super(geometry, material);
    this.instanceMatrices = new Float32Array(instanceCount * 16);
    this.instanceIds = Array.from({ length: instanceCount }, (_, i) => `${this.id}:${i}`);
    for (let i = 0; i < instanceCount; i++) this.instanceMatrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], i * 16);
  }
  get count() { return this.instanceCount; }
  setMatrixAt(i: number, m: Mat4) { m.toFloat32(this.instanceMatrices, i * 16); this.instanceVersion++; }
  getMatrixAt(i: number, m: Mat4) { m.fromArray(this.instanceMatrices, i * 16); return m; }
  set instanceMatrixNeedsUpdate(_v: boolean) { this.instanceVersion++; }
}

export class Skin {
  readonly boneMatrices: Float32Array;
  version = 0;
  constructor(public bones: Node[], public inverseBind: Mat4[]) { this.boneMatrices = new Float32Array(bones.length * 16); }
  update(meshWorld: Mat4) {
    const invMesh = meshWorld.clone().invert(), m = new Mat4();
    for (let i = 0; i < this.bones.length; i++) {
      m.multiplyMatrices(invMesh, this.bones[i]!.matrixWorld).multiply(this.inverseBind[i]!);
      m.toFloat32(this.boneMatrices, i * 16);
    }
    this.version++;
  }
}

export class Camera extends Node {
  fov = 60; aspect = 1; near = 0.1; far = 12000;
  readonly projection = new Mat4();
  readonly view = new Mat4();
  updateProjectionMatrix() { this.projection.perspective(this.fov, this.aspect, this.near, this.far); }
  updateView() { this.updateWorldMatrixUpward(); this.view.copy(this.matrixWorld).invert(); }
}

export class Light extends Node {
  color = new Color(1, 1, 1);
  intensity = 1;
  constructor(public kind: 'directional' | 'point' | 'spot' | 'hemisphere') { super(); }
}
export class DirectionalLight extends Light {
  readonly target = new Node();
  shadow = { mapSize: 2048, extent: 50, near: 1, far: 260, bias: -0.0004, normalBias: 0.04 };
  constructor(color: ColorLike = 0xffffff, intensity = 1) { super('directional'); this.color = toColor(color); this.intensity = intensity; }
}
export class PointLight extends Light {
  constructor(color: ColorLike = 0xffffff, intensity = 1, public distance = 10, public decay = 2) { super('point'); this.color = toColor(color); this.intensity = intensity; }
}
export class SpotLight extends Light {
  readonly target = new Node();
  constructor(color: ColorLike = 0xffffff, intensity = 1, public distance = 20, public angle = 0.6, public penumbra = 0.4, public decay = 2) { super('spot'); this.color = toColor(color); this.intensity = intensity; }
}
export class HemisphereLight extends Light {
  groundColor: Color;
  constructor(sky: ColorLike = 0xffffff, ground: ColorLike = 0x444444, intensity = 1) { super('hemisphere'); this.color = toColor(sky); this.groundColor = toColor(ground); this.intensity = intensity; }
}

export interface Fog { color: Color; density: number }

export class Scene extends Node {
  fog: Fog | null = null;
  background: Color | null = null;
  /** Environment lighting coefficients (order-2 SH, 9 RGB terms) + specular cubemap handle owned by the renderer. */
  envSH: Float32Array | null = null;
  environmentIntensity = 1;
}

function cloneNode(src: Node, deep: boolean, map: Map<Node, Node>): Node {
  let n: Node;
  if (src instanceof InstancedMesh) { const im = new InstancedMesh(src.geometry, src.material, src.instanceCount); im.instanceMatrices.set(src.instanceMatrices); n = im; }
  else if (src instanceof Mesh) { const m = new Mesh(src.geometry, src.material); n = m; }
  else if (src instanceof Camera) n = new Camera();
  else n = new (src.constructor as new () => Node)();
  map.set(src, n);
  n.name = src.name;
  n.position.copy(src.position); n.quaternion.copy(src.quaternion); n.scale.copy(src.scale);
  n.visible = src.visible; n.castShadow = src.castShadow; n.receiveShadow = src.receiveShadow; n.frustumCulled = src.frustumCulled; n.epistemic = src.epistemic;
  n.userData = { ...src.userData };
  if (deep) for (const c of src.children) n.add(cloneNode(c, true, map));
  return n;
}
/** Re-bind skins of a cloned tree to the cloned bones (skeleton-aware clone). */
function remapSkins(root: Node, map: Map<Node, Node>) {
  const inv = new Map<Node, Node>();
  for (const [a, b] of map) inv.set(b, a);
  root.traverse((n) => {
    const src = inv.get(n);
    if (src instanceof Mesh && src.skin && n instanceof Mesh) n.skin = new Skin(src.skin.bones.map((b) => map.get(b) ?? b), src.skin.inverseBind);
  });
}
