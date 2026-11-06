// Renders public/og.png (the 1200×630 link-preview image) from og.html, using the site's own
// fonts and colours from src/styles/base.css. Run after changing og.html:
//   npx -y playwright@1.63.0 install chromium   (first time only)
//   node scripts/og/render.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const html = readFileSync(here('./og.html'), 'utf8').replace('<style id="base"></style>', `<style>${readFileSync(here('../../src/styles/base.css'), 'utf8')}</style>`);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: here('../../public/og.png') });
await browser.close();
console.log('wrote public/og.png');
