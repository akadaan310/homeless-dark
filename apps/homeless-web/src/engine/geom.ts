// Procedural geometry from sourced vector data. ENU (east, north) → scene (x = east, z = −north).
import { Geometry, Attribute, Vec3, Mat4, Node, Group, Mesh, Material, Color, triangulate, mergeGeometries } from '@astro/core';

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
export function ribbon(pts: P2[], o0: number, o1: number, y: number, uvScale = 1): Geometry | null {
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
  const g = new Geometry();
  g.setAttribute('position', new Attribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new Attribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  fixWinding(g);
  g.computeVertexNormals();
  return g;
}

/** Vertical strip (curb face) along an offset line, from y0 to y1. */
export function wallStrip(pts: P2[], off: number, y0: number, y1: number): Geometry | null {
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
  const g = new Geometry();
  g.setAttribute('position', new Attribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new Attribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Ensure upward-facing triangles for flat ribbons (offset sign can flip winding). */
function fixWinding(g: Geometry) {
  const p = g.getAttribute('position');
  const arr = g.index!.array;
  const a = new Vec3(), b = new Vec3(), c = new Vec3();
  for (let i = 0; i < arr.length; i += 3) {
    a.fromBufferAttribute(p, arr[i]!); b.fromBufferAttribute(p, arr[i + 1]!); c.fromBufferAttribute(p, arr[i + 2]!);
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (ny < 0) { const t = arr[i + 1]!; arr[i + 1] = arr[i + 2]!; arr[i + 2] = t; }
  }
  g.index!.version++;
}

export interface ExtrudeOut { walls: Geometry; roof: Geometry; frontage: number; longestEdge: { a: P2; b: P2; len: number } }

/**
 * Extrude a footprint ring (ENU) to height h. Walls get UVs in metres (u along the
 * perimeter, v up) and a per-vertex aFacade = (bayWidth, floorHeight, seed, commercial)
 * plus vertex colour (palette wall tint).
 */
export function extrudeFootprint(ring: P2[], h: number, facade: [number, number, number, number], tint: Color, base = 0): ExtrudeOut {
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
  const walls = new Geometry();
  walls.setAttribute('position', new Attribute(new Float32Array(pos), 3));
  walls.setAttribute('uv', new Attribute(new Float32Array(uv), 2));
  walls.setAttribute('aFacade', new Attribute(new Float32Array(fac), 4));
  walls.setAttribute('color', new Attribute(new Float32Array(col), 3));
  walls.computeVertexNormals();
  // roof
  const tris = triangulate(r.map((p) => ({ x: p[0], y: p[1] })));
  const rp: number[] = [], ruv: number[] = [], rfac: number[] = [], rcol: number[] = [];
  for (const t of tris) for (const k of [t[0]!, t[2]!, t[1]!]) {
    const [x, z] = toXZ(r[k]!);
    rp.push(x, h, z); ruv.push(r[k]![0], -1); rfac.push(...facade); rcol.push(tint.r * 0.55, tint.g * 0.55, tint.b * 0.55);
  }
  const roof = new Geometry();
  roof.setAttribute('position', new Attribute(new Float32Array(rp), 3));
  roof.setAttribute('uv', new Attribute(new Float32Array(ruv), 2));
  roof.setAttribute('aFacade', new Attribute(new Float32Array(rfac), 4));
  roof.setAttribute('color', new Attribute(new Float32Array(rcol), 3));
  roof.computeVertexNormals();
  return { walls, roof, frontage: longest.len, longestEdge: longest };
}

export function merge(geoms: (Geometry | null)[]): Geometry | null {
  return mergeGeometries(geoms.filter((x): x is Geometry => !!x));
}

/** Merge every static mesh of a glTF scene by material into a few meshes (draw-call control). Keeps named nodes separate. */
export function consolidate(root: Node, keep: (o: Node) => boolean): Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byMat = new Map<Material, Geometry[]>();
  const kept: Node[] = [];
  root.traverse((o) => {
    if (o !== root && keep(o)) { kept.push(o); return; }
    if (!(o instanceof Mesh) || o.skin) return;
    let anc: Node | null = o.parent;
    while (anc && anc !== root) { if (keep(anc)) return; anc = anc.parent; }
    const xf = new Mat4().multiplyMatrices(inv, o.matrixWorld);
    // Geometry.applyMatrix4 dequantizes (meshopt int16 → float) and restores winding for mirrored parts
    const g = o.geometry.clone().applyMatrix4(xf);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.hasAttribute('uv')) g.setAttribute('uv', new Attribute(new Float32Array(g.vertexCount * 2), 2));
    byMat.set(o.material, [...(byMat.get(o.material) ?? []), g]);
  });
  const out = new Group();
  for (const [mat, gs] of byMat) {
    const merged = mergeGeometries(gs);
    if (!merged) continue;
    const mesh = new Mesh(merged, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    out.add(mesh);
  }
  for (const k of kept) {
    const wrapper = new Group();
    wrapper.name = k.name;
    const m = new Mat4().multiplyMatrices(inv, k.matrixWorld);
    m.decompose(wrapper.position, wrapper.quaternion, wrapper.scale);
    const inner = consolidate(k.clone(), () => false);
    inner.position.set(0, 0, 0);
    // inner geometry is already in k's local space
    wrapper.add(inner);
    out.add(wrapper);
  }
  return out;
}
