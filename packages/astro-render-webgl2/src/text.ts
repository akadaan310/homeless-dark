// ASTRO SDF text (§050): glyphs rasterised from a bundled font with the browser's 2-D canvas,
// converted to signed distance fields (sdf.ts), packed into one R8 atlas and drawn as
// depth-tested quads in world space. Text is a Mesh: it is lit, fogged and occluded
// like any other geometry. No third-party text engine.
import { Mesh, Geometry, Attribute, Material, Texture, Color, type ColorLike } from '@astro/core';
import { alphaToSdf } from './sdf';

const PX = 48, PAD = 8, SIZE = 1024;

export interface Glyph { x: number; y: number; w: number; h: number; advance: number; left: number; top: number }

export class FontAtlas {
  readonly texture: Texture;
  readonly glyphs = new Map<string, Glyph>();
  readonly data = new Uint8Array(SIZE * SIZE);
  ascent = PX * 0.75; descent = PX * 0.22;
  private penX = 1; private penY = 1; private rowH = 0;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  readonly font: string;
  constructor(readonly family: string, readonly weight = 700, readonly fallback = false) {
    this.font = `${weight} ${PX}px "${family}", system-ui, sans-serif`;
    this.texture = new Texture({ kind: 'data', data: this.data, width: SIZE, height: SIZE, channels: 1 }, 'linear', `sdf:${family}`);
    this.texture.wrap = 'clamp';
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(PX * 3, PX * 2) : Object.assign(document.createElement('canvas'), { width: PX * 3, height: PX * 2 });
    this.ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    this.ctx.font = this.font;
    const m = this.ctx.measureText('Hgy');
    if (m.fontBoundingBoxAscent) { this.ascent = m.fontBoundingBoxAscent; this.descent = m.fontBoundingBoxDescent; }
  }
  /** Load a font file with the FontFace API; a failed load falls back to system sans (recorded). */
  static async load(url: string, family = 'AstroInter', weight = 700): Promise<FontAtlas> {
    try {
      const ff = new FontFace(family, `url(${url})`, { weight: String(weight) });
      await ff.load();
      (document.fonts as unknown as { add(f: FontFace): void }).add(ff);
      return new FontAtlas(family, weight, false);
    } catch { return new FontAtlas('sans-serif', weight, true); }
  }
  ensure(text: string): boolean {
    let added = false;
    for (const ch of new Set([...text])) { if (ch === '\n' || this.glyphs.has(ch)) continue; this.add(ch); added = true; }
    if (added) this.texture.version++;
    return added;
  }
  private add(ch: string) {
    const ctx = this.ctx;
    const m = ctx.measureText(ch);
    const left = Math.ceil(m.actualBoundingBoxLeft || 0), right = Math.ceil(m.actualBoundingBoxRight || m.width);
    const asc = Math.ceil(m.actualBoundingBoxAscent || this.ascent), desc = Math.ceil(m.actualBoundingBoxDescent || 0);
    const w = Math.max(1, left + right) + PAD * 2, h = Math.max(1, asc + desc) + PAD * 2;
    if (ch.trim() === '') { this.glyphs.set(ch, { x: 0, y: 0, w: 0, h: 0, advance: m.width, left: 0, top: 0 }); return; }
    if (ctx.canvas.width < w || ctx.canvas.height < h) { ctx.canvas.width = Math.max(ctx.canvas.width, w); ctx.canvas.height = Math.max(ctx.canvas.height, h); ctx.font = this.font; }
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(ch, PAD + left, PAD + asc);
    const img = ctx.getImageData(0, 0, w, h).data;
    const a = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) a[i] = img[i * 4 + 3]!;
    const sdf = alphaToSdf(a, w, h, PAD);
    if (this.penX + w + 1 > SIZE) { this.penX = 1; this.penY += this.rowH + 1; this.rowH = 0; }
    if (this.penY + h + 1 > SIZE) throw new Error('ASTRO font atlas full (1024²)');
    for (let y = 0; y < h; y++) this.data.set(sdf.subarray(y * w, y * w + w), (this.penY + y) * SIZE + this.penX);
    this.glyphs.set(ch, { x: this.penX, y: this.penY, w, h, advance: m.width, left: left + PAD, top: asc + PAD });
    this.penX += w + 1; this.rowH = Math.max(this.rowH, h);
  }
  measure(line: string) { let w = 0; for (const ch of line) w += this.glyphs.get(ch)?.advance ?? PX * 0.5; return w; }
}

/** World-space text block: centred lines, font size in metres. */
export class Text extends Mesh {
  text = '';
  fontSize = 0.2;
  lineHeight = 1.2;
  maxWidth = Infinity;
  anchorX: 'center' | 'left' = 'center';
  private built = '';
  constructor(readonly atlas: FontAtlas, material?: Material) {
    super(new Geometry(), material ?? new Material({ feature: 'text', color: 0xffffff, transparent: true, depthWrite: false }));
    this.material.feature = 'text';
    this.material.map = atlas.texture;
    this.material.transparent = true;
    this.frustumCulled = false;
  }
  set color(c: ColorLike) { this.material.color = c instanceof Color ? c : new Color().setHex(typeof c === 'number' ? c : 0xffffff); }
  sync() {
    const key = `${this.text}|${this.fontSize}|${this.lineHeight}|${this.maxWidth}|${this.anchorX}`;
    if (key === this.built) return;
    this.built = key;
    const A = this.atlas;
    A.ensure(this.text);
    const s = this.fontSize / PX;
    const lines = this.text.split('\n');
    const lh = this.lineHeight * this.fontSize;
    const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
    const capMid = ((A.ascent - A.descent) / 2) * s;
    lines.forEach((line, li) => {
      let width = A.measure(line) * s;
      const fit = Number.isFinite(this.maxWidth) && width > this.maxWidth ? this.maxWidth / width : 1; // never overflow the sign
      width *= fit;
      let pen = this.anchorX === 'center' ? -width / 2 : 0;
      const baseline = ((lines.length - 1) / 2 - li) * lh - capMid;
      for (const ch of line) {
        const g = A.glyphs.get(ch);
        if (!g) continue;
        if (g.w > 0) {
          const x0 = pen - g.left * s * fit, x1 = x0 + g.w * s * fit, y1 = baseline + g.top * s * fit, y0 = y1 - g.h * s * fit;
          const b = pos.length / 3;
          pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0);
          nor.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
          const u0 = g.x / SIZE, u1 = (g.x + g.w) / SIZE, vTop = g.y / SIZE, vBot = (g.y + g.h) / SIZE;
          uv.push(u0, vBot, u1, vBot, u1, vTop, u0, vTop);
          idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
        pen += g.advance * s * fit;
      }
    });
    const geo = new Geometry();
    geo.setAttribute('position', new Attribute(new Float32Array(pos), 3));
    geo.setAttribute('normal', new Attribute(new Float32Array(nor), 3));
    geo.setAttribute('uv', new Attribute(new Float32Array(uv), 2));
    geo.setIndex(idx.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx));
    this.geometry = geo;
  }
}
