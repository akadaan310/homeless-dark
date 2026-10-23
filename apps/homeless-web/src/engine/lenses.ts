// ASTRO lenses (§057–§061, §070–§076, §111): alternative projections of the SAME committed
// world. A lens reads state (observer lat/lon, UTC, camera pose, committed events) and
// never writes it. Globe: Earth from orbit lit by the computed subsolar point, with the
// observer, its antipode and the nadir ray. Sky: the Hipparcos (mag ≤ 5) catalogue placed
// by the observer's sidereal time. Glyph: abstract ring-graph templates as meshes.
// Pixel: the GPU wave field as a diagnostic overlay driven by projected world events.
import { Scene, Camera, Group, Mesh, Material, DirectionalLight, HemisphereLight, Geometry, Attribute, Vec3, Quat, Euler, Color, sphereGeometry, cylinderGeometry, type Texture } from '@astro/core';
import { ringGlyphMesh } from '@astro/geometry';
import { GpuWaveField, Text, type Renderer, type FontAtlas } from '@astro/render-webgl2';
import { hipparcosStars, equatorialToHorizontal, enuFromAltAz, sunRaDec, moonRaDec, gmstDeg, antipode, CATALOG_SOURCE, type CatalogStar } from '@astro/sky';
import { pchemTemplates, ochemCatalog, cycle, RING_SIZES } from '@astro/glyphs';
import { chooseFieldGrid } from '@astro/pixels';
import { kelvinToLinear } from '@dark/visual-grammar';
import type { LensId } from '@astro/world-adapter';
import { canvasTexture, url } from './assets';

const D2R = Math.PI / 180;
/** Globe frame: y = north pole, lon 0 at +x, lon 90°E at −z. */
export const globePoint = (lat: number, lon: number, r = 1) => new Vec3(r * Math.cos(lat * D2R) * Math.cos(lon * D2R), r * Math.sin(lat * D2R), -r * Math.cos(lat * D2R) * Math.sin(lon * D2R));

function globeGeometry(r: number, ws = 128, hs = 64): Geometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= hs; j++) for (let i = 0; i <= ws; i++) {
    const lat = 90 - (180 * j) / hs, lon = -180 + (360 * i) / ws;
    const p = globePoint(lat, lon, 1);
    pos.push(p.x * r, p.y * r, p.z * r); nor.push(p.x, p.y, p.z); uv.push(i / ws, (lat + 90) / 180);
  }
  for (let j = 0; j < hs; j++) for (let i = 0; i < ws; i++) { const a = j * (ws + 1) + i, b = a + ws + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new Geometry();
  g.setAttribute('position', new Attribute(new Float32Array(pos), 3)); g.setAttribute('normal', new Attribute(new Float32Array(nor), 3)); g.setAttribute('uv', new Attribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  return g;
}

async function landTexture(): Promise<Texture | null> {
  try {
    const bmp = await createImageBitmap(await (await fetch(url('data/landmask.png'))).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const W = 1440, H = 720, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, W, H);
    const img = ctx.getImageData(0, 0, W, H);
    for (let i = 0; i < W * H; i++) {
      const land = img.data[i * 4]! > 127, lat = 90 - ((Math.floor(i / W) + 0.5) * 180) / H;
      const ice = Math.abs(lat) > 66 && land;
      const [r, g, b] = ice ? [228, 232, 236] : land ? [92, 118, 74] : [14, 38, 70];
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = canvasTexture(c, true);
    t.wrap = 'clamp';
    return t;
  } catch { return null; }
}

export class GlobeView {
  readonly scene = new Scene();
  readonly camera = new Camera();
  private earth: Mesh;
  private observer = new Mesh(sphereGeometry(0.018, 12, 8), new Material({ color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 2, name: 'observer' }));
  private anti = new Mesh(sphereGeometry(0.018, 12, 8), new Material({ color: 0x4aa3ff, emissive: 0x4aa3ff, emissiveIntensity: 2, name: 'antipode' }));
  private sub = new Mesh(sphereGeometry(0.02, 12, 8), new Material({ color: 0xffd65a, emissive: 0xffd65a, emissiveIntensity: 3, name: 'subsolar' }));
  private nadir = new Mesh(cylinderGeometry(0.004, 0.004, 1, 6).translate(0, -0.5, 0), new Material({ color: 0xff8a7a, emissive: 0xff8a7a, emissiveIntensity: 1, name: 'nadir' }));
  private sun = new DirectionalLight(0xfff4e0, 3.2);
  orbit = 0;
  readonly facts: Record<string, unknown> = {};
  constructor() {
    this.earth = new Mesh(globeGeometry(1), new Material({ color: 0xffffff, roughness: 0.85, metalness: 0, name: 'earth (Natural Earth land mask)' }));
    this.earth.epistemic = 'source_derived';
    this.scene.add(this.earth, this.observer, this.anti, this.sub, this.nadir, this.sun, this.sun.target, new HemisphereLight(0x223044, 0x000000, 0.25));
    this.scene.background = new Color(0.003, 0.004, 0.008);
    this.camera.fov = 40; this.camera.near = 0.01; this.camera.far = 100;
    void landTexture().then((t) => { if (t) { this.earth.material.map = t; this.earth.material.color.setRGB(1, 1, 1); } });
  }
  update(lat: number, lon: number, utc: Date, aspect: number, yaw: number, pitch: number) {
    const o = globePoint(lat, lon, 1.0);
    this.observer.position.copy(o);
    const a = antipode(lat, lon);
    this.anti.position.copy(globePoint(a.lat, a.lon, 1.0));
    // nadir ray: from the observer through the centre (geocentric approximation of local down)
    this.nadir.position.copy(o);
    this.nadir.quaternion.setFromAxisAngle(new Vec3(0, 1, 0).cross(o.clone().normalize()).normalize(), Math.acos(Math.max(-1, Math.min(1, o.clone().normalize().y))));
    // subsolar point from the solar RA/Dec and Greenwich sidereal time
    const s = sunRaDec(utc);
    const subLon = ((((s.raDeg - gmstDeg(utc)) % 360) + 540) % 360) - 180;
    const sp = globePoint(s.decDeg, subLon, 1.0);
    this.sub.position.copy(sp);
    this.sun.position.copy(sp.clone().multiplyScalar(10));
    const m = moonRaDec(utc);
    Object.assign(this.facts, { observer: { lat, lon }, antipode: a, subsolar: { lat: +s.decDeg.toFixed(3), lon: +subLon.toFixed(3) }, moonDec: +m.decDeg.toFixed(2), daylight: o.clone().normalize().dot(sp.clone().normalize()) > 0 });
    // orbit camera above the observer, steerable by look input
    const up = o.clone().normalize();
    const q = new Quat().setFromAxisAngle(new Vec3(0, 1, 0), yaw * 0.6 + this.orbit);
    const dir = up.clone().applyQuaternion(q).add(new Vec3(0, Math.max(-0.6, Math.min(0.6, -pitch)), 0)).normalize();
    this.camera.position.copy(dir.multiplyScalar(3.4));
    this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
    this.camera.lookAt(new Vec3(0, 0, 0));
  }
}

const bvToLinear = (bv: number): [number, number, number] => {
  const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  return kelvinToLinear(Math.max(2000, Math.min(12000, T)));
};

export class SkyView {
  readonly scene = new Scene();
  readonly camera = new Camera();
  private stars: CatalogStar[];
  private bins: Mesh[] = [];
  private sunM = new Mesh(sphereGeometry(1.2, 16, 10), new Material({ feature: 'unlit', color: 0xfff1c8, name: 'sun marker' }));
  private moonM = new Mesh(sphereGeometry(0.9, 16, 10), new Material({ feature: 'unlit', color: 0xc8d2e6, name: 'moon marker' }));
  private lastKey = '';
  readonly facts: Record<string, unknown> = {};
  constructor(atlas: FontAtlas | null) {
    this.stars = hipparcosStars();
    this.scene.background = new Color(0.002, 0.003, 0.007);
    this.camera.fov = 70; this.camera.near = 0.1; this.camera.far = 400;
    for (const size of [4.5, 3, 1.8]) {
      const m = new Mesh(new Geometry(), new Material({ feature: 'stars', vertexColors: true, transparent: true, depthWrite: false, blending: 'additive', fog: false, pointSize: size, name: `stars ≤${size}` }));
      m.mode = 'points'; m.frustumCulled = false; m.epistemic = 'observed';
      this.bins.push(m); this.scene.add(m);
    }
    // horizon and altitude circles (lines)
    for (const alt of [0, 30, 60]) {
      const pts: number[] = [];
      for (let i = 0; i < 128; i++) { const a0 = (i / 128) * 360, a1 = ((i + 1) / 128) * 360; for (const az of [a0, a1]) { const e = enuFromAltAz(alt, az); pts.push(e[0] * 100, e[2] * 100, -e[1] * 100); } }
      const g = new Geometry(); g.setAttribute('position', new Attribute(new Float32Array(pts), 3));
      const l = new Mesh(g, new Material({ feature: 'unlit', color: alt === 0 ? 0x6b7a90 : 0x2c3442, fog: false, name: `alt ${alt}°` }));
      l.mode = 'lines'; l.frustumCulled = false; this.scene.add(l);
    }
    if (atlas) for (const [label, az] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) {
      const t = new Text(atlas, new Material({ feature: 'text', color: 0x9fb0c8, emissive: 0x9fb0c8, emissiveIntensity: 1, name: `cardinal ${label}` }));
      t.text = label; t.fontSize = 4; t.sync();
      const e = enuFromAltAz(2, az);
      t.position.set(e[0] * 90, e[2] * 90 + 2, -e[1] * 90);
      t.lookAt(new Vec3(t.position.x * 2, t.position.y, t.position.z * 2)); // text faces +Z: point −Z away from the observer
      this.scene.add(t);
    }
    this.scene.add(this.sunM, this.moonM);
  }
  update(lat: number, lon: number, utc: Date, aspect: number, yaw: number, pitch: number) {
    const key = `${lat.toFixed(3)}|${lon.toFixed(3)}|${Math.floor(utc.getTime() / 60000)}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      const bins: { p: number[]; c: number[] }[] = [{ p: [], c: [] }, { p: [], c: [] }, { p: [], c: [] }];
      let visible = 0;
      for (const s of this.stars) {
        const h = equatorialToHorizontal(s.raDeg, s.decDeg, lat, lon, utc);
        if (h.altDeg < -2) continue;
        visible++;
        const e = enuFromAltAz(h.altDeg, h.azDeg);
        const b = s.mag < 1.5 ? 0 : s.mag < 3.2 ? 1 : 2;
        const k = bvToLinear(s.bv), lum = Math.min(1.6, 10 ** (-0.4 * (s.mag - 1.5)) * 1.4 + 0.12);
        bins[b]!.p.push(e[0] * 100, e[2] * 100, -e[1] * 100);
        bins[b]!.c.push(k[0] * lum, k[1] * lum, k[2] * lum);
      }
      bins.forEach((bn, i) => {
        const g = new Geometry();
        g.setAttribute('position', new Attribute(new Float32Array(bn.p), 3));
        g.setAttribute('color', new Attribute(new Float32Array(bn.c), 3));
        this.bins[i]!.geometry = g;
      });
      const place = (m: Mesh, ra: number, dec: number) => { const h = equatorialToHorizontal(ra, dec, lat, lon, utc); const e = enuFromAltAz(h.altDeg, h.azDeg); m.position.set(e[0] * 95, e[2] * 95, -e[1] * 95); m.visible = h.altDeg > -1; return h; };
      const sh = place(this.sunM, sunRaDec(utc).raDeg, sunRaDec(utc).decDeg), mh = place(this.moonM, moonRaDec(utc).raDeg, moonRaDec(utc).decDeg);
      Object.assign(this.facts, { catalogue: CATALOG_SOURCE, starsAboveHorizon: visible, total: this.stars.length, sunAlt: +sh.altDeg.toFixed(2), moonAlt: +mh.altDeg.toFixed(2), gaiaDR3: 'BLOCKED (not ingested)' });
    }
    this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.setFromEuler(new Euler(Math.max(-0.2, Math.min(1.45, 0.35 - pitch)), yaw, 0, 'YXZ'));
  }
}

export class GlyphView {
  readonly scene = new Scene();
  readonly camera = new Camera();
  private items: Mesh[] = [];
  readonly facts: Record<string, unknown> = {};
  constructor(atlas: FontAtlas | null) {
    this.scene.background = new Color(0.01, 0.012, 0.018);
    const key = new DirectionalLight(0xffffff, 3); key.position.set(2, 4, 5);
    this.scene.add(key, key.target, new HemisphereLight(0x8898b0, 0x202020, 0.6));
    const templates = RING_SIZES.map((n) => cycle(null, n)); // unlabeled simple cycles C3…C8
    templates.forEach((t, i) => {
      const m = new Mesh(ringGlyphMesh(t.n, t.edges, 0.55, 0.05), new Material({ color: [0x7ec8e3, 0xa3d977, 0xffd166, 0xef8354, 0xc77dff, 0x80ffdb][i]!, roughness: 0.35, metalness: 0.2, name: `glyph ${t.id}` }));
      m.position.set((i - 2.5) * 1.45, 0.3, 0); m.epistemic = 'abstract';
      this.items.push(m); this.scene.add(m);
      if (atlas) { const l = new Text(atlas, new Material({ feature: 'text', color: 0xcfd6e4, emissive: 0xcfd6e4, emissiveIntensity: 0.8 })); l.text = `C${t.n} cycle\nabstract`; l.fontSize = 0.14; l.sync(); l.position.set((i - 2.5) * 1.45, -0.6, 0); this.scene.add(l); }
    });
    if (atlas) { const h = new Text(atlas, new Material({ feature: 'text', color: 0xffe6b0, emissive: 0xffe6b0, emissiveIntensity: 1 })); h.text = 'Ring glyph templates — abstract grammar · 0 certified chemicals'; h.fontSize = 0.2; h.maxWidth = 8; h.sync(); h.position.set(0, 1.4, 0); this.scene.add(h); }
    const cat = ochemCatalog();
    Object.assign(this.facts, { templates: pchemTemplates().length, shown: templates.length, ochemEntries: cat.entries, ochemCells: cat.cells, chemicalAdmission: false });
    this.camera.fov = 40; this.camera.near = 0.1; this.camera.far = 100;
    this.camera.position.set(0, 0.4, 7.6);
    this.camera.lookAt(new Vec3(0, 0.2, 0));
  }
  update(dt: number, aspect: number) {
    for (const [i, m] of this.items.entries()) { m.rotation.y += dt * (0.25 + i * 0.05); m.rotation.x = 0.35 * Math.sin(performance.now() / 1600 + i); }
    this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
  }
}

/** GPU pixel-field diagnostic: impulses come from projected committed events (footsteps, rain, car). */
export class PixelLens {
  wave: GpuWaveField | null = null;
  readonly facts: Record<string, unknown> = {};
  lastEvent: string | null = null;
  constructor(private r: Renderer) {}
  ensure() {
    if (this.wave) return this.wave;
    const b = chooseFieldGrid(this.r.drawingBufferWidth, this.r.drawingBufferHeight, 'tiles', 8 * 1024 * 1024, 16, 2);
    try { this.wave = new GpuWaveField(this.r.gl, b.nx, b.ny, { c: 1, damping: 0.6, dt: 0.02, dx: 0.05 }); }
    catch (e) { this.facts.blocked = (e as Error).message; return null; }
    Object.assign(this.facts, { grid: [b.nx, b.ny], bytes: b.bytes, model: 'damped-wave-2d/leapfrog', epistemic: 'simulation', digests: this.wave.digests });
    return this.wave;
  }
  /** Inject at a normalised screen point (0..1, y up) — a display sample mapped to a solver cell. */
  impulse(sx: number, sy: number, amp: number, eventId: string | null) {
    const w = this.ensure(); if (!w) return;
    if (sx < 0 || sx > 1 || sy < 0 || sy > 1) return;
    w.impulse(Math.floor(sx * w.nx), Math.floor(sy * w.ny), amp, 2);
    if (eventId) this.lastEvent = eventId;
  }
  step(on: boolean) {
    if (!on) { this.r.field = null; return; }
    const w = this.ensure(); if (!w) return;
    w.step(2);
    this.r.field = { texture: w.texture, gain: 5 };
  }
  witness() { const w = this.wave; if (!w) return null; return w.witness(Math.floor(w.nx / 2), Math.floor(w.ny / 2), this.lastEvent); }
  dispose() { this.wave?.dispose(); this.wave = null; this.r.field = null; }
}

export type { LensId };
export const LENS_LABEL: Record<LensId, string> = { player: 'Player', stereo: 'Stereo (side-by-side)', anaglyph: 'Stereo fusion (anaglyph)', globe: 'Globe', sky: 'Sky sphere', pixel: 'Pixel field', glyph: 'Glyphs' };
export { Group };
