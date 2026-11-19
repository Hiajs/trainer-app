// Renders build/icon.svg to PNGs with Chromium and packs them into build/icon.icns.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const svg = fs.readFileSync('build/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
// icns OSType -> pixel size (PNG payloads, supported since macOS 10.7)
const types = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
const pngs = {};
for (const size of [...new Set(types.map((t) => t[1]))]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body></html>`);
  pngs[size] = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
fs.writeFileSync('build/icon.png', pngs[1024]);
const chunks = types.map(([type, size]) => {
  const head = Buffer.alloc(8);
  head.write(type, 0, 'ascii');
  head.writeUInt32BE(pngs[size].length + 8, 4);
  return Buffer.concat([head, pngs[size]]);
});
const body = Buffer.concat(chunks);
const header = Buffer.alloc(8);
header.write('icns', 0, 'ascii');
header.writeUInt32BE(body.length + 8, 4);
fs.writeFileSync('build/icon.icns', Buffer.concat([header, body]));
console.log('wrote build/icon.icns', body.length + 8, 'bytes');
