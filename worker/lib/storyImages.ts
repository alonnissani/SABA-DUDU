import type { StoryImage } from '../../shared/types';
import { fail, intOrNull, newId, now, placeholders } from './http';
import { STORY_PREFIX } from './validation';

/**
 * תמונות של סיפורים — מערכת נפרדת לחלוטין מגלריית התמונות:
 * הקבצים נשמרים ב-R2 תחת stories/, משויכים לסיפור עצמו (files.item_id = מזהה הסיפור)
 * ומנוהלים בטבלה story_images. הם לא פריטי ״תמונה״, לא מופיעים בגלריה, ב״זיכרון מסבא״ או בסנכרון הדרייב.
 */

export interface StoryImageInput {
  fileId: string;
  thumbId: string | null;
  width: number | null;
  height: number | null;
}

interface FileCheckRow {
  id: string;
  role: string;
  mime: string;
  r2_key: string;
  created_by: string;
  item_id: string | null;
}

/** בדיקת קבצים שהועלו לסיפור: של המשתמש, עדיין לא שויכו, בנתיב הסיפורים, ותמונות */
export async function parseStoryImageInputs(db: D1Database, userId: string, raw: unknown, max = 20): Promise<StoryImageInput[]> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) fail(400, 'תמונות לא תקינות');
  const list = raw.slice(0, max).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    if (typeof o.fileId !== 'string') fail(400, 'תמונה לא תקינה');
    return {
      fileId: o.fileId,
      thumbId: typeof o.thumbId === 'string' ? o.thumbId : null,
      width: intOrNull(o.width, 'רוחב', 1, 100000),
      height: intOrNull(o.height, 'גובה', 1, 100000),
    };
  });
  const ids = list.flatMap((i) => [i.fileId, ...(i.thumbId ? [i.thumbId] : [])]);
  if (!ids.length) return [];
  if (new Set(ids).size !== ids.length) fail(400, 'תמונה כפולה');
  const rows = await db
    .prepare(`SELECT id, role, mime, r2_key, created_by, item_id FROM files WHERE id IN (${placeholders(ids.length)})`)
    .bind(...ids)
    .all<FileCheckRow>();
  const byId = new Map(rows.results.map((r) => [r.id, r]));
  for (const img of list) {
    const f = byId.get(img.fileId);
    if (!f || f.created_by !== userId || f.item_id || f.role !== 'original' || !f.r2_key.startsWith(STORY_PREFIX) || !f.mime.startsWith('image/')) {
      fail(400, 'תמונת הסיפור לא נמצאה או כבר שויכה');
    }
    if (img.thumbId) {
      const t = byId.get(img.thumbId);
      if (!t || t.created_by !== userId || t.item_id || t.role !== 'thumb' || !t.r2_key.startsWith(STORY_PREFIX)) fail(400, 'תמונה ממוזערת לא תקינה');
    }
  }
  return list;
}

/** שיוך התמונות לסיפור. firstPosition — מיקום הראשונה (קטן יותר = מוקדם יותר; הראשונה היא תמונת הסיפור) */
export function attachStoryImages(db: D1Database, storyId: string, userId: string, images: StoryImageInput[], firstPosition = 0): D1PreparedStatement[] {
  const t = now();
  return images.flatMap((img, i) => [
    db.prepare('UPDATE files SET item_id = ?, width = COALESCE(?, width), height = COALESCE(?, height) WHERE id = ? AND item_id IS NULL').bind(storyId, img.width, img.height, img.fileId),
    ...(img.thumbId ? [db.prepare('UPDATE files SET item_id = ? WHERE id = ? AND item_id IS NULL').bind(storyId, img.thumbId)] : []),
    db
      .prepare('INSERT INTO story_images (id, story_id, file_id, thumb_file_id, width, height, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(newId(), storyId, img.fileId, img.thumbId, img.width, img.height, firstPosition + i, userId, t),
  ]);
}

/** תמונות הסיפורים לפי סדר */
export async function loadStoryImages(db: D1Database, storyIds: string[]): Promise<Map<string, StoryImage[]>> {
  const out = new Map<string, StoryImage[]>();
  if (!storyIds.length) return out;
  const res = await db
    .prepare(
      `SELECT s.id, s.story_id, s.file_id, s.thumb_file_id, COALESCE(s.width, f.width) AS width, COALESCE(s.height, f.height) AS height, f.mime
       FROM story_images s JOIN files f ON f.id = s.file_id
       WHERE s.story_id IN (${placeholders(storyIds.length)}) ORDER BY s.story_id, s.position, s.created_at`,
    )
    .bind(...storyIds)
    .all<{ id: string; story_id: string; file_id: string; thumb_file_id: string | null; width: number | null; height: number | null; mime: string }>();
  for (const r of res.results) {
    const list = out.get(r.story_id) ?? [];
    list.push({ id: r.id, fileId: r.file_id, thumbId: r.thumb_file_id, width: r.width, height: r.height, mime: r.mime });
    out.set(r.story_id, list);
  }
  return out;
}

export async function minStoryImagePosition(db: D1Database, storyId: string): Promise<number> {
  const r = await db.prepare('SELECT MIN(position) AS m FROM story_images WHERE story_id = ?').bind(storyId).first<{ m: number | null }>();
  return r?.m ?? 0;
}

/** הסרת תמונה מסיפור: השורה, שורות הקבצים והאובייקטים ב-R2 (רק בנתיב הסיפורים) */
export async function removeStoryImage(db: D1Database, bucket: R2Bucket, storyId: string, imageId: string): Promise<void> {
  const img = await db
    .prepare('SELECT id, file_id, thumb_file_id FROM story_images WHERE id = ? AND story_id = ?')
    .bind(imageId, storyId)
    .first<{ id: string; file_id: string; thumb_file_id: string | null }>();
  if (!img) fail(404, 'התמונה לא נמצאה בסיפור');
  const fileIds = [img.file_id, ...(img.thumb_file_id ? [img.thumb_file_id] : [])];
  const files = await db
    .prepare(`SELECT id, r2_key FROM files WHERE id IN (${placeholders(fileIds.length)}) AND item_id = ?`)
    .bind(...fileIds, storyId)
    .all<{ id: string; r2_key: string }>();
  await db.batch([
    db.prepare('DELETE FROM story_images WHERE id = ?').bind(img.id),
    ...files.results.map((f) => db.prepare('DELETE FROM files WHERE id = ?').bind(f.id)),
  ]);
  const keys = files.results.map((f) => f.r2_key).filter((k) => k.startsWith(STORY_PREFIX));
  if (keys.length) await bucket.delete(keys);
}
