// Keeps the ?v= cache-busting query on CSS/JS in public/index.html equal to a
// hash of each file's contents. The zone serves static files with a long
// browser max-age, so without a new URL returning visitors would keep running
// an old app.js against new HTML.
//
//   node scripts/asset-version.js          check (exits 1 if out of date)
//   node scripts/asset-version.js --write  update index.html

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const ASSETS = ['/css/style.css', '/js/app.js'];

const hash = (path) =>
  createHash('sha256')
    // Normalize line endings so Windows and CI checkouts hash the same.
    .update(readFileSync(root + path.slice(1), 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex')
    .slice(0, 10);

const htmlPath = root + 'index.html';
const html = readFileSync(htmlPath, 'utf8');
let updated = html;
const stale = [];

for (const asset of ASSETS) {
  const pattern = new RegExp(`${asset.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(\\?v=[0-9a-f]*)?"`, 'g');
  const want = `${asset}?v=${hash(asset)}"`;
  const found = html.match(pattern);
  if (!found) {
    console.error(`index.html does not reference ${asset}`);
    process.exit(1);
  }
  if (found.some((m) => m !== want)) stale.push(asset);
  updated = updated.replace(pattern, want);
}

if (process.argv.includes('--write')) {
  if (updated !== html) writeFileSync(htmlPath, updated);
  console.log(stale.length ? `Updated: ${stale.join(', ')}` : 'Asset versions already current');
} else if (stale.length) {
  console.error(`Stale asset versions in index.html: ${stale.join(', ')}\nRun: npm run version-assets`);
  process.exit(1);
} else {
  console.log('Asset versions current');
}
