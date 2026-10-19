-- גל הקול של הקלטה: 160 ערכי עוצמה (0-99), מחושבים מהקובץ בדפדפן. נתונים זעירים — לא עותק של ההקלטה.
CREATE TABLE IF NOT EXISTS audio_peaks (
  item_id    TEXT PRIMARY KEY REFERENCES items(id),
  peaks      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
