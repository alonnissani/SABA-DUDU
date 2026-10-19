import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireUser } from '../lib/auth';
import { fail } from '../lib/http';
import { getSetting } from '../lib/settings';
import { TtlCache } from '../lib/cache';

/** מידע על קבצים (60 שניות) — חוסך שאילתת D1 לכל תמונה בגלריה */
export const fileCache = new TtlCache<FileAccessRow>(60_000);

/**
 * הגשת קבצים — רק למשתמשים מחוברים, רק דרך ה-Worker (ה-bucket אינו ציבורי).
 * תומך ב-Range כדי לאפשר ניגון ודילוג בסרטונים ובהקלטות.
 */
export const fileRoutes = new Hono<AppEnv>();

interface FileAccessRow {
  id: string;
  item_id: string | null;
  r2_key: string;
  mime: string;
  size: number;
  original_name: string;
  created_by: string;
  deleted_at: number | null;
}

function contentDisposition(type: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

fileRoutes.get('/:id', async (c) => {
  const user = requireUser(c);
  const id = c.req.param('id');
  let file = fileCache.get(id) ?? null;
  if (!file) file = await c.env.DB.prepare(
    `SELECT f.id, f.item_id, f.r2_key, f.mime, f.size, f.original_name, f.created_by, i.deleted_at
     FROM files f LEFT JOIN items i ON i.id = f.item_id WHERE f.id = ?`,
  )
    .bind(id)
    .first<FileAccessRow>();
  if (!file) fail(404, 'הקובץ לא נמצא');
  if (file.item_id) fileCache.set(id, file);
  if (file.item_id) {
    // קובץ של פריט שנמחק — זמין רק למנהל (לצורך שחזור)
    if (file.deleted_at && user.role !== 'admin') fail(404, 'הקובץ לא נמצא');
  } else {
    // קובץ שעדיין לא שויך לפריט: זמין למי שהעלה אותו, למנהל, או אם זו התמונה הראשית
    const isHero = (await getSetting(c.env.DB, 'hero_file_id')) === file.id;
    if (!isHero && file.created_by !== user.id && user.role !== 'admin') fail(404, 'הקובץ לא נמצא');
  }

  const obj = await c.env.MEDIA.get(file.r2_key, { range: c.req.raw.headers, onlyIf: c.req.raw.headers });
  if (!obj) fail(404, 'הקובץ לא נמצא באחסון');

  const headers = new Headers();
  headers.set('content-type', file.mime);
  headers.set('accept-ranges', 'bytes');
  headers.set('etag', obj.httpEtag);
  // המפתח לעולם לא משתנה, ולכן אפשר לשמור במטמון הדפדפן בלבד (private)
  headers.set('cache-control', 'private, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-disposition', contentDisposition(c.req.query('download') ? 'attachment' : 'inline', file.original_name));
  if (file.mime !== 'application/pdf') headers.set('content-security-policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");

  if (!('body' in obj)) {
    // תנאי If-None-Match התקיים — אין צורך לשלוח שוב
    return new Response(null, { status: 304, headers });
  }
  const range = obj.range as { offset?: number; length?: number } | undefined;
  if (range && c.req.header('range')) {
    const offset = range.offset ?? 0;
    const length = range.length ?? obj.size - offset;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('content-length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
});
