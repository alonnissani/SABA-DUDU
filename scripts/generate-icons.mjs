// יוצר את אייקוני ה-PNG של ה-PWA מתוך public/icons/icon.svg בעזרת Chromium (Playwright).
// הרצה: node scripts/generate-icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const svg = readFileSync(`${root}public/icons/icon.svg`, 'utf8');
const font = readFileSync(`${root}node_modules/@fontsource/frank-ruhl-libre/files/frank-ruhl-libre-hebrew-700-normal.woff2`).toString('base64');

const targets = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  { file: 'apple-touch-icon.png', size: 180, pad: 0, square: true },
  // maskable: אזור בטוח של 80% — מקטינים את הסמל ומשאירים רקע מלא
  { file: 'icon-maskable-512.png', size: 512, pad: 0.12, square: true },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const t of targets) {
  let icon = t.square ? svg.replace('rx="112"', 'rx="0"') : svg;
  if (t.pad) {
    // מקטינים רק את הסמל — הרקע ממשיך עד הקצה
    const s = 1 - t.pad * 2;
    icon = icon.replace(/(<circle[\s\S]*<\/text>)/, `<g transform="translate(256 256) scale(${s}) translate(-256 -256)">$1</g>`);
  }
  const inner = t.size;
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: 'Frank Ruhl Libre'; font-weight: 700; src: url(data:font/woff2;base64,${font}) format('woff2'); }
    html,body { margin:0; width:${t.size}px; height:${t.size}px; background:${t.square ? '#f3e6cd' : 'transparent'}; display:grid; place-items:center; }
    svg { width:${inner}px; height:${inner}px; display:block; }
  </style></head><body>${icon}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(`${root}public/icons/${t.file}`, await page.screenshot({ omitBackground: !t.square }));
  console.log('✓', t.file);
}
await browser.close();
