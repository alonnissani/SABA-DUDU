import type { FileRole, ItemKind } from '../../shared/types';
import { ALLOWED_MIME, MAX_FILE_SIZE, THUMB_MAX, resolveMime } from '../../shared/constants';
import { fail } from './http';

export type MediaKind = Exclude<ItemKind, 'story'>;

export function parseMediaKind(value: unknown): MediaKind {
  if (value === 'photo' || value === 'video' || value === 'audio' || value === 'document') return value;
  fail(400, 'קטגוריה לא תקינה להעלאת קובץ');
}

/** נתיב האחסון של תמונות הסיפורים — נפרד לחלוטין מהגלריה (שמגיעה מ-Google Drive) */
export const STORY_PREFIX = 'stories/';

/** העלאה: קטגוריה רגילה, או ״story״ — תמונה של סיפור (נבדקת כמו תמונה, נשמרת בנתיב הסיפורים) */
export const VIDEO_LINK_ONLY = 'סרטונים מוסיפים כקישור ל-Google Drive';

export function parseUploadKind(value: unknown): { kind: MediaKind; story: boolean } {
  if (value === 'story') return { kind: 'photo', story: true };
  const kind = parseMediaKind(value);
  // סרטונים לא נשמרים באתר — רק קישור לקובץ ב-Google Drive
  if (kind === 'video') fail(400, VIDEO_LINK_ONLY);
  return { kind, story: false };
}

export function parseFileRole(value: unknown): FileRole {
  if (value === undefined || value === null || value === '' || value === 'original') return 'original';
  if (value === 'thumb' || value === 'poster') return value;
  fail(400, 'סוג קובץ לא תקין');
}

export function cleanFileName(name: unknown): string {
  const raw = typeof name === 'string' ? name : '';
  // מסירים נתיבים ותווי בקרה; שומרים עברית ותווים רגילים
  const base = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '').trim().slice(0, 180);
  return cleaned || 'file';
}

/**
 * בדיקה מוקדמת (לפני קבלת הקובץ): סוג MIME מותר וגודל בגבולות.
 * מחזיר את ה-MIME הסופי שיישמר.
 */
export function checkDeclaredFile(kind: MediaKind, role: FileRole, mimeClaim: string | null, name: string, size: number): string {
  if (!Number.isFinite(size) || size <= 0) fail(400, 'הקובץ ריק');
  const mime = resolveMime(mimeClaim, name);
  if (role !== 'original') {
    if (mime !== 'image/webp' && mime !== 'image/jpeg' && mime !== 'image/png') fail(415, 'תמונה ממוזערת בפורמט לא נתמך');
    if (size > THUMB_MAX) fail(413, 'התמונה הממוזערת גדולה מדי');
    return mime;
  }
  if (!ALLOWED_MIME[kind].includes(mime)) fail(415, `סוג הקובץ (${mime}) אינו נתמך בקטגוריה זו`);
  if (size > MAX_FILE_SIZE[kind]) fail(413, 'הקובץ גדול מהמותר בקטגוריה זו');
  return mime;
}

type Family = 'jpeg' | 'png' | 'gif' | 'webp' | 'tiff' | 'isobmff' | 'ebml' | 'mp3' | 'aac' | 'wav' | 'ogg' | 'flac' | 'amr' | 'pdf';

function ascii(bytes: Uint8Array, start: number, len: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + len));
}

/** זיהוי סוג הקובץ לפי ״חתימת הבתים״ שבתחילתו. */
export function sniff(bytes: Uint8Array): Family | null {
  if (bytes.length < 4) return null;
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return 'wav';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 0x2a)) return 'tiff';
  if (ascii(b, 4, 4) === 'ftyp') return 'isobmff'; // mp4, mov, m4a, heic, avif, 3gp
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'ebml'; // webm / mkv
  if (ascii(b, 0, 3) === 'ID3') return 'mp3';
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'aac'; // ADTS
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3'; // MPEG frame sync
  if (ascii(b, 0, 4) === 'OggS') return 'ogg';
  if (ascii(b, 0, 4) === 'fLaC') return 'flac';
  if (ascii(b, 0, 5) === '#!AMR') return 'amr';
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  return null;
}

const FAMILY_FOR_MIME: Record<string, Family[]> = {
  'image/jpeg': ['jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/tiff': ['tiff'],
  'image/heic': ['isobmff'],
  'image/heif': ['isobmff'],
  'image/avif': ['isobmff'],
  'video/mp4': ['isobmff'],
  'video/quicktime': ['isobmff'],
  'video/x-m4v': ['isobmff'],
  'video/3gpp': ['isobmff'],
  'video/webm': ['ebml'],
  'audio/mp4': ['isobmff'],
  'audio/x-m4a': ['isobmff'],
  'audio/3gpp': ['isobmff'],
  'audio/mpeg': ['mp3'],
  'audio/aac': ['aac', 'isobmff'],
  'audio/wav': ['wav'],
  'audio/x-wav': ['wav'],
  'audio/wave': ['wav'],
  'audio/ogg': ['ogg'],
  'audio/webm': ['ebml'],
  'audio/flac': ['flac'],
  'audio/x-flac': ['flac'],
  'audio/amr': ['amr'],
  'application/pdf': ['pdf'],
};

/** מוודא שתוכן הקובץ תואם לסוג המוצהר — מונע העלאת קובץ מזויף. */
export function checkContent(mime: string, head: Uint8Array): void {
  const family = sniff(head);
  const allowed = FAMILY_FOR_MIME[mime];
  if (!family || !allowed || !allowed.includes(family)) {
    fail(415, 'תוכן הקובץ אינו תואם לסוג הקובץ. ייתכן שהקובץ פגום.');
  }
}

export function extensionFor(mime: string, name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (/^[a-z0-9]{1,5}$/.test(ext)) return ext;
  const fromMime = mime.split('/')[1]?.replace(/^x-/, '') ?? 'bin';
  return fromMime.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
}

/** מפתח אחסון ייחודי — נוצר בשרת בלבד, ולכן קובץ קיים לעולם לא נדרס. */
export function storageKey(kind: MediaKind, role: FileRole, fileId: string, mime: string, name: string, story = false): string {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const folder = role === 'original' ? 'originals' : 'previews';
  if (story) return `${STORY_PREFIX}${folder}/${ym}/${fileId}.${extensionFor(mime, name)}`;
  return `${folder}/${kind}/${ym}/${fileId}.${extensionFor(mime, name)}`;
}
