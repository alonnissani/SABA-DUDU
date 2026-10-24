-- סרטונים חיצוניים (קישור ל-Google Drive) — לא נשמרים ב-R2.
-- טבלה נפרדת ו-IF NOT EXISTS: בטוח להרצה חוזרת, וה-Worker יוצר אותה גם בעצמו אם ה-migration לא הוחל.
CREATE TABLE IF NOT EXISTS external_media (
  item_id    TEXT PRIMARY KEY REFERENCES items(id),
  provider   TEXT NOT NULL CHECK (provider IN ('gdrive')),
  file_id    TEXT NOT NULL,
  url        TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
