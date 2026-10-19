import { DRIVE_FILE_PREFIX, driveVirtualId } from '../../shared/drive';
import type {
  CommentInfo, ExternalVideo, FileInfo, FileRole, ItemDetail, ItemKind, ItemSummary, StoryType, TranscriptStatus,
} from '../../shared/types';
import { placeholders } from './http';

export interface ItemRow {
  id: string;
  kind: ItemKind;
  title: string;
  description: string | null;
  body: string | null;
  story_type: StoryType | null;
  date_text: string | null;
  date_year: number | null;
  people: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  creator_name: string;
}

interface FileRow {
  id: string;
  item_id: string;
  role: FileRole;
  mime: string;
  size: number;
  original_name: string;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export const ITEM_SELECT = `SELECT i.id, i.kind, i.title, i.description, i.body, i.story_type, i.date_text, i.date_year,
  i.people, i.created_by, i.created_at, i.updated_at, i.deleted_at, u.name AS creator_name
  FROM items i JOIN users u ON u.id = i.created_by`;

export function fileInfo(f: FileRow): FileInfo {
  return {
    id: f.id,
    role: f.role,
    mime: f.mime,
    size: f.size,
    originalName: f.original_name,
    width: f.width,
    height: f.height,
    duration: f.duration,
  };
}

function chunks<T>(arr: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function excerptOf(body: string | null): string | null {
  if (!body) return null;
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 240 ? `${flat.slice(0, 240)}…` : flat;
}

/**
 * ״קבצים וירטואליים״ לתמונה מ-Google Drive: המקור (תצוגה גדולה) והממוזערת מוגשים דרך /api/files/gd:…
 * מגוגל, בפורמט שהדפדפן מציג — כך הגלריה, התצוגה המלאה ו״זיכרון מסבא״ עובדים בלי שינוי.
 */
function driveFiles(d: { file_id: string; mime: string; width: number | null; height: number | null; size: number | null }): FileInfo[] {
  const base = { mime: 'image/jpeg', width: d.width, height: d.height, duration: null };
  return [
    { ...base, id: driveVirtualId(d.file_id, 'original'), role: 'original', size: d.size ?? 0, originalName: `drive-${d.file_id}` },
    { ...base, id: driveVirtualId(d.file_id, 'thumb'), role: 'thumb', size: 0, originalName: '' },
  ];
}

/** הופך שורות פריטים לאובייקטים מלאים (קבצים, תגיות, מספר תגובות) בכמה שאילתות מרוכזות. */
export async function toSummaries(db: D1Database, rows: ItemRow[]): Promise<ItemSummary[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const files = new Map<string, FileInfo[]>();
  const tags = new Map<string, string[]>();
  const counts = new Map<string, number>();
  const external = new Map<string, ExternalVideo>();
  const covers = new Map<string, string>();
  const drive = new Map<string, { file_id: string; mime: string; width: number | null; height: number | null; size: number | null }>();

  for (const part of chunks(ids)) {
    const ph = placeholders(part.length);
    const [f, t, c, x, v, d] = await db.batch([
      db.prepare(
        `SELECT id, item_id, role, mime, size, original_name, width, height, duration FROM files
         WHERE item_id IN (${ph}) ORDER BY position, created_at`,
      ).bind(...part),
      db.prepare(
        `SELECT it.item_id, t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id
         WHERE it.item_id IN (${ph}) ORDER BY t.name`,
      ).bind(...part),
      db.prepare(
        `SELECT item_id, COUNT(*) AS n FROM comments WHERE deleted_at IS NULL AND item_id IN (${ph}) GROUP BY item_id`,
      ).bind(...part),
      db.prepare(`SELECT item_id, provider, file_id, url FROM external_media WHERE item_id IN (${ph})`).bind(...part),
      // תמונת הסיפור: התמונה הראשונה (לפי הסדר) מבין התמונות שצורפו לו ולא נמחקו — מהאתר או מ-Google Drive
      db.prepare(
        `SELECT l.story_id, l.position, p.id AS photo_id, f.id AS file_id, f.role FROM item_links l
         JOIN items p ON p.id = l.item_id AND p.kind = 'photo' AND p.deleted_at IS NULL
         JOIN files f ON f.item_id = p.id AND f.role IN ('thumb', 'original')
         WHERE l.story_id IN (${ph})
         UNION ALL
         SELECT l.story_id, l.position, p.id AS photo_id, '${DRIVE_FILE_PREFIX}' || dp.file_id || ':t' AS file_id, 'thumb' AS role FROM item_links l
         JOIN items p ON p.id = l.item_id AND p.kind = 'photo' AND p.deleted_at IS NULL
         JOIN drive_photos dp ON dp.item_id = p.id
         WHERE l.story_id IN (${ph})
         ORDER BY 1, 2, 3`,
      ).bind(...part, ...part),
      // תמונות מ-Google Drive: הקובץ נשאר בדרייב, כאן רק המזהה והמידות
      db.prepare(`SELECT item_id, file_id, mime, width, height, size FROM drive_photos WHERE item_id IN (${ph})`).bind(...part),
    ]);
    for (const row of f.results as unknown as FileRow[]) {
      const list = files.get(row.item_id) ?? [];
      list.push(fileInfo(row));
      files.set(row.item_id, list);
    }
    for (const row of t.results as unknown as { item_id: string; name: string }[]) {
      const list = tags.get(row.item_id) ?? [];
      list.push(row.name);
      tags.set(row.item_id, list);
    }
    for (const row of c.results as unknown as { item_id: string; n: number }[]) counts.set(row.item_id, row.n);
    for (const row of x.results as unknown as { item_id: string; provider: 'gdrive'; file_id: string; url: string }[]) {
      external.set(row.item_id, { provider: row.provider, fileId: row.file_id, url: row.url });
    }
    for (const row of d.results as unknown as { item_id: string; file_id: string; mime: string; width: number | null; height: number | null; size: number | null }[]) {
      drive.set(row.item_id, row);
    }
    const coverPhoto = new Map<string, string>();
    for (const row of v.results as unknown as { story_id: string; photo_id: string; file_id: string; role: string }[]) {
      const first = coverPhoto.get(row.story_id) ?? row.photo_id;
      coverPhoto.set(row.story_id, first);
      if (row.photo_id !== first) continue;
      // ממוזערת עדיפה על המקור
      if (row.role === 'thumb' || !covers.has(row.story_id)) covers.set(row.story_id, row.file_id);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    description: r.description,
    excerpt: r.kind === 'story' ? excerptOf(r.body) : null,
    storyType: r.story_type,
    dateText: r.date_text,
    dateYear: r.date_year,
    people: r.people,
    tags: tags.get(r.id) ?? [],
    createdAt: r.created_at,
    createdBy: drive.has(r.id) ? { id: r.created_by, name: 'Google Drive' } : { id: r.created_by, name: r.creator_name },
    files: drive.has(r.id) ? driveFiles(drive.get(r.id)!) : files.get(r.id) ?? [],
    externalVideo: external.get(r.id) ?? null,
    coverFileId: covers.get(r.id) ?? null,
    commentCount: counts.get(r.id) ?? 0,
    deletedAt: r.deleted_at,
  }));
}

export async function getItemRow(db: D1Database, id: string): Promise<ItemRow | null> {
  return db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).bind(id).first<ItemRow>();
}

export async function getItemDetail(db: D1Database, row: ItemRow, includeDeleted: boolean): Promise<ItemDetail> {
  const [summary] = await toSummaries(db, [row]);
  const [linkRes, commentRes, transcript] = await db.batch([
    db.prepare(
      `${ITEM_SELECT} JOIN item_links l ON l.item_id = i.id WHERE l.story_id = ? ${includeDeleted ? '' : 'AND i.deleted_at IS NULL'}
       ORDER BY l.position`,
    ).bind(row.id),
    db.prepare(
      `SELECT c.id, c.kind, c.body, c.created_at, c.created_by, u.name AS creator_name FROM comments c
       JOIN users u ON u.id = c.created_by WHERE c.item_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at`,
    ).bind(row.id),
    db.prepare('SELECT status FROM transcripts WHERE item_id = ?').bind(row.id),
  ]);
  const comments: CommentInfo[] = (commentRes.results as Record<string, unknown>[]).map((c) => ({
    id: c.id as string,
    kind: c.kind as CommentInfo['kind'],
    body: c.body as string,
    createdAt: c.created_at as number,
    createdBy: { id: c.created_by as string, name: c.creator_name as string },
  }));
  const status = (transcript.results[0] as { status?: TranscriptStatus } | undefined)?.status ?? 'none';
  return {
    ...summary,
    body: row.body,
    updatedAt: row.updated_at,
    links: await toSummaries(db, linkRes.results as unknown as ItemRow[]),
    comments,
    transcriptStatus: status,
  };
}

/** מחזיר מזהי תגיות, ויוצר תגיות חדשות לפי הצורך. */
export async function ensureTags(db: D1Database, names: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (const name of names) {
    await db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').bind(name).run();
    const row = await db.prepare('SELECT id FROM tags WHERE name = ?').bind(name).first<{ id: number }>();
    if (row) ids.push(row.id);
  }
  return ids;
}

export function parseTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,،]/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const t = raw.replace(/^#/, '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const key = t.toLowerCase();
    if (t && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
    if (out.length >= 20) break;
  }
  return out;
}
