// ASTRO geometry: typed attribute arrays (no per-vertex objects) and procedural builders.
import { Vec3, Box3, Mat4, Quat } from './math';

export type TypedArray = Float32Array | Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array;

export class Attribute {
  version = 0;
  constructor(public array: TypedArray, public itemSize: number, public normalized = false) {}
  get count() { return this.array.length / this.itemSize; }
  getComponent(i: number, k: number) {
    const v = this.array[i * this.itemSize + k]!;
    if (!this.normalized) return v;
    if (this.array instanceof Int8Array) return Math.max(v / 127, -1);
    if (this.array instanceof Uint8Array) return v / 255;
    if (this.array instanceof Int16Array) return Math.max(v / 32767, -1);
    if (this.array instanceof Uint16Array) return v / 65535;
    return v;
  }
  getX(i: number) { return this.getComponent(i, 0); }
  getY(i: number) { return this.getComponent(i, 1); }
  getZ(i: number) { return this.getComponent(i, 2); }
  getW(i: number) { return this.getComponent(i, 3); }
  setX(i: number, v: number) { this.array[i * this.itemSize] = v; return this; }
  setY(i: number, v: number) { this.array[i * this.itemSize + 1] = v; return this; }
  setZ(i: number, v: number) { this.array[i * this.itemSize + 2] = v; return this; }
  setXY(i: number, x: number, y: number) { this.array[i * this.itemSize] = x; this.array[i * this.itemSize + 1] = y; return this; }
  setXYZ(i: number, x: number, y: number, z: number) { const o = i * this.itemSize; this.array[o] = x; this.array[o + 1] = y; this.array[o + 2] = z; return this; }
  set needsUpdate(_v: boolean) { this.version++; }
  clone() { return new Attribute(this.array.slice() as TypedArray, this.itemSize, this.normalized); }
  /** Float32 copy with normalized integers expanded (needed before baking transforms). */
  toFloat() { if (this.array instanceof Float32Array && !this.normalized) return this; const out = new Float32Array(this.array.length); for (let i = 0; i < this.count; i++) for (let k = 0; k < this.itemSize; k++) out[i * this.itemSize + k] = this.getComponent(i, k); return new Attribute(out, this.itemSize, false); }
}

let geomId = 0;
export class Geometry {
  readonly id = ++geomId;
  attributes: Record<string, Attribute> = {};
  index: Attribute | null = null;
  boundingBox: Box3 | null = null;
  version = 0;
  setAttribute(name: string, a: Attribute) { this.attributes[name] = a; this.boundingBox = null; return this; }
  getAttribute(name: string) { return this.attributes[name]!; }
  hasAttribute(name: string) { return !!this.attributes[name]; }
  deleteAttribute(name: string) { delete this.attributes[name]; return this; }
  setIndex(idx: number[] | Uint32Array | Uint16Array | null) {
    if (!idx) { this.index = null; return this; }
    let max = 0;
    if (!(idx instanceof Uint32Array || idx instanceof Uint16Array)) for (const v of idx) if (v > max) max = v;
    const arr = idx instanceof Uint32Array || idx instanceof Uint16Array ? idx : max > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
    this.index = new Attribute(arr, 1);
    return this;
  }
  get vertexCount() { return this.attributes.position?.count ?? 0; }
  get triangleCount() { return (this.index ? this.index.count : this.vertexCount) / 3; }
  computeBoundingBox() {
    if (this.boundingBox) return this.boundingBox;
    const b = new Box3(), p = this.attributes.position, v = new Vec3();
    if (p) for (let i = 0; i < p.count; i++) b.expandByPoint(v.fromBufferAttribute(p, i));
    this.boundingBox = b;
    return b;
  }
  clone() {
    const g = new Geometry();
    for (const [k, a] of Object.entries(this.attributes)) g.attributes[k] = a.clone();
    g.index = this.index?.clone() ?? null;
    return g;
  }
  /** Expand normalized/quantized attributes to Float32 in place. */
  dequantize() { for (const k of Object.keys(this.attributes)) this.attributes[k] = this.attributes[k]!.toFloat(); return this; }
  applyMatrix4(m: Mat4) {
    this.dequantize();
    const p = this.attributes.position, n = this.attributes.normal, v = new Vec3();
    if (p) for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m); p.setXYZ(i, v.x, v.y, v.z); }
    if (n) {
      const nm = m.clone(); nm.elements[12] = nm.elements[13] = nm.elements[14] = 0;
      const inv = nm.clone().invert(); // normal matrix = inverse transpose
      const e = inv.elements;
      for (let i = 0; i < n.count; i++) {
        const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
        v.set(e[0]! * x + e[1]! * y + e[2]! * z, e[4]! * x + e[5]! * y + e[6]! * z, e[8]! * x + e[9]! * y + e[10]! * z).normalize();
        n.setXYZ(i, v.x, v.y, v.z);
      }
    }
    if (m.determinant() < 0) this.flipWinding();
    this.boundingBox = null;
    return this;
  }
  translate(x: number, y: number, z: number) { return this.applyMatrix4(new Mat4().makeTranslation(x, y, z)); }
  rotateX(a: number) { return this.applyMatrix4(new Mat4().makeRotationFromQuaternion(new Quat().setFromAxisAngle(new Vec3(1, 0, 0), a))); }
  rotateY(a: number) { return this.applyMatrix4(new Mat4().makeRotationFromQuaternion(new Quat().setFromAxisAngle(new Vec3(0, 1, 0), a))); }
  rotateZ(a: number) { return this.applyMatrix4(new Mat4().makeRotationFromQuaternion(new Quat().setFromAxisAngle(new Vec3(0, 0, 1), a))); }
  scale(x: number, y: number, z: number) { return this.applyMatrix4(new Mat4().makeScale(x, y, z)); }
  flipWinding() {
    if (this.index) { const a = this.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]!; a[i + 1] = a[i + 2]!; a[i + 2] = t; } return this; }
    for (const at of Object.values(this.attributes)) {
      const s = at.itemSize, arr = at.array;
      for (let i = 0; i < at.count; i += 3) for (let k = 0; k < s; k++) { const t = arr[(i + 1) * s + k]!; arr[(i + 1) * s + k] = arr[(i + 2) * s + k]!; arr[(i + 2) * s + k] = t; }
    }
    return this;
  }
  toNonIndexed() {
    if (!this.index) return this;
    const g = new Geometry(), idx = this.index.array;
    for (const [k, a] of Object.entries(this.attributes)) {
      const out = new (a.array.constructor as new (n: number) => TypedArray)(idx.length * a.itemSize);
      for (let i = 0; i < idx.length; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.array[idx[i]! * a.itemSize + c]!;
      g.attributes[k] = new Attribute(out, a.itemSize, a.normalized);
    }
    return g;
  }
  computeVertexNormals() {
    const p = this.attributes.position!;
    const n = new Float32Array(p.count * 3);
    const a = new Vec3(), b = new Vec3(), c = new Vec3(), e1 = new Vec3(), e2 = new Vec3();
    const tri = (i0: number, i1: number, i2: number) => {
      a.fromBufferAttribute(p, i0); b.fromBufferAttribute(p, i1); c.fromBufferAttribute(p, i2);
      e1.subVectors(c, b); e2.subVectors(a, b); e1.cross(e2);
      for (const i of [i0, i1, i2]) { n[i * 3] = n[i * 3]! + e1.x; n[i * 3 + 1] = n[i * 3 + 1]! + e1.y; n[i * 3 + 2] = n[i * 3 + 2]! + e1.z; }
    };
    if (this.index) { const ix = this.index.array; for (let i = 0; i < ix.length; i += 3) tri(ix[i]!, ix[i + 1]!, ix[i + 2]!); }
    else for (let i = 0; i < p.count; i += 3) tri(i, i + 1, i + 2);
    for (let i = 0; i < p.count; i++) { const l = Math.hypot(n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!) || 1; n[i * 3] = n[i * 3]! / l; n[i * 3 + 1] = n[i * 3 + 1]! / l; n[i * 3 + 2] = n[i * 3 + 2]! / l; }
    this.setAttribute('normal', new Attribute(n, 3));
    return this;
  }
}

export const f32 = (a: ArrayLike<number>, size: number) => new Attribute(Float32Array.from(a as ArrayLike<number>), size);

/** Merge geometries (all must share attribute names; missing optional attributes are zero-filled). */
export function mergeGeometries(list: Geometry[]): Geometry | null {
  const gs = list.filter((g) => g && g.vertexCount > 0).map((g) => g.toNonIndexed().dequantize());
  if (!gs.length) return null;
  const names = new Set<string>();
  for (const g of gs) for (const k of Object.keys(g.attributes)) names.add(k);
  const out = new Geometry();
  const total = gs.reduce((s, g) => s + g.vertexCount, 0);
  for (const k of names) {
    const size = gs.find((g) => g.attributes[k])!.attributes[k]!.itemSize;
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of gs) { const a = g.attributes[k]; if (a) arr.set(a.array as Float32Array, o); o += g.vertexCount * size; }
    out.setAttribute(k, new Attribute(arr, size));
  }
  return out;
}

// ---------------------------------------------------------------- procedural primitives
function build(pos: number[], nor: number[], uv: number[], idx: number[]) {
  const g = new Geometry();
  g.setAttribute('position', new Attribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new Attribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new Attribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  return g;
}

export function boxGeometry(w = 1, h = 1, d = 1): Geometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const face = (u: Vec3, v: Vec3, n: Vec3, su: number, sv: number, off: number) => {
    const b = pos.length / 3;
    for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      pos.push(n.x * off + u.x * a * su / 2 + v.x * c * sv / 2, n.y * off + u.y * a * su / 2 + v.y * c * sv / 2, n.z * off + u.z * a * su / 2 + v.z * c * sv / 2);
      nor.push(n.x, n.y, n.z); uv.push((a + 1) / 2, (c + 1) / 2);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const X = new Vec3(1, 0, 0), Y = new Vec3(0, 1, 0), Z = new Vec3(0, 0, 1), nX = new Vec3(-1, 0, 0), nY = new Vec3(0, -1, 0), nZ = new Vec3(0, 0, -1);
  face(nZ, Y, X, d, h, w / 2); face(Z, Y, nX, d, h, w / 2);
  face(X, nZ, Y, w, d, h / 2); face(X, Z, nY, w, d, h / 2);
  face(X, Y, Z, w, h, d / 2); face(nX, Y, nZ, w, h, d / 2);
  return build(pos, nor, uv, idx);
}

export function planeGeometry(w = 1, h = 1): Geometry {
  return build([-w / 2, -h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0, -w / 2, h / 2, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1], [0, 1, 2, 0, 2, 3]);
}

export function cylinderGeometry(rTop: number, rBot: number, h: number, seg = 16, open = false, thetaStart = 0, thetaLen = Math.PI * 2): Geometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const slope = (rBot - rTop) / h;
  for (let y = 0; y <= 1; y++) for (let i = 0; i <= seg; i++) {
    const t = thetaStart + (i / seg) * thetaLen, r = y ? rTop : rBot;
    const sx = Math.sin(t), cz = Math.cos(t);
    pos.push(r * sx, y ? h / 2 : -h / 2, r * cz);
    const n = new Vec3(sx, slope, cz).normalize(); nor.push(n.x, n.y, n.z); uv.push(i / seg, y);
  }
  for (let i = 0; i < seg; i++) { const a = i, b = i + 1, c = seg + 1 + i, d = seg + 2 + i; idx.push(a, b, d, a, d, c); }
  if (!open) for (const top of [true, false]) {
    const r = top ? rTop : rBot; if (r <= 0) continue;
    const yy = top ? h / 2 : -h / 2, c0 = pos.length / 3;
    pos.push(0, yy, 0); nor.push(0, top ? 1 : -1, 0); uv.push(0.5, 0.5);
    for (let i = 0; i <= seg; i++) { const t = thetaStart + (i / seg) * thetaLen; pos.push(r * Math.sin(t), yy, r * Math.cos(t)); nor.push(0, top ? 1 : -1, 0); uv.push(0.5 + Math.sin(t) / 2, 0.5 + Math.cos(t) / 2); }
    for (let i = 0; i < seg; i++) top ? idx.push(c0, c0 + 1 + i, c0 + 2 + i) : idx.push(c0, c0 + 2 + i, c0 + 1 + i);
  }
  return build(pos, nor, uv, idx);
}

export const coneGeometry = (r: number, h: number, seg = 16, open = false) => cylinderGeometry(0.0001, r, h, seg, open);

export function sphereGeometry(r = 1, ws = 24, hs = 16): Geometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let y = 0; y <= hs; y++) for (let x = 0; x <= ws; x++) {
    const u = x / ws, v = y / hs, th = u * Math.PI * 2, ph = v * Math.PI;
    const n = new Vec3(-Math.cos(th) * Math.sin(ph), Math.cos(ph), Math.sin(th) * Math.sin(ph));
    pos.push(n.x * r, n.y * r, n.z * r); nor.push(n.x, n.y, n.z); uv.push(u, 1 - v);
  }
  for (let y = 0; y < hs; y++) for (let x = 0; x < ws; x++) { const a = y * (ws + 1) + x, b = a + ws + 1; if (y) idx.push(a, b, a + 1); if (y < hs - 1) idx.push(a + 1, b, b + 1); }
  return build(pos, nor, uv, idx);
}

export function circleGeometry(r = 1, seg = 32): Geometry {
  const pos = [0, 0, 0], nor = [0, 0, 1], uv = [0.5, 0.5], idx: number[] = [];
  for (let i = 0; i <= seg; i++) { const t = (i / seg) * Math.PI * 2; pos.push(r * Math.cos(t), r * Math.sin(t), 0); nor.push(0, 0, 1); uv.push(0.5 + Math.cos(t) / 2, 0.5 + Math.sin(t) / 2); }
  for (let i = 1; i <= seg; i++) idx.push(0, i, i + 1);
  return build(pos, nor, uv, idx);
}

/** Surface of revolution of (r, y) profile points around +Y. */
export function latheGeometry(profile: { x: number; y: number }[], seg = 24): Geometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    for (let j = 0; j < profile.length; j++) { const p = profile[j]!; pos.push(p.x * Math.sin(t), p.y, p.x * Math.cos(t)); uv.push(i / seg, j / (profile.length - 1)); }
  }
  const n = profile.length;
  for (let i = 0; i < seg; i++) for (let j = 0; j < n - 1; j++) { const a = i * n + j, b = a + n; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new Geometry();
  g.setAttribute('position', new Attribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new Attribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  return g.computeVertexNormals();
}

/** Ear-clipping triangulation of a simple polygon (2D). Returns index triples into `pts`. */
export function triangulate(pts: { x: number; y: number }[]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) { const a = pts[i]!, b = pts[(i + 1) % n]!; area += a.x * b.y - b.x * a.y; }
  const V = Array.from({ length: n }, (_, i) => (area > 0 ? i : n - 1 - i));
  const out: [number, number, number][] = [];
  const inside = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => {
    const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y), d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y), d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  let guard = 0;
  while (V.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < V.length; i++) {
      const ia = V[(i + V.length - 1) % V.length]!, ib = V[i]!, ic = V[(i + 1) % V.length]!;
      const a = pts[ia]!, b = pts[ib]!, c = pts[ic]!;
      if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) <= 1e-12) continue; // reflex/degenerate
      let ok = true;
      for (const j of V) if (j !== ia && j !== ib && j !== ic && inside(pts[j]!, a, b, c)) { ok = false; break; }
      if (!ok) continue;
      out.push([ia, ib, ic]); V.splice(i, 1); clipped = true; break;
    }
    if (!clipped) { // fall back to a fan for self-touching input
      for (let i = 1; i + 1 < V.length; i++) out.push([V[0]!, V[i]!, V[i + 1]!]);
      return out;
    }
  }
  if (V.length === 3) out.push([V[0]!, V[1]!, V[2]!]);
  return out;
}

/** Extrude a closed 2D outline (x,y) along +z by depth with optional per-step taper callback. */
export function extrudeOutline(outline: { x: number; y: number }[], depth: number, steps = 1): Geometry {
  const pos: number[] = [], idx: number[] = [];
  const n = outline.length;
  for (let s = 0; s <= steps; s++) for (const p of outline) pos.push(p.x, p.y, (depth * s) / steps);
  for (let s = 0; s < steps; s++) for (let i = 0; i < n; i++) { const a = s * n + i, b = s * n + ((i + 1) % n), c = a + n, d = b + n; idx.push(a, b, d, a, d, c); }
  const tris = triangulate(outline);
  for (const [a, b, c] of tris) { idx.push(c, b, a); idx.push(steps * n + a, steps * n + b, steps * n + c); }
  const g = new Geometry();
  g.setAttribute('position', new Attribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new Attribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  return g.toNonIndexed().computeVertexNormals();
}
