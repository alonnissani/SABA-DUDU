import { SELF } from 'cloudflare:test';

export const ORIGIN = 'https://saba.test';

/** לקוח HTTP קטן עם ״עוגיות״ — מדמה דפדפן של בן משפחה. */
export class Client {
  cookie = '';

  async req(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set('cookie', this.cookie);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(init.json);
    }
    if (init.method && init.method !== 'GET' && !headers.has('origin')) headers.set('origin', ORIGIN);
    const res = await SELF.fetch(`${ORIGIN}${path}`, { ...init, headers, body });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = /sd_session=([^;]*)/.exec(set);
      if (m) this.cookie = m[1] ? `sd_session=${m[1]}` : '';
    }
    return res;
  }

  get(path: string) {
    return this.req(path);
  }
  post(path: string, json?: unknown) {
    return this.req(path, { method: 'POST', json: json ?? {} });
  }
  patch(path: string, json: unknown) {
    return this.req(path, { method: 'PATCH', json });
  }
  put(path: string, json: unknown) {
    return this.req(path, { method: 'PUT', json });
  }
  del(path: string) {
    return this.req(path, { method: 'DELETE' });
  }
}

// קבצים מינימליים עם חתימות אמיתיות
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
export const PDF = new TextEncoder().encode('%PDF-1.4\n%test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
export const MP3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
export const MP4_HEAD = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

export async function setupAdmin(): Promise<Client> {
  const admin = new Client();
  const res = await admin.post('/api/auth/setup', {
    token: 'test-setup-token-123', name: 'מנהל', email: 'admin@family.test', password: 'admin-password-1',
  });
  if (res.status !== 200) throw new Error(`setup failed ${res.status} ${await res.text()}`);
  return admin;
}

export async function inviteMember(admin: Client, email = 'member@family.test', name = 'בן משפחה'): Promise<Client> {
  const inv = (await (await admin.post('/api/invites', { role: 'member' })).json()) as { url: string };
  const token = inv.url.split('/invite/')[1];
  const member = new Client();
  const res = await member.post('/api/auth/accept-invite', { token, name, email, password: 'member-password-1' });
  if (res.status !== 200) throw new Error(`accept failed ${res.status} ${await res.text()}`);
  return member;
}

export async function upload(client: Client, kind: string, bytes: Uint8Array, name: string, mime: string, role = 'original') {
  return client.req(`/api/uploads/direct?kind=${kind}&role=${role}&name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': mime },
    body: bytes,
  });
}

export async function createMedia(client: Client, kind: string, bytes: Uint8Array, name: string, mime: string, extra: Record<string, unknown> = {}) {
  // תמונות לגלריה כבר לא נוצרות דרך האתר — לבדיקות קבצים נוצרת ״תמונה ישנה״ ישירות ב-D1
  if (kind === 'photo') return legacyPhoto(client, bytes, name, mime, { title: typeof extra.title === 'string' ? extra.title : name });
  // סרטונים כבר לא מועלים לאתר (רק קישור Drive) — ״סרטון ישן״ נוצר ישירות
  if (kind === 'video') return legacyVideo(client, bytes, name, mime, { title: typeof extra.title === 'string' ? extra.title : name });
  const up = await upload(client, kind, bytes, name, mime);
  if (up.status !== 200) throw new Error(`upload failed ${up.status} ${await up.text()}`);
  const file = (await up.json()) as { id: string };
  const res = await client.post('/api/items', { kind, title: name, files: [{ id: file.id }], ...extra });
  if (res.status !== 201) throw new Error(`create failed ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string; files: { id: string }[] };
}

/** מזהה המשתמש של לקוח מחובר */
export async function userIdOf(client: Client): Promise<string> {
  return ((await (await client.get('/api/auth/status')).json()) as { user: { id: string } }).user.id;
}

/**
 * תמונת גלריה ״ישנה״ שהועלתה לאתר (R2) — כפי שהיו לפני המעבר ל-Google Drive.
 * האתר כבר לא מאפשר ליצור כאלה, ולכן נוצרת ישירות ב-D1 (לבדיקות קבצים, גיבוי וניקוי).
 */
export async function legacyPhoto(client: Client, bytes: Uint8Array, name: string, mime: string, extra: { title?: string; thumb?: boolean } = {}) {
  const { env } = await import('cloudflare:test');
  const up = (await (await upload(client, 'photo', bytes, name, mime)).json()) as { id: string };
  const fileIds = [up.id];
  if (extra.thumb) fileIds.push(((await (await upload(client, 'photo', PNG, 'preview.png', 'image/png', 'thumb')).json()) as { id: string }).id);
  const id = crypto.randomUUID();
  const userId = await userIdOf(client);
  const t = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO items (id, kind, title, created_by, created_at, updated_at) VALUES (?, 'photo', ?, ?, ?, ?)").bind(id, extra.title ?? name, userId, t, t),
    ...fileIds.map((f) => env.DB.prepare('UPDATE files SET item_id = ? WHERE id = ?').bind(id, f)),
  ]);
  return { id, files: fileIds.map((f) => ({ id: f })) };
}

/** סרטון שהועלה לאתר לפני שהסרטונים עברו לקישורי Drive בלבד — קובץ ב-R2 ושורות ב-D1 */
export async function legacyVideo(client: Client, bytes: Uint8Array, name: string, mime: string, extra: { title?: string } = {}) {
  const { env } = await import('cloudflare:test');
  const id = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const userId = await userIdOf(client);
  const t = Date.now();
  const key = `originals/video/legacy/${fileId}.mp4`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO items (id, kind, title, created_by, created_at, updated_at) VALUES (?, 'video', ?, ?, ?, ?)").bind(id, extra.title ?? name, userId, t, t),
    env.DB.prepare(
      `INSERT INTO files (id, item_id, role, r2_key, mime, size, sha256, original_name, created_by, created_at)
       VALUES (?, ?, 'original', ?, ?, ?, NULL, ?, ?, ?)`,
    ).bind(fileId, id, key, mime, bytes.length, name, userId, t),
    env.DB.prepare("INSERT INTO transcripts (item_id, status, updated_at) VALUES (?, 'none', ?)").bind(id, t),
  ]);
  const { reindexItem } = await import('../../worker/lib/search');
  await reindexItem(env.DB, id);
  return { id, files: [{ id: fileId }] };
}

let driveSeq = 0;
/** תמונה בגלריה מ-Google Drive (כאילו סונכרנה) — שורה ב-items וב-drive_photos */
export async function drivePhoto(client: Client, extra: { title?: string; dateYear?: number; width?: number; height?: number } = {}) {
  const { env } = await import('cloudflare:test');
  const id = crypto.randomUUID();
  const fileId = `1TestDrivePhoto${String(++driveSeq).padStart(6, '0')}abcdefgh`;
  const userId = await userIdOf(client);
  const t = Date.now() + driveSeq;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO items (id, kind, title, date_year, created_by, created_at, updated_at) VALUES (?, 'photo', ?, ?, ?, ?, ?)").bind(id, extra.title ?? '', extra.dateYear ?? null, userId, t, t),
    env.DB.prepare('INSERT INTO drive_photos (file_id, item_id, mime, width, height, size, first_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(fileId, id, 'image/jpeg', extra.width ?? 1200, extra.height ?? 900, 1000, t),
  ]);
  return { id, fileId };
}

/** העלאת תמונה של סיפור (נתיב הסיפורים) */
export async function storyImageUpload(client: Client, bytes: Uint8Array = PNG, name = 'story.png', mime = 'image/png') {
  const res = await upload(client, 'story', bytes, name, mime);
  if (res.status !== 200) throw new Error(`story upload failed ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string };
}
