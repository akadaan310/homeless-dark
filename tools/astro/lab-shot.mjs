// Capture the ASTRO renderer lab: node tools/astro/lab-shot.mjs <url> <out.png> [settleMs]
// Prints renderer info, caps, GLB stats, GPU-vs-CPU wave check and WebGPU probe as JSON.
import { chromium } from '@playwright/test';
const [url, out, settle = '1500'] = process.argv.slice(2);
const browser = await chromium.launch({ args: (process.env.CHROME_ARGS ?? '--use-angle=swiftshader --enable-unsafe-swiftshader').split(' ') });
const page = await browser.newPage({ viewport: { width: Number(process.env.VW ?? 1280), height: Number(process.env.VH ?? 720) }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error, null, { timeout: 180000 }).catch(() => logs.push('timeout'));
await page.waitForTimeout(Number(settle));
const result = await page.evaluate(async () => {
  const L = window.__astroLab;
  if (!L) return { error: document.body.dataset.error ?? 'no lab' };
  L.freeze();
  const wave = await L.gpuWaveCheck().catch((e) => ({ error: String(e) }));
  const webgpu = await L.probeWebGPU();
  L.freeze();
  const ft = L.frameTimes().sort((a, b) => a - b);
  const q = (p) => ft[Math.min(ft.length - 1, Math.floor(ft.length * p))];
  return { info: L.info(), caps: L.caps, glb: L.glb, clips: L.clips, loadMs: Math.round(L.loadMs), atlasFallback: L.atlasFallback, wave, webgpu, graph: L.graph(), frames: { n: ft.length, p50: q(0.5), p95: q(0.95), p99: q(0.99) }, programs: Object.keys(L.shaderDigests()).length };
});
await page.screenshot({ path: out, timeout: 120000 });
console.log(JSON.stringify(result, null, 1));
console.log(logs.filter((l) => !l.includes('[vite]')).slice(0, 30).join('\n'));
await browser.close();
