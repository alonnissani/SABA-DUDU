import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv } from '../env';
import type { CurrentUser, Role } from '../../shared/types';
import { randomToken, sha256Hex } from './crypto';
import { fail, now } from './http';
import { TtlCache } from './cache';

/** סשנים שאומתו לאחרונה (30 שניות) — כדי שכל תמונה בגלריה לא תדרוש שאילתה נוספת */
export const sessionCache = new TtlCache<{ user: CurrentUser; sessionId: string; expiresAt: number }>(30_000);

export const SESSION_COOKIE = 'sd_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 יום
const SESSION_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionRow {
  session_id: string;
  expires_at: number;
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled_at: number | null;
}

function isSecure(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

export async function createSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const token = randomToken();
  const id = await sha256Hex(token);
  const t = now();
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, userId, t, t + SESSION_TTL_MS, (c.req.header('user-agent') ?? '').slice(0, 300))
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const sessionId = c.get('sessionId');
  if (sessionId) {
    sessionCache.delete(sessionId);
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isSecure(c) });
}

/** טוען את המשתמש המחובר (אם יש) לכל בקשה. */
export const loadSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set('user', null);
  c.set('sessionId', null);
  const token = getCookie(c, SESSION_COOKIE);
  if (token && token.length < 200) {
    const id = await sha256Hex(token);
    const cached = sessionCache.get(id);
    if (cached && cached.expiresAt > now()) {
      c.set('user', cached.user);
      c.set('sessionId', cached.sessionId);
      await next();
      return;
    }
    const row = await c.env.DB.prepare(
      `SELECT s.id AS session_id, s.expires_at, u.id, u.email, u.name, u.role, u.disabled_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
      .bind(id)
      .first<SessionRow>();
    const t = now();
    if (row && row.expires_at > t && !row.disabled_at) {
      const user: CurrentUser = { id: row.id, email: row.email, name: row.name, role: row.role };
      c.set('user', user);
      c.set('sessionId', row.session_id);
      sessionCache.set(id, { user, sessionId: row.session_id, expiresAt: row.expires_at });
      // הארכה הדרגתית של סשן פעיל
      if (row.expires_at - t < SESSION_TTL_MS - SESSION_REFRESH_MS) {
        await c.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
          .bind(t + SESSION_TTL_MS, row.session_id)
          .run();
      }
    } else if (row) {
      await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(row.session_id).run();
    }
  }
  await next();
};

/**
 * הגנת CSRF: בקשה משנה (POST/PUT/PATCH/DELETE) שמגיעה מדפדפן חייבת להגיע מאותו origin.
 * בנוסף, עוגיית הסשן היא SameSite=Lax.
 */
export const sameOriginGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = c.req.header('origin');
    const site = c.req.header('sec-fetch-site');
    const self = new URL(c.req.url).origin;
    if ((origin && origin !== self) || (site && site !== 'same-origin' && site !== 'none')) {
      fail(403, 'בקשה ממקור לא מורשה');
    }
  }
  await next();
};

export function requireUser(c: Context<AppEnv>): CurrentUser {
  const user = c.get('user');
  if (!user) fail(401, 'יש להתחבר כדי להמשיך');
  return user;
}

/** אכיפת הרשאת מנהל בצד השרת. */
export function requireAdmin(c: Context<AppEnv>): CurrentUser {
  const user = requireUser(c);
  if (user.role !== 'admin') fail(403, 'פעולה זו מותרת למנהל המערכת בלבד');
  return user;
}

export const userGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  requireUser(c);
  await next();
};

export const adminGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  requireAdmin(c);
  await next();
};

export function validatePassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < 8) fail(400, 'הסיסמה חייבת לכלול לפחות 8 תווים');
  if (password.length > 200) fail(400, 'הסיסמה ארוכה מדי');
  return password;
}

export function validateEmail(email: unknown): string {
  if (typeof email !== 'string') fail(400, 'כתובת דוא״ל לא תקינה');
  const e = email.trim().toLowerCase();
  if (e.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail(400, 'כתובת דוא״ל לא תקינה');
  return e;
}

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

/** הגבלת ניסיונות התחברות כושלים לפי דוא״ל ולפי כתובת IP. */
export async function checkRateLimit(c: Context<AppEnv>, keys: string[]): Promise<void> {
  const since = now() - ATTEMPT_WINDOW_MS;
  for (const key of keys) {
    const row = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND attempted_at > ?',
    )
      .bind(key, since)
      .first<{ n: number }>();
    if ((row?.n ?? 0) >= MAX_ATTEMPTS) fail(429, 'יותר מדי ניסיונות. נסו שוב בעוד כרבע שעה.');
  }
}

export async function recordFailedAttempt(c: Context<AppEnv>, keys: string[]): Promise<void> {
  const t = now();
  await c.env.DB.batch([
    ...keys.map((k) => c.env.DB.prepare('INSERT INTO login_attempts (key, attempted_at) VALUES (?, ?)').bind(k, t)),
    c.env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(t - ATTEMPT_WINDOW_MS * 4),
  ]);
}

export async function clearAttempts(c: Context<AppEnv>, keys: string[]): Promise<void> {
  await c.env.DB.batch(keys.map((k) => c.env.DB.prepare('DELETE FROM login_attempts WHERE key = ?').bind(k)));
}
