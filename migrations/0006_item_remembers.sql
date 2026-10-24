-- ״גם אני זוכר את זה״ — סימון (כמו לייק) של בן משפחה על פריט, בלי תגובה כתובה.
CREATE TABLE IF NOT EXISTS item_remembers (
  item_id    TEXT NOT NULL REFERENCES items(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (item_id, user_id)
);
