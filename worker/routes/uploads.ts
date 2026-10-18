import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { DIRECT_UPLOAD_MAX, MULTIPART_PART_SIZE } from '../../shared/constants';
import { requireUser } from '../lib/auth';
import { sha256Hex } from '../lib/crypto';
import { fail, intOrNull, newId, now, readJson } from '../lib/http';
import { fileInfo } from '../lib/items';
import {
  checkContent, checkDeclaredFile, cleanFileName, parseFileRole, parseMediaKind, storageKey,
} from '../lib/validation';

/**
 * העלאת קבצים. כל קובץ נשמר ב-R2 תחת מפתח ייחודי שנוצר בשרת, ונרשם ב-D1 כ״ממתין״ (item_id = NULL)
 * עד ששומרים את הפריט. קובץ המקור נשמר כפי שהוא — ללא דחיסה או שינוי.
 */
export const uploadRoutes = new Hono<AppEnv>();

async function insertFile(
  db: D1Database,
  f: { id: string; role: string; r2Key: string; mime: string; size: number; sha256: string | null; name: string; userId: string },
) {
  await db
    .prepare(
      `INSERT INTO files (id, item_id, role, r2_key, mime, size, sha256, original_name, created_by, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(f.id, f.role, f.r2Key, f.mime, f.size, f.sha256, f.name, f.userId, now())
    .run();
  const row = await db.prepare('SELECT * FROM files WHERE id = ?').bind(f.id).first();
  return fileInfo(row as never);
}

/** העלאה ישירה של קובץ עד 25MB. גוף הבקשה הוא תוכן הקובץ עצמו. */
uploadRoutes.post('/direct', async (c) => {
  const user = requireUser(c);
  const kind = parseMediaKind(c.req.query('kind'));
  const role = parseFileRole(c.req.query('role'));
  const name = cleanFileName(c.req.query('name'));
  const declared = Number(c.req.header('content-length') ?? c.req.query('size'));
  if (declared > DIRECT_UPLOAD_MAX) fail(413, 'קובץ גדול — יש להעלות בחלקים');
  const buf = new Uint8Array(await c.req.arrayBuffer());
  if (buf.byteLength > DIRECT_UPLOAD_MAX) fail(413, 'קובץ גדול — יש להעלות בחלקים');
  const mime = checkDeclaredFile(kind, role, c.req.header('content-type') ?? null, name, buf.byteLength);
  checkContent(mime, buf.subarray(0, 64));
  const id = newId();
  const key = storageKey(kind, role, id, mime, name);
  const sha = await sha256Hex(buf);
  // onlyIf: כתיבה רק אם המפתח עוד לא קיים — הגנה נוספת מפני דריסה
  const put = await c.env.MEDIA.put(key, buf, {
    httpMetadata: { contentType: mime },
    customMetadata: { originalName: encodeURIComponent(name), uploadedBy: user.id, sha256: sha },
    onlyIf: { etagDoesNotMatch: '*' },
  });
  if (!put) fail(409, 'קובץ בשם זה כבר קיים באחסון');
  return c.json(await insertFile(c.env.DB, { id, role, r2Key: key, mime, size: buf.byteLength, sha256: sha, name, userId: user.id }));
});

interface UploadRow {
  id: string;
  r2_upload_id: string;
  r2_key: string;
  kind: string;
  role: string;
  mime: string;
  size: number;
  original_name: string;
  created_by: string;
  completed_at: number | null;
  aborted_at: number | null;
}

async function ownUpload(c: { env: AppEnv['Bindings'] }, id: string, userId: string): Promise<UploadRow> {
  const row = await c.env.DB.prepare('SELECT * FROM uploads WHERE id = ?').bind(id).first<UploadRow>();
  if (!row || row.created_by !== userId) fail(404, 'ההעלאה לא נמצאה');
  if (row.completed_at || row.aborted_at) fail(409, 'ההעלאה כבר הסתיימה');
  return row;
}

/** פתיחת העלאה בחלקים (לקבצים גדולים — סרטונים והקלטות ארוכות). */
uploadRoutes.post('/multipart', async (c) => {
  const user = requireUser(c);
  const body = await readJson(c.req.raw);
  const kind = parseMediaKind(body.kind);
  const role = parseFileRole(body.role);
  const name = cleanFileName(body.name);
  const size = intOrNull(body.size, 'גודל', 1, Number.MAX_SAFE_INTEGER) ?? 0;
  const mime = checkDeclaredFile(kind, role, typeof body.mime === 'string' ? body.mime : null, name, size);
  const id = newId();
  const key = storageKey(kind, role, id, mime, name);
  const mpu = await c.env.MEDIA.createMultipartUpload(key, {
    httpMetadata: { contentType: mime },
    customMetadata: { originalName: encodeURIComponent(name), uploadedBy: user.id },
  });
  await c.env.DB.prepare(
    `INSERT INTO uploads (id, r2_upload_id, r2_key, kind, role, mime, size, original_name, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, mpu.uploadId, key, kind, role, mime, size, name, user.id, now())
    .run();
  return c.json({ uploadId: id, partSize: MULTIPART_PART_SIZE, parts: Math.ceil(size / MULTIPART_PART_SIZE) });
});

uploadRoutes.put('/multipart/:id/:part', async (c) => {
  const user = requireUser(c);
  const up = await ownUpload(c, c.req.param('id'), user.id);
  const partNumber = Number(c.req.param('part'));
  const totalParts = Math.ceil(up.size / MULTIPART_PART_SIZE);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > totalParts) fail(400, 'מספר חלק לא תקין');
  const buf = new Uint8Array(await c.req.arrayBuffer());
  const expected = partNumber < totalParts ? MULTIPART_PART_SIZE : up.size - MULTIPART_PART_SIZE * (totalParts - 1);
  if (buf.byteLength !== expected) fail(400, 'גודל החלק אינו תואם');
  if (partNumber === 1) checkContent(up.mime, buf.subarray(0, 64));
  const mpu = c.env.MEDIA.resumeMultipartUpload(up.r2_key, up.r2_upload_id);
  const part = await mpu.uploadPart(partNumber, buf);
  return c.json({ partNumber: part.partNumber, etag: part.etag });
});

uploadRoutes.post('/multipart/:id/complete', async (c) => {
  const user = requireUser(c);
  const up = await ownUpload(c, c.req.param('id'), user.id);
  const body = await readJson<{ parts?: { partNumber: number; etag: string }[] }>(c.req.raw);
  const parts = Array.isArray(body.parts) ? body.parts : [];
  const totalParts = Math.ceil(up.size / MULTIPART_PART_SIZE);
  if (parts.length !== totalParts) fail(400, 'חסרים חלקים בהעלאה');
  const sorted = parts
    .map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) }))
    .sort((a, b) => a.partNumber - b.partNumber);
  const mpu = c.env.MEDIA.resumeMultipartUpload(up.r2_key, up.r2_upload_id);
  const obj = await mpu.complete(sorted);
  if (obj.size !== up.size) fail(400, 'גודל הקובץ שהתקבל אינו תואם');
  await c.env.DB.prepare('UPDATE uploads SET completed_at = ? WHERE id = ?').bind(now(), up.id).run();
  return c.json(
    await insertFile(c.env.DB, {
      id: up.id, role: up.role, r2Key: up.r2_key, mime: up.mime, size: up.size, sha256: null, name: up.original_name, userId: user.id,
    }),
  );
});

uploadRoutes.post('/multipart/:id/abort', async (c) => {
  const user = requireUser(c);
  const up = await ownUpload(c, c.req.param('id'), user.id);
  await c.env.MEDIA.resumeMultipartUpload(up.r2_key, up.r2_upload_id).abort();
  await c.env.DB.prepare('UPDATE uploads SET aborted_at = ? WHERE id = ?').bind(now(), up.id).run();
  return c.json({ ok: true });
});
