// יוצר את מרקם ה״נייר״ כתמונה קבועה (במקום פילטר SVG שמחושב בכל ציור — כבד מאוד בטלפונים).
// הרצה: node scripts/generate-textures.mjs
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SIZE = 220;
const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${SIZE}' height='${SIZE}'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .36 0 0 0 0 .26 0 0 0 0 .16 0 0 0 .07 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const dataUrl = await page.evaluate(async ({ svg, size }) => {
  const img = new Image();
  img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toDataURL('image/webp', 0.82);
}, { svg, size: SIZE });
writeFileSync(`${root}src/assets/paper.webp`, Buffer.from(dataUrl.split(',')[1], 'base64'));
console.log('✓ paper.webp');
await browser.close();
