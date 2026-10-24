-- תמונות של סיפורים: מערכת נפרדת מגלריית התמונות (שמגיעה מ-Google Drive).
-- הקבצים עצמם ב-R2 תחת stories/, ושורות files שלהם משויכות לסיפור (item_id = מזהה הסיפור).
CREATE TABLE IF NOT EXISTS story_images (
  id            TEXT PRIMARY KEY,
  story_id      TEXT NOT NULL REFERENCES items(id),
  file_id       TEXT NOT NULL UNIQUE REFERENCES files(id),
  thumb_file_id TEXT REFERENCES files(id),
  width         INTEGER,
  height        INTEGER,
  position      INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_story_images_story ON story_images(story_id, position);
