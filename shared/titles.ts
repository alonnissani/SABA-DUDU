// זיהוי כותרות ״טכניות״ שנוצרו אוטומטית (שם קובץ, מספר, UUID) — כדי לא להציג אותן למשתמשים.

const normalize = (s: string) =>
  s
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_\-.()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const CAMERA_PREFIX =
  /^(img|image|dsc|dscn|dscf|dcim|pxl|mvimg|photo|pic|picture|screenshot|screen shot|whatsapp image|signal|telegram|snapchat|fb img|received|scan|scanned|photo edited|edited|copy of|file)\b/;

/** האם הכותרת היא מזהה טכני ולא שם שהוזן ידנית. */
export function isTechnicalTitle(title: string | null | undefined, originalName?: string | null): boolean {
  const t = normalize(title ?? '');
  if (!t) return true;
  if (originalName && t === normalize(originalName)) return true;
  // מספר בלבד (למשל ״8813״) — מלבד שנה, שיכולה להיות כותרת אמיתית
  if (/^\d+$/.test(t) && !/^(18|19|20)\d{2}$/.test(t)) return true;
  // UUID או מחרוזת hex ארוכה
  if (/^[0-9a-f]{8} ?[0-9a-f]{4} ?[0-9a-f]{4} ?[0-9a-f]{4} ?[0-9a-f]{12}$/.test(t)) return true;
  if (/^[0-9a-f]{12,}$/.test(t.replace(/ /g, ''))) return true;
  // מחרוזת ארוכה של אותיות וספרות בלי רווחים (מזהה קובץ)
  if (/^[a-z0-9]{16,}$/.test(t) && /\d/.test(t)) return true;
  // שמות מצלמה: IMG 8813, PXL 20240101 123456, WhatsApp Image 2024 01 01 at 10 00 00
  if (CAMERA_PREFIX.test(t)) {
    const rest = t.replace(CAMERA_PREFIX, '').replace(/\b(at|e|edited|copy|\d+)\b/g, '').replace(/[\s:]/g, '');
    if (!rest) return true;
  }
  return false;
}
