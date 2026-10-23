// Meshlet-like clustering (§062), CPU coarse culling (§063), glyph → mesh (§061).
// Inspired by published cluster-LOD ideas (bounded triangle clusters with geometric
// error and bounds); independently implemented — no engine source copied.
import { Geometry, Attribute, Vec3, Mat4, cylinderGeometry, sphereGeometry, mergeGeometries, Quat } from '@astro/core';

export interface Cluster { triangles: Uint32Array; center: Vec3; radius: number; error: number; level: number }
export interface ClusterHierarchy { levels: Cluster[][]; sourceTriangles: number }

const morton = (x: number, y: number, z: number) => {
  const part = (v: number) => { v = Math.min(1023, Math.max(0, Math.floor(v * 1023))); v = (v | (v << 16)) & 0x030000ff; v = (v | (v << 8)) & 0x0300f00f; v = (v | (v << 4)) & 0x030c30c3; v = (v | (v << 2)) & 0x09249249; return v; };
  return (part(x) << 2) | (part(y) << 1) | part(z);
};

/** Partition triangles into spatially coherent clusters of ≤ maxTris (Morton order of centroids). */
export function clusterize(g: Geometry, maxTris = 124, level = 0, error = 0): Cluster[] {
  const p = g.getAttribute('position');
  const idx = g.index ? g.index.array : Uint32Array.from({ length: p.count }, (_, i) => i);
  const nt = idx.length / 3;
  const bb = g.computeBoundingBox(), size = bb.getSize(new Vec3());
  const cen = new Float32Array(nt * 3), codes: [number, number][] = [];
  const a = new Vec3(), b = new Vec3(), c = new Vec3();
  for (let t = 0; t < nt; t++) {
    a.fromBufferAttribute(p, idx[t * 3]!); b.fromBufferAttribute(p, idx[t * 3 + 1]!); c.fromBufferAttribute(p, idx[t * 3 + 2]!);
    const x = (a.x + b.x + c.x) / 3, y = (a.y + b.y + c.y) / 3, z = (a.z + b.z + c.z) / 3;
    cen.set([x, y, z], t * 3);
    codes.push([morton((x - bb.min.x) / (size.x || 1), (y - bb.min.y) / (size.y || 1), (z - bb.min.z) / (size.z || 1)), t]);
  }
  codes.sort((u, v) => u[0] - v[0]);
  const out: Cluster[] = [];
  for (let s = 0; s < codes.length; s += maxTris) {
    const tris = codes.slice(s, s + maxTris).map((q) => q[1]);
    const triIdx = new Uint32Array(tris.length * 3);
    const center = new Vec3();
    tris.forEach((t, i) => { triIdx.set([idx[t * 3]!, idx[t * 3 + 1]!, idx[t * 3 + 2]!], i * 3); center.x += cen[t * 3]!; center.y += cen[t * 3 + 1]!; center.z += cen[t * 3 + 2]!; });
    center.multiplyScalar(1 / tris.length);
    let r = 0;
    for (const vi of triIdx) r = Math.max(r, a.fromBufferAttribute(p, vi).distanceTo(center));
    out.push({ triangles: triIdx, center, radius: r, error, level });
  }
  return out;
}

/** Two-level hierarchy: full detail clusters + a coarse level from a supplied simplified geometry. */
export function buildHierarchy(fine: Geometry, coarse: Geometry | null, coarseError: number): ClusterHierarchy {
  const levels = [clusterize(fine, 124, 0, 0)];
  if (coarse) levels.push(clusterize(coarse, 124, 1, coarseError));
  return { levels, sourceTriangles: fine.triangleCount };
}

export const screenError = (errorM: number, dist: number, fovDeg: number, viewportPx: number) => (errorM * viewportPx) / (2 * Math.max(0.01, dist) * Math.tan((fovDeg * Math.PI) / 360));

/** Select the coarsest level whose projected error ≤ tolerance; returns triangles drawn. */
export function selectClusters(h: ClusterHierarchy, eye: Vec3, fovDeg: number, viewportPx: number, tolerancePx = 1): { level: number; clusters: number; triangles: number } {
  for (let l = h.levels.length - 1; l >= 0; l--) {
    const cl = h.levels[l]!;
    const worst = Math.max(...cl.map((c) => screenError(c.error, Math.max(0.01, eye.distanceTo(c.center) - c.radius), fovDeg, viewportPx)));
    if (worst <= tolerancePx || l === 0) return { level: l, clusters: cl.length, triangles: cl.reduce((s, c) => s + c.triangles.length / 3, 0) };
  }
  return { level: 0, clusters: 0, triangles: 0 };
}

// ---------------------------------------------------------------- frustum
export type Plane = [number, number, number, number];
export function frustumPlanes(viewProj: Mat4): Plane[] {
  const m = viewProj.elements;
  const r = (i: number) => [m[i]!, m[4 + i]!, m[8 + i]!, m[12 + i]!];
  const [r0, r1, r2, r3] = [r(0), r(1), r(2), r(3)];
  const planes: Plane[] = [];
  for (const [s, row] of [[1, r0], [-1, r0], [1, r1], [-1, r1], [1, r2], [-1, r2]] as [number, number[]][]) {
    const p: Plane = [r3[0]! + s * row[0]!, r3[1]! + s * row[1]!, r3[2]! + s * row[2]!, r3[3]! + s * row[3]!];
    const l = Math.hypot(p[0], p[1], p[2]); planes.push([p[0] / l, p[1] / l, p[2] / l, p[3] / l]);
  }
  return planes;
}
export const sphereInFrustum = (planes: Plane[], c: Vec3, r: number) => planes.every((p) => p[0] * c.x + p[1] * c.y + p[2] * c.z + p[3] >= -r);

// ---------------------------------------------------------------- glyph → mesh (§061)
/**
 * Compile a ring graph's straight-line embedding (regular polygon, radius R) into an indexed
 * tube mesh: one cylinder per edge and one sphere per vertex. Counts are predictable:
 * vertices = E·(2(seg+1) + 2(seg+2)) + V·(ws+1)(hs+1).
 */
export function ringGlyphMesh(n: number, edges: [number, number][], R = 1, tube = 0.06, seg = 8): Geometry {
  const pts = Array.from({ length: n }, (_, i) => new Vec3(Math.cos((2 * Math.PI * i) / n) * R, Math.sin((2 * Math.PI * i) / n) * R, 0));
  const parts: Geometry[] = [];
  for (const [a, b] of edges) {
    const pa = pts[a]!, pb = pts[b]!, len = pa.distanceTo(pb);
    const cyl = cylinderGeometry(tube, tube, len, seg);
    const dir = pb.clone().sub(pa).normalize();
    const q = new Quat().setFromAxisAngle(new Vec3(0, 1, 0).cross(dir).normalize(), Math.acos(Math.max(-1, Math.min(1, dir.y))));
    cyl.applyMatrix4(new Mat4().compose(pa.clone().add(pb).multiplyScalar(0.5), q, new Vec3(1, 1, 1)));
    parts.push(cyl);
  }
  for (const p of pts) parts.push(sphereGeometry(tube * 1.8, 8, 6).translate(p.x, p.y, p.z));
  const g = mergeGeometries(parts)!;
  g.userTag = `ring C${n}`;
  return g;
}
declare module '@astro/core' { interface Geometry { userTag?: string } }

export { Attribute };
