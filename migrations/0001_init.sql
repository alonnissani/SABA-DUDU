-- סבא דודו — סכמת בסיס הנתונים הראשונית (Cloudflare D1 / SQLite)
-- כל הזמנים נשמרים כמילישניות מאז 1970 (UTC).

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  disabled_at   INTEGER
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,           -- SHA-256 של טוקן העוגייה (הטוקן עצמו לא נשמר)
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE invites (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  email       TEXT COLLATE NOCASE,
  note        TEXT,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  used_by     TEXT REFERENCES users(id),
  revoked_at  INTEGER
);

CREATE TABLE login_attempts (
  key          TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts ON login_attempts(key, attempted_at);

-- טבלה אחת לכל חמש הקטגוריות: מאפשרת חיפוש, זיכרון אקראי ומחיקה רכה אחידים.
CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('photo', 'video', 'audio', 'story', 'document')),
  title       TEXT NOT NULL,
  description TEXT,
  body        TEXT,                      -- תוכן מלא של סיפור
  story_type  TEXT,                      -- family | personal | joke | saying | funny | lesson
  date_text   TEXT,                      -- תאריך חופשי: ״קיץ 1974״, ״בערך 1960״
  date_year   INTEGER,                   -- שנה משוערת למיון וסינון
  people      TEXT,                      -- שמות אנשים המופיעים / קשורים
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT REFERENCES users(id),
  deleted_at  INTEGER,                   -- מחיקה רכה
  deleted_by  TEXT REFERENCES users(id)
);
CREATE INDEX idx_items_kind ON items(kind, deleted_at, created_at);
CREATE INDEX idx_items_year ON items(date_year);

CREATE TABLE files (
  id            TEXT PRIMARY KEY,
  item_id       TEXT REFERENCES items(id),  -- NULL עד שהפריט נשמר
  role          TEXT NOT NULL DEFAULT 'original' CHECK (role IN ('original', 'thumb', 'poster')),
  r2_key        TEXT NOT NULL UNIQUE,       -- מפתח ייחודי שנוצר בשרת; קבצים לעולם לא נדרסים
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  sha256        TEXT,
  original_name TEXT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  duration      REAL,                       -- שניות (וידאו / שמע)
  position      INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  backed_up_at  INTEGER
);
CREATE INDEX idx_files_item ON files(item_id, role);
CREATE INDEX idx_files_backup ON files(backed_up_at);

-- העלאות גדולות (R2 multipart) שעדיין בתהליך
CREATE TABLE uploads (
  id            TEXT PRIMARY KEY,
  r2_upload_id  TEXT NOT NULL,
  r2_key        TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL,
  role          TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  completed_at  INTEGER,
  aborted_at    INTEGER
);

CREATE TABLE tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE item_tags (
  item_id TEXT NOT NULL REFERENCES items(id),
  tag_id  INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX idx_item_tags_tag ON item_tags(tag_id);

-- תגובות לסיפורים, כולל ״גם אני זוכר את זה״ (kind = 'memory')
CREATE TABLE comments (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id),
  kind        TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'memory')),
  body        TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  deleted_by  TEXT REFERENCES users(id)
);
CREATE INDEX idx_comments_item ON comments(item_id, created_at);

-- צירוף פריטי מדיה לסיפור
CREATE TABLE item_links (
  story_id  TEXT NOT NULL REFERENCES items(id),
  item_id   TEXT NOT NULL REFERENCES items(id),
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (story_id, item_id)
);

-- הכנה לתמלול עתידי של הקלטות וסרטונים (לא פעיל עדיין)
CREATE TABLE transcripts (
  item_id       TEXT PRIMARY KEY REFERENCES items(id),
  status        TEXT NOT NULL DEFAULT 'none' CHECK (status IN ('none', 'pending', 'processing', 'done', 'failed')),
  language      TEXT DEFAULT 'he',
  engine        TEXT,
  text          TEXT,
  segments_json TEXT,                    -- [{start, end, text}]
  updated_at    INTEGER
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  details     TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);

CREATE TABLE backup_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  status        TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'failed', 'skipped')),
  files_copied  INTEGER NOT NULL DEFAULT 0,
  bytes_copied  INTEGER NOT NULL DEFAULT 0,
  snapshot_key  TEXT,
  message       TEXT
);

-- אינדקס חיפוש טקסט מלא. tokenizer מסוג trigram מאפשר התאמת תת-מחרוזת,
-- כך ש״יום הולדת״ ימצא גם ״ביום ההולדת״ — חשוב בעברית בגלל אותיות השימוש.
CREATE VIRTUAL TABLE search_index USING fts5(
  item_id UNINDEXED,
  kind UNINDEXED,
  content,
  tokenize = 'trigram'
);

-- קישורי איפוס סיסמה שמנהל יוצר עבור בן משפחה ששכח סיסמה
CREATE TABLE password_resets (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
