// Renders public/icons/icon.svg to the PNG app icons referenced by
// manifest.webmanifest and index.html. Run after changing the SVG:
//
//   node scripts/build-icons.js     (needs Playwright + Chromium installed)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// require() also finds a globally installed Playwright; ESM import does not.
const { chromium } = createRequire(import.meta.url)('playwright');

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url));
const svg = readFileSync(dir + 'icon.svg', 'utf8');
const SIZES = { 'icon-192.png': 192, 'icon-512.png': 512, 'apple-touch-icon.png': 180 };

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size] of Object.entries(SIZES)) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: dir + file, omitBackground: false });
  console.log(`Wrote icons/${file}`);
}
await browser.close();
