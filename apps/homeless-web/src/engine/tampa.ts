// Source-anchored Tampa street cell: OSM roads and building footprints (ODbL) around
// N Dale Mabry Hwy & W Spruce St, composed with authored detail. Every object keeps
// a data-status: roads/footprints 'verified' (OSM fixture), heights per source tag,
// façades/café/props 'authored' (fictional).
import { Group, Mesh, InstancedMesh, Material, PointLight, Vec3, Quat, Mat4, Box3, Color, planeGeometry, boxGeometry, cylinderGeometry, coneGeometry, sphereGeometry, type Geometry, type Node } from '@astro/core';
import type RAPIER from '@dimforge/rapier3d-compat';
import { composeFacade, districtPalette, furnishStreet, weave } from '@dark/subjects';
import { fnv1a } from '@dark/core';
import type { SurfaceKind } from '@dark/somatostratum';
import { ribbon, wallStrip, extrudeFootprint, merge, consolidate, polylineLength, along, toXZ, offsetPolyline, type P2 } from './geom';
import { wetSurface, facadeMaterial, MAT } from './materials';
import { Physics, GROUP } from './physics';
import { SignSystem, signEntity } from './signs';
import { loadGLB, loadJSON, canvasTexture } from './assets';

export interface TampaCell {
  anchor: { lat: number; lon: number; osmNode: number };
  roads: { id: string; class: string; name: string | null; width: number; lanes: number | null; oneway: boolean; pts: P2[] }[];
  buildings: { id: string; kind: string; name: string | null; height: number; heightSource: string; ring: P2[] }[];
  attribution: string;
}

const VEHICLE = new Set(['motorway', 'motorway_link', 'primary', 'primary_link', 'secondary', 'tertiary', 'residential', 'unclassified', 'service']);
const SIDEWALKED = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified']);
const carriageway = (r: TampaCell['roads'][number]) => (r.class === 'primary' ? 10.5 : r.class === 'motorway' ? 11 : r.class === 'tertiary' ? 8 : r.class === 'residential' ? 7 : r.class === 'service' ? 5 : r.width);

export type Lamp = Vec3 & { yaw?: number; head?: Vec3 };

export const CAFE = { x0: -32, x1: -24, n0: 20, n1: 36, doorN: 28, name: 'Spruce Corner Café' } as const;

/** Fictional storefront names (authored; no real business is implied). */
const SHOP_NAMES = ['Laurel Hardware', 'Bayside Books', 'Palmetto Florist', 'Harbor Tailors', 'Cypress Pharmacy', 'Gulf Coast Optics', 'Sunshine Laundry', 'Mangrove Records', 'Pelican Bakery', 'Driftwood Repairs', 'Citrus Market', 'Heron Barber'];

export interface TampaWorld {
  group: Group;
  surfaces: Map<number, SurfaceKind>;
  streetlights: Lamp[];
  spawn: Vec3;
  carSpawn: { pos: Vec3; yaw: number };
  cafe: { door: Mesh; doorCollider: RAPIER.Collider; doorWorld: Vec3; interior: Box3; music: Vec3; counter: Vec3; sign: string };
  trafficLanes: { pts: P2[]; dir: 1 | -1; name: string }[];
  signalHeads: Mesh[];
  stats: { roads: number; buildings: number; sidewalkM: number; triangles: number; drawGroups: number };
  sourceLabels: { id: string; status: string; note: string }[];
  stores: { name: string; pos: Vec3 }[];
  /** Non-grass ground (roads, walks, kerbs, footprints) for the near-field grass mask. */
  grassBlockers: Geometry[];
}

export async function buildTampa(phys: Physics, signs: SignSystem, quality: 'low' | 'high'): Promise<TampaWorld> {
  const cell = await loadJSON<TampaCell>('data/tampa-cell.json');
  const group = new Group();
  group.name = 'tampa-cell';
  const surfaces = new Map<number, SurfaceKind>();
  const radius = quality === 'low' ? 520 : 800;
  const inRange = (pts: P2[]) => pts.some((p) => Math.hypot(p[0], p[1]) < radius);

  // ---------------------------------------------------------------- ground
  const groundMat = wetSurface('grass', { repeat: 220, tint: 0x9aa58a, puddles: false });
  const ground = new Mesh(planeGeometry(2400, 2400).rotateX(-Math.PI / 2), groundMat);
  ground.receiveShadow = true;
  ground.position.y = -0.005;
  group.add(ground);
  const gcol = phys.fixedBox(new Vec3(0, -0.5, 0), new Vec3(1200, 0.5, 1200));
  surfaces.set(gcol.handle, 'grass');

  // ---------------------------------------------------------------- roads
  const roads = cell.roads.filter((r) => VEHICLE.has(r.class) && inRange(r.pts));
  // junctions: vertices shared by ≥2 vehicle roads
  const key = (p: P2) => `${Math.round(p[0])}|${Math.round(p[1])}`;
  const seen = new Map<string, Set<string>>();
  for (const r of roads) for (const p of r.pts) { const k = key(p); seen.set(k, (seen.get(k) ?? new Set()).add(r.id)); }
  const junctions: { p: P2; r: number; major: boolean }[] = [];
  for (const [k, ids] of seen) {
    if (ids.size < 2) continue;
    const [x, y] = k.split('|').map(Number) as [number, number];
    const rs = roads.filter((r) => ids.has(r.id));
    const maxW = Math.max(...rs.map(carriageway));
    junctions.push({ p: [x, y], r: maxW / 2 + 3.2, major: rs.filter((r) => r.class !== 'service').length >= 2 });
  }
  // the divided highway crosses Spruce at two carriageways: treat the anchor as one large junction
  junctions.push({ p: [-8, 0], r: 15, major: true });

  const asphalt = wetSurface('asphalt', { repeat: 1, tint: 0x8d8d8d });
  const concrete = wetSurface('concrete', { repeat: 1, tint: 0xd6d2c8, puddles: false });
  const paving = wetSurface('paving', { repeat: 1, tint: 0xcfc7b8, puddles: false });
  const curbMat = MAT.curb();
  const roadGeoms: Geometry[] = [], walkGeoms: Geometry[] = [], curbGeoms: Geometry[] = [];
  const white: Geometry[] = [], yellow: Geometry[] = [];
  let sidewalkM = 0;

  const outsideJunctions = (pts: P2[], pad: number): P2[][] => {
    // split a polyline into pieces that stay out of every junction disc
    const dense: P2[] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
      for (let k = 0; k < n; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    dense.push(pts[pts.length - 1]!);
    const pieces: P2[][] = [];
    let cur: P2[] = [];
    for (const p of dense) {
      const blocked = junctions.some((j) => Math.hypot(p[0] - j.p[0], p[1] - j.p[1]) < j.r + pad);
      if (blocked) { if (cur.length > 1) pieces.push(cur); cur = []; } else cur.push(p);
    }
    if (cur.length > 1) pieces.push(cur);
    return pieces;
  };

  for (const r of roads) {
    const w = carriageway(r);
    const y = r.class === 'service' ? 0.018 : r.class === 'primary' ? 0.026 : 0.022;
    const g = ribbon(r.pts, -w / 2, w / 2, y, 6);
    if (g) roadGeoms.push(g);
    if (SIDEWALKED.has(r.class)) {
      for (const piece of outsideJunctions(r.pts, 0)) {
        for (const side of [-1, 1] as const) {
          const o0 = side * (w / 2), o1 = side * (w / 2 + 2.8);
          const sw = ribbon(piece, Math.min(o0, o1), Math.max(o0, o1), 0.15, 3);
          if (sw) walkGeoms.push(sw);
          const c = wallStrip(piece, o0, 0.0, 0.15);
          if (c) curbGeoms.push(c);
          sidewalkM += polylineLength(piece);
        }
      }
      // lane markings (outside junctions)
      for (const piece of outsideJunctions(r.pts, 1.5)) {
        if (r.class === 'primary') {
          for (const o of [-w / 6, w / 6]) dashes(piece, o, 3, 9, 0.12, y + 0.004, white);
          for (const o of [-w / 2 + 0.35, w / 2 - 0.35]) { const l = ribbon(piece, o - 0.08, o + 0.08, y + 0.004, 1); if (l) white.push(l); }
        } else {
          for (const o of [-0.12, 0.12]) { const l = ribbon(piece, o - 0.06, o + 0.06, y + 0.004, 1); if (l) yellow.push(l); }
        }
      }
    }
  }

  // OSM footways: paving where they run on open ground; zebra crossings where they cross a carriageway
  const insideRoad = (p: P2) => roads.some((r) => r.class !== 'service' && distToPolyline(p, r.pts) < carriageway(r) / 2 - 0.3);
  for (const f of cell.roads.filter((r) => (r.class === 'footway' || r.class === 'path') && inRange(r.pts))) {
    for (let i = 1; i < f.pts.length; i++) {
      const seg: P2[] = [f.pts[i - 1]!, f.pts[i]!];
      const mid: P2 = [(seg[0]![0] + seg[1]![0]) / 2, (seg[0]![1] + seg[1]![1]) / 2];
      if (insideRoad(mid)) zebra(seg, 3.0, white, 0.034);
      else { const g = ribbon(seg, -1.1, 1.1, 0.03, 2.5); if (g) walkGeoms.push(g); }
    }
  }
  // crosswalks across every arm of the anchor junction
  for (const [a, b] of [[[-24, -6.5], [8, -6.5]], [[-24, 6.5], [8, 6.5]], [[-25.5, -4], [-25.5, 4]], [[9.5, -4], [9.5, 4]]] as [P2, P2][]) zebra([a, b], 3.2, white, 0.034);

  const addMerged = (geoms: Geometry[], mat: Material, surface: SurfaceKind | null, castShadow = false) => {
    const g = merge(geoms);
    if (!g) return;
    const m = new Mesh(g, mat);
    m.receiveShadow = true; m.castShadow = castShadow;
    group.add(m);
    if (surface) surfaces.set(phys.fixedTrimesh(g).handle, surface);
  };
  const grassBlockers: Geometry[] = [...roadGeoms, ...walkGeoms];
  addMerged(roadGeoms, asphalt, 'asphalt');
  addMerged(walkGeoms, concrete, 'concrete');
  addMerged(curbGeoms, curbMat, 'concrete');
  addMerged(white, MAT.laneWhite(), null);
  addMerged(yellow, MAT.laneYellow(), null);

  // ---------------------------------------------------------------- buildings via FacadeGrammar
  const cafeBox = { minE: CAFE.x0 - 2, maxE: CAFE.x1 + 1, minN: CAFE.n0 - 2, maxN: CAFE.n1 + 2 };
  const byMat = new Map<string, { walls: Geometry[]; roofs: Geometry[] }>();
  const allBuilding: Geometry[] = [];
  const stores: { name: string; pos: Vec3 }[] = [];
  const shopfrontCandidates: { b: TampaCell['buildings'][number]; edge: { a: P2; b: P2; len: number }; dist: number; prog: ReturnType<typeof composeFacade> }[] = [];
  let nBuild = 0;
  for (const b of cell.buildings) {
    const c = centroid(b.ring);
    if (Math.hypot(c[0], c[1]) > radius) continue;
    if (c[0] > cafeBox.minE && c[0] < cafeBox.maxE && c[1] > cafeBox.minN && c[1] < cafeBox.maxN) continue;
    const district = `tampa-${Math.floor(c[0] / 150)}-${Math.floor(c[1] / 150)}`;
    const nearPrimary = roads.some((r) => (r.class === 'primary' || r.class === 'tertiary') && distToPolyline(c, r.pts) < 45);
    const commercial = nearPrimary || b.kind === 'retail' || b.kind === 'commercial' || !!b.name;
    const prog = composeFacade({ buildingId: b.id, districtId: district, frontageM: 20, heightM: b.height, ground: commercial ? 'commercial' : 'residential' });
    const pal = districtPalette(district);
    const tint = new Color().setRGB(pal.wall[0], pal.wall[1], pal.wall[2]).lerp(new Color(1, 1, 1), prog.material === 'bricks' ? 0.6 : 0.15);
    const floorH = b.height / Math.max(1, prog.floors);
    const ex = extrudeFootprint(b.ring, b.height, [prog.bayWidth, Math.min(4.2, Math.max(2.8, floorH)), (fnv1a(b.id) % 997) / 7.3, commercial ? 1 : 0], tint);
    const slot = byMat.get(prog.material) ?? { walls: [], roofs: [] };
    slot.walls.push(ex.walls); slot.roofs.push(ex.roof);
    byMat.set(prog.material, slot);
    allBuilding.push(ex.walls, ex.roof);
    grassBlockers.push(ex.roof);
    nBuild++;
    if (commercial && ex.longestEdge.len > 8) shopfrontCandidates.push({ b, edge: ex.longestEdge, dist: Math.hypot(c[0], c[1]), prog });
  }
  for (const [mat, s] of byMat) {
    const fm = facadeMaterial({ id: mat as 'stucco', repeatM: mat === 'bricks' ? 2.2 : 3.5 });
    const w = merge(s.walls), r = merge(s.roofs);
    if (w) { const m = new Mesh(w, fm); m.castShadow = m.receiveShadow = true; group.add(m); }
    if (r) { const m = new Mesh(r, fm); m.receiveShadow = true; group.add(m); }
  }
  const bcol = merge(allBuilding);
  if (bcol) surfaces.set(phys.fixedTrimesh(bcol).handle, 'concrete');

  // close-range storefront detail: awnings + fictional shop signs on the nearest commercial frontages
  shopfrontCandidates.sort((a, b) => a.dist - b.dist);
  const awnings: Geometry[] = [];
  const awningMat = new Map<string, Material>();
  shopfrontCandidates.slice(0, quality === 'low' ? 8 : 12).forEach((s, i) => {
    const { a, b } = s.edge;
    const mid: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const dir: P2 = [(b[0] - a[0]) / s.edge.len, (b[1] - a[1]) / s.edge.len];
    const outward: P2 = [dir[1], -dir[0]]; // ring is CCW → outward is to the right
    const yaw = Math.atan2(-outward[1], outward[0]) - Math.PI / 2; // face outward in XZ
    const name = SHOP_NAMES[i % SHOP_NAMES.length]!;
    const pal = s.prog.palette;
    const col = new Color().setRGB(pal.awning[0], pal.awning[1], pal.awning[2]);
    const key = col.getHexString();
    if (!awningMat.has(key)) awningMat.set(key, MAT.fabric(col));
    const aw = Math.min(s.edge.len * 0.7, 14);
    const awning = new Mesh(boxGeometry(aw, 0.12, 1.6).translate(0, 0, 0.8).rotateX(0.28), awningMat.get(key)!);
    const [mx, mz] = toXZ([mid[0] + outward[0] * 0.05, mid[1] + outward[1] * 0.05]);
    awning.position.set(mx, 3.4, mz); awning.rotation.y = yaw; awning.castShadow = true;
    group.add(awning);
    const sign = signs.create(signEntity(`shop-${i}`, 'shopfront', name, Math.min(aw * 0.8, 6), 0.7, { emission: { hue: pal.hues[2] ?? 40, chroma: 0.09, lightness: 0.9, brightness: 0.75 }, schedule: { onHour: 7, offHour: 23 } }), { lit: false, panelColor: 0x101215 });
    const [sx, sz] = toXZ([mid[0] + outward[0] * 0.12, mid[1] + outward[1] * 0.12]);
    sign.group.position.set(sx, 4.2, sz); sign.group.rotation.y = yaw;
    group.add(sign.group);
    stores.push({ name, pos: new Vec3(sx, 0, sz) });
  });
  void awnings;

  // ---------------------------------------------------------------- the café (author-composed, fictional)
  const cafe = await buildCafe(group, phys, surfaces, signs);

  // ---------------------------------------------------------------- street furniture
  const streetlights: Lamp[] = [];
  const palmSpots: { x: number; z: number; r: number; s: number }[] = [];
  for (const r of roads) {
    if (!SIDEWALKED.has(r.class)) continue;
    const L = polylineLength(r.pts);
    const w = carriageway(r);
    for (const f of furnishStreet(L, fnv1a(r.id), r.class)) {
      const { p, dir } = along(r.pts, f.t);
      const n: P2 = [-dir[1], dir[0]];
      const off = w / 2 + f.offset;
      const q: P2 = [p[0] + n[0] * off * f.side, p[1] + n[1] * off * f.side];
      if (junctions.some((j) => Math.hypot(q[0] - j.p[0], q[1] - j.p[1]) < j.r + 1)) continue;
      if (q[0] > cafeBox.minE - 1 && q[0] < cafeBox.maxE + 1 && q[1] > cafeBox.minN && q[1] < cafeBox.maxN) continue;
      const [x, z] = toXZ(q);
      if (f.kind === 'streetlight') {
        const v = new Vec3(x, 0.15, z) as Lamp;
        v.yaw = Math.atan2(-n[0] * f.side, n[1] * f.side); // arm points across the carriageway
        streetlights.push(v);
      }
      else if (f.kind === 'palm') palmSpots.push({ x, z, r: (fnv1a(r.id + f.t) % 628) / 100, s: 0.85 + (fnv1a(r.id + f.t + 'a') % 40) / 100 });
    }
  }
  buildStreetlights(group, streetlights, phys);
  // palms are the heaviest instanced asset (~11k triangles each even simplified): bound them per tier
  const palmBudget = quality === 'low' ? { r: 170, n: 36 } : { r: 420, n: 140 };
  const palms = palmSpots.filter((p) => Math.hypot(p.x, p.z) < palmBudget.r).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)).slice(0, palmBudget.n);
  await buildPalms(group, palms, phys);

  // traffic signal heads at the anchor (cycle driven by the game loop)
  const signalHeads: Mesh[] = [];
  for (const [e, n, yaw] of [[-23.5, 8.5, 0], [7.5, -8.5, Math.PI], [7.5, 8.5, -Math.PI / 2], [-23.5, -8.5, Math.PI / 2]] as const) {
    const pole = new Mesh(cylinderGeometry(0.09, 0.11, 5.4, 10), MAT.metal(0x3a3d40));
    const [x, z] = toXZ([e, n]);
    pole.position.set(x, 2.85, z); pole.castShadow = true; group.add(pole);
    const head = new Mesh(boxGeometry(0.36, 1.0, 0.3), MAT.emissive(0x000000, 0));
    head.position.set(x, 5.2, z); head.rotation.y = yaw; head.castShadow = true;
    group.add(head); signalHeads.push(head);
    phys.fixedBox(new Vec3(x, 2.7, z), new Vec3(0.12, 2.7, 0.12));
  }
  // route sign: wayfinding with real road names (source: OSM names), distance to the airport computed at runtime
  const route = signs.create(signEntity('route-north', 'wayfinding', 'N Dale Mabry Hwy  ↑  Airport', 3.4, 0.8, { emission: { hue: 150, chroma: 0.11, lightness: 0.86, brightness: 0.6 }, fictional: false }), { panelColor: 0x0d5a35 });
  route.group.position.set(-23.5, 4.3, -10.5); route.group.rotation.y = -Math.PI / 2;
  group.add(route.group);

  // traffic lanes: the two Dale Mabry carriageways (northbound east, southbound west)
  const dm = cell.roads.filter((r) => r.name === 'North Dale Mabry Highway' && r.class === 'primary');
  const east = stitch(dm.filter((r) => avgE(r.pts) > -8)), west = stitch(dm.filter((r) => avgE(r.pts) <= -8));
  const trafficLanes: TampaWorld['trafficLanes'] = [];
  for (const [line, dir, nm] of [[east, 1, 'NB'], [west, -1, 'SB']] as const) {
    if (line.length < 2) continue;
    const sorted = [...line].sort((a, b) => a[1] - b[1]);
    const ordered = dir === 1 ? sorted : sorted.reverse();
    trafficLanes.push({ pts: offsetPolyline(ordered, -1.9), dir, name: `${nm}-inner` }, { pts: offsetPolyline(ordered, -5.1 + 1.9 * 0.2), dir, name: `${nm}-outer` });
  }

  let triangles = 0;
  group.traverse((m) => { if (m instanceof Mesh) triangles += m.geometry.triangleCount * (m instanceof InstancedMesh ? 1 : 1); });

  return {
    group, surfaces, streetlights, grassBlockers: [...grassBlockers, boxGeometry(CAFE.x1 - CAFE.x0 + 1.2, 0.1, CAFE.n1 - CAFE.n0 + 1.2).translate((CAFE.x0 + CAFE.x1) / 2, 0, -(CAFE.n0 + CAFE.n1) / 2)],
    spawn: new Vec3(-22.6, 0.2, -12),
    carSpawn: { pos: new Vec3(-42, 0.05, 2.2), yaw: -Math.PI / 2 },
    cafe, trafficLanes, signalHeads, stores,
    stats: { roads: roads.length, buildings: nBuild, sidewalkM: Math.round(sidewalkM), triangles: Math.round(triangles), drawGroups: group.children.length },
    sourceLabels: [
      { id: 'roads', status: 'verified', note: `${roads.length} OSM ways (${cell.attribution}, ODbL-1.0)` },
      { id: 'buildings', status: 'verified', note: `${nBuild} OSM footprints; heights from OSM tags where present, else authored 7 m` },
      { id: 'facades', status: 'authored', note: 'FacadeGrammar compositions on real footprints; not the real appearance' },
      { id: 'cafe', status: 'authored', note: `${CAFE.name} is fictional` },
      { id: 'shops', status: 'authored', note: 'storefront names are fictional; no real business is implied' },
      { id: 'elevation', status: 'unavailable', note: 'street-level altitude unknown; cell rendered on a flat local tangent plane' },
    ],
  };

  function dashes(pts: P2[], off: number, dash: number, gap: number, halfW: number, y: number, out: Geometry[]) {
    const L = polylineLength(pts);
    for (let s = 0; s + dash < L; s += dash + gap) {
      const a = along(pts, s / L).p, b = along(pts, (s + dash) / L).p;
      const g = ribbon([a, b], off - halfW / 2, off + halfW / 2, y, 1);
      if (g) out.push(g);
    }
  }
  function zebra(seg: P2[], width: number, out: Geometry[], y: number) {
    const L = polylineLength(seg);
    for (let s = 0.3; s + 0.5 < L; s += 1.0) {
      const a = along(seg, s / L).p, b = along(seg, (s + 0.5) / L).p;
      const g = ribbon([a, b], -width / 2, width / 2, y, 1);
      if (g) out.push(g);
    }
  }
}

function centroid(r: P2[]): P2 { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; }
const avgE = (pts: P2[]) => pts.reduce((a, p) => a + p[0], 0) / pts.length;
function stitch(rs: { pts: P2[] }[]): P2[] { return rs.flatMap((r) => r.pts); }

export function distToPolyline(p: P2, pts: P2[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

// ---------------------------------------------------------------- café
async function buildCafe(group: Group, phys: Physics, surfaces: Map<number, SurfaceKind>, signs: SignSystem) {
  const g = new Group();
  g.name = 'cafe (authored, fictional)';
  const [x0, x1] = [CAFE.x0, CAFE.x1];
  const z0 = -CAFE.n1, z1 = -CAFE.n0; // three z
  const zDoor = -CAFE.doorN;
  const H = 4.2;
  const wallMat = facadeMaterial({ id: 'plaster', repeatM: 3 });
  const plain = (w: number, h: number, d: number, mat: Material, x: number, y: number, z: number, collide = true, surface: SurfaceKind = 'concrete') => {
    const m = new Mesh(boxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
    g.add(m);
    if (collide) surfaces.set(phys.fixedBox(new Vec3(x, y, z), new Vec3(w / 2, h / 2, d / 2)).handle, surface);
    return m;
  };
  const plasterMat = new Material({ map: wallMat.map, normalMap: wallMat.normalMap, color: 0xf1e3cf, roughness: 0.9, uvScale: 1, name: 'plaster' });
  // back, north and south walls
  plain(0.3, H, z1 - z0, plasterMat, x0, H / 2, (z0 + z1) / 2);
  plain(x1 - x0, H, 0.3, plasterMat, (x0 + x1) / 2, H / 2, z0);
  plain(x1 - x0, H, 0.3, plasterMat, (x0 + x1) / 2, H / 2, z1);
  // street façade (east, x = x1): glass storefront with a doorway 1.8 m wide at zDoor
  const glass = MAT.glass();
  const doorW = 1.8;
  const segA = [z0, zDoor - doorW / 2], segB = [zDoor + doorW / 2, z1];
  for (const [za, zb] of [segA, segB] as [number, number][]) {
    plain(0.2, 0.6, zb - za, plasterMat, x1, 0.3, (za + zb) / 2);
    const pane = new Mesh(boxGeometry(0.05, 2.6, zb - za), glass);
    pane.position.set(x1, 1.9, (za + zb) / 2); g.add(pane);
    surfaces.set(phys.fixedBox(pane.position.clone(), new Vec3(0.05, 1.3, (zb - za) / 2)).handle, 'concrete');
    for (let z = za; z <= zb + 0.01; z += (zb - za) / 3) plain(0.12, 2.6, 0.08, MAT.metal(0x22252a), x1 + 0.02, 1.9, z, false);
  }
  plain(0.3, H - 3.2, z1 - z0, plasterMat, x1, 3.2 + (H - 3.2) / 2, (z0 + z1) / 2);
  // south wall mural (sign class artist_mural): an authored generative painting from the interval orbit ⟨5⟩ ⊂ ℤ/12
  g.add(muralMesh(x1 - x0 - 0.8, 3.3, (x0 + x1) / 2, 2.05, z1 + 0.17));
  // roof + interior floor (wood) + ceiling
  plain(x1 - x0 + 0.4, 0.25, z1 - z0 + 0.4, new Material({ color: 0x5b5450, roughness: 0.9 }), (x0 + x1) / 2, H + 0.12, (z0 + z1) / 2);
  const woodMat = wetSurface('wood', { repeat: 1, puddles: false });
  const floorGeo = boxGeometry(x1 - x0, 0.16, z1 - z0);
  const uv = floorGeo.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / 2.5, uv.getY(i) * (z1 - z0) / 2.5);
  const floor = new Mesh(floorGeo, woodMat);
  floor.position.set((x0 + x1) / 2, 0.08, (z0 + z1) / 2); floor.receiveShadow = true; g.add(floor);
  surfaces.set(phys.fixedBox(floor.position.clone(), new Vec3((x1 - x0) / 2, 0.08, (z1 - z0) / 2)).handle, 'wood');
  // sliding glass door leaf (kinematic collider; opens only when the motion grammar admits PASS_DOOR)
  const door = new Mesh(boxGeometry(0.06, 2.3, doorW), glass.clone());
  door.position.set(x1 + 0.08, 1.31, zDoor); g.add(door);
  const doorBody = phys.world.createRigidBody(phys.R.RigidBodyDesc.kinematicPositionBased().setTranslation(door.position.x, door.position.y, door.position.z));
  const doorCollider = phys.world.createCollider(phys.R.ColliderDesc.cuboid(0.05, 1.15, doorW / 2).setCollisionGroups((GROUP.STATIC << 16) | 0xffff), doorBody);
  // counter, shelves, tables
  const wood = new Material({ map: woodMat.map, color: 0x8a5a3a, roughness: 0.55, name: 'wood' });
  const stone = new Material({ color: 0xe7e2da, roughness: 0.25, metalness: 0, name: 'stone' });
  plain(1.0, 1.05, 6.5, wood, x0 + 1.7, 0.68, (z0 + z1) / 2 - 2.5);
  plain(1.1, 0.06, 6.6, stone, x0 + 1.7, 1.23, (z0 + z1) / 2 - 2.5, false);
  plain(0.3, 0.05, 5, wood, x0 + 0.35, 1.9, (z0 + z1) / 2 - 2.5, false);
  plain(0.3, 0.05, 5, wood, x0 + 0.35, 2.5, (z0 + z1) / 2 - 2.5, false);
  const cup = (await loadGLB('cup')).scene;
  for (let i = 0; i < 6; i++) { const c = cup.clone(); c.position.set(x0 + 1.6, 1.26, (z0 + z1) / 2 - 5 + i * 0.9); g.add(c); }
  for (const [tx, tz] of [[x0 + 4.4, z0 + 3], [x0 + 4.4, z0 + 6.2], [x0 + 6.2, z1 - 2.4], [x0 + 4.4, z1 - 4.8]] as [number, number][]) {
    const top = new Mesh(cylinderGeometry(0.42, 0.42, 0.04, 28), stone); top.position.set(tx, 0.92, tz); top.castShadow = true; g.add(top);
    const leg = new Mesh(cylinderGeometry(0.05, 0.25, 0.75, 16), MAT.metal(0x1c1d20)); leg.position.set(tx, 0.53, tz); g.add(leg);
    surfaces.set(phys.fixedBox(new Vec3(tx, 0.55, tz), new Vec3(0.4, 0.4, 0.4)).handle, 'wood');
    for (const a of [0, Math.PI]) {
      const seat = new Mesh(cylinderGeometry(0.2, 0.2, 0.05, 20), wood); seat.position.set(tx + Math.cos(a) * 0.75, 0.62, tz + Math.sin(a) * 0.75); seat.castShadow = true; g.add(seat);
      const sleg = new Mesh(cylinderGeometry(0.03, 0.03, 0.46, 8), MAT.metal(0x1c1d20)); sleg.position.set(seat.position.x, 0.38, seat.position.z); g.add(sleg);
    }
  }
  // pendant lamps: warm 2700 K bounded lights (photometric intensity in candela)
  for (const lz of [z0 + 3.5, (z0 + z1) / 2, z1 - 3.5]) {
    const shade = new Mesh(coneGeometry(0.28, 0.3, 24, true), new Material({ color: 0x1b1b1b, roughness: 0.6, side: 'double', emissive: 0xffb46b, emissiveIntensity: 0.4, name: 'shade' }));
    shade.position.set(x0 + 4.6, 3.1, lz); g.add(shade);
    const bulb = new Mesh(sphereGeometry(0.07, 12, 8), MAT.emissive(0xffc98a, 6)); bulb.position.set(x0 + 4.6, 2.98, lz); g.add(bulb);
    if (lz === (z0 + z1) / 2) { const l = new PointLight(0xffc28a, 60, 12, 2); l.position.set(x0 + 4.6, 2.9, lz); g.add(l); } // one real light; the others are emissive only
  }
  // awning + sign
  const awning = new Mesh(boxGeometry(1.8, 0.1, z1 - z0).translate(0.9, 0, 0), MAT.fabric(0x6b2a24));
  awning.position.set(x1 + 0.15, 3.3, (z0 + z1) / 2); awning.rotation.z = -0.3; awning.castShadow = true; g.add(awning);
  const sign = signs.create(signEntity('cafe-sign', 'shopfront', CAFE.name.toUpperCase(), 6.5, 0.85, {
    emission: { hue: 70, chroma: 0.11, lightness: 0.9, brightness: 0.9 }, schedule: { onHour: 6, offHour: 24 }, preferredReadDistance: 35,
  }), { lit: true, panelColor: 0x1a1210 });
  sign.group.position.set(x1 + 0.22, 3.75, (z0 + z1) / 2); sign.group.rotation.y = Math.PI / 2;
  g.add(sign.group);
  // night-window weave on the upper fascia (World Loom rule 110 port)
  const pattern = weave(110, 12, 2);
  pattern[1]!.forEach((bit, i) => {
    if (!bit) return;
    const p = plain(0.04, 0.12, 0.5, MAT.emissive(0xffb070, 1.2), x1 + 0.17, 4.05, z0 + 0.8 + i * ((z1 - z0 - 1.6) / 11), false);
    p.name = 'loom-light';
  });
  group.add(g);
  return {
    door, doorCollider, doorWorld: new Vec3(x1, 0, zDoor), interior: new Box3(new Vec3(x0, 0, z0), new Vec3(x1, H, z1)),
    music: new Vec3(x0 + 1, 2.5, (z0 + z1) / 2), counter: new Vec3(x0 + 2.6, 0.16, (z0 + z1) / 2 - 2.5), sign: 'cafe-sign',
  };
}

function muralMesh(w: number, h: number, x: number, y: number, z: number): Mesh {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = Math.round(1024 * (h / w));
  const ctx = c.getContext('2d')!;
  const pal = districtPalette('cafe-mural', 5);
  const css = (rgb: number[], a = 1) => { const s = rgb.map((v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))); return `rgba(${s[0]},${s[1]},${s[2]},${a})`; };
  ctx.fillStyle = css(pal.trim); ctx.fillRect(0, 0, c.width, c.height);
  const hues = pal.hues;
  for (let i = 0; i < hues.length; i++) {
    const cx = (i + 0.5) * (c.width / hues.length), cy = c.height * (0.45 + 0.25 * Math.sin(i * 1.7));
    const r = c.height * (0.28 + 0.12 * ((i * 5) % 12) / 12);
    const grd = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
    const col = new Color().setHSL(hues[i]! / 360, 0.55, 0.55);
    grd.addColorStop(0, `#${col.getHexString()}`); grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = css(pal.accent, 0.85); ctx.lineWidth = 10;
  ctx.beginPath();
  for (let k = 0; k <= 12; k++) { const a = ((k * 5) % 12) / 12 * Math.PI * 2; const px = c.width / 2 + Math.cos(a) * c.height * 0.38, py = c.height / 2 + Math.sin(a) * c.height * 0.38; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
  ctx.stroke();
  ctx.fillStyle = css(pal.wall, 0.9); ctx.font = '600 34px Inter, sans-serif'; ctx.fillText('⟨5⟩ ⊂ ℤ/12 · a walk of fourths', 24, c.height - 26);
  const tex = canvasTexture(c, true);
  tex.anisotropy = 8; tex.wrap = 'clamp';
  const m = new Mesh(planeGeometry(w, h), new Material({ map: tex, roughness: 0.85, name: 'mural' }));
  m.position.set(x, y, z);
  m.name = 'mural (authored)';
  m.receiveShadow = true;
  return m;
}

function buildStreetlights(group: Group, pts: Vec3[], phys: Physics) {
  const n = pts.length;
  if (!n) return;
  const poleGeo = cylinderGeometry(0.07, 0.11, 7.5, 10).translate(0, 3.75, 0);
  const armGeo = boxGeometry(0.08, 0.08, 1.9).translate(0, 7.35, 0.9);
  const headGeo = boxGeometry(0.34, 0.12, 0.7).translate(0, 7.28, 1.75);
  const poles = new InstancedMesh(poleGeo, MAT.metal(0x3b3e42), n);
  const arms = new InstancedMesh(armGeo, MAT.metal(0x3b3e42), n);
  const heads = new InstancedMesh(headGeo, MAT.emissive(0xffd6a0, 0), n);
  heads.name = 'streetlight-heads';
  const m = new Mat4(), q = new Quat();
  pts.forEach((p, i) => {
    q.setFromAxisAngle(new Vec3(0, 1, 0), (p as Lamp).yaw ?? 0);
    m.compose(p, q, new Vec3(1, 1, 1));
    poles.setMatrixAt(i, m); arms.setMatrixAt(i, m); heads.setMatrixAt(i, m);
    phys.fixedBox(new Vec3(p.x, 3, p.z), new Vec3(0.12, 3, 0.12));
    // lamp head position in world for light pooling
    const head = new Vec3(0, 7.2, 1.75).applyQuaternion(q).add(p);
    (p as Lamp).head = head;
  });
  for (const im of [poles, arms, heads]) { im.castShadow = im !== heads; im.receiveShadow = true; group.add(im); }
}

async function buildPalms(group: Group, spots: { x: number; z: number; r: number; s: number }[], phys: Physics) {
  if (!spots.length) return;
  // instanced street trees: simplified derivative, merged by material first (≈900 sub-meshes → a few draws)
  const palm = consolidate((await loadGLB('palm-lod')).scene, () => false);
  palm.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  palm.traverse((o) => { if (o instanceof Mesh) meshes.push(o); });
  const m = new Mat4(), q = new Quat(), sc = new Vec3();
  for (const mesh of meshes) {
    const mat = mesh.material.clone();
    mat.side = 'double'; // fronds are single-sheet geometry
    const im = new InstancedMesh(mesh.geometry, mat, spots.length);
    spots.forEach((s, i) => {
      q.setFromAxisAngle(new Vec3(0, 1, 0), s.r);
      sc.setScalar(s.s);
      m.compose(new Vec3(s.x, 0.15, s.z), q, sc).multiply(mesh.matrixWorld);
      im.setMatrixAt(i, m);
    });
    im.castShadow = true; im.receiveShadow = true;
    group.add(im);
  }
  for (const s of spots) phys.fixedBox(new Vec3(s.x, 2, s.z), new Vec3(0.22, 2, 0.22));
}
