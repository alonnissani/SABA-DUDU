let ensured: Promise<void> | null = null;

/**
 * מוודא שתוספות סכמה שאינן הורסות קיימות גם אם פקודת הפריסה לא הריצה migrations.
 * כל פקודה כאן חייבת להיות idempotent (IF NOT EXISTS) וזהה ל-migration המקביל.
 */
export function ensureSchema(db: D1Database): Promise<void> {
  ensured ??= db
    .batch([
      db.prepare(
        `CREATE TABLE IF NOT EXISTS external_media (
          item_id    TEXT PRIMARY KEY REFERENCES items(id),
          provider   TEXT NOT NULL CHECK (provider IN ('gdrive')),
          file_id    TEXT NOT NULL,
          url        TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
      ),
      // 0003_drive_photos.sql
      db.prepare(
        `CREATE TABLE IF NOT EXISTS drive_photos (
          file_id       TEXT PRIMARY KEY,
          item_id       TEXT NOT NULL UNIQUE REFERENCES items(id),
          mime          TEXT NOT NULL,
          width         INTEGER,
          height        INTEGER,
          size          INTEGER,
          resource_key  TEXT,
          created_time  INTEGER,
          first_seen_at INTEGER NOT NULL,
          removed_at    INTEGER
        )`,
      ),
      // 0004_story_images.sql
      db.prepare(
        `CREATE TABLE IF NOT EXISTS story_images (
          id            TEXT PRIMARY KEY,
          story_id      TEXT NOT NULL REFERENCES items(id),
          file_id       TEXT NOT NULL UNIQUE REFERENCES files(id),
          thumb_file_id TEXT REFERENCES files(id),
          width         INTEGER,
          height        INTEGER,
          position      INTEGER NOT NULL DEFAULT 0,
          created_by    TEXT NOT NULL REFERENCES users(id),
          created_at    INTEGER NOT NULL
        )`,
      ),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_story_images_story ON story_images(story_id, position)'),
      // 0005_audio_peaks.sql
      db.prepare(
        `CREATE TABLE IF NOT EXISTS audio_peaks (
          item_id    TEXT PRIMARY KEY REFERENCES items(id),
          peaks      TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )`,
      ),
    ])
    .then(() => undefined)
    .catch((e) => {
      ensured = null;
      throw e;
    });
  return ensured;
}
