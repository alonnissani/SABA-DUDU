import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { InviteInfo } from '../../shared/types';
import { requireUser } from '../lib/auth';
import { audit } from '../lib/audit';
import { randomToken, sha256Hex } from '../lib/crypto';
import { fail, intOrNull, newId, now, readJson, str } from '../lib/http';

/**
 * הזמנות להצטרפות — כל משתמש מחובר יכול להזמין בני משפחה.
 * מנהל רואה ומבטל את כל ההזמנות ויכול להזמין מנהלים; בן משפחה מזמין רק בני משפחה ורואה רק את ההזמנות שלו.
 */
export const inviteRoutes = new Hono<AppEnv>();

inviteRoutes.get('/', async (c) => {
  const user = requireUser(c);
  const admin = user.role === 'admin';
  const res = await c.env.DB.prepare(
    `SELECT i.*, u.name AS creator_name, uu.name AS used_name FROM invites i JOIN users u ON u.id = i.created_by
     LEFT JOIN users uu ON uu.id = i.used_by ${admin ? '' : 'WHERE i.created_by = ?'} ORDER BY i.created_at DESC LIMIT 100`,
  )
    .bind(...(admin ? [] : [user.id]))
    .all<Record<string, never>>();
  const invites: InviteInfo[] = res.results.map((r) => ({
    id: r.id, email: r.email, note: r.note, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at,
    usedAt: r.used_at, usedBy: r.used_name, revokedAt: r.revoked_at, createdBy: r.creator_name,
  }));
  return c.json(invites);
});

inviteRoutes.post('/', async (c) => {
  const user = requireUser(c);
  const b = await readJson(c.req.raw);
  const role = b.role === 'admin' ? 'admin' : 'member';
  if (role === 'admin' && user.role !== 'admin') fail(403, 'רק מנהל/ת יכול/ה להזמין מנהלים');
  const email = str(b.email, 200, 'דוא״ל')?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'כתובת דוא״ל לא תקינה');
  const note = str(b.note, 200, 'הערה');
  const days = intOrNull(b.days, 'תוקף', 1, 30) ?? 7;
  const token = randomToken();
  const id = newId();
  const t = now();
  await c.env.DB.prepare(
    'INSERT INTO invites (id, token_hash, email, note, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, await sha256Hex(token), email, note, role, user.id, t, t + days * 24 * 60 * 60 * 1000)
    .run();
  await audit(c.env.DB, user.id, 'invite.create', 'invite', id, { role, email });
  // הטוקן עצמו לא נשמר — הקישור מוצג פעם אחת בלבד
  return c.json({ id, url: `${new URL(c.req.url).origin}/invite/${token}`, expiresAt: t + days * 24 * 60 * 60 * 1000 }, 201);
});

inviteRoutes.delete('/:id', async (c) => {
  const user = requireUser(c);
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT created_by FROM invites WHERE id = ?').bind(id).first<{ created_by: string }>();
  if (!row) fail(404, 'ההזמנה לא נמצאה');
  if (user.role !== 'admin' && row.created_by !== user.id) fail(403, 'אפשר לבטל רק הזמנות שיצרת');
  await c.env.DB.prepare('UPDATE invites SET revoked_at = ? WHERE id = ? AND used_at IS NULL').bind(now(), id).run();
  await audit(c.env.DB, user.id, 'invite.revoke', 'invite', id);
  return c.json({ ok: true });
});
