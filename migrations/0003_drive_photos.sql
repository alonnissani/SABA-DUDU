-- תמונות מתיקיית Google Drive משפחתית: רק מזהים ונתונים בסיסיים — הקבצים עצמם נשארים בדרייב.
-- כל תמונה מקושרת לפריט רגיל מסוג photo, כדי שהגלריה, הסדר האקראי ו״זיכרון מסבא״ יעבדו כרגיל.
CREATE TABLE IF NOT EXISTS drive_photos (
  file_id       TEXT PRIMARY KEY,
  item_id       TEXT NOT NULL UNIQUE REFERENCES items(id),
  mime          TEXT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  size          INTEGER,
  resource_key  TEXT,
  created_time  INTEGER,
  first_seen_at INTEGER NOT NULL,
  -- הוסרה מהדרייב (או מהתיקייה המחוברת): מוסתרת מהאתר; חוזרת אם התמונה מופיעה שוב
  removed_at    INTEGER
);
