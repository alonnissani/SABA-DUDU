import type { Env } from '../env';
import type { DriveStatus } from '../../shared/types';
import type { DriveFolderRef } from '../../shared/drive';
import { driveFolderUrl } from '../../shared/drive';
import { newId, now } from './http';
import { getSetting, setSetting } from './settings';

/**
 * חיבור לתיקיית Google Drive משפחתית (משותפת ל״כל מי שיש לו את הקישור״).
 * Drive API מחייב מפתח API גם לתיקייה ציבורית — המפתח נשמר כסוד ב-Worker בלבד ולא מגיע לדפדפן.
 * בסנכרון נשמרים ב-D1 רק מזהים ונתונים בסיסיים; התמונות עצמן נשארות בדרייב.
 */

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
/** מגבלות בטיחות לסריקה אחת */
const MAX_FOLDERS = 500;
const MAX_FILES = 50_000;
/** מספר תמונות חדשות שנוספות בהרצה אחת — כדי לא לחרוג ממשאבי ה-Worker; ההמשך בהרצה הבאה */
export const MAX_NEW_PER_RUN = 400;
const LOCK_MS = 5 * 60 * 1000;

export interface DriveFolderSetting extends DriveFolderRef {
  url: string;
  name: string;
  ownerId: string;
  connectedAt: number;
}

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

const apiBase = (env: Env) => env.DRIVE_API_BASE ?? 'https://www.googleapis.com';
const imageBase = (env: Env) => env.DRIVE_IMAGE_BASE ?? 'https://lh3.googleusercontent.com';

function requireKey(env: Env): string {
  if (!env.GOOGLE_DRIVE_API_KEY) throw new DriveError('לא הוגדר מפתח Google API באתר (GOOGLE_DRIVE_API_KEY). ראו את ההוראות בהגדרות.', 503);
  return env.GOOGLE_DRIVE_API_KEY;
}

/** הודעת שגיאה ברורה בעברית לפי תשובת Google */
function explain(status: number, body: string): string {
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(body)) return 'מפתח ה-API של Google אינו תקין.';
  if (status === 403 && /SERVICE_DISABLED|accessNotConfigured|has not been used/i.test(body)) return 'Google Drive API לא הופעל בפרויקט ב-Google Cloud.';
  if (status === 403 && /API_KEY_SERVICE_BLOCKED|blocked/i.test(body)) return 'מפתח ה-API מוגבל ואינו מורשה ל-Google Drive API.';
  if (status === 429 || /rateLimit|userRateLimit|quota/i.test(body)) return 'חריגה זמנית ממכסת הבקשות של Google — הסנכרון יתבצע שוב בהמשך.';
  if (status === 404) return 'התיקייה לא נמצאה. ודאו שהקישור נכון ושהתיקייה משותפת עם ״כל מי שיש לו את הקישור״.';
  if (status === 403) return 'אין גישה לתיקייה. ודאו שהיא משותפת עם ״כל מי שיש לו את הקישור״ (צפייה).';
  return `שגיאה מ-Google Drive (${status}).`;
}

async function driveGet<T>(env: Env, path: string, params: Record<string, string>, resourceKeys: string[] = []): Promise<T> {
  const url = new URL(`${apiBase(env)}/drive/v3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('key', requireKey(env));
  const headers: Record<string, string> = {};
  if (resourceKeys.length) headers['X-Goog-Drive-Resource-Keys'] = resourceKeys.join(',');
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    throw new DriveError('אין חיבור ל-Google Drive כרגע — נסו שוב בעוד כמה דקות.');
  }
  if (!res.ok) throw new DriveError(explain(res.status, await res.text().catch(() => '')), res.status === 404 ? 404 : 502);
  return res.json() as Promise<T>;
}

/** בדיקת גישה לתיקייה — מחזיר את שמה */
export async function checkFolder(env: Env, ref: DriveFolderRef): Promise<string> {
  const rk = ref.resourceKey ? [`${ref.folderId}/${ref.resourceKey}`] : [];
  const meta = await driveGet<{ id: string; name: string; mimeType: string }>(env, `files/${ref.folderId}`, { fields: 'id,name,mimeType', supportsAllDrives: 'true' }, rk);
  if (meta.mimeType !== FOLDER_MIME) throw new DriveError('הקישור מוביל לקובץ ולא לתיקייה. העתיקו את הקישור של התיקייה עצמה.', 400);
  return meta.name;
}

interface ApiFile {
  id: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  resourceKey?: string;
  imageMediaMetadata?: { width?: number; height?: number; rotation?: number; time?: string };
  shortcutDetails?: { targetId: string; targetMimeType: string; targetResourceKey?: string };
}

export interface DriveImage {
  id: string;
  mime: string;
  width: number | null;
  height: number | null;
  size: number | null;
  createdTime: number | null;
  resourceKey: string | null;
  year: number | null;
}

/** תאריך הצילום מנתוני EXIF (״2019:07:14 10:22:31״) — לשנה בלבד, לסינון לפי עשורים */
function exifYear(t: string | undefined): number | null {
  const y = t ? Number(t.slice(0, 4)) : NaN;
  return y >= 1850 && y <= 2200 ? y : null;
}

function toImage(f: ApiFile): DriveImage | null {
  if (f.mimeType === SHORTCUT_MIME && f.shortcutDetails?.targetMimeType.startsWith('image/')) {
    return { id: f.shortcutDetails.targetId, mime: f.shortcutDetails.targetMimeType, width: null, height: null, size: null, createdTime: null, resourceKey: f.shortcutDetails.targetResourceKey ?? null, year: null };
  }
  if (!f.mimeType.startsWith('image/')) return null;
  const m = f.imageMediaMetadata ?? {};
  // סיבוב של 90°/270° — הממדים מתחלפים
  const swap = (m.rotation ?? 0) % 2 === 1;
  const w = m.width ?? null;
  const h = m.height ?? null;
  return {
    id: f.id,
    mime: f.mimeType,
    width: swap ? h : w,
    height: swap ? w : h,
    size: f.size ? Number(f.size) : null,
    createdTime: f.createdTime ? Date.parse(f.createdTime) || null : null,
    resourceKey: f.resourceKey ?? null,
    year: exifYear(m.time),
  };
}

/** כל התמונות בתיקייה ובתיקיות המשנה. complete=false אם הסריקה נקטעה בגלל מגבלת בטיחות. */
export async function listImages(env: Env, ref: DriveFolderRef): Promise<{ images: DriveImage[]; complete: boolean }> {
  const queue: { id: string; rk: string | null }[] = [{ id: ref.folderId, rk: ref.resourceKey }];
  const seenFolders = new Set<string>([ref.folderId]);
  const images = new Map<string, DriveImage>();
  let complete = true;
  while (queue.length) {
    const folder = queue.shift()!;
    let pageToken: string | undefined;
    do {
      const page = await driveGet<{ files: ApiFile[]; nextPageToken?: string }>(
        env,
        'files',
        {
          q: `'${folder.id}' in parents and trashed = false and (mimeType contains 'image/' or mimeType = '${FOLDER_MIME}' or mimeType = '${SHORTCUT_MIME}')`,
          // רק השדות הנחוצים — חוסך תעבורה ועיבוד
          fields: 'nextPageToken,files(id,mimeType,size,createdTime,resourceKey,imageMediaMetadata(width,height,rotation,time),shortcutDetails(targetId,targetMimeType,targetResourceKey))',
          pageSize: '1000',
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
          ...(pageToken ? { pageToken } : {}),
        },
        folder.rk ? [`${folder.id}/${folder.rk}`] : [],
      );
      for (const f of page.files ?? []) {
        if (f.mimeType === FOLDER_MIME) {
          if (seenFolders.has(f.id)) continue;
          if (seenFolders.size >= MAX_FOLDERS) {
            complete = false;
            continue;
          }
          seenFolders.add(f.id);
          queue.push({ id: f.id, rk: f.resourceKey ?? null });
        } else {
          const img = toImage(f);
          if (img && !images.has(img.id)) images.set(img.id, img);
          if (images.size >= MAX_FILES) return { images: [...images.values()], complete: false };
        }
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
  }
  return { images: [...images.values()], complete };
}

// ---------- הגדרות ומצב ----------

export async function getDriveFolder(db: D1Database): Promise<DriveFolderSetting | null> {
  const raw = await getSetting(db, 'drive_folder');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DriveFolderSetting;
  } catch {
    return null;
  }
}

export async function setDriveFolder(db: D1Database, folder: DriveFolderSetting): Promise<void> {
  await setSetting(db, 'drive_folder', JSON.stringify(folder), folder.ownerId);
}

const EMPTY_STATUS: Omit<DriveStatus, 'apiKeyConfigured' | 'folder'> = {
  state: 'disconnected',
  lastSyncAt: null,
  lastAttemptAt: null,
  lastError: null,
  photoCount: 0,
  added: 0,
  removed: 0,
  pending: 0,
};

async function readStatus(db: D1Database): Promise<typeof EMPTY_STATUS> {
  try {
    return { ...EMPTY_STATUS, ...(JSON.parse((await getSetting(db, 'drive_status')) || '{}') as Partial<typeof EMPTY_STATUS>) };
  } catch {
    return { ...EMPTY_STATUS };
  }
}

export async function getDriveStatus(env: Env): Promise<DriveStatus> {
  const folder = await getDriveFolder(env.DB);
  const s = await readStatus(env.DB);
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM drive_photos d JOIN items i ON i.id = d.item_id WHERE d.removed_at IS NULL AND i.deleted_at IS NULL`,
  ).first<{ n: number }>();
  return {
    ...s,
    state: folder ? s.state : 'disconnected',
    photoCount: count?.n ?? 0,
    apiKeyConfigured: Boolean(env.GOOGLE_DRIVE_API_KEY),
    folder: folder ? { url: folder.url, name: folder.name, connectedAt: folder.connectedAt } : null,
  };
}

/** קישור התיקייה להצגה לבני המשפחה (כפתור ״הוספת תמונות לדרייב״) — רק אחרי סנכרון מוצלח */
export async function publicDriveFolderUrl(db: D1Database): Promise<string | null> {
  const folder = await getDriveFolder(db);
  if (!folder) return null;
  const s = await readStatus(db);
  return s.lastSyncAt ? folder.url : null;
}

// ---------- סנכרון ----------

export interface SyncResult {
  ok: boolean;
  message: string;
  added: number;
  removed: number;
  restored: number;
  pending: number;
  total: number;
}

/** מנעול פשוט ב-settings — כדי שסנכרון ידני ותזמון לא ירוצו יחד */
async function acquireLock(db: D1Database, userId: string): Promise<boolean> {
  const t = now();
  const res = await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('drive_lock', ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
       WHERE CAST(settings.value AS INTEGER) < ?`,
    )
    .bind(String(t), t, userId, t - LOCK_MS)
    .run();
  return res.meta.changes > 0;
}
const releaseLock = (db: D1Database) => db.prepare(`UPDATE settings SET value = '0' WHERE key = 'drive_lock'`).run();

/**
 * סנכרון התיקייה: מוסיף תמונות חדשות, מסתיר תמונות שהוסרו ומחזיר תמונות שחזרו.
 * בכשל (רשת, מכסה, הרשאות) — הרשימה הקיימת לא משתנה. כתיבות ל-D1 רק כשיש שינוי.
 */
export async function syncDrive(env: Env, opts: { maxNew?: number } = {}): Promise<SyncResult> {
  const db = env.DB;
  const folder = await getDriveFolder(db);
  if (!folder) return { ok: false, message: 'לא חוברה תיקיית Google Drive.', added: 0, removed: 0, restored: 0, pending: 0, total: 0 };
  if (!(await acquireLock(db, folder.ownerId))) {
    return { ok: false, message: 'סנכרון כבר מתבצע כרגע — נסו שוב בעוד דקה.', added: 0, removed: 0, restored: 0, pending: 0, total: 0 };
  }
  const prev = await readStatus(db);
  const attemptAt = now();
  try {
    const { images, complete } = await listImages(env, folder);
    const existing = (
      await db
        .prepare(`SELECT d.file_id, d.item_id, d.removed_at, i.deleted_at, i.deleted_by FROM drive_photos d JOIN items i ON i.id = d.item_id`)
        .all<{ file_id: string; item_id: string; removed_at: number | null; deleted_at: number | null; deleted_by: string | null }>()
    ).results;
    const known = new Map(existing.map((e) => [e.file_id, e]));
    const listed = new Set(images.map((i) => i.id));
    const stmts: D1PreparedStatement[] = [];
    const t = now();

    // חדשות — הוותיקות קודם, ועד מכסה להרצה אחת
    const fresh = images.filter((i) => !known.has(i.id)).sort((a, b) => (a.createdTime ?? 0) - (b.createdTime ?? 0));
    const maxNew = opts.maxNew ?? MAX_NEW_PER_RUN;
    const toAdd = fresh.slice(0, maxNew);
    for (const img of toAdd) {
      const itemId = newId();
      stmts.push(
        db
          .prepare(`INSERT INTO items (id, kind, title, date_year, created_by, created_at, updated_at) VALUES (?, 'photo', '', ?, ?, ?, ?)`)
          .bind(itemId, img.year, folder.ownerId, img.createdTime ?? t, t),
        db
          .prepare(
            `INSERT INTO drive_photos (file_id, item_id, mime, width, height, size, resource_key, created_time, first_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(img.id, itemId, img.mime, img.width, img.height, img.size, img.resourceKey, img.createdTime, t),
      );
    }

    // הוסרו מהדרייב — מוסתרות (לא נמחקות). רק כשהסריקה מלאה, ולא כשהתיקייה נראית ריקה פתאום.
    let removed = 0;
    let note = '';
    const gone = existing.filter((e) => e.removed_at === null && !listed.has(e.file_id));
    if (gone.length && complete && images.length > 0) {
      for (const e of gone) {
        stmts.push(db.prepare('UPDATE drive_photos SET removed_at = ? WHERE file_id = ?').bind(t, e.file_id));
        // הסתרה ״של המערכת״ (deleted_by ריק) — כדי שתוכל לחזור אוטומטית אם התמונה תופיע שוב
        stmts.push(db.prepare('UPDATE items SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').bind(t, e.item_id));
        removed++;
      }
    } else if (gone.length && images.length === 0) {
      note = ' התיקייה נראית ריקה — לא הוסרו תמונות מהאתר, ליתר ביטחון.';
    }

    // חזרו לדרייב
    let restored = 0;
    for (const e of existing) {
      if (e.removed_at !== null && listed.has(e.file_id)) {
        stmts.push(db.prepare('UPDATE drive_photos SET removed_at = NULL WHERE file_id = ?').bind(e.file_id));
        if (e.deleted_at && !e.deleted_by) stmts.push(db.prepare('UPDATE items SET deleted_at = NULL WHERE id = ?').bind(e.item_id));
        restored++;
      }
    }

    for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));

    const pending = fresh.length - toAdd.length;
    const total = images.length;
    const message =
      `הסנכרון הושלם: ${total} תמונות בתיקייה` +
      (toAdd.length ? `, ${toAdd.length} חדשות נוספו` : '') +
      (removed ? `, ${removed} הוסרו מהתצוגה` : '') +
      (restored ? `, ${restored} חזרו` : '') +
      (pending ? `. עוד ${pending} תמונות ממתינות ויתווספו בסנכרון הבא.` : '.') +
      (complete ? '' : ' (התיקייה גדולה מאוד — חלק מהתיקיות לא נסרקו.)') +
      note;
    await setSetting(
      db,
      'drive_status',
      JSON.stringify({ ...prev, state: 'ok', lastSyncAt: t, lastAttemptAt: attemptAt, lastError: null, added: toAdd.length, removed, pending }),
      folder.ownerId,
    );
    return { ok: true, message, added: toAdd.length, removed, restored, pending, total };
  } catch (e) {
    const message = e instanceof DriveError ? e.message : 'שגיאה לא צפויה בסנכרון.';
    if (!(e instanceof DriveError)) console.error('drive sync', e);
    // הרשימה הקיימת נשארת כמו שהיא — רק המצב מתעדכן
    await setSetting(db, 'drive_status', JSON.stringify({ ...prev, state: 'error', lastAttemptAt: attemptAt, lastError: message }), folder.ownerId);
    return { ok: false, message, added: 0, removed: 0, restored: 0, pending: prev.pending, total: 0 };
  } finally {
    await releaseLock(db);
  }
}

/** סנכרון מתוזמן (Cron) — רק אם חוברה תיקייה ויש מפתח */
export async function scheduledDriveSync(env: Env): Promise<void> {
  if (!env.GOOGLE_DRIVE_API_KEY) return;
  if (!(await getDriveFolder(env.DB))) return;
  const r = await syncDrive(env);
  if (!r.ok) console.warn('drive sync:', r.message);
}

// ---------- הגשת תמונות ----------

const THUMB_PX = 800;
const FULL_PX = 2400;

/**
 * תמונה מהדרייב דרך ה-Worker: ממוזערת (800px) או תצוגה גדולה (2400px), בפורמט שהדפדפן מציג (גם ל-HEIC).
 * הכתובת של גוגל לפי מזהה הקובץ יציבה; אם היא נכשלת — דרך ה-API הרשמי (thumbnailLink טרי, לא נשמר).
 * המטמון: בדפדפן בלבד (private), בלי עותק ב-R2.
 */
export async function fetchDriveImage(env: Env, fileId: string, role: 'original' | 'thumb', resourceKey: string | null): Promise<Response> {
  const px = role === 'thumb' ? THUMB_PX : FULL_PX;
  const isImage = (r: Response) => r.ok && (r.headers.get('content-type') ?? '').startsWith('image/');
  let res: Response | null = null;
  try {
    const u = new URL(`${imageBase(env)}/d/${fileId}=s${px}`);
    if (resourceKey) u.searchParams.set('resourcekey', resourceKey);
    res = await fetch(u, { cf: { cacheEverything: true, cacheTtl: 86400 } } as RequestInit);
  } catch {
    res = null;
  }
  if (!res || !isImage(res)) {
    if (env.GOOGLE_DRIVE_API_KEY) {
      try {
        const meta = await driveGet<{ thumbnailLink?: string }>(env, `files/${fileId}`, { fields: 'thumbnailLink', supportsAllDrives: 'true' }, resourceKey ? [`${fileId}/${resourceKey}`] : []);
        if (meta.thumbnailLink) res = await fetch(meta.thumbnailLink.replace(/=s\d+$/, `=s${px}`));
      } catch {
        /* נשאר הכישלון המקורי */
      }
    }
  }
  if (!res || !isImage(res)) return new Response('לא ניתן לטעון את התמונה מ-Google Drive', { status: 502, headers: { 'cache-control': 'no-store' } });
  const headers = new Headers();
  headers.set('content-type', res.headers.get('content-type') ?? 'image/jpeg');
  const len = res.headers.get('content-length');
  if (len) headers.set('content-length', len);
  headers.set('cache-control', 'private, max-age=604800');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(res.body, { status: 200, headers });
}

export const driveDownloadUrl = (fileId: string, resourceKey: string | null) =>
  `https://drive.google.com/uc?export=download&id=${fileId}${resourceKey ? `&resourcekey=${resourceKey}` : ''}`;

export { driveFolderUrl };
