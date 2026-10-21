// Procedural geometry from sourced vector data. ENU (east, north) → Three (x = east, z = −north).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type P2 = [number, number];
export const toXZ = (p: P2): [number, number] => [p[0], -p[1]];

export function polylineLength(pts: P2[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return s;
}

/** Point and tangent at arc-length fraction t along an ENU polyline. */
export function along(pts: P2[], t: number): { p: P2; dir: P2 } {
  const L = polylineLength(pts) * Math.min(1, Math.max(0, t));
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s + l >= L || i === pts.length - 1) {
      const u = l > 0 ? (L - s) / l : 0;
      return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], dir: l > 0 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : [1, 0] };
    }
    s += l;
  }
  return { p: pts[0]!, dir: [1, 0] };
}

/** Mitred offset of a polyline (ENU), positive offset = left of travel direction. */
export function offsetPolyline(pts: P2[], off: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)]!, next = pts[Math.min(pts.length - 1, i + 1)]!;
    const d1 = norm([pts[i]![0] - prev[0], pts[i]![1] - prev[1]]), d2 = norm([next[0] - pts[i]![0], next[1] - pts[i]![1]]);
    const d = i === 0 ? d2 : i === pts.length - 1 ? d1 : norm([d1[0] + d2[0], d1[1] + d2[1]]);
    const n: P2 = [-d[1], d[0]];
    const cos = i === 0 || i === pts.length - 1 ? 1 : Math.max(0.35, d1[0] * d[0] + d1[1] * d[1]);
    out.push([pts[i]![0] + (n[0] * off) / cos, pts[i]![1] + (n[1] * off) / cos]);
  }
  return out;
}
const norm = (v: P2): P2 => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

/** Flat ribbon between lateral offsets [o0, o1] at height y; UV u across (m), v along (m). */
export function ribbon(pts: P2[], o0: number, o1: number, y: number, uvScale = 1): THREE.BufferGeometry | null {
  if (pts.length < 2) return null;
  const a = offsetPolyline(pts, o0), b = offsetPolyline(pts, o1);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) s += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    const [ax, az] = toXZ(a[i]!), [bx, bz] = toXZ(b[i]!);
    pos.push(ax, y, az, bx, y, bz);
    uv.push(o0 / uvScale, s / uvScale, o1 / uvScale, s / uvScale);
    if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  fixWinding(g);
  g.computeVertexNormals();
  return g;
}

/** Vertical strip (curb face) along an offset line, from y0 to y1. */
export function wallStrip(pts: P2[], off: number, y0: number, y1: number): THREE.BufferGeometry | null {
  if (pts.length < 2) return null;
  const l = offsetPolyline(pts, off);
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let s = 0;
  for (let i = 0; i < l.length; i++) {
    if (i > 0) s += Math.hypot(l[i]![0] - l[i - 1]![0], l[i]![1] - l[i - 1]![1]);
    const [x, z] = toXZ(l[i]!);
    pos.push(x, y0, z, x, y1, z);
    uv.push(s, y0, s, y1);
    if (i > 0) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Ensure upward-facing triangles for flat ribbons (offset sign can flip winding). */
function fixWinding(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const idx = g.getIndex()!;
  const arr = idx.array as unknown as number[];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < arr.length; i += 3) {
    a.fromBufferAttribute(p, arr[i]!); b.fromBufferAttribute(p, arr[i + 1]!); c.fromBufferAttribute(p, arr[i + 2]!);
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (ny < 0) { const t = arr[i + 1]!; arr[i + 1] = arr[i + 2]!; arr[i + 2] = t; }
  }
  idx.needsUpdate = true;
}

export interface ExtrudeOut { walls: THREE.BufferGeometry; roof: THREE.BufferGeometry; frontage: number; longestEdge: { a: P2; b: P2; len: number } }

/**
 * Extrude a footprint ring (ENU) to height h. Walls get UVs in metres (u along the
 * perimeter, v up) and a per-vertex aFacade = (bayWidth, floorHeight, seed, commercial)
 * plus vertex colour (palette wall tint).
 */
export function extrudeFootprint(ring: P2[], h: number, facade: [number, number, number, number], tint: THREE.Color, base = 0): ExtrudeOut {
  let r = ring.slice();
  if (r.length > 1 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1]) r = r.slice(0, -1);
  // CCW in ENU so outward normals face out
  let area = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i]!, b = r[(i + 1) % r.length]!; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) r.reverse();
  const pos: number[] = [], uv: number[] = [], fac: number[] = [], col: number[] = [];
  let s = 0;
  let longest = { a: r[0]!, b: r[1 % r.length]!, len: 0 };
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!, b = r[(i + 1) % r.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len > longest.len) longest = { a, b, len };
    const [ax, az] = toXZ(a), [bx, bz] = toXZ(b);
    // two triangles, outward facing (CCW in ENU → clockwise seen from above in XZ)
    const quad = [[ax, base, az, s, 0], [bx, base, bz, s + len, 0], [bx, h, bz, s + len, h - base], [ax, base, az, s, 0], [bx, h, bz, s + len, h - base], [ax, h, az, s, h - base]];
    for (const q of quad) { pos.push(q[0]!, q[1]!, q[2]!); uv.push(q[3]!, q[4]!); fac.push(...facade); col.push(tint.r, tint.g, tint.b); }
    s += len;
  }
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  walls.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  walls.setAttribute('aFacade', new THREE.Float32BufferAttribute(fac, 4));
  walls.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  walls.computeVertexNormals();
  // roof
  const contour = r.map((p) => new THREE.Vector2(p[0], p[1]));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const rp: number[] = [], ruv: number[] = [], rfac: number[] = [], rcol: number[] = [];
  for (const t of tris) for (const k of [t[0]!, t[2]!, t[1]!]) {
    const [x, z] = toXZ(r[k]!);
    rp.push(x, h, z); ruv.push(r[k]![0], -1); rfac.push(...facade); rcol.push(tint.r * 0.55, tint.g * 0.55, tint.b * 0.55);
  }
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  roof.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
  roof.setAttribute('aFacade', new THREE.Float32BufferAttribute(rfac, 4));
  roof.setAttribute('color', new THREE.Float32BufferAttribute(rcol, 3));
  roof.computeVertexNormals();
  return { walls, roof, frontage: longest.len, longestEdge: longest };
}

export function merge(geoms: (THREE.BufferGeometry | null)[]): THREE.BufferGeometry | null {
  const g = geoms.filter((x): x is THREE.BufferGeometry => !!x);
  if (!g.length) return null;
  return mergeGeometries(g.map((x) => (x.index ? x.toNonIndexed() : x)), false);
}

/** KHR_mesh_quantization/meshopt attributes are normalized integers; baking a transform needs Float32. */
export function dequantize(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    if (a.array instanceof Float32Array && !(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  return g;
}

function flipWinding(g: THREE.BufferGeometry) {
  if (g.index) {
    const a = g.index.array as unknown as number[];
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]!; a[i + 1] = a[i + 2]!; a[i + 2] = t; }
    g.index.needsUpdate = true;
  } else {
    for (const name of Object.keys(g.attributes)) {
      const attr = g.getAttribute(name) as THREE.BufferAttribute;
      const n = attr.itemSize, arr = attr.array as unknown as number[];
      for (let i = 0; i < attr.count; i += 3) for (let k = 0; k < n; k++) { const t = arr[(i + 1) * n + k]!; arr[(i + 1) * n + k] = arr[(i + 2) * n + k]!; arr[(i + 2) * n + k] = t; }
      attr.needsUpdate = true;
    }
  }
}

/** Merge every static mesh of a glTF scene by material into a few meshes (draw-call control). Keeps named nodes separate. */
export function consolidate(root: THREE.Object3D, keep: (o: THREE.Object3D) => boolean): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const kept: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && keep(o)) { kept.push(o); return; }
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
    let anc: THREE.Object3D | null = o.parent;
    while (anc && anc !== root) { if (keep(anc)) return; anc = anc.parent; }
    const mat = m.material as THREE.Material;
    const xf = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const g = dequantize(m.geometry.clone()).applyMatrix4(xf);
    // mirrored parts (negative determinant) would flip winding once baked: restore it
    if (xf.determinant() < 0) flipWinding(g);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    byMat.set(mat, [...(byMat.get(mat) ?? []), g.index ? g.toNonIndexed() : g]);
  });
  const out = new THREE.Group();
  for (const [mat, gs] of byMat) {
    const merged = mergeGeometries(gs, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    out.add(mesh);
  }
  for (const k of kept) {
    const wrapper = new THREE.Group();
    wrapper.name = k.name;
    const m = new THREE.Matrix4().multiplyMatrices(inv, k.matrixWorld);
    m.decompose(wrapper.position, wrapper.quaternion, wrapper.scale);
    const inner = consolidate(k.clone(), () => false);
    inner.position.set(0, 0, 0);
    // inner geometry is already in k's local space
    wrapper.add(inner);
    out.add(wrapper);
  }
  return out;
}
