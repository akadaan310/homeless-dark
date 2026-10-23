// BILLBOARDSTRATUM runtime: signs are world entities with SDF glyphs (ASTRO text) on real
// 3D panels, depth-tested and occluded like any geometry. A sign's content, layout,
// brightness and reflection cue change only through admitted programs.
import { Group, Mesh, Material, PointLight, Color, boxGeometry, type ColorLike } from '@astro/core';
import { FontAtlas, Text } from '@astro/render-webgl2';
import { layoutSign, flashSafe, oklchToSrgbGamut, type SignEntity, type SignClass } from '@dark/visual-grammar';
import { url } from './assets';

export interface SignView {
  entity: SignEntity;
  group: Group;
  panel: Mesh;
  text: Text;
  light: PointLight | null;
  base: { hue: number; brightness: number };
  pulse: number;
}

// Bundled Inter (SIL OFL 1.1): signs render offline and in the APK; no font is fetched from a CDN.
const FONT = url('assets/fonts/inter-latin-700-normal.woff');

export class SignSystem {
  readonly signs = new Map<string, SignView>();
  reducedMotion = false;
  onFrame: ((s: SignView) => void) | null = null;
  atlas: FontAtlas | null = null;

  /** Load the glyph atlas once (FontFace API); falls back to system sans and records it. */
  async init(): Promise<void> { this.atlas ??= await FontAtlas.load(FONT, 'HomelessInter', 700); }

  create(entity: SignEntity, opts: { lit?: boolean; panelColor?: ColorLike; textColor?: ColorLike; depth?: number } = {}): SignView {
    if (!this.atlas) throw new Error('SignSystem.init() must run before signs are created');
    const g = new Group();
    g.name = `sign:${entity.entityId}`;
    const { width, height } = entity.bounds;
    const panel = new Mesh(boxGeometry(width, height, opts.depth ?? 0.12), new Material({ color: opts.panelColor ?? 0x15181d, roughness: 0.35, metalness: 0.3, name: 'sign-panel' }));
    panel.castShadow = true; panel.receiveShadow = true;
    g.add(panel);
    const text = new Text(this.atlas, new Material({ feature: 'text', color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.4, name: 'sign-text' }));
    text.position.z = (opts.depth ?? 0.12) / 2 + 0.005;
    g.add(text);
    let light: PointLight | null = null;
    if (opts.lit) {
      // A glowing mesh does not light its surroundings in a raster pipeline: pair it with a bounded real light.
      light = new PointLight(0xffffff, 0, Math.max(6, width * 3), 2);
      light.position.set(0, -height * 0.2, 1.2);
      g.add(light);
    }
    const view: SignView = { entity, group: g, panel, text, light, base: { hue: entity.emission.hue, brightness: entity.emission.brightness }, pulse: 0 };
    this.signs.set(entity.entityId, view);
    this.apply(view);
    return view;
  }

  /** Re-layout and re-colour from the entity's current state. */
  apply(v: SignView): void {
    const e = v.entity;
    const lay = layoutSign(e.text, e.bounds, e.script);
    v.text.text = lay.lines.join('\n');
    v.text.fontSize = Math.max(0.05, lay.fontSize);
    v.text.maxWidth = e.bounds.width * 0.92;
    v.text.sync();
    const col = oklchToSrgbGamut({ l: e.emission.lightness, c: e.emission.chroma, h: e.emission.hue }).linear;
    const c = new Color().setRGB(col[0], col[1], col[2]);
    v.text.material.color = c.clone();
    v.text.material.emissive = c.clone();
    if (v.light) v.light.color = c.clone();
  }

  /** Per-frame: night factor scales emission; pulses are flash-safe and disabled in reduced motion. */
  update(t: number, night: number, wet: number, hour: number): void {
    for (const v of this.signs.values()) {
      const e = v.entity;
      const on = !e.schedule || (e.schedule.onHour <= e.schedule.offHour ? hour >= e.schedule.onHour && hour < e.schedule.offHour : hour >= e.schedule.onHour || hour < e.schedule.offHour);
      const safe = flashSafe(e.pulseHz, this.reducedMotion);
      const pulse = safe.effectiveHz > 0 ? 0.82 + 0.18 * Math.sin(t * Math.PI * 2 * safe.effectiveHz) : 1;
      const b = on ? e.emission.brightness * pulse : 0.02;
      v.text.material.emissiveIntensity = (0.35 + 2.6 * night) * b + 0.15;
      v.panel.material.roughness = 0.35 * (1 - 0.6 * wet);
      if (v.light) v.light.intensity = on ? night * b * 4.5 * (e.bounds.width / 2) : 0;
      this.onFrame?.(v);
    }
  }

  setText(id: string, text: string) { const v = this.signs.get(id); if (v) { v.entity.text = text; v.entity.revision++; this.apply(v); } }
}

export function signEntity(id: string, cls: SignClass, text: string, w: number, h: number, extra: Partial<SignEntity> = {}): SignEntity {
  return {
    entityId: id, class: cls, text, language: 'en', script: 'Latn', fontLicense: 'Inter (SIL OFL 1.1), bundled', owner: 'homeless:authored',
    fictional: true, bounds: { width: w, height: h }, preferredReadDistance: 20, emission: { hue: 60, chroma: 0.08, lightness: 0.92, brightness: 0.8 },
    pulseHz: 0, revision: 1, ...extra,
  };
}
