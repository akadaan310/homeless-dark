// node tools/astro/matlab-shot.mjs <url> <out.png> — material lab witness (Gate A)
import { chromium } from '@playwright/test';
const [url, out] = process.argv.slice(2);
const browser = await chromium.launch({ args: (process.env.CHROME_ARGS ?? '--use-angle=swiftshader --enable-unsafe-swiftshader').split(' ') });
const page = await browser.newPage({ viewport: { width: Number(process.env.VW ?? 1280), height: Number(process.env.VH ?? 720) } });
const logs = []; page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`)); page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 300000 }).catch(() => logs.push('timeout'));
const r = await page.evaluate(() => window.__matLab);
await page.screenshot({ path: out });
console.log(JSON.stringify(r, null, 1));
console.log(logs.filter((l) => /error|warn/i.test(l) && !/WebGPU|vite/.test(l)).slice(0, 10).join('\n'));
await browser.close();
