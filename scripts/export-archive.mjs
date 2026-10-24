#!/usr/bin/env node
// ייצוא מלא של ארכיון ״סבא דודו״ למחשב: קובץ נתונים (manifest.json) + כל קובצי המקור.
// שימוש:
//   npm run export-archive -- --url https://saba-dudu.example.workers.dev --email admin@example.com [--out export]
// הסיסמה נשאלת בהרצה (או דרך משתנה הסביבה SABA_PASSWORD). נדרש חשבון מנהל.
// אפשר להריץ שוב — קבצים שכבר ירדו בגודל הנכון לא יורדו פעם נוספת.
import { createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const base = (arg('url') || process.env.SABA_URL || '').replace(/\/$/, '');
const email = arg('email') || process.env.SABA_EMAIL;
const outDir = path.resolve(arg('out', 'export'));
if (!base || !email) {
  console.error('שימוש: npm run export-archive -- --url https://YOUR-SITE --email you@example.com [--out export]');
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl._writeToOutput = (s) => (s.includes(question) ? process.stdout.write(s) : undefined);
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const password = process.env.SABA_PASSWORD || (await askHidden('סיסמה: '));

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) {
  console.error('ההתחברות נכשלה:', (await login.json().catch(() => ({}))).error ?? login.status);
  process.exit(1);
}
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const headers = { cookie };

const res = await fetch(`${base}/api/admin/export`, { headers });
if (!res.ok) {
  console.error('הורדת הנתונים נכשלה (נדרש חשבון מנהל):', res.status);
  process.exit(1);
}
const manifest = await res.json();
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const items = new Map(manifest.items.map((i) => [i.id, i]));
const safe = (s) => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);
const originals = manifest.files.filter((f) => f.role === 'original');
let done = 0;
let skipped = 0;
let failed = 0;

for (const f of originals) {
  const item = f.item_id ? items.get(f.item_id) : null;
  const folder = item ? `${item.kind}${item.deleted_at ? '-deleted' : ''}` : 'unattached';
  const dir = path.join(outDir, 'files', folder);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${f.id.slice(0, 8)}-${safe(f.original_name)}`);
  if (existsSync(target) && statSync(target).size === f.size) {
    skipped++;
    continue;
  }
  try {
    const r = await fetch(`${base}/api/files/${f.id}?download=1`, { headers });
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    const tmp = `${target}.part`;
    await pipeline(Readable.fromWeb(r.body), createWriteStream(tmp));
    if (statSync(tmp).size !== f.size) throw new Error('גודל הקובץ אינו תואם');
    await rename(tmp, target);
    done++;
    process.stdout.write(`\r${done + skipped}/${originals.length} קבצים`);
  } catch (e) {
    failed++;
    console.error(`\nשגיאה בקובץ ${f.original_name}: ${e.message}`);
  }
}

console.log(`\n✓ הייצוא הסתיים: ${done} הורדו, ${skipped} כבר היו קיימים, ${failed} נכשלו → ${outDir}`);
await fetch(`${base}/api/auth/logout`, { method: 'POST', headers }).catch(() => undefined);
process.exit(failed ? 2 : 0);
