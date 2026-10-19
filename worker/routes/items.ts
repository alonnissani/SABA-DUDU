import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { ItemKind, StoryType } from '../../shared/types';
import { ALLOWED_MIME, ITEM_KINDS, STORY_TYPES } from '../../shared/constants';
import { driveViewUrl, parseDriveFileId } from '../../shared/drive';
import { requireAdmin, requireUser } from '../lib/auth';
import { audit } from '../lib/audit';
import { fail, intOrNull, newId, now, placeholders, readJson, str } from '../lib/http';
import {
  ITEM_SELECT, ensureTags, getItemDetail, getItemRow, parseTags, toSummaries, type ItemRow,
} from '../lib/items';
import { reindexItem } from '../lib/search';
import { getSetting } from '../lib/settings';
import { clearFileCaches } from './files';
import { attachStoryImages, minStoryImagePosition, parseStoryImageInputs, removeStoryImage } from '../lib/storyImages';

export const itemRoutes = new Hono<AppEnv>();

function parseKind(value: unknown, required: true): ItemKind;
function parseKind(value: unknown, required: false): ItemKind | null;
function parseKind(value: unknown, required: boolean): ItemKind | null {
  if ((value === undefined || value === null || value === '') && !required) return null;
  if (typeof value === 'string' && (ITEM_KINDS as string[]).includes(value)) return value as ItemKind;
  fail(400, 'קטגוריה לא תקינה');
}

function parseStoryType(value: unknown): StoryType {
  const found = STORY_TYPES.find((t) => t.value === value);
  if (!found) fail(400, 'יש לבחור סוג סיפור');
  return found.value;
}

const SORTS: Record<string, string> = {
  new: 'i.created_at DESC',
  old: 'i.created_at ASC',
  year_asc: 'i.date_year IS NULL, i.date_year ASC, i.created_at ASC',
  year_desc: 'i.date_year IS NULL, i.date_year DESC, i.created_at DESC',
  title: 'i.title COLLATE NOCASE ASC',
};

/**
 * סדר ״אקראי״ יציב לפי seed: גיבוב של rowid של הפריט עם ה-seed.
 * אותו seed ← אותו סדר בכל העמודים (בלי כפילויות או חוסרים בגלילה); seed חדש ← סדר חדש.
 * הסדר במסד הנתונים לא משתנה. SQLite חסר XOR, ולכן a XOR b = (a | b) - (a & b).
 */
function randomOrder(seed: number): string {
  const xor = (a: string, b: string) => `((${a}) | (${b})) - ((${a}) & (${b}))`;
  const h1 = `((${xor('i.rowid', String(seed))}) * 2654435761) % 4294967296`;
  const h2 = `((${xor(h1, `(${h1}) >> 13`)}) * 1274126177) % 4294967296`;
  return `${h2}, i.id`;
}

/** תמונות בגלריה — רק אלה שמגיעות מ-Google Drive */
const GALLERY_ONLY_DRIVE = `(i.kind != 'photo' OR EXISTS (SELECT 1 FROM drive_photos dp WHERE dp.item_id = i.id))`;

/** רשימת פריטים עם מיון וסינון. מנהל יכול לבקש deleted=1 כדי לראות את סל המחזור. */
itemRoutes.get('/items', async (c) => {
  const user = requireUser(c);
  const kind = parseKind(c.req.query('kind'), false);
  const trash = c.req.query('deleted') === '1';
  if (trash && user.role !== 'admin') fail(403, 'פעולה זו מותרת למנהל המערכת בלבד');
  // בסל המחזור לא מוצגות תמונות שהוסתרו כי הוסרו מ-Google Drive (הן חוזרות לבד אם יוחזרו לדרייב)
  const where: string[] = [
    trash
      ? 'i.deleted_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM drive_photos dp WHERE dp.item_id = i.id AND dp.removed_at IS NOT NULL)'
      : 'i.deleted_at IS NULL',
  ];
  // גלריית התמונות מגיעה רק מ-Google Drive (תמונות R2 ישנות אינן מוצגות)
  where.push(GALLERY_ONLY_DRIVE);
  const binds: unknown[] = [];
  if (kind) {
    where.push('i.kind = ?');
    binds.push(kind);
  }
  const tag = c.req.query('tag');
  if (tag) {
    where.push('EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id AND t.name = ?)');
    binds.push(tag);
  }
  const year = intOrNull(c.req.query('year'), 'שנה', 1800, 2200);
  if (year !== null) {
    where.push('i.date_year = ?');
    binds.push(year);
  }
  const decade = intOrNull(c.req.query('decade'), 'עשור', 1800, 2200);
  if (decade !== null) {
    where.push('i.date_year >= ? AND i.date_year < ?');
    binds.push(decade, decade + 10);
  }
  const storyType = c.req.query('storyType');
  if (storyType) {
    where.push('i.story_type = ?');
    binds.push(parseStoryType(storyType));
  }
  const sort = c.req.query('sort') ?? 'new';
  const order = trash
    ? 'i.deleted_at DESC'
    : sort === 'random'
      ? randomOrder(intOrNull(c.req.query('seed'), 'seed', 1, 2_147_483_647) ?? 1)
      : (SORTS[sort] ?? SORTS.new);
  const limit = intOrNull(c.req.query('limit'), 'limit', 1, 100) ?? 40;
  const offset = intOrNull(c.req.query('offset'), 'offset', 0, 1_000_000) ?? 0;
  const whereSql = where.join(' AND ');
  const [rows, total] = await c.env.DB.batch([
    c.env.DB.prepare(`${ITEM_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...binds, limit, offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM items i WHERE ${whereSql}`).bind(...binds),
  ]);
  return c.json({
    items: await toSummaries(c.env.DB, rows.results as unknown as ItemRow[]),
    total: (total.results[0] as { n: number }).n,
  });
});

/** שנים ותגיות קיימות — לסינון. */
itemRoutes.get('/facets', async (c) => {
  requireUser(c);
  const kind = parseKind(c.req.query('kind'), false);
  const kindSql = kind ? 'AND i.kind = ?' : '';
  const binds = kind ? [kind] : [];
  const [years, tags] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT date_year AS year, COUNT(*) AS n FROM items i WHERE deleted_at IS NULL AND date_year IS NOT NULL AND ${GALLERY_ONLY_DRIVE} ${kindSql}
       GROUP BY date_year ORDER BY date_year`,
    ).bind(...binds),
    c.env.DB.prepare(
      `SELECT t.id, t.name, COUNT(i.id) AS n FROM tags t JOIN item_tags it ON it.tag_id = t.id
       JOIN items i ON i.id = it.item_id WHERE i.deleted_at IS NULL AND ${GALLERY_ONLY_DRIVE} ${kindSql}
       GROUP BY t.id ORDER BY n DESC, t.name LIMIT 100`,
    ).bind(...binds),
  ]);
  return c.json({
    years: (years.results as { year: number; n: number }[]).map((y) => ({ year: y.year, count: y.n })),
    tags: (tags.results as { id: number; name: string; n: number }[]).map((t) => ({ id: t.id, name: t.name, count: t.n })),
  });
});

itemRoutes.get('/items/:id', async (c) => {
  const user = requireUser(c);
  const row = await getItemRow(c.env.DB, c.req.param('id'));
  if (!row || (row.deleted_at && user.role !== 'admin')) fail(404, 'הפריט לא נמצא');
  return c.json(await getItemDetail(c.env.DB, row, user.role === 'admin'));
});

interface CreateBody {
  kind?: unknown;
  title?: unknown;
  description?: unknown;
  body?: unknown;
  storyType?: unknown;
  dateText?: unknown;
  dateYear?: unknown;
  people?: unknown;
  tags?: unknown;
  files?: { id?: unknown; width?: unknown; height?: unknown; duration?: unknown }[];
  linkIds?: unknown;
  images?: unknown;
  externalUrl?: unknown;
}

/** קישור Google Drive לסרטון — מחזיר מזהה קובץ וכתובת מנורמלת */
function parseExternalUrl(value: unknown): { fileId: string; url: string } {
  if (typeof value !== 'string' || value.length > 2000) fail(400, 'קישור לא תקין');
  const fileId = parseDriveFileId(value);
  if (!fileId) fail(400, 'זה לא נראה כמו קישור שיתוף של קובץ ב-Google Drive. העתיקו את הקישור מ״שיתוף ← העתקת קישור״.');
  return { fileId, url: driveViewUrl(fileId) };
}

/** יצירת פריט חדש — מותר לכל משתמש מחובר. התוכן מופיע מיד לכל המשפחה. */
itemRoutes.post('/items', async (c) => {
  const user = requireUser(c);
  const b = await readJson<CreateBody>(c.req.raw);
  const kind = parseKind(b.kind, true);
  // גלריית התמונות מגיעה רק מ-Google Drive; תמונות של סיפורים מועלות עם הסיפור עצמו
  if (kind === 'photo') fail(400, 'תמונות לגלריה מגיעות מתיקיית Google Drive המשפחתית — העלו אותן לשם.');
  const title = str(b.title, 200, 'כותרת', true) ?? '';
  const description = str(b.description, 4000, 'תיאור');
  const body = kind === 'story' ? str(b.body, 50000, 'תוכן הסיפור', true) : null;
  const storyType = kind === 'story' ? parseStoryType(b.storyType) : null;
  const dateText = str(b.dateText, 80, 'תאריך');
  const dateYear = intOrNull(b.dateYear, 'שנה', 1800, 2200);
  const people = str(b.people, 500, 'אנשים');
  const tags = parseTags(b.tags);
  const db = c.env.DB;

  // אימות הקבצים: שייכים למשתמש, ממתינים, ומתאימים לקטגוריה
  const fileInputs = Array.isArray(b.files) ? b.files.slice(0, 5) : [];
  if (kind === 'story' && fileInputs.length) fail(400, 'לסיפור מצרפים פריטים קיימים, לא קבצים');
  const heroId = await getSetting(db, 'hero_file_id');
  const fileRows: { id: string; role: string; mime: string; created_by: string; item_id: string | null }[] = [];
  for (const f of fileInputs) {
    if (typeof f?.id !== 'string') fail(400, 'קובץ לא תקין');
    const row = await db.prepare('SELECT id, role, mime, created_by, item_id FROM files WHERE id = ?').bind(f.id).first<{
      id: string; role: string; mime: string; created_by: string; item_id: string | null;
    }>();
    if (!row || row.created_by !== user.id || row.item_id || row.id === heroId) fail(400, 'קובץ לא נמצא או כבר שויך');
    fileRows.push(row);
  }
  const external = kind === 'video' && b.externalUrl !== undefined && b.externalUrl !== null && b.externalUrl !== ''
    ? parseExternalUrl(b.externalUrl)
    : null;
  if (external && fileInputs.length) fail(400, 'יש לבחור קובץ או קישור — לא את שניהם');
  if (kind !== 'story' && !external) {
    const originals = fileRows.filter((f) => f.role === 'original');
    if (originals.length !== 1) fail(400, 'יש לצרף קובץ אחד');
    if (!ALLOWED_MIME[kind].includes(originals[0].mime)) fail(400, 'סוג הקובץ אינו מתאים לקטגוריה');
    if (fileRows.filter((f) => f.role !== 'original').length > 1) fail(400, 'יותר מדי תמונות תצוגה');
  }

  let linkIds: string[] = [];
  if (kind === 'story' && Array.isArray(b.linkIds)) {
    linkIds = [...new Set(b.linkIds.filter((x): x is string => typeof x === 'string'))].slice(0, 30);
    if (linkIds.length) {
      const found = await db
        // תמונות לא מצורפות כפריטי גלריה — לסיפור יש תמונות משלו (images)
        .prepare(`SELECT id FROM items WHERE id IN (${placeholders(linkIds.length)}) AND deleted_at IS NULL AND kind NOT IN ('story', 'photo')`)
        .bind(...linkIds)
        .all<{ id: string }>();
      const ok = new Set(found.results.map((r) => r.id));
      linkIds = linkIds.filter((id) => ok.has(id));
    }
  }

  const images = kind === 'story' ? await parseStoryImageInputs(db, user.id, b.images) : [];
  const id = newId();
  const t = now();
  const tagIds = await ensureTags(db, tags);
  const stmts: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO items (id, kind, title, description, body, story_type, date_text, date_year, people, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, kind, title, description, body, storyType, dateText, dateYear, people, user.id, t, t),
    ...fileInputs.map((f, i) =>
      db.prepare('UPDATE files SET item_id = ?, position = ?, width = ?, height = ?, duration = ? WHERE id = ? AND item_id IS NULL').bind(
        id,
        i,
        intOrNull(f.width, 'רוחב', 1, 100000),
        intOrNull(f.height, 'גובה', 1, 100000),
        typeof f.duration === 'number' && Number.isFinite(f.duration) && f.duration >= 0 ? f.duration : null,
        f.id as string,
      ),
    ),
    ...tagIds.map((tagId) => db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?, ?)').bind(id, tagId)),
    ...linkIds.map((linkId, i) => db.prepare('INSERT INTO item_links (story_id, item_id, position) VALUES (?, ?, ?)').bind(id, linkId, i)),
    ...attachStoryImages(db, id, user.id, images),
  ];
  if (external) {
    stmts.push(
      db.prepare("INSERT INTO external_media (item_id, provider, file_id, url, updated_at) VALUES (?, 'gdrive', ?, ?, ?)").bind(id, external.fileId, external.url, t),
    );
  }
  if (kind === 'audio' || (kind === 'video' && !external)) {
    stmts.push(db.prepare("INSERT INTO transcripts (item_id, status, updated_at) VALUES (?, 'none', ?)").bind(id, t));
  }
  await db.batch(stmts);
  await reindexItem(db, id);
  await audit(db, user.id, 'item.create', kind, id);
  const row = (await getItemRow(db, id))!;
  return c.json(await getItemDetail(db, row, false), 201);
});

/** עריכת פריט — מנהל בלבד. */
itemRoutes.patch('/items/:id', async (c) => {
  const admin = requireAdmin(c);
  const db = c.env.DB;
  const row = await getItemRow(db, c.req.param('id'));
  if (!row) fail(404, 'הפריט לא נמצא');
  const b = await readJson<CreateBody>(c.req.raw);
  const sets: string[] = [];
  const binds: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(v);
  };
  if ('title' in b) set('title', str(b.title, 200, 'כותרת', row.kind !== 'photo') ?? '');
  if ('description' in b) set('description', str(b.description, 4000, 'תיאור'));
  if ('body' in b && row.kind === 'story') set('body', str(b.body, 50000, 'תוכן הסיפור', true));
  if ('storyType' in b && row.kind === 'story') set('story_type', parseStoryType(b.storyType));
  if ('dateText' in b) set('date_text', str(b.dateText, 80, 'תאריך'));
  if ('dateYear' in b) set('date_year', intOrNull(b.dateYear, 'שנה', 1800, 2200));
  if ('people' in b) set('people', str(b.people, 500, 'אנשים'));
  set('updated_at', now());
  set('updated_by', admin.id);
  const stmts = [db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, row.id)];
  if ('externalUrl' in b) {
    // החלפת קישור Google Drive — רק לסרטון שנוסף מלכתחילה כקישור
    const hasExternal = await db.prepare('SELECT 1 FROM external_media WHERE item_id = ?').bind(row.id).first();
    if (!hasExternal) fail(400, 'לפריט זה אין קישור חיצוני');
    const ext = parseExternalUrl(b.externalUrl);
    stmts.push(db.prepare('UPDATE external_media SET file_id = ?, url = ?, updated_at = ? WHERE item_id = ?').bind(ext.fileId, ext.url, now(), row.id));
  }
  if ('tags' in b) {
    const tagIds = await ensureTags(db, parseTags(b.tags));
    stmts.push(db.prepare('DELETE FROM item_tags WHERE item_id = ?').bind(row.id));
    for (const tagId of tagIds) stmts.push(db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)').bind(row.id, tagId));
  }
  await db.batch(stmts);
  await reindexItem(db, row.id);
  await audit(db, admin.id, 'item.edit', row.kind, row.id);
  return c.json(await getItemDetail(db, (await getItemRow(db, row.id))!, true));
});

/** מחיקה רכה — מנהל בלבד. הקבצים נשארים באחסון וניתן לשחזר. */
itemRoutes.delete('/items/:id', async (c) => {
  const admin = requireAdmin(c);
  const res = await c.env.DB.prepare('UPDATE items SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL')
    .bind(now(), admin.id, c.req.param('id'))
    .run();
  if (!res.meta.changes) fail(404, 'הפריט לא נמצא');
  clearFileCaches();
  await audit(c.env.DB, admin.id, 'item.delete', 'item', c.req.param('id'));
  return c.json({ ok: true });
});

itemRoutes.post('/items/:id/restore', async (c) => {
  const admin = requireAdmin(c);
  const res = await c.env.DB.prepare('UPDATE items SET deleted_at = NULL, deleted_by = NULL WHERE id = ? AND deleted_at IS NOT NULL')
    .bind(c.req.param('id'))
    .run();
  if (!res.meta.changes) fail(404, 'הפריט לא נמצא בסל המחזור');
  clearFileCaches();
  await audit(c.env.DB, admin.id, 'item.restore', 'item', c.req.param('id'));
  return c.json({ ok: true });
});

/** תגובה או ״גם אני זוכר את זה״ — לכל משתמש מחובר. */
itemRoutes.post('/items/:id/comments', async (c) => {
  const user = requireUser(c);
  const b = await readJson(c.req.raw);
  const row = await getItemRow(c.env.DB, c.req.param('id'));
  if (!row || row.deleted_at) fail(404, 'הפריט לא נמצא');
  const body = str(b.body, 10000, 'תוכן', true)!;
  const kind = b.kind === 'memory' ? 'memory' : 'comment';
  const id = newId();
  await c.env.DB.prepare('INSERT INTO comments (id, item_id, kind, body, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, row.id, kind, body, user.id, now())
    .run();
  await reindexItem(c.env.DB, row.id);
  return c.json({ id }, 201);
});

itemRoutes.delete('/comments/:id', async (c) => {
  const admin = requireAdmin(c);
  const row = await c.env.DB.prepare('SELECT item_id FROM comments WHERE id = ? AND deleted_at IS NULL')
    .bind(c.req.param('id'))
    .first<{ item_id: string }>();
  if (!row) fail(404, 'התגובה לא נמצאה');
  await c.env.DB.prepare('UPDATE comments SET deleted_at = ?, deleted_by = ? WHERE id = ?')
    .bind(now(), admin.id, c.req.param('id'))
    .run();
  await reindexItem(c.env.DB, row.item_id);
  await audit(c.env.DB, admin.id, 'comment.delete', 'comment', c.req.param('id'));
  return c.json({ ok: true });
});

/**
 * ״זיכרון מסבא״ — פריט אקראי. הלקוח שולח את הפריטים שהוצגו לאחרונה כדי לא לחזור עליהם ברצף.
 */
itemRoutes.get('/random', async (c) => {
  requireUser(c);
  const db = c.env.DB;
  const exclude = (c.req.query('exclude') ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 50);
  // ״זיכרון מסבא״ — רק תמונות מגלריית Google Drive (לא מוסתרות), מהרשימה שב-D1
  const pool = `i.deleted_at IS NULL AND i.kind = 'photo' AND EXISTS (SELECT 1 FROM drive_photos dp WHERE dp.item_id = i.id)`;
  const totalRow = await db.prepare(`SELECT COUNT(*) AS n FROM items i WHERE ${pool}`).first<{ n: number }>();
  const total = totalRow?.n ?? 0;
  if (!total) return c.json({ item: null, total: 0 });
  const pick = async (ex: string[]) =>
    db
      .prepare(`${ITEM_SELECT} WHERE ${pool} ${ex.length ? `AND i.id NOT IN (${placeholders(ex.length)})` : ''} ORDER BY RANDOM() LIMIT 1`)
      .bind(...ex)
      .first<ItemRow>();
  // אם כל התמונות כבר הוצגו — מתחילים סבב חדש, אבל לא מחזירים את האחרונה שהוצגה
  let row = await pick(exclude);
  if (!row && exclude.length) row = await pick(total > 1 ? exclude.slice(-1) : []);
  const [item] = row ? await toSummaries(db, [row]) : [null];
  return c.json({ item, total });
});

/** הוספת תמונה לסיפור קיים (מנהל) — נכנסת ראשונה, כלומר הופכת לתמונת הסיפור */
itemRoutes.post('/items/:id/images', async (c) => {
  const admin = requireAdmin(c);
  const db = c.env.DB;
  const row = await getItemRow(db, c.req.param('id'));
  if (!row || row.kind !== 'story') fail(404, 'הסיפור לא נמצא');
  const b = await readJson(c.req.raw);
  const images = await parseStoryImageInputs(db, admin.id, [b], 1);
  if (!images.length) fail(400, 'לא נבחרה תמונה');
  await db.batch(attachStoryImages(db, row.id, admin.id, images, (await minStoryImagePosition(db, row.id)) - 1));
  await audit(db, admin.id, 'story.image.add', 'item', row.id);
  return c.json(await getItemDetail(db, (await getItemRow(db, row.id))!, true));
});

/** הסרת תמונה מסיפור (מנהל) — רק התמונה של הסיפור; הגלריה לא מושפעת */
itemRoutes.delete('/items/:id/images/:imageId', async (c) => {
  const admin = requireAdmin(c);
  const db = c.env.DB;
  const row = await getItemRow(db, c.req.param('id'));
  if (!row || row.kind !== 'story') fail(404, 'הסיפור לא נמצא');
  await removeStoryImage(db, c.env.MEDIA, row.id, c.req.param('imageId'));
  clearFileCaches();
  await audit(db, admin.id, 'story.image.remove', 'item', row.id);
  return c.json(await getItemDetail(db, (await getItemRow(db, row.id))!, true));
});

itemRoutes.get('/tags', async (c) => {
  requireUser(c);
  const res = await c.env.DB.prepare(
    `SELECT t.id, t.name, COUNT(i.id) AS n FROM tags t LEFT JOIN item_tags it ON it.tag_id = t.id
     LEFT JOIN items i ON i.id = it.item_id AND i.deleted_at IS NULL GROUP BY t.id ORDER BY t.name`,
  ).all<{ id: number; name: string; n: number }>();
  return c.json(res.results.map((t) => ({ id: t.id, name: t.name, count: t.n })));
});

/** פריטים שניתן לצרף לסיפור (לא סיפורים). */
itemRoutes.get('/attachable', async (c) => {
  requireUser(c);
  const kind = parseKind(c.req.query('kind'), false);
  const res = await c.env.DB.prepare(
    `${ITEM_SELECT} WHERE i.deleted_at IS NULL AND i.kind NOT IN ('story', 'photo') ${kind ? 'AND i.kind = ?' : ''}
     ORDER BY i.created_at DESC LIMIT 60`,
  )
    .bind(...(kind ? [kind] : []))
    .all<ItemRow>();
  return c.json(await toSummaries(c.env.DB, res.results));
});
