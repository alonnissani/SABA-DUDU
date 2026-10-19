import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { Client, MP3, MP4_HEAD, PDF, PNG, createMedia, inviteMember, setupAdmin, upload } from './helpers';

describe('הקמה, התחברות והזמנות', () => {
  it('דורש SETUP_TOKEN נכון ומאפשר הקמה פעם אחת בלבד', async () => {
    const anon = new Client();
    const status = await (await anon.get('/api/auth/status')).json();
    expect(status).toMatchObject({ setupRequired: true, user: null });

    const bad = await anon.post('/api/auth/setup', { token: 'wrong', name: 'x', email: 'a@b.cd', password: '12345678' });
    expect(bad.status).toBe(403);

    const admin = await setupAdmin();
    const me = (await (await admin.get('/api/auth/status')).json()) as { user: { role: string } };
    expect(me.user.role).toBe('admin');

    const again = await new Client().post('/api/auth/setup', {
      token: 'test-setup-token-123', name: 'x', email: 'x@y.zz', password: '12345678',
    });
    expect(again.status).toBe(409);
  });

  it('אין הרשמה ציבורית — הצטרפות רק בקישור הזמנה חד-פעמי', async () => {
    const admin = await setupAdmin();
    const inv = (await (await admin.post('/api/admin/invites', { role: 'member' })).json()) as { url: string };
    const token = inv.url.split('/invite/')[1];
    const a = new Client();
    expect((await a.post('/api/auth/accept-invite', { token, name: 'א', email: 'a@f.test', password: 'password-1' })).status).toBe(200);
    const b = new Client();
    expect((await b.post('/api/auth/accept-invite', { token, name: 'ב', email: 'b@f.test', password: 'password-1' })).status).toBe(410);
    expect((await b.post('/api/auth/accept-invite', { token: 'x'.repeat(43), name: 'ב', email: 'b@f.test', password: 'password-1' })).status).toBe(404);
  });

  it('התחברות עם סיסמה שגויה נכשלת, ומוגבלת אחרי ניסיונות רבים', async () => {
    await setupAdmin();
    const c = new Client();
    expect((await c.post('/api/auth/login', { email: 'admin@family.test', password: 'nope-nope' })).status).toBe(401);
    expect((await c.post('/api/auth/login', { email: 'admin@family.test', password: 'admin-password-1' })).status).toBe(200);
    for (let i = 0; i < 8; i++) await new Client().post('/api/auth/login', { email: 'admin@family.test', password: 'bad-pass' });
    expect((await new Client().post('/api/auth/login', { email: 'admin@family.test', password: 'admin-password-1' })).status).toBe(429);
  });

  it('חוסם בקשות משנות ממקור זר (CSRF)', async () => {
    const admin = await setupAdmin();
    const res = await admin.req('/api/admin/invites', {
      method: 'POST', json: { role: 'member' }, headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });

  it('משתמש לא מחובר לא יכול לגשת לתכנים', async () => {
    const anon = new Client();
    for (const path of ['/api/items?kind=photo', '/api/random', '/api/search?q=test', '/api/settings', '/api/tags']) {
      expect((await anon.get(path)).status, path).toBe(401);
    }
  });
});

describe('הרשאות מחיקה', () => {
  it('משתמש רגיל לא יכול למחוק, לשחזר או לערוך — גם תוכן שהעלה בעצמו', async () => {
    const admin = await setupAdmin();
    const member = await inviteMember(admin);
    const item = await createMedia(member, 'photo', PNG, 'סבא בים.png', 'image/png');

    expect((await member.del(`/api/items/${item.id}`)).status).toBe(403);
    expect((await member.patch(`/api/items/${item.id}`, { title: 'שונה' })).status).toBe(403);
    expect((await member.post(`/api/items/${item.id}/restore`)).status).toBe(403);
    expect((await member.get('/api/items?deleted=1')).status).toBe(403);
    expect((await member.get('/api/admin/users')).status).toBe(403);
    expect((await member.put('/api/admin/hero', { clear: true })).status).toBe(403);
    expect((await member.put('/api/admin/settings', { siteTitle: 'x' })).status).toBe(403);

    // הפריט עדיין קיים
    expect((await member.get(`/api/items/${item.id}`)).status).toBe(200);
  });

  it('מנהל מוחק מחיקה רכה ומשחזר; הקובץ נשמר באחסון', async () => {
    const admin = await setupAdmin();
    const member = await inviteMember(admin);
    const item = await createMedia(member, 'document', PDF, 'תעודה.pdf', 'application/pdf');
    const fileId = item.files[0].id;

    expect((await admin.del(`/api/items/${item.id}`)).status).toBe(200);
    // נעלם מהרשימה ומהגישה של משתמש רגיל
    const list = (await (await member.get('/api/items?kind=document')).json()) as { items: unknown[] };
    expect(list.items).toHaveLength(0);
    expect((await member.get(`/api/items/${item.id}`)).status).toBe(404);
    expect((await member.get(`/api/files/${fileId}`)).status).toBe(404);
    // מנהל עדיין רואה בסל המחזור
    const trash = (await (await admin.get('/api/items?deleted=1')).json()) as { items: { id: string }[] };
    expect(trash.items.map((i) => i.id)).toContain(item.id);
    expect((await admin.get(`/api/files/${fileId}`)).status).toBe(200);

    // הרשומה לא נמחקה פיזית
    const row = await env.DB.prepare('SELECT deleted_at FROM items WHERE id = ?').bind(item.id).first<{ deleted_at: number }>();
    expect(row?.deleted_at).toBeGreaterThan(0);

    expect((await admin.post(`/api/items/${item.id}/restore`)).status).toBe(200);
    expect((await member.get(`/api/items/${item.id}`)).status).toBe(200);
    expect((await member.get(`/api/files/${fileId}`)).status).toBe(200);
  });

  it('משתמש רגיל לא יכול למחוק תגובות; מנהל יכול', async () => {
    const admin = await setupAdmin();
    const member = await inviteMember(admin);
    const story = (await (await member.post('/api/items', {
      kind: 'story', title: 'הסיפור', body: 'תוכן', storyType: 'family',
    })).json()) as { id: string };
    const comment = (await (await member.post(`/api/items/${story.id}/comments`, { body: 'גם אני', kind: 'memory' })).json()) as { id: string };
    expect((await member.del(`/api/comments/${comment.id}`)).status).toBe(403);
    expect((await admin.del(`/api/comments/${comment.id}`)).status).toBe(200);
  });
});

describe('העלאת קבצים וגישה אליהם', () => {
  it('מעלה ומגיש את קובץ המקור ללא שינוי, עם תמיכה ב-Range והורדה', async () => {
    const admin = await setupAdmin();
    const item = await createMedia(admin, 'audio', MP3, 'קול של סבא.mp3', 'audio/mpeg');
    const fileId = item.files[0].id;
    const full = await admin.get(`/api/files/${fileId}`);
    expect(full.status).toBe(200);
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(MP3);
    expect(full.headers.get('cache-control')).toContain('private');

    const part = await admin.req(`/api/files/${fileId}`, { headers: { range: 'bytes=2-5' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 2-5/${MP3.length}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(MP3.slice(2, 6));

    const dl = await admin.get(`/api/files/${fileId}?download=1`);
    expect(dl.headers.get('content-disposition')).toContain('attachment');
    expect(dl.headers.get('content-disposition')).toContain(encodeURIComponent('קול של סבא.mp3'));
  });

  it('גישה לקובץ ללא התחברות נחסמת', async () => {
    const admin = await setupAdmin();
    const item = await createMedia(admin, 'photo', PNG, 'a.png', 'image/png');
    expect((await new Client().get(`/api/files/${item.files[0].id}`)).status).toBe(401);
  });

  it('דוחה סוג קובץ לא מותר ותוכן שאינו תואם לסוג המוצהר', async () => {
    const admin = await setupAdmin();
    expect((await upload(admin, 'photo', PDF, 'x.pdf', 'application/pdf')).status).toBe(415);
    // קובץ ״PNG״ שהוא בעצם טקסט
    expect((await upload(admin, 'photo', new TextEncoder().encode('<script>alert(1)</script>'), 'x.png', 'image/png')).status).toBe(415);
    expect((await upload(admin, 'audio', PNG, 'x.mp3', 'audio/mpeg')).status).toBe(415);
    expect((await upload(admin, 'photo', new Uint8Array(0), 'x.png', 'image/png')).status).toBe(400);
  });

  it('קובץ ממתין שייך רק למי שהעלה אותו', async () => {
    const admin = await setupAdmin();
    const member = await inviteMember(admin);
    const up = (await (await upload(admin, 'photo', PNG, 'a.png', 'image/png')).json()) as { id: string };
    expect((await member.get(`/api/files/${up.id}`)).status).toBe(404);
    const res = await member.post('/api/items', { kind: 'photo', title: 'גניבה', files: [{ id: up.id }] });
    expect(res.status).toBe(400);
  });

  it('קבצים לא נדרסים — כל העלאה מקבלת מפתח אחסון ייחודי', async () => {
    const admin = await setupAdmin();
    const a = (await (await upload(admin, 'photo', PNG, 'same.png', 'image/png')).json()) as { id: string };
    const b = (await (await upload(admin, 'photo', PNG, 'same.png', 'image/png')).json()) as { id: string };
    const keys = await env.DB.prepare('SELECT r2_key FROM files WHERE id IN (?, ?)').bind(a.id, b.id).all<{ r2_key: string }>();
    expect(new Set(keys.results.map((k) => k.r2_key)).size).toBe(2);
  });

  it('העלאה בחלקים (multipart) לקבצים גדולים', async () => {
    const admin = await setupAdmin();
    const partSize = 10 * 1024 * 1024;
    const size = partSize + 1234;
    const data = new Uint8Array(size);
    data.set(MP4_HEAD, 0);
    const start = (await (await admin.post('/api/uploads/multipart', {
      kind: 'video', name: 'חתונה.mp4', mime: 'video/mp4', size,
    })).json()) as { uploadId: string; parts: number };
    expect(start.parts).toBe(2);
    const parts = [];
    for (let n = 1; n <= 2; n++) {
      const chunk = data.slice((n - 1) * partSize, Math.min(n * partSize, size));
      const res = await admin.req(`/api/uploads/multipart/${start.uploadId}/${n}`, { method: 'PUT', body: chunk });
      expect(res.status).toBe(200);
      parts.push(await res.json());
    }
    const done = await admin.post(`/api/uploads/multipart/${start.uploadId}/complete`, { parts });
    expect(done.status).toBe(200);
    const file = (await done.json()) as { id: string; size: number };
    expect(file.size).toBe(size);
    const item = await admin.post('/api/items', { kind: 'video', title: 'חתונה', files: [{ id: file.id, duration: 12.5 }] });
    expect(item.status).toBe(201);
    const head = await admin.req(`/api/files/${file.id}`, { headers: { range: 'bytes=0-15' } });
    expect(new Uint8Array(await head.arrayBuffer())).toEqual(MP4_HEAD);
  });
});

describe('חיפוש', () => {
  it('״יום הולדת״ מוצא פריטים בכל הקטגוריות, כולל תחיליות, ניקוד ותגיות', async () => {
    const admin = await setupAdmin();
    const member = await inviteMember(admin);
    await createMedia(member, 'photo', PNG, 'p.png', 'image/png', { title: 'ביום ההולדת ה-80 של סבא' });
    await createMedia(member, 'audio', MP3, 'a.mp3', 'audio/mpeg', { title: 'ברכה', description: 'סבא שר ביום־הולדת' });
    await createMedia(member, 'document', PDF, 'd.pdf', 'application/pdf', { title: 'הזמנה', tags: ['יום הולדת'] });
    await member.post('/api/items', { kind: 'story', title: 'מסיבה', body: 'ביוֹם הוּלֶדֶת אחד סבא הפתיע את כולם', storyType: 'family' });
    await member.post('/api/items', { kind: 'story', title: 'משהו אחר', body: 'טיול בכנרת', storyType: 'personal' });

    const res = (await (await member.get(`/api/search?q=${encodeURIComponent('יום הולדת')}`)).json()) as {
      total: number; groups: { kind: string }[];
    };
    expect(res.total).toBe(4);
    expect(res.groups.map((g) => g.kind).sort()).toEqual(['audio', 'document', 'photo', 'story']);

    const onlyStories = (await (await member.get(`/api/search?q=${encodeURIComponent('יום הולדת')}&kind=story`)).json()) as { total: number };
    expect(onlyStories.total).toBe(1);

    // חיפוש לפי שם המעלה, שנה וטקסט קצר
    expect(((await (await member.get(`/api/search?q=${encodeURIComponent('בן משפחה')}`)).json()) as { total: number }).total).toBe(5);
    expect(((await (await member.get(`/api/search?q=${encodeURIComponent('80')}`)).json()) as { total: number }).total).toBe(1);
  });

  it('פריט מחוק לא מופיע בחיפוש, ותגובות נכללות בחיפוש', async () => {
    const admin = await setupAdmin();
    const story = (await (await admin.post('/api/items', { kind: 'story', title: 'דייג', body: 'סבא דג בנמל', storyType: 'family' })).json()) as { id: string };
    await admin.post(`/api/items/${story.id}/comments`, { body: 'אני זוכר את הסירה הכחולה', kind: 'memory' });
    const q = async (s: string) => ((await (await admin.get(`/api/search?q=${encodeURIComponent(s)}`)).json()) as { total: number }).total;
    expect(await q('הסירה הכחולה')).toBe(1);
    await admin.del(`/api/items/${story.id}`);
    expect(await q('הסירה הכחולה')).toBe(0);
  });
});

describe('זיכרון אקראי', () => {
  it('מחזיר null בארכיון ריק, ונמנע מחזרה על פריטים שהוצגו', async () => {
    const admin = await setupAdmin();
    expect(await (await admin.get('/api/random')).json()).toEqual({ item: null, total: 0 });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = (await (await admin.post('/api/items', { kind: 'story', title: `ס${i}`, body: 'x', storyType: 'family' })).json()) as { id: string };
      ids.push(r.id);
    }
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = (await (await admin.get(`/api/random?exclude=${seen.join(',')}`)).json()) as { item: { id: string } };
      expect(seen).not.toContain(r.item.id);
      seen.push(r.item.id);
    }
    expect(seen.sort()).toEqual(ids.sort());
    // כשהכול הוצג — לא חוזר על האחרון
    const r = (await (await admin.get(`/api/random?exclude=${seen.join(',')}`)).json()) as { item: { id: string } };
    expect(r.item.id).not.toBe(seen[seen.length - 1]);
  });
});

describe('סיפורים, הגדרות וגיבוי', () => {
  it('סיפור עם פריטים מצורפים ותגובות ״גם אני זוכר״', async () => {
    const admin = await setupAdmin();
    const member = await inviteMember(admin);
    const photo = await createMedia(member, 'photo', PNG, 'p.png', 'image/png');
    const story = (await (await member.post('/api/items', {
      kind: 'story', title: 'בדיחה', body: 'סבא אמר...', storyType: 'joke', linkIds: [photo.id], tags: ['בדיחות'],
    })).json()) as { id: string };
    await member.post(`/api/items/${story.id}/comments`, { body: 'וגם צחקנו!', kind: 'memory' });
    const detail = (await (await admin.get(`/api/items/${story.id}`)).json()) as {
      links: { id: string }[]; comments: { kind: string; createdBy: { name: string } }[]; storyType: string; tags: string[];
    };
    expect(detail.links.map((l) => l.id)).toEqual([photo.id]);
    expect(detail.comments[0]).toMatchObject({ kind: 'memory', createdBy: { name: 'בן משפחה' } });
    expect(detail.storyType).toBe('joke');
    expect(detail.tags).toEqual(['בדיחות']);
  });

  it('מנהל מחליף תמונה ראשית ומאפייני מסך פתיחה', async () => {
    const admin = await setupAdmin();
    const member = await inviteMember(admin);
    const up = (await (await upload(admin, 'photo', PNG, 'hero.png', 'image/png')).json()) as { id: string };
    expect((await admin.put('/api/admin/hero', { fileId: up.id })).status).toBe(200);
    await admin.put('/api/admin/settings', { heroTraits: { quotes: ['יהיה בסדר'], symbols: [{ icon: '🎩', label: 'הכובע' }], details: [] } });
    const s = (await (await member.get('/api/settings')).json()) as { heroFileId: string; heroTraits: { quotes: string[] } };
    expect(s.heroFileId).toBe(up.id);
    expect(s.heroTraits.quotes).toEqual(['יהיה בסדר']);
    // התמונה הראשית זמינה לכל המשפחה
    expect((await member.get(`/api/files/${up.id}`)).status).toBe(200);
  });

  it('לא ניתן להסיר את המנהל האחרון', async () => {
    const admin = await setupAdmin();
    const me = (await (await admin.get('/api/auth/status')).json()) as { user: { id: string } };
    expect((await admin.patch(`/api/admin/users/${me.user.id}`, { role: 'member' })).status).toBe(400);
  });

  it('גיבוי מעתיק קבצים ו-snapshot ל-bucket הגיבוי', async () => {
    const admin = await setupAdmin();
    const item = await createMedia(admin, 'photo', PNG, 'b.png', 'image/png');
    const res = (await (await admin.post('/api/admin/backups/run')).json()) as { status: string };
    expect(res.status).toBe('ok');
    const key = await env.DB.prepare('SELECT r2_key FROM files WHERE id = ?').bind(item.files[0].id).first<{ r2_key: string }>();
    const copy = await env.BACKUP!.get(key!.r2_key);
    expect(new Uint8Array(await copy!.arrayBuffer())).toEqual(PNG);
    const status = (await (await admin.get('/api/admin/backups')).json()) as { filesBackedUp: number; lastRun: { snapshotKey: string } };
    expect(status.filesBackedUp).toBe(1);
    expect(await env.BACKUP!.head(status.lastRun.snapshotKey)).not.toBeNull();
  });

  it('ייצוא מחזיר manifest עם קישורי הורדה', async () => {
    const admin = await setupAdmin();
    await createMedia(admin, 'photo', PNG, 'e.png', 'image/png');
    const m = (await (await admin.get('/api/admin/export')).json()) as { format: string; files: { downloadUrl: string }[] };
    expect(m.format).toBe('saba-dudu-archive');
    expect(m.files[0].downloadUrl).toMatch(/\/api\/files\/.+\?download=1$/);
  });

  it('קישור איפוס סיסמה', async () => {
    const admin = await setupAdmin();
    const member = await inviteMember(admin);
    const me = (await (await member.get('/api/auth/status')).json()) as { user: { id: string } };
    const { url } = (await (await admin.post(`/api/admin/users/${me.user.id}/reset-link`)).json()) as { url: string };
    const token = url.split('/reset/')[1];
    const c = new Client();
    expect((await c.post('/api/auth/reset', { token, password: 'brand-new-pass' })).status).toBe(200);
    expect((await new Client().post('/api/auth/login', { email: 'member@family.test', password: 'brand-new-pass' })).status).toBe(200);
    expect((await c.post('/api/auth/reset', { token, password: 'another-pass' })).status).toBe(410);
  });
});

describe('סרטון מקישור Google Drive', () => {
  const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

  it('נשמר בלי קובץ ב-R2, ומזהה את הקובץ מצורות קישור שונות', async () => {
    const admin = await setupAdmin();
    const member = await inviteMember(admin);
    for (const url of [
      `https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`,
      `https://drive.google.com/open?id=${DRIVE_ID}`,
      `https://drive.google.com/uc?id=${DRIVE_ID}&export=download`,
    ]) {
      const res = await member.post('/api/items', { kind: 'video', title: 'מהדרייב', externalUrl: url });
      expect(res.status, url).toBe(201);
      const item = (await res.json()) as { files: unknown[]; externalVideo: { fileId: string; url: string } };
      expect(item.files).toHaveLength(0);
      expect(item.externalVideo).toEqual({ provider: 'gdrive', fileId: DRIVE_ID, url: `https://drive.google.com/file/d/${DRIVE_ID}/view` });
    }
    const objects = await env.MEDIA.list();
    expect(objects.objects).toHaveLength(0);
    const list = (await (await member.get('/api/items?kind=video')).json()) as { items: { externalVideo: unknown }[] };
    expect(list.items).toHaveLength(3);
    expect(list.items[0].externalVideo).not.toBeNull();
  });

  it('דוחה קישור שאינו Google Drive, וקישור יחד עם קובץ', async () => {
    const admin = await setupAdmin();
    for (const url of ['https://example.com/file/d/abc/view', 'javascript:alert(1)', 'https://drive.google.com/drive/folders/', 'לא קישור']) {
      expect((await admin.post('/api/items', { kind: 'video', title: 'x', externalUrl: url })).status, url).toBe(400);
    }
    const up = (await (await upload(admin, 'video', MP4_HEAD, 'a.mp4', 'video/mp4')).json()) as { id: string };
    const both = await admin.post('/api/items', { kind: 'video', title: 'x', files: [{ id: up.id }], externalUrl: `https://drive.google.com/file/d/${DRIVE_ID}/view` });
    expect(both.status).toBe(400);
  });

  it('מנהל יכול להחליף את הקישור; משתמש רגיל לא', async () => {
    const admin = await setupAdmin();
    const member = await inviteMember(admin);
    const item = (await (await member.post('/api/items', { kind: 'video', title: 'v', externalUrl: `https://drive.google.com/file/d/${DRIVE_ID}/view` })).json()) as { id: string };
    const NEW_ID = '9ZyXwVuTsRqPoNmLkJiHgFeDcBa98765';
    expect((await member.patch(`/api/items/${item.id}`, { externalUrl: `https://drive.google.com/file/d/${NEW_ID}/view` })).status).toBe(403);
    const res = await admin.patch(`/api/items/${item.id}`, { externalUrl: `https://drive.google.com/file/d/${NEW_ID}/view?usp=drive_link` });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { externalVideo: { fileId: string } }).externalVideo.fileId).toBe(NEW_ID);
    expect((await admin.patch(`/api/items/${item.id}`, { externalUrl: 'https://example.com' })).status).toBe(400);
  });

  it('סרטון שהועלה כקובץ ממשיך לעבוד כרגיל', async () => {
    const admin = await setupAdmin();
    const item = await createMedia(admin, 'video', MP4_HEAD, 'old.mp4', 'video/mp4');
    const detail = (await (await admin.get(`/api/items/${item.id}`)).json()) as { externalVideo: unknown; files: unknown[] };
    expect(detail.externalVideo).toBeNull();
    expect(detail.files).toHaveLength(1);
  });
});

describe('כותרות תמונות', () => {
  it('תמונה ללא כותרת נשמרת עם כותרת ריקה; לסוגים אחרים הכותרת חובה', async () => {
    const admin = await setupAdmin();
    const up = (await (await upload(admin, 'photo', PNG, 'IMG_8813.png', 'image/png')).json()) as { id: string };
    const res = await admin.post('/api/items', { kind: 'photo', files: [{ id: up.id }] });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { title: string }).title).toBe('');
    expect((await admin.post('/api/items', { kind: 'story', body: 'x', storyType: 'family' })).status).toBe(400);
  });
});

describe('סדר אקראי בגלריה', () => {
  it('אותו seed — סדר יציב בין עמודים בלי כפילויות או חוסרים; seed אחר — סדר אחר', async () => {
    const admin = await setupAdmin();
    const ids: string[] = [];
    for (let i = 0; i < 45; i++) ids.push((await createMedia(admin, 'photo', PNG, `p${i}.png`, 'image/png', { title: `ת${i}` })).id);
    const page = async (seed: number, offset: number) =>
      ((await (await admin.get(`/api/items?kind=photo&sort=random&seed=${seed}&limit=20&offset=${offset}`)).json()) as { items: { id: string }[]; total: number });
    const all = async (seed: number) => {
      const out: string[] = [];
      for (let off = 0; off < 45; off += 20) out.push(...(await page(seed, off)).items.map((x) => x.id));
      return out;
    };
    const a = await all(12345);
    expect(a).toHaveLength(45);
    expect(new Set(a).size).toBe(45);
    expect([...a].sort()).toEqual([...ids].sort());
    expect(await all(12345)).toEqual(a); // יציב
    const b = await all(987654);
    expect(b).not.toEqual(a);
    // לא סתם סדר ההוספה או הפוכו
    expect(a).not.toEqual(ids);
    expect(a).not.toEqual([...ids].reverse());
    // הסדר השמור לא השתנה
    const byNew = ((await (await admin.get('/api/items?kind=photo&limit=100')).json()) as { items: { id: string }[] }).items.map((x) => x.id);
    expect(byNew).toEqual([...ids].reverse());
  });
});

describe('תמונות ממוזערות לתמונות קיימות', () => {
  it('מנהל רואה תמונות ללא ממוזערת ומצרף אחת; משתמש רגיל לא יכול', async () => {
    const admin = await setupAdmin();
    const member = await inviteMember(admin);
    const item = await createMedia(member, 'photo', PNG, 'old.png', 'image/png');
    const missing = (await (await admin.get('/api/admin/thumbs/missing')).json()) as { itemId: string }[];
    expect(missing.map((m) => m.itemId)).toEqual([item.id]);
    expect((await member.get('/api/admin/thumbs/missing')).status).toBe(403);

    const thumb = (await (await upload(admin, 'photo', PNG, 'preview.png', 'image/png', 'thumb')).json()) as { id: string };
    expect((await member.post(`/api/admin/items/${item.id}/thumb`, { fileId: thumb.id })).status).toBe(403);
    expect((await admin.post(`/api/admin/items/${item.id}/thumb`, { fileId: thumb.id, width: 1200, height: 800 })).status).toBe(200);

    const detail = (await (await admin.get(`/api/items/${item.id}`)).json()) as { files: { id: string; role: string; width: number }[] };
    expect(detail.files.map((f) => f.role).sort()).toEqual(['original', 'thumb']);
    expect(detail.files.find((f) => f.role === 'original')!.width).toBe(1200);
    // המקור לא השתנה
    const orig = detail.files.find((f) => f.role === 'original')!;
    expect(new Uint8Array(await (await admin.get(`/api/files/${orig.id}`)).arrayBuffer())).toEqual(PNG);
    expect(((await (await admin.get('/api/admin/thumbs/missing')).json()) as unknown[]).length).toBe(0);
  });
});

describe('תמונות לדף הבית', () => {
  it('מנהל שומר אוסף עם מיקוד; התמונה הראשית ותמונות שנמחקו לא מוחזרות; משתמש רגיל לא יכול לשנות', async () => {
    const admin = await setupAdmin();
    const member = await inviteMember(admin);
    const a = await createMedia(admin, 'photo', PNG, 'a.png', 'image/png', { title: 'א' });
    const b = await createMedia(admin, 'photo', PNG, 'b.png', 'image/png', { title: 'ב' });
    const c = await createMedia(admin, 'photo', PNG, 'c.png', 'image/png', { title: 'ג' });
    const story = (await (await admin.post('/api/items', { kind: 'story', title: 's', body: 'x', storyType: 'family' })).json()) as { id: string };

    expect((await member.put('/api/admin/settings', { homePhotos: [{ itemId: a.id }] })).status).toBe(403);
    expect((await admin.put('/api/admin/settings', { homePhotos: [{ itemId: story.id }] })).status).toBe(400);
    expect((await admin.put('/api/admin/settings', { homePhotos: 'x' })).status).toBe(400);

    const save = await admin.put('/api/admin/settings', {
      homePhotos: [{ itemId: a.id, x: 40, y: 20, zoom: 1.5 }, { itemId: b.id, x: 500, y: -3, zoom: 9 }, { itemId: c.id }, { itemId: a.id }],
    });
    expect(save.status).toBe(200);
    let s = (await (await member.get('/api/settings')).json()) as { homePhotos: { itemId: string; fileId: string; x: number; y: number; zoom: number }[] };
    expect(s.homePhotos.map((p) => p.itemId)).toEqual([a.id, b.id, c.id]);
    expect(s.homePhotos[0]).toMatchObject({ x: 40, y: 20, zoom: 1.5, fileId: a.files[0].id });
    expect(s.homePhotos[1]).toMatchObject({ x: 100, y: 0, zoom: 3 });

    // התמונה הראשית (בכותרת) לא חוזרת באוסף
    await admin.put('/api/admin/hero', { itemId: b.id });
    // תמונה שנמחקה לא מוחזרת
    await admin.del(`/api/items/${c.id}`);
    s = (await (await member.get('/api/settings')).json()) as typeof s;
    expect(s.homePhotos.map((p) => p.itemId)).toEqual([a.id]);
  });
});
