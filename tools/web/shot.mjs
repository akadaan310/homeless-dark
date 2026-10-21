// Ad-hoc capture: node tools/web/shot.mjs <url> <out.png> [waitMs] [actions-json]
import { chromium } from '@playwright/test';
const [url, out, wait = '8000', actions = '[]'] = process.argv.slice(2);
const browser = await chromium.launch({ args: (process.env.CHROME_ARGS ?? '--use-angle=swiftshader --enable-unsafe-swiftshader').split(' ') });
const page = await browser.newPage({ viewport: { width: Number(process.env.VW ?? 1280), height: Number(process.env.VH ?? 720) }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.__dark?.hud?.ready || window.__dark?.hud?.error, null, { timeout: 120000 }).catch(() => logs.push('timeout waiting ready'));
await page.click('[data-testid=enter]').catch((e) => logs.push('no enter ' + e.message));
for (const a of JSON.parse(actions)) {
  if (a.key) { await page.keyboard.down(a.key); await page.waitForTimeout(a.ms ?? 500); await page.keyboard.up(a.key); }
  if (a.eval) await page.evaluate(a.eval);
  if (a.wait) await page.waitForTimeout(a.wait);
}
await page.waitForTimeout(Number(wait));
const hud0 = await page.evaluate(() => { window.__dark.freeze(); return true; });
await page.waitForTimeout(300);
await page.screenshot({ path: out, timeout: 120000 });
await page.evaluate(() => window.__dark.thaw());
const hud = await page.evaluate(() => { const h = window.__dark?.hud; return h && { fps: h.fps, p95: h.p95, draws: h.drawCalls, tris: h.triangles, err: h.error, region: h.region, time: h.localTime, extra: h.extra, trace: h.trace.slice(0, 6) }; });
console.log(JSON.stringify(hud, null, 1));
console.log(logs.filter((l) => !l.includes('[vite]')).slice(0, 40).join('\n'));
await browser.close();
