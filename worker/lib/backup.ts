import type { Env } from '../env';
import { now } from './http';
import { ensureSchema } from './schema';

/** טבלאות שנכללות ב-snapshot של בסיס הנתונים (ללא סשנים, ניסיונות התחברות ואינדקס חיפוש שניתן לבנות מחדש). */
const SNAPSHOT_TABLES = [
  'users', 'invites', 'items', 'files', 'tags', 'item_tags', 'comments', 'item_links', 'transcripts', 'settings', 'audit_log', 'backup_runs', 'external_media', 'drive_photos', 'story_images', 'audio_peaks',
];

export interface BackupOptions {
  maxFiles: number;
  timeBudgetMs: number;
}

/**
 * גיבוי ל-bucket נפרד (BACKUP): מעתיק כל קובץ שעוד לא גובה, ושומר snapshot JSON של בסיס הנתונים.
 * רץ אוטומטית כל לילה (Cron) וניתן להפעלה ידנית מדף ״מצב גיבויים״.
 */
export async function runBackup(env: Env, opts: BackupOptions): Promise<{ status: string; message: string }> {
  if (!env.BACKUP) return { status: 'skipped', message: 'לא הוגדר bucket גיבוי (BACKUP)' };
  const db = env.DB;
  await ensureSchema(db);
  const started = now();
  const run = await db
    .prepare("INSERT INTO backup_runs (started_at, status) VALUES (?, 'running') RETURNING id")
    .bind(started)
    .first<{ id: number }>();
  const runId = run!.id;
  let copied = 0;
  let bytes = 0;
  const errors: string[] = [];
  try {
    const pending = await db
      .prepare('SELECT id, r2_key, size FROM files WHERE backed_up_at IS NULL ORDER BY created_at LIMIT ?')
      .bind(opts.maxFiles)
      .all<{ id: string; r2_key: string; size: number }>();
    for (const f of pending.results) {
      if (now() - started > opts.timeBudgetMs) break;
      try {
        const exists = await env.BACKUP.head(f.r2_key);
        if (!exists) {
          const obj = await env.MEDIA.get(f.r2_key);
          if (!obj) {
            errors.push(`missing:${f.r2_key}`);
            continue;
          }
          const { readable, writable } = new FixedLengthStream(obj.size);
          await Promise.all([
            obj.body.pipeTo(writable),
            env.BACKUP.put(f.r2_key, readable, { httpMetadata: obj.httpMetadata, customMetadata: obj.customMetadata }),
          ]);
          bytes += obj.size;
        }
        await db.prepare('UPDATE files SET backed_up_at = ? WHERE id = ?').bind(now(), f.id).run();
        copied++;
      } catch (e) {
        errors.push(`${f.r2_key}: ${(e as Error).message}`);
      }
    }

    // snapshot של בסיס הנתונים
    const snapshot: Record<string, unknown[]> = {};
    for (const table of SNAPSHOT_TABLES) {
      const cols = table === 'users' ? 'id, email, name, role, created_at, last_login_at, disabled_at' : '*';
      const res = await db.prepare(`SELECT ${cols} FROM ${table}`).all();
      snapshot[table] = res.results;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotKey = `db-snapshots/${stamp}.json`;
    await env.BACKUP.put(snapshotKey, JSON.stringify({ createdAt: new Date().toISOString(), tables: snapshot }), {
      httpMetadata: { contentType: 'application/json' },
    });

    const remaining = await db.prepare('SELECT COUNT(*) AS n FROM files WHERE backed_up_at IS NULL').first<{ n: number }>();
    const status = errors.length ? 'partial' : (remaining?.n ?? 0) > 0 ? 'partial' : 'ok';
    const message = [
      remaining?.n ? `נותרו ${remaining.n} קבצים לגיבוי בסבב הבא` : 'כל הקבצים מגובים',
      ...errors.slice(0, 5),
    ].join(' · ');
    await db
      .prepare('UPDATE backup_runs SET finished_at = ?, status = ?, files_copied = ?, bytes_copied = ?, snapshot_key = ?, message = ? WHERE id = ?')
      .bind(now(), status, copied, bytes, snapshotKey, message, runId)
      .run();
    return { status, message };
  } catch (e) {
    const message = (e as Error).message;
    await db
      .prepare("UPDATE backup_runs SET finished_at = ?, status = 'failed', files_copied = ?, bytes_copied = ?, message = ? WHERE id = ?")
      .bind(now(), copied, bytes, message, runId)
      .run();
    return { status: 'failed', message };
  }
}
