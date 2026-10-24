import type { ItemKind } from '../../shared/types';
import { STORY_TYPE_LABEL, KIND_LABELS } from '../../shared/constants';
import { ITEM_SELECT, type ItemRow } from './items';

/**
 * נרמול טקסט עברי לחיפוש: הסרת ניקוד וטעמים, גרש/גרשיים ומירכאות, סימני פיסוק ורווחים כפולים.
 * כך ״יום־הולדת״, ״יוֹם הוּלֶדֶת״ ו-״יום הולדת״ נחשבים זהים.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFC')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[״׳"'`’‘”“]/g, '')
    .replace(/[־\-_.,!?;:()[\]{}<>/\\|+=*&^%$#@~]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** בונה מחדש את מסמך החיפוש של פריט (כותרת, תיאור, תוכן, תגיות, אנשים, תאריך, כותב, תגובות, תמלול). */
export async function reindexItem(db: D1Database, itemId: string): Promise<void> {
  const item = await db
    .prepare(
      `SELECT i.id, i.kind, i.title, i.description, i.body, i.story_type, i.date_text, i.date_year, i.people,
              u.name AS creator_name
       FROM items i JOIN users u ON u.id = i.created_by WHERE i.id = ?`,
    )
    .bind(itemId)
    .first<Record<string, string | number | null>>();
  if (!item) return;
  const [tags, comments, files, transcript] = await db.batch([
    db.prepare('SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ?').bind(itemId),
    db.prepare(
      `SELECT c.body, u.name FROM comments c JOIN users u ON u.id = c.created_by
       WHERE c.item_id = ? AND c.deleted_at IS NULL`,
    ).bind(itemId),
    db.prepare("SELECT original_name FROM files WHERE item_id = ? AND role = 'original'").bind(itemId),
    db.prepare("SELECT text FROM transcripts WHERE item_id = ? AND status = 'done'").bind(itemId),
  ]);
  const parts: (string | number | null | undefined)[] = [
    item.title,
    item.description,
    item.body,
    item.story_type ? STORY_TYPE_LABEL[item.story_type as keyof typeof STORY_TYPE_LABEL] : null,
    KIND_LABELS[item.kind as ItemKind]?.singular,
    item.date_text,
    item.date_year,
    item.people,
    item.creator_name,
    ...(tags.results as { name: string }[]).map((t) => t.name),
    ...(comments.results as { body: string; name: string }[]).flatMap((c) => [c.body, c.name]),
    ...(files.results as { original_name: string }[]).map((f) => f.original_name.replace(/\.[^.]+$/, '')),
    ...(transcript.results as { text: string | null }[]).map((t) => t.text),
  ];
  const content = normalizeText(parts.filter((p) => p !== null && p !== undefined && p !== '').join(' \n '));
  await db.batch([
    db.prepare('DELETE FROM search_index WHERE item_id = ?').bind(itemId),
    db.prepare('INSERT INTO search_index (item_id, kind, content) VALUES (?, ?, ?)').bind(itemId, item.kind, content),
  ]);
}

export async function reindexItems(db: D1Database, ids: string[]): Promise<void> {
  for (const id of ids) await reindexItem(db, id);
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/**
 * חיפוש טקסט מלא. מילים של 3 תווים ומעלה עוברות דרך אינדקס FTS5 (trigram, התאמת תת-מחרוזת);
 * מילים קצרות יותר נבדקות ב-LIKE. כל המילים חייבות להופיע (AND).
 */
export async function searchItems(
  db: D1Database,
  query: string,
  opts: { kind?: ItemKind | null; limit?: number },
): Promise<ItemRow[]> {
  const words = normalizeText(query).split(' ').filter(Boolean).slice(0, 8);
  if (!words.length) return [];
  const long = words.filter((w) => [...w].length >= 3);
  const short = words.filter((w) => [...w].length < 3);
  // תמונות בגלריה — רק מ-Google Drive
  const where: string[] = ['i.deleted_at IS NULL', `(i.kind != 'photo' OR EXISTS (SELECT 1 FROM drive_photos dp WHERE dp.item_id = i.id))`];
  const binds: unknown[] = [];
  if (long.length) {
    where.push('search_index MATCH ?');
    binds.push(long.map((w) => `"${w}"`).join(' AND '));
  }
  for (const w of short) {
    where.push("search_index.content LIKE ? ESCAPE '\\'");
    binds.push(`%${escapeLike(w)}%`);
  }
  if (opts.kind) {
    where.push('i.kind = ?');
    binds.push(opts.kind);
  }
  const order = long.length ? 'bm25(search_index), i.created_at DESC' : 'i.created_at DESC';
  const sql = `${ITEM_SELECT} JOIN search_index ON search_index.item_id = i.id
    WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`;
  binds.push(opts.limit ?? 120);
  const res = await db.prepare(sql).bind(...binds).all<ItemRow>();
  return res.results;
}
