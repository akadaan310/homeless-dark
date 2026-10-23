// BILLBOARDSTRATUM runtime: signs are world entities with SDF glyphs (troika-three-text)
// on real 3D panels, depth-tested and occluded like any geometry. A sign's content,
// layout, brightness and reflection cue change only through admitted programs.
import * as THREE from 'three';
import { Text } from 'troika-three-text';
import { layoutSign, flashSafe, oklchToSrgbGamut, type SignEntity, type SignClass } from '@dark/visual-grammar';
import { url } from './assets';

export interface SignView {
  entity: SignEntity;
  group: THREE.Group;
  panel: THREE.Mesh;
  text: Text;
  light: THREE.PointLight | null;
  base: { hue: number; brightness: number };
  pulse: number;
}

// Bundled Inter (SIL OFL 1.1) so signs render offline and in the APK; troika's default font would fetch from a CDN.
const FONT = url('assets/fonts/inter-latin-700-normal.woff');

export class SignSystem {
  readonly signs = new Map<string, SignView>();
  reducedMotion = false;
  onFrame: ((s: SignView) => void) | null = null;

  create(entity: SignEntity, opts: { lit?: boolean; panelColor?: THREE.ColorRepresentation; textColor?: THREE.ColorRepresentation; depth?: number } = {}): SignView {
    const g = new THREE.Group();
    g.name = `sign:${entity.entityId}`;
    const { width, height } = entity.bounds;
    const panelMat = new THREE.MeshStandardMaterial({ color: opts.panelColor ?? 0x15181d, roughness: 0.35, metalness: 0.3, emissive: new THREE.Color(0, 0, 0) });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(width, height, opts.depth ?? 0.12), panelMat);
    panel.castShadow = true; panel.receiveShadow = true;
    g.add(panel);
    const text = new Text();
    text.font = FONT;
    text.anchorX = 'center'; text.anchorY = 'middle'; text.textAlign = 'center';
    text.position.z = (opts.depth ?? 0.12) / 2 + 0.005;
    text.color = (opts.textColor as number | string | undefined) ?? 0xffffff;
    (text as unknown as { material: THREE.Material }).material = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.4, toneMapped: true });
    g.add(text);
    let light: THREE.PointLight | null = null;
    if (opts.lit) {
      // A glowing mesh does not light its surroundings in a raster pipeline: pair it with a bounded real light.
      light = new THREE.PointLight(0xffffff, 0, Math.max(6, width * 3), 2);
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
    const c = new THREE.Color().setRGB(col[0], col[1], col[2], THREE.LinearSRGBColorSpace);
    const mat = (v.text as unknown as { material: THREE.MeshStandardMaterial }).material;
    mat.color.copy(c);
    mat.emissive.copy(c);
    if (v.light) v.light.color.copy(c);
  }

  /** Per-frame: night factor scales emission; pulses are flash-safe and disabled in reduced motion. */
  update(t: number, night: number, wet: number, hour: number): void {
    for (const v of this.signs.values()) {
      const e = v.entity;
      const on = !e.schedule || (e.schedule.onHour <= e.schedule.offHour ? hour >= e.schedule.onHour && hour < e.schedule.offHour : hour >= e.schedule.onHour || hour < e.schedule.offHour);
      const safe = flashSafe(e.pulseHz, this.reducedMotion);
      const pulse = safe.effectiveHz > 0 ? 0.82 + 0.18 * Math.sin(t * Math.PI * 2 * safe.effectiveHz) : 1;
      const b = on ? e.emission.brightness * pulse : 0.02;
      const mat = (v.text as unknown as { material: THREE.MeshStandardMaterial }).material;
      mat.emissiveIntensity = (0.35 + 2.6 * night) * b + 0.15;
      (v.panel.material as THREE.MeshStandardMaterial).roughness = 0.35 * (1 - 0.6 * wet);
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
