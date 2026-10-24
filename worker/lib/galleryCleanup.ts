import type { Env } from '../env';
import { fail, newId, now, placeholders } from './http';
import { getSetting, setSetting, parseHomePhotos } from './settings';
import { fetchDriveImage, getDriveFolder, getDriveStatus } from './drive';
import { STORY_PREFIX, storageKey } from './validation';
import { minStoryImagePosition } from './storyImages';

/**
 * מעבר הגלריה ל-Google Drive וניקוי האחסון הישן — בשלושה שלבים, למנהל בלבד:
 * 1. דוח (בלי שינויים)
 * 2. הפרדת תמונות הסיפורים: לכל תמונת גלריה שמצורפת לסיפור נוצר עותק עצמאי של הסיפור ב-R2 (stories/),
 *    העותק נבדק, ורק אז הקישור הישן מוסר.
 * 3. מחיקת תמונות הגלריה הישנות (R2 + D1) — רק פריטים שזוהו בוודאות כגלריה ישנה ושאינם בשימוש של סיפור.
 * לא נמחק שום דבר מ-Google Drive, ולא נוגעים במסמכים, סרטונים, הקלטות או סיפורים.
 */

/** פריט ״גלריה ישנה״ בוודאות: תמונה שאינה מהדרייב ושאף סיפור לא מצביע עליה */
const LEGACY_PHOTO = `i.kind = 'photo' AND NOT EXISTS (SELECT 1 FROM drive_photos dp WHERE dp.item_id = i.id)`;

export interface CleanupReport {
  drive: { connected: boolean; lastSyncOk: boolean; photos: number };
  legacy: { photos: number; files: number; bytes: number };
  storyLinkedPhotos: number;
  storyImages: number;
  heroProtected: boolean;
  deleted: { items: number; files: number; bytes: number; lastRunAt: number | null };
  blockers: string[];
}

async function readDeleted(db: D1Database): Promise<CleanupReport['deleted']> {
  try {
    return { items: 0, files: 0, bytes: 0, lastRunAt: null, ...JSON.parse((await getSetting(db, 'gallery_cleanup')) || '{}') };
  } catch {
    return { items: 0, files: 0, bytes: 0, lastRunAt: null };
  }
}

export async function cleanupReport(env: Env): Promise<CleanupReport> {
  const db = env.DB;
  const status = await getDriveStatus(env);
  const heroId = await getSetting(db, 'hero_file_id');
  const [legacy, legacyFiles, linked, storyImgs, hero] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n FROM items i WHERE ${LEGACY_PHOTO}`),
    db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(f.size), 0) AS bytes FROM files f JOIN items i ON i.id = f.item_id WHERE ${LEGACY_PHOTO} AND f.r2_key NOT LIKE '${STORY_PREFIX}%'`),
    db.prepare(`SELECT COUNT(*) AS n FROM item_links l JOIN items i ON i.id = l.item_id WHERE i.kind = 'photo'`),
    db.prepare('SELECT COUNT(*) AS n FROM story_images'),
    db.prepare(`SELECT COUNT(*) AS n FROM files f JOIN items i ON i.id = f.item_id WHERE f.id = ? AND ${LEGACY_PHOTO}`).bind(heroId || '-'),
  ]);
  const n = (r: D1Result) => (r.results[0] as { n: number }).n;
  const report: CleanupReport = {
    drive: { connected: status.state !== 'disconnected', lastSyncOk: status.state === 'ok' && status.lastSyncAt !== null, photos: status.photoCount },
    legacy: { photos: n(legacy), files: n(legacyFiles), bytes: (legacyFiles.results[0] as { bytes: number }).bytes },
    storyLinkedPhotos: n(linked),
    storyImages: n(storyImgs),
    heroProtected: n(hero) > 0,
    deleted: await readDeleted(db),
    blockers: [],
  };
  if (!report.drive.connected) report.blockers.push('תיקיית Google Drive עדיין לא חוברה.');
  else if (!report.drive.lastSyncOk) report.blockers.push('הסנכרון האחרון עם Google Drive לא הצליח — סנכרנו בהצלחה לפני ניקוי.');
  if (report.drive.photos === 0) report.blockers.push('בגלריית הדרייב עדיין אין תמונות.');
  if (report.storyLinkedPhotos > 0) report.blockers.push(`${report.storyLinkedPhotos} תמונות גלריה עדיין מצורפות לסיפורים — יש להריץ קודם את ״הפרדת תמונות הסיפורים״.`);
  return report;
}

// ---------- שלב 2: הפרדת תמונות הסיפורים ----------

interface LinkRow {
  story_id: string;
  item_id: string;
  position: number;
  created_by: string;
  drive_file: string | null;
  drive_rk: string | null;
}

async function putStoryFile(
  env: Env,
  body: ArrayBuffer,
  meta: { role: 'original' | 'thumb'; mime: string; name: string; width: number | null; height: number | null; storyId: string; userId: string },
): Promise<string> {
  const id = newId();
  const key = storageKey('photo', meta.role, id, meta.mime, meta.name, true);
  await env.MEDIA.put(key, body, { httpMetadata: { contentType: meta.mime }, customMetadata: { originalName: encodeURIComponent(meta.name), copiedFor: meta.storyId } });
  // אימות: העותק קיים ובגודל הנכון
  const head = await env.MEDIA.head(key);
  if (!head || head.size !== body.byteLength || body.byteLength === 0) throw new Error('copy verification failed');
  await env.DB.prepare(
    `INSERT INTO files (id, item_id, role, r2_key, mime, size, original_name, width, height, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, meta.storyId, meta.role, key, meta.mime, body.byteLength, meta.name, meta.width, meta.height, meta.userId, now())
    .run();
  return id;
}

async function copyOne(env: Env, link: LinkRow): Promise<void> {
  const db = env.DB;
  const made: string[] = [];
  try {
    let originalId: string;
    let thumbId: string | null = null;
    let width: number | null = null;
    let height: number | null = null;
    if (link.drive_file) {
      // תמונה מהדרייב — שומרים לסיפור עותק משלו (תצוגה גדולה וממוזערת)
      const full = await fetchDriveImage(env, link.drive_file, 'original', link.drive_rk);
      if (!full.ok) throw new Error('drive fetch failed');
      const dims = await db.prepare('SELECT width, height FROM drive_photos WHERE file_id = ?').bind(link.drive_file).first<{ width: number | null; height: number | null }>();
      width = dims?.width ?? null;
      height = dims?.height ?? null;
      originalId = await putStoryFile(env, await full.arrayBuffer(), { role: 'original', mime: full.headers.get('content-type') ?? 'image/jpeg', name: `story-${link.drive_file}.jpg`, width, height, storyId: link.story_id, userId: link.created_by });
      made.push(originalId);
      const thumb = await fetchDriveImage(env, link.drive_file, 'thumb', link.drive_rk);
      if (thumb.ok) {
        thumbId = await putStoryFile(env, await thumb.arrayBuffer(), { role: 'thumb', mime: thumb.headers.get('content-type') ?? 'image/jpeg', name: 'preview.jpg', width: null, height: null, storyId: link.story_id, userId: link.created_by });
        made.push(thumbId);
      }
    } else {
      const files = await db
        .prepare(`SELECT id, role, r2_key, mime, original_name, width, height FROM files WHERE item_id = ? AND role IN ('original', 'thumb')`)
        .bind(link.item_id)
        .all<{ id: string; role: 'original' | 'thumb'; r2_key: string; mime: string; original_name: string; width: number | null; height: number | null }>();
      const orig = files.results.find((f) => f.role === 'original');
      if (!orig) throw new Error('no original');
      const copy = async (f: typeof orig) => {
        const obj = await env.MEDIA.get(f.r2_key);
        if (!obj) throw new Error('missing object');
        return putStoryFile(env, await obj.arrayBuffer(), { role: f.role, mime: f.mime, name: f.original_name, width: f.width, height: f.height, storyId: link.story_id, userId: link.created_by });
      };
      width = orig.width;
      height = orig.height;
      originalId = await copy(orig);
      made.push(originalId);
      const t = files.results.find((f) => f.role === 'thumb');
      if (t) {
        thumbId = await copy(t);
        made.push(thumbId);
      }
    }
    // הסדר נשמר: תמונות שהיו מצורפות נכנסות לפי מיקומן, אחרי תמונות הסיפור הקיימות
    const pos = link.position + (await minStoryImagePosition(db, link.story_id)) - 1000;
    await db.batch([
      db
        .prepare('INSERT INTO story_images (id, story_id, file_id, thumb_file_id, width, height, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(newId(), link.story_id, originalId, thumbId, width, height, pos, link.created_by, now()),
      // רק אחרי שהעותק נשמר ונבדק — הקישור לתמונת הגלריה מוסר
      db.prepare('DELETE FROM item_links WHERE story_id = ? AND item_id = ?').bind(link.story_id, link.item_id),
    ]);
  } catch (e) {
    // כשל: מנקים עותקים חלקיים; הקישור הישן נשאר, ולכן התמונה המקורית לא תימחק בשלב הניקוי
    if (made.length) {
      const rows = await db.prepare(`SELECT r2_key FROM files WHERE id IN (${placeholders(made.length)})`).bind(...made).all<{ r2_key: string }>();
      await db.prepare(`DELETE FROM files WHERE id IN (${placeholders(made.length)})`).bind(...made).run();
      await env.MEDIA.delete(rows.results.map((r) => r.r2_key));
    }
    throw e;
  }
}

export async function separateStoryImages(env: Env, limit = 15): Promise<{ copied: number; failed: number; remaining: number }> {
  const db = env.DB;
  const links = await db
    .prepare(
      `SELECT l.story_id, l.item_id, l.position, s.created_by, dp.file_id AS drive_file, dp.resource_key AS drive_rk
       FROM item_links l JOIN items i ON i.id = l.item_id AND i.kind = 'photo'
       JOIN items s ON s.id = l.story_id
       LEFT JOIN drive_photos dp ON dp.item_id = i.id
       ORDER BY l.story_id, l.position LIMIT ?`,
    )
    .bind(limit)
    .all<LinkRow>();
  let copied = 0;
  let failed = 0;
  for (const link of links.results) {
    try {
      await copyOne(env, link);
      copied++;
    } catch (e) {
      console.error('story image copy', link.story_id, link.item_id, e);
      failed++;
    }
  }
  const left = await db.prepare(`SELECT COUNT(*) AS n FROM item_links l JOIN items i ON i.id = l.item_id WHERE i.kind = 'photo'`).first<{ n: number }>();
  return { copied, failed, remaining: left?.n ?? 0 };
}

// ---------- שלב 3: מחיקת האחסון הישן ----------

export async function deleteLegacyGallery(env: Env, userId: string, limit = 40): Promise<{ items: number; files: number; bytes: number; remaining: number }> {
  const db = env.DB;
  const report = await cleanupReport(env);
  if (report.blockers.length) fail(409, report.blockers.join(' '));
  if (!(await getDriveFolder(db))) fail(409, 'תיקיית Google Drive לא מחוברת.');
  const heroId = await getSetting(db, 'hero_file_id');
  const items = await db
    .prepare(`SELECT i.id FROM items i WHERE ${LEGACY_PHOTO} AND NOT EXISTS (SELECT 1 FROM item_links l WHERE l.item_id = i.id) LIMIT ?`)
    .bind(limit)
    .all<{ id: string }>();
  const ids = items.results.map((r) => r.id);
  let files = 0;
  let bytes = 0;
  if (ids.length) {
    const ph = placeholders(ids.length);
    const rows = await db
      .prepare(`SELECT id, r2_key, size FROM files WHERE item_id IN (${ph})`)
      .bind(...ids)
      .all<{ id: string; r2_key: string; size: number }>();
    // התמונה הראשית של האתר נשמרת: הקובץ מנותק מהפריט ולא נמחק. קבצים בנתיב הסיפורים לעולם לא נמחקים כאן.
    const keep = rows.results.filter((f) => f.id === heroId || f.r2_key.startsWith(STORY_PREFIX));
    const drop = rows.results.filter((f) => !keep.includes(f));
    if (drop.length) await env.MEDIA.delete(drop.map((f) => f.r2_key));
    files = drop.length;
    bytes = drop.reduce((a, f) => a + f.size, 0);
    await db.batch([
      ...keep.map((f) => db.prepare('UPDATE files SET item_id = NULL WHERE id = ?').bind(f.id)),
      ...(drop.length ? [db.prepare(`DELETE FROM files WHERE id IN (${placeholders(drop.length)})`).bind(...drop.map((f) => f.id))] : []),
      db.prepare(`DELETE FROM comments WHERE item_id IN (${ph})`).bind(...ids),
      db.prepare(`DELETE FROM item_tags WHERE item_id IN (${ph})`).bind(...ids),
      db.prepare(`DELETE FROM search_index WHERE item_id IN (${ph})`).bind(...ids),
      db.prepare(`DELETE FROM items WHERE id IN (${ph}) AND kind = 'photo' AND NOT EXISTS (SELECT 1 FROM drive_photos dp WHERE dp.item_id = items.id)`).bind(...ids),
    ]);
    // הפניות לתמונות שנמחקו מאוסף ״תמונות לדף הבית״
    const home = parseHomePhotos(await getSetting(db, 'home_photos'));
    const gone = new Set(ids);
    if (home.some((h) => gone.has(h.itemId))) await setSetting(db, 'home_photos', JSON.stringify(home.filter((h) => !gone.has(h.itemId))), userId);
  }
  const prev = await readDeleted(db);
  const total = { items: prev.items + ids.length, files: prev.files + files, bytes: prev.bytes + bytes, lastRunAt: now() };
  await setSetting(db, 'gallery_cleanup', JSON.stringify(total), userId);
  const left = await db.prepare(`SELECT COUNT(*) AS n FROM items i WHERE ${LEGACY_PHOTO}`).first<{ n: number }>();
  return { items: ids.length, files, bytes, remaining: left?.n ?? 0 };
}

/** בדיקת שלמות אחרי הניקוי: קבצי סיפורים קיימים ב-R2, ואין הפניות שבורות */
export async function integrityCheck(env: Env): Promise<{ storyImagesChecked: number; missingStoryFiles: number; brokenLinks: number; orphanFiles: number }> {
  const db = env.DB;
  const imgs = await db
    .prepare('SELECT f.r2_key FROM story_images s JOIN files f ON f.id = s.file_id OR f.id = s.thumb_file_id LIMIT 500')
    .all<{ r2_key: string }>();
  let missing = 0;
  for (const r of imgs.results) if (!(await env.MEDIA.head(r.r2_key))) missing++;
  const [broken, orphan] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM item_links l LEFT JOIN items i ON i.id = l.item_id WHERE i.id IS NULL'),
    db.prepare('SELECT COUNT(*) AS n FROM story_images s LEFT JOIN files f ON f.id = s.file_id WHERE f.id IS NULL'),
  ]);
  return {
    storyImagesChecked: imgs.results.length,
    missingStoryFiles: missing,
    brokenLinks: (broken.results[0] as { n: number }).n,
    orphanFiles: (orphan.results[0] as { n: number }).n,
  };
}
