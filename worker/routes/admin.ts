import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { AdminUser, ArchiveStats, BackupRun, BackupStatus, HeroTraits, InviteInfo, ItemKind } from '../../shared/types';
import { ITEM_KINDS } from '../../shared/constants';
import { requireAdmin } from '../lib/auth';
import { audit } from '../lib/audit';
import { randomToken, sha256Hex } from '../lib/crypto';
import { fail, intOrNull, newId, now, readJson, str } from '../lib/http';
import { reindexItems } from '../lib/search';
import { setSetting } from '../lib/settings';
import { runBackup } from '../lib/backup';

/** כל הנתיבים כאן מוגנים ב-adminGuard (ראו worker/index.ts) ובנוסף בודקים requireAdmin. */
export const adminRoutes = new Hono<AppEnv>();

// ---------- משתמשים ----------

adminRoutes.get('/users', async (c) => {
  requireAdmin(c);
  const res = await c.env.DB.prepare(
    'SELECT id, email, name, role, created_at, last_login_at, disabled_at FROM users ORDER BY created_at',
  ).all<Record<string, never>>();
  const users: AdminUser[] = res.results.map((u) => ({
    id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.created_at, lastLoginAt: u.last_login_at, disabledAt: u.disabled_at,
  }));
  return c.json(users);
});

async function activeAdminCount(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL").first<{ n: number }>();
  return row?.n ?? 0;
}

adminRoutes.patch('/users/:id', async (c) => {
  const admin = requireAdmin(c);
  const id = c.req.param('id');
  const b = await readJson(c.req.raw);
  const target = await c.env.DB.prepare('SELECT id, role, disabled_at FROM users WHERE id = ?').bind(id).first<{
    id: string; role: string; disabled_at: number | null;
  }>();
  if (!target) fail(404, 'המשתמש לא נמצא');
  const stmts: D1PreparedStatement[] = [];
  const losesAdmin = (b.role === 'member' && target.role === 'admin') || (b.disabled === true && target.role === 'admin');
  if (losesAdmin && (await activeAdminCount(c.env.DB)) <= 1) fail(400, 'חייב להישאר לפחות מנהל פעיל אחד');
  if (b.role !== undefined) {
    if (b.role !== 'admin' && b.role !== 'member') fail(400, 'תפקיד לא תקין');
    stmts.push(c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(b.role, id));
  }
  if (b.disabled !== undefined) {
    if (id === admin.id && b.disabled) fail(400, 'לא ניתן להשבית את החשבון שלך');
    stmts.push(c.env.DB.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').bind(b.disabled ? now() : null, id));
    if (b.disabled) stmts.push(c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  }
  if (b.name !== undefined) stmts.push(c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(str(b.name, 80, 'שם', true), id));
  if (stmts.length) await c.env.DB.batch(stmts);
  await audit(c.env.DB, admin.id, 'user.update', 'user', id, b);
  return c.json({ ok: true });
});

/** קישור חד-פעמי לאיפוס סיסמה עבור בן משפחה ששכח את סיסמתו. */
adminRoutes.post('/users/:id/reset-link', async (c) => {
  const admin = requireAdmin(c);
  const id = c.req.param('id');
  const user = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first();
  if (!user) fail(404, 'המשתמש לא נמצא');
  const token = randomToken();
  const t = now();
  await c.env.DB.prepare(
    'INSERT INTO password_resets (id, token_hash, user_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(newId(), await sha256Hex(token), id, admin.id, t, t + 3 * 24 * 60 * 60 * 1000)
    .run();
  await audit(c.env.DB, admin.id, 'user.reset_link', 'user', id);
  return c.json({ url: `${new URL(c.req.url).origin}/reset/${token}`, expiresInDays: 3 });
});

// ---------- הזמנות ----------

adminRoutes.get('/invites', async (c) => {
  requireAdmin(c);
  const res = await c.env.DB.prepare(
    `SELECT i.*, u.name AS creator_name, uu.name AS used_name FROM invites i JOIN users u ON u.id = i.created_by
     LEFT JOIN users uu ON uu.id = i.used_by ORDER BY i.created_at DESC LIMIT 100`,
  ).all<Record<string, never>>();
  const invites: InviteInfo[] = res.results.map((r) => ({
    id: r.id, email: r.email, note: r.note, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at,
    usedAt: r.used_at, usedBy: r.used_name, revokedAt: r.revoked_at, createdBy: r.creator_name,
  }));
  return c.json(invites);
});

adminRoutes.post('/invites', async (c) => {
  const admin = requireAdmin(c);
  const b = await readJson(c.req.raw);
  const role = b.role === 'admin' ? 'admin' : 'member';
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
    .bind(id, await sha256Hex(token), email, note, role, admin.id, t, t + days * 24 * 60 * 60 * 1000)
    .run();
  await audit(c.env.DB, admin.id, 'invite.create', 'invite', id, { role, email });
  // הטוקן עצמו לא נשמר — הקישור מוצג פעם אחת בלבד
  return c.json({ id, url: `${new URL(c.req.url).origin}/invite/${token}`, expiresAt: t + days * 24 * 60 * 60 * 1000 }, 201);
});

adminRoutes.delete('/invites/:id', async (c) => {
  const admin = requireAdmin(c);
  await c.env.DB.prepare('UPDATE invites SET revoked_at = ? WHERE id = ? AND used_at IS NULL').bind(now(), c.req.param('id')).run();
  await audit(c.env.DB, admin.id, 'invite.revoke', 'invite', c.req.param('id'));
  return c.json({ ok: true });
});

// ---------- הגדרות האתר ----------

function cleanTraits(v: unknown): HeroTraits {
  const t = (v ?? {}) as Partial<Record<keyof HeroTraits, unknown>>;
  const list = (x: unknown) => (Array.isArray(x) ? x.slice(0, 30) : []);
  const s = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
  return {
    quotes: list(t.quotes).map((q) => s(q, 300)).filter(Boolean),
    symbols: list(t.symbols)
      .map((x) => ({ icon: s((x as { icon?: unknown })?.icon, 8), label: s((x as { label?: unknown })?.label, 80) }))
      .filter((x) => x.label),
    details: list(t.details)
      .map((x) => ({ label: s((x as { label?: unknown })?.label, 60), value: s((x as { value?: unknown })?.value, 200) }))
      .filter((x) => x.label && x.value),
  };
}

adminRoutes.put('/settings', async (c) => {
  const admin = requireAdmin(c);
  const b = await readJson(c.req.raw);
  if (b.siteTitle !== undefined) await setSetting(c.env.DB, 'site_title', str(b.siteTitle, 60, 'שם האתר', true)!, admin.id);
  if (b.subtitle !== undefined) await setSetting(c.env.DB, 'subtitle', str(b.subtitle, 160, 'כותרת משנה') ?? '', admin.id);
  if (b.heroTraits !== undefined) await setSetting(c.env.DB, 'hero_traits', JSON.stringify(cleanTraits(b.heroTraits)), admin.id);
  await audit(c.env.DB, admin.id, 'settings.update', 'settings', null);
  return c.json({ ok: true });
});

/** החלפת התמונה הראשית: קובץ שהמנהל העלה זה עתה, תמונה קיימת מהארכיון, או הסרה. */
adminRoutes.put('/hero', async (c) => {
  const admin = requireAdmin(c);
  const b = await readJson(c.req.raw);
  let fileId = '';
  if (typeof b.fileId === 'string') {
    const f = await c.env.DB.prepare("SELECT id, mime, item_id FROM files WHERE id = ? AND role = 'original'").bind(b.fileId).first<{
      id: string; mime: string; item_id: string | null;
    }>();
    if (!f || !f.mime.startsWith('image/')) fail(400, 'יש לבחור קובץ תמונה');
    fileId = f.id;
  } else if (typeof b.itemId === 'string') {
    const f = await c.env.DB.prepare(
      "SELECT f.id FROM files f JOIN items i ON i.id = f.item_id WHERE i.id = ? AND i.kind = 'photo' AND f.role = 'original' AND i.deleted_at IS NULL",
    )
      .bind(b.itemId)
      .first<{ id: string }>();
    if (!f) fail(400, 'התמונה לא נמצאה');
    fileId = f.id;
  } else if (b.clear !== true) {
    fail(400, 'בקשה לא תקינה');
  }
  await setSetting(c.env.DB, 'hero_file_id', fileId, admin.id);
  await audit(c.env.DB, admin.id, 'hero.update', 'file', fileId || null);
  return c.json({ ok: true, heroFileId: fileId || null });
});

// ---------- תגיות ----------

adminRoutes.patch('/tags/:id', async (c) => {
  const admin = requireAdmin(c);
  const id = Number(c.req.param('id'));
  const b = await readJson(c.req.raw);
  const name = str(b.name, 40, 'שם התגית', true)!.replace(/^#/, '');
  const db = c.env.DB;
  const existing = await db.prepare('SELECT id FROM tags WHERE name = ? AND id != ?').bind(name, id).first<{ id: number }>();
  const affected = await db.prepare('SELECT item_id FROM item_tags WHERE tag_id = ?').bind(id).all<{ item_id: string }>();
  if (existing) {
    // שם קיים — מאחדים את שתי התגיות
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT item_id, ? FROM item_tags WHERE tag_id = ?').bind(existing.id, id),
      db.prepare('DELETE FROM item_tags WHERE tag_id = ?').bind(id),
      db.prepare('DELETE FROM tags WHERE id = ?').bind(id),
    ]);
  } else {
    await db.prepare('UPDATE tags SET name = ? WHERE id = ?').bind(name, id).run();
  }
  await reindexItems(db, affected.results.map((r) => r.item_id));
  await audit(db, admin.id, 'tag.rename', 'tag', String(id), { name });
  return c.json({ ok: true });
});

adminRoutes.delete('/tags/:id', async (c) => {
  const admin = requireAdmin(c);
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const affected = await db.prepare('SELECT item_id FROM item_tags WHERE tag_id = ?').bind(id).all<{ item_id: string }>();
  await db.batch([db.prepare('DELETE FROM item_tags WHERE tag_id = ?').bind(id), db.prepare('DELETE FROM tags WHERE id = ?').bind(id)]);
  await reindexItems(db, affected.results.map((r) => r.item_id));
  await audit(db, admin.id, 'tag.delete', 'tag', String(id));
  return c.json({ ok: true });
});

// ---------- סטטיסטיקה, ייצוא וגיבוי ----------

adminRoutes.get('/stats', async (c) => {
  requireAdmin(c);
  const db = c.env.DB;
  const [kinds, deleted, users, bytes] = await db.batch([
    db.prepare('SELECT kind, COUNT(*) AS n FROM items WHERE deleted_at IS NULL GROUP BY kind'),
    db.prepare('SELECT COUNT(*) AS n FROM items WHERE deleted_at IS NOT NULL'),
    db.prepare('SELECT COUNT(*) AS n FROM users WHERE disabled_at IS NULL'),
    db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM files'),
  ]);
  const counts = Object.fromEntries(ITEM_KINDS.map((k) => [k, 0])) as Record<ItemKind, number>;
  for (const r of kinds.results as { kind: ItemKind; n: number }[]) counts[r.kind] = r.n;
  const stats: ArchiveStats = {
    counts,
    deleted: (deleted.results[0] as { n: number }).n,
    users: (users.results[0] as { n: number }).n,
    bytes: (bytes.results[0] as { n: number }).n,
  };
  return c.json(stats);
});

/** ייצוא מלא של המטא-דאטה + רשימת כל הקבצים עם קישורי הורדה (משמש גם את scripts/export-archive.mjs). */
adminRoutes.get('/export', async (c) => {
  const admin = requireAdmin(c);
  const db = c.env.DB;
  const [items, files, tags, itemTags, comments, links, users, settings] = await db.batch([
    db.prepare('SELECT * FROM items ORDER BY created_at'),
    db.prepare('SELECT id, item_id, role, r2_key, mime, size, sha256, original_name, width, height, duration, created_by, created_at FROM files ORDER BY created_at'),
    db.prepare('SELECT * FROM tags'),
    db.prepare('SELECT * FROM item_tags'),
    db.prepare('SELECT * FROM comments ORDER BY created_at'),
    db.prepare('SELECT * FROM item_links'),
    db.prepare('SELECT id, name, email, role, created_at, disabled_at FROM users'),
    db.prepare('SELECT key, value FROM settings'),
  ]);
  const origin = new URL(c.req.url).origin;
  await audit(db, admin.id, 'archive.export', null, null);
  const manifest = {
    format: 'saba-dudu-archive',
    version: 1,
    exportedAt: new Date().toISOString(),
    items: items.results,
    files: (files.results as { id: string }[]).map((f) => ({ ...f, downloadUrl: `${origin}/api/files/${f.id}?download=1` })),
    tags: tags.results,
    itemTags: itemTags.results,
    comments: comments.results,
    links: links.results,
    users: users.results,
    settings: settings.results,
  };
  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="saba-dudu-manifest-${new Date().toISOString().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
});

function toRun(r: Record<string, never>): BackupRun {
  return {
    id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, status: r.status, filesCopied: r.files_copied,
    bytesCopied: r.bytes_copied, snapshotKey: r.snapshot_key, message: r.message,
  };
}

adminRoutes.get('/backups', async (c) => {
  requireAdmin(c);
  const db = c.env.DB;
  const [runs, totals] = await db.batch([
    db.prepare('SELECT * FROM backup_runs ORDER BY id DESC LIMIT 10'),
    db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes, SUM(CASE WHEN backed_up_at IS NOT NULL THEN 1 ELSE 0 END) AS done FROM files'),
  ]);
  const recent = (runs.results as Record<string, never>[]).map(toRun);
  const t = totals.results[0] as { n: number; bytes: number; done: number | null };
  const status: BackupStatus = {
    backupBucketConfigured: Boolean(c.env.BACKUP),
    lastRun: recent[0] ?? null,
    recentRuns: recent,
    filesTotal: t.n,
    filesBackedUp: t.done ?? 0,
    bytesTotal: t.bytes,
  };
  return c.json(status);
});

adminRoutes.post('/backups/run', async (c) => {
  const admin = requireAdmin(c);
  if (!c.env.BACKUP) fail(400, 'לא הוגדר bucket גיבוי. ראו הוראות ב-README.');
  const result = await runBackup(c.env, { maxFiles: 40, timeBudgetMs: 20_000 });
  await audit(c.env.DB, admin.id, 'backup.run', null, null, result);
  return c.json(result);
});

adminRoutes.get('/audit', async (c) => {
  requireAdmin(c);
  const res = await c.env.DB.prepare(
    `SELECT a.id, a.action, a.target_type, a.target_id, a.created_at, u.name AS user_name FROM audit_log a
     LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 100`,
  ).all();
  return c.json(res.results);
});
