import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { inviteMember, setupAdmin } from './helpers';
import { scheduledDriveSync } from '../../worker/lib/drive';

// ---------- Google Drive מדומה ----------
const FOLDER = '1FamilyFolderAbcdefghijklmnop';
const SUB = '1SubFolderAbcdefghijklmnopqrs';
const fid = (n: number) => `1PhotoFile${String(n).padStart(4, '0')}abcdefghijklm`;
const folderUrl = `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`;

interface MockFile { id: string; mimeType: string; parent: string; width?: number; height?: number; rotation?: number; time?: string }
let files: MockFile[] = [];
let failListing: number | null = null;
let apiCalls = 0;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 0xff, 0xd9]);
const realFetch = globalThis.fetch;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockDrive(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === 'img.test') {
    const id = /\/d\/([^=]+)=s(\d+)/.exec(url.pathname)?.[1];
    return Promise.resolve(files.some((f) => f.id === id) ? new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }) : new Response('nope', { status: 404 }));
  }
  if (url.hostname !== 'drive.test') return realFetch(input, init);
  apiCalls++;
  if (url.searchParams.get('key') !== 'test-drive-key') return Promise.resolve(json({ error: { message: 'API key not valid' } }, 400));
  const m = /\/drive\/v3\/files(?:\/([^/]+))?$/.exec(url.pathname);
  if (m?.[1]) {
    if (m[1] === FOLDER) return Promise.resolve(json({ id: FOLDER, name: 'תמונות המשפחה', mimeType: 'application/vnd.google-apps.folder' }));
    const f = files.find((x) => x.id === m[1]);
    return Promise.resolve(f ? json({ id: f.id, name: 'x', mimeType: f.mimeType }) : json({ error: { message: 'File not found' } }, 404));
  }
  if (failListing) return Promise.resolve(json({ error: { message: 'rateLimitExceeded' } }, failListing));
  const parent = /'([^']+)' in parents/.exec(url.searchParams.get('q') ?? '')?.[1];
  const children = files.filter((f) => f.parent === parent);
  // עמודים של 2 — כדי לבדוק גם המשך לעמוד הבא
  const start = Number(url.searchParams.get('pageToken') ?? 0);
  const page = children.slice(start, start + 2).map((f) => ({
    id: f.id,
    mimeType: f.mimeType,
    createdTime: '2024-05-01T10:00:00.000Z',
    ...(f.width ? { imageMediaMetadata: { width: f.width, height: f.height, rotation: f.rotation ?? 0, time: f.time } } : {}),
  }));
  return Promise.resolve(json({ files: page, ...(start + 2 < children.length ? { nextPageToken: String(start + 2) } : {}) }));
}

beforeEach(() => {
  files = [];
  failListing = null;
  apiCalls = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(mockDrive as typeof fetch);
});
afterEach(() => vi.restoreAllMocks());

const photo = (n: number, parent = FOLDER, extra: Partial<MockFile> = {}): MockFile => ({ id: fid(n), mimeType: 'image/jpeg', parent, width: 4000, height: 3000, ...extra });

describe('חיבור Google Drive', () => {
  it('רק מנהל; קישור לא תקין נדחה; חיבור שומר את התיקייה ומסנכרן', async () => {
    const admin = await setupAdmin();
    const member = await inviteMember(admin);
    expect((await member.get('/api/admin/drive')).status).toBe(403);
    expect((await member.put('/api/admin/drive', { url: folderUrl })).status).toBe(403);

    const before = (await (await admin.get('/api/admin/drive')).json()) as { state: string; apiKeyConfigured: boolean };
    expect(before.state).toBe('disconnected');
    expect(before.apiKeyConfigured).toBe(true);

    for (const url of ['https://example.com/x', 'https://drive.google.com/file/d/1abcdefghijklmnopqrstuvwxyz/view', 'לא קישור']) {
      expect((await admin.put('/api/admin/drive', { url })).status, url).toBe(400);
    }
    // תיקייה שלא קיימת / לא משותפת
    const missing = await admin.put('/api/admin/drive', { url: 'https://drive.google.com/drive/folders/1MissingFolderAbcdefghijklm' });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toContain('לא נמצאה');

    files = [photo(1), photo(2), photo(3, FOLDER, { width: 3000, height: 4000 }), { id: SUB, mimeType: 'application/vnd.google-apps.folder', parent: FOLDER }, photo(4, SUB, { rotation: 1, time: '1987:06:01 12:00:00' })];
    const res = await admin.put('/api/admin/drive', { url: folderUrl });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sync: { ok: boolean; added: number; total: number }; status: { state: string; photoCount: number; lastSyncAt: number; folder: { name: string } } };
    expect(body.sync.ok).toBe(true);
    expect(body.sync.added).toBe(4);
    expect(body.status).toMatchObject({ state: 'ok', photoCount: 4, folder: { name: 'תמונות המשפחה' } });
    expect(body.status.lastSyncAt).toBeGreaterThan(0);

    // התמונות בגלריה: בלי שם קובץ, עם מידות (כולל סיבוב), בלי שום קובץ ב-R2
    const list = (await (await member.get('/api/items?kind=photo&limit=50')).json()) as { total: number; items: { title: string; dateYear: number | null; createdBy: { name: string }; files: { id: string; role: string; width: number; height: number }[] }[] };
    expect(list.total).toBe(4);
    expect(list.items.every((i) => i.title === '')).toBe(true);
    const rotated = list.items.find((i) => i.files[0].id.includes(fid(4)))!;
    expect(rotated.files.find((f) => f.role === 'original')).toMatchObject({ width: 3000, height: 4000 });
    expect(rotated.dateYear).toBe(1987);
    expect(rotated.createdBy.name).toBe('Google Drive');
    expect((await env.MEDIA.list()).objects).toHaveLength(0);

    // התמונה עצמה — דרך ה-Worker, מגוגל
    const thumbId = list.items[0].files.find((f) => f.role === 'thumb')!.id;
    const img = await member.get(`/api/files/${thumbId}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    expect(img.headers.get('cache-control')).toContain('private');
    // הורדת המקור — הפניה לגוגל
    const dl = await member.req(`/api/files/${list.items[0].files.find((f) => f.role === 'original')!.id}?download=1`, { redirect: 'manual' });
    expect(dl.status).toBe(302);
    expect(dl.headers.get('location')).toContain('drive.google.com/uc?export=download');
    // לא שער פתוח לכל קובץ בדרייב
    expect((await member.get('/api/files/gd:1SomeOtherFileAbcdefghijklmnop')).status).toBe(404);
    // בלי התחברות — אין גישה
    expect((await new (await import('./helpers')).Client().get(`/api/files/${thumbId}`)).status).toBe(401);

    // הקישור להוספת תמונות זמין לבני המשפחה
    const settings = (await (await member.get('/api/settings')).json()) as { driveFolderUrl: string };
    expect(settings.driveFolderUrl).toBe(`https://drive.google.com/drive/folders/${FOLDER}`);

    // ״זיכרון מסבא״ בוחר מהרשימה שב-D1 — בלי לקרוא לדרייב
    apiCalls = 0;
    const r = (await (await member.get('/api/random')).json()) as { item: { kind: string } };
    expect(r.item.kind).toBe('photo');
    expect(apiCalls).toBe(0);
  });

  it('סנכרון: חדשות נוספות, שהוסרו מוסתרות וחוזרות, בלי כפילויות; כשל זמני לא מוחק דבר', async () => {
    const admin = await setupAdmin();
    files = [photo(1), photo(2), photo(3)];
    await admin.put('/api/admin/drive', { url: folderUrl });
    const count = async () => ((await (await admin.get('/api/items?kind=photo&limit=1')).json()) as { total: number }).total;
    expect(await count()).toBe(3);

    // סנכרון חוזר בלי שינוי — בלי כפילויות
    let s = (await (await admin.post('/api/admin/drive/sync')).json()) as { sync: { ok: boolean; added: number; removed: number; message: string } };
    expect(s.sync).toMatchObject({ ok: true, added: 0, removed: 0 });
    expect(await count()).toBe(3);

    // נוספה תמונה והוסרה אחרת
    files = [photo(1), photo(3), photo(5)];
    s = (await (await admin.post('/api/admin/drive/sync')).json()) as typeof s;
    expect(s.sync).toMatchObject({ ok: true, added: 1, removed: 1 });
    expect(await count()).toBe(3);
    // התמונה שהוסרה לא מוצגת ולא נגישה, ולא מופיעה בסל המחזור
    const trash = (await (await admin.get('/api/items?deleted=1&limit=50')).json()) as { total: number };
    expect(trash.total).toBe(0);

    // כשל זמני (מכסה/רשת) — שום דבר לא נמחק, והמצב מראה שגיאה
    failListing = 429;
    s = (await (await admin.post('/api/admin/drive/sync')).json()) as typeof s;
    expect(s.sync.ok).toBe(false);
    expect(s.sync.message).toContain('מכסת');
    expect(await count()).toBe(3);
    const st = (await (await admin.get('/api/admin/drive')).json()) as { state: string; lastError: string; photoCount: number };
    expect(st).toMatchObject({ state: 'error', photoCount: 3 });
    failListing = null;

    // תיקייה שנראית ריקה פתאום — לא מוחקים כלום, ליתר ביטחון
    files = [];
    s = (await (await admin.post('/api/admin/drive/sync')).json()) as typeof s;
    expect(s.sync.ok).toBe(true);
    expect(s.sync.removed).toBe(0);
    expect(await count()).toBe(3);

    // התמונה שהוסרה חזרה לדרייב — חוזרת לאתר (אותו פריט, בלי כפילות)
    files = [photo(1), photo(2), photo(3), photo(5)];
    s = (await (await admin.post('/api/admin/drive/sync')).json()) as typeof s;
    expect(s.sync).toMatchObject({ ok: true, added: 0 });
    expect(await count()).toBe(4);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM drive_photos').first<{ n: number }>();
    expect(rows?.n).toBe(4);
  });

  it('מנהל שהסתיר תמונה מהדרייב — נשארת מוסתרת; סנכרון מתוזמן פועל לבד; תיקייה גדולה נוספת בהדרגה', async () => {
    const admin = await setupAdmin();
    files = [photo(1), photo(2)];
    await admin.put('/api/admin/drive', { url: folderUrl });
    const items = ((await (await admin.get('/api/items?kind=photo&limit=10')).json()) as { items: { id: string }[] }).items;
    expect((await admin.del(`/api/items/${items[0].id}`)).status).toBe(200);
    await admin.post('/api/admin/drive/sync');
    expect(((await (await admin.get('/api/items?kind=photo&limit=1')).json()) as { total: number }).total).toBe(1);

    // סנכרון מתוזמן (Cron) מזהה תמונות חדשות
    files = [photo(1), photo(2), ...Array.from({ length: 6 }, (_, i) => photo(10 + i))];
    await scheduledDriveSync(env as never);
    expect(((await (await admin.get('/api/items?kind=photo&limit=1')).json()) as { total: number }).total).toBe(7);
  });
});
