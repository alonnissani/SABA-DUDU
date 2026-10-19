import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const FIXTURES = path.resolve('test-results/fixtures');

/** יוצר קבצי בדיקה סינתטיים (דוגמאות צבע וצליל — לא תוכן משפחתי) */
export default function globalSetup() {
  mkdirSync(FIXTURES, { recursive: true });
  const ff = (args: string[]) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args]);
  const out = (f: string) => path.join(FIXTURES, f);
  if (!existsSync(out('IMG_8813.jpg'))) {
    ff(['-f', 'lavfi', '-i', 'gradients=s=1200x900:c0=0xd9bd84:c1=0x5e4330:x0=0:y0=0:x1=1200:y1=900', '-frames:v', '1', out('photo-a.jpg')]);
    ff(['-f', 'lavfi', '-i', 'gradients=s=900x1200:c0=0xf3e6cd:c1=0x8b6a4c:x0=0:y0=1200:x1=900:y1=0', '-frames:v', '1', out('photo-b.jpg')]);
    ff(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-ac', '1', out('tone.wav')]);
    ff(['-f', 'lavfi', '-i', 'gradients=s=1000x700:c0=0xe3cf9f:c1=0x6a5644', '-frames:v', '1', out('IMG_8813.jpg')]);
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:v', 'libvpx-vp9', '-b:v', '300k', '-c:a', 'libopus', '-shortest', out('clip.webm')]);
    writeFileSync(
      out('letter.pdf'),
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<<>>>>endobj\n4 0 obj<</Length 44>>stream\n0.6 0.5 0.3 rg 20 20 260 160 re f\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    );
  }
}
