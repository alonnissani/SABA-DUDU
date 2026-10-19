import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { AuthStatus } from '../../shared/types';
import {
  checkRateLimit, clearAttempts, createSession, destroySession, recordFailedAttempt, requireUser, sessionCache,
  validateEmail, validatePassword,
} from '../lib/auth';
import { hashPassword, sha256Hex, timingSafeStringEqual, verifyPassword } from '../lib/crypto';
import { fail, newId, now, readJson, str } from '../lib/http';
import { audit } from '../lib/audit';
import { getSetting } from '../lib/settings';

export const authRoutes = new Hono<AppEnv>();

async function userCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return row?.n ?? 0;
}

authRoutes.get('/status', async (c) => {
  const status: AuthStatus = {
    setupRequired: (await userCount(c.env.DB)) === 0,
    user: c.get('user'),
    siteTitle: await getSetting(c.env.DB, 'site_title'),
  };
  return c.json(status);
});

/** יצירת המנהל הראשון. פעיל רק כשאין משתמשים כלל, ודורש את הסוד SETUP_TOKEN. */
authRoutes.post('/setup', async (c) => {
  const body = await readJson(c.req.raw);
  const expected = c.env.SETUP_TOKEN;
  if (!expected || expected.length < 8) fail(503, 'לא הוגדר SETUP_TOKEN בשרת. ראו הוראות ב-README.');
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  await checkRateLimit(c, [`setup:${ip}`]);
  if (typeof body.token !== 'string' || !timingSafeStringEqual(body.token, expected)) {
    await recordFailedAttempt(c, [`setup:${ip}`]);
    fail(403, 'קוד ההקמה שגוי');
  }
  if ((await userCount(c.env.DB)) > 0) fail(409, 'המערכת כבר הוקמה. יש להתחבר.');
  const name = str(body.name, 80, 'שם', true)!;
  const email = validateEmail(body.email);
  const password = validatePassword(body.password);
  const id = newId();
  await c.env.DB.prepare(
    "INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)",
  )
    .bind(id, email, name, await hashPassword(password), now())
    .run();
  await audit(c.env.DB, id, 'setup', 'user', id);
  await createSession(c, id);
  return c.json({ ok: true });
});

authRoutes.post('/login', async (c) => {
  const body = await readJson(c.req.raw);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) fail(400, 'יש להזין דוא״ל וסיסמה');
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  const keys = [`email:${email}`, `ip:${ip}`];
  await checkRateLimit(c, keys);
  const user = await c.env.DB.prepare('SELECT id, password_hash, disabled_at FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; password_hash: string; disabled_at: number | null }>();
  // מאמתים גם כשהמשתמש לא קיים, כדי לא לחשוף קיום חשבון לפי זמן תגובה
  const ok = await verifyPassword(password, user?.password_hash ?? 'pbkdf2$100000$00$00');
  if (!user || !ok || user.disabled_at) {
    await recordFailedAttempt(c, keys);
    fail(401, 'דוא״ל או סיסמה שגויים');
  }
  await clearAttempts(c, [`email:${email}`]);
  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now(), user.id).run();
  await createSession(c, user.id);
  return c.json({ ok: true });
});

authRoutes.post('/logout', async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

interface InviteRow {
  id: string;
  email: string | null;
  role: 'admin' | 'member';
  expires_at: number;
  used_at: number | null;
  revoked_at: number | null;
}

async function findInvite(db: D1Database, token: unknown): Promise<InviteRow> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) fail(404, 'קישור ההזמנה אינו תקין');
  const row = await db
    .prepare('SELECT id, email, role, expires_at, used_at, revoked_at FROM invites WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .first<InviteRow>();
  if (!row || row.revoked_at) fail(404, 'קישור ההזמנה אינו תקין');
  if (row.used_at) fail(410, 'כבר נעשה שימוש בקישור ההזמנה הזה');
  if (row.expires_at < now()) fail(410, 'תוקף קישור ההזמנה פג. בקשו קישור חדש.');
  return row;
}

authRoutes.get('/invite/:token', async (c) => {
  const invite = await findInvite(c.env.DB, c.req.param('token'));
  return c.json({ valid: true, email: invite.email, role: invite.role });
});

/** הצטרפות באמצעות קישור הזמנה חד-פעמי. אין הרשמה ציבורית. */
authRoutes.post('/accept-invite', async (c) => {
  const body = await readJson(c.req.raw);
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  await checkRateLimit(c, [`invite:${ip}`]);
  let invite: InviteRow;
  try {
    invite = await findInvite(c.env.DB, body.token);
  } catch (e) {
    await recordFailedAttempt(c, [`invite:${ip}`]);
    throw e;
  }
  const name = str(body.name, 80, 'שם', true)!;
  const email = validateEmail(invite.email ?? body.email);
  const password = validatePassword(body.password);
  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (exists) fail(409, 'כבר קיים חשבון עם כתובת הדוא״ל הזו. נסו להתחבר.');
  const id = newId();
  const t = now();
  // סימון ההזמנה כמנוצלת באופן אטומי — מונע שימוש כפול במקביל
  const claim = await c.env.DB.prepare(
    'UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL',
  )
    .bind(t, invite.id)
    .run();
  if (!claim.meta.changes) fail(410, 'כבר נעשה שימוש בקישור ההזמנה הזה');
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(id, email, name, await hashPassword(password), invite.role, t),
    c.env.DB.prepare('UPDATE invites SET used_by = ? WHERE id = ?').bind(id, invite.id),
  ]);
  await audit(c.env.DB, id, 'invite.accept', 'invite', invite.id);
  await createSession(c, id);
  return c.json({ ok: true });
});

authRoutes.patch('/me', async (c) => {
  const user = requireUser(c);
  const body = await readJson(c.req.raw);
  const name = str(body.name, 80, 'שם', true)!;
  await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
  sessionCache.clear();
  return c.json({ ok: true });
});

authRoutes.post('/me/password', async (c) => {
  const user = requireUser(c);
  const body = await readJson(c.req.raw);
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ password_hash: string }>();
  if (!row || typeof body.current !== 'string' || !(await verifyPassword(body.current, row.password_hash))) {
    fail(400, 'הסיסמה הנוכחית שגויה');
  }
  const next = validatePassword(body.password);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(next), user.id),
    // ניתוק כל שאר המכשירים
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(user.id, c.get('sessionId')),
  ]);
  sessionCache.clear();
  return c.json({ ok: true });
});

async function findReset(db: D1Database, token: unknown) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) fail(404, 'הקישור אינו תקין');
  const row = await db
    .prepare(
      `SELECT r.id, r.user_id, r.expires_at, r.used_at, u.name, u.email FROM password_resets r
       JOIN users u ON u.id = r.user_id WHERE r.token_hash = ?`,
    )
    .bind(await sha256Hex(token))
    .first<{ id: string; user_id: string; expires_at: number; used_at: number | null; name: string; email: string }>();
  if (!row) fail(404, 'הקישור אינו תקין');
  if (row.used_at || row.expires_at < now()) fail(410, 'תוקף הקישור פג. בקשו קישור חדש מהמנהל.');
  return row;
}

authRoutes.get('/reset/:token', async (c) => {
  const r = await findReset(c.env.DB, c.req.param('token'));
  return c.json({ valid: true, name: r.name, email: r.email });
});

/** קביעת סיסמה חדשה באמצעות קישור איפוס שהמנהל יצר. */
authRoutes.post('/reset', async (c) => {
  const body = await readJson(c.req.raw);
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  await checkRateLimit(c, [`reset:${ip}`]);
  let r: Awaited<ReturnType<typeof findReset>>;
  try {
    r = await findReset(c.env.DB, body.token);
  } catch (e) {
    await recordFailedAttempt(c, [`reset:${ip}`]);
    throw e;
  }
  const password = validatePassword(body.password);
  const claim = await c.env.DB.prepare('UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL').bind(now(), r.id).run();
  if (!claim.meta.changes) fail(410, 'כבר נעשה שימוש בקישור הזה');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), r.user_id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(r.user_id),
  ]);
  sessionCache.clear();
  await audit(c.env.DB, r.user_id, 'user.password_reset', 'user', r.user_id);
  await createSession(c, r.user_id);
  return c.json({ ok: true });
});
