import type { ItemKind, StoryType } from './types';

export const ITEM_KINDS: ItemKind[] = ['photo', 'video', 'audio', 'story', 'document'];

export const KIND_LABELS: Record<ItemKind, { singular: string; plural: string }> = {
  photo: { singular: 'תמונה', plural: 'תמונות' },
  video: { singular: 'סרטון', plural: 'סרטונים' },
  audio: { singular: 'הקלטה', plural: 'הקלטות' },
  story: { singular: 'סיפור', plural: 'סיפורים' },
  document: { singular: 'מסמך', plural: 'מסמכים' },
};

export const STORY_TYPES: { value: StoryType; label: string }[] = [
  { value: 'family', label: 'סיפור משפחתי' },
  { value: 'personal', label: 'זיכרון אישי' },
  { value: 'joke', label: 'בדיחה של סבא' },
  { value: 'saying', label: 'משפט שסבא היה אומר' },
  { value: 'funny', label: 'רגע מצחיק' },
  { value: 'lesson', label: 'משהו שלמדנו מסבא' },
];

export const STORY_TYPE_LABEL: Record<StoryType, string> = Object.fromEntries(
  STORY_TYPES.map((t) => [t.value, t.label]),
) as Record<StoryType, string>;

const MB = 1024 * 1024;

/** קבצים עד גודל זה עולים בבקשה אחת; גדולים יותר — בחלקים (multipart). */
export const DIRECT_UPLOAD_MAX = 25 * MB;
/** גודל חלק בהעלאה מרובת חלקים (R2 דורש לפחות 5MB לחלק). */
export const MULTIPART_PART_SIZE = 10 * MB;
/** גודל מקסימלי לממוזערת / פוסטר שנוצרים בדפדפן. */
export const THUMB_MAX = 3 * MB;

/** גודל מקסימלי לקובץ מקור, לפי קטגוריה. */
export const MAX_FILE_SIZE: Record<Exclude<ItemKind, 'story'>, number> = {
  photo: 100 * MB,
  video: 4 * 1024 * MB, // מתחת למגבלת 5GB של העתקה בודדת ב-R2 (לגיבוי)
  audio: 2 * 1024 * MB,
  document: 300 * MB,
};

/** סוגי קבצים מותרים, לפי קטגוריה. */
export const ALLOWED_MIME: Record<Exclude<ItemKind, 'story'>, string[]> = {
  photo: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/avif'],
  video: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp'],
  audio: [
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/wave',
    'audio/ogg', 'audio/webm', 'audio/flac', 'audio/x-flac', 'audio/amr', 'audio/3gpp',
  ],
  document: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/tiff'],
};

/** סיומות לזיהוי סוג הקובץ כשהדפדפן לא מוסר MIME. */
export const EXTENSION_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg',
  oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', amr: 'audio/amr',
  pdf: 'application/pdf',
};

export const ACCEPT_ATTR: Record<Exclude<ItemKind, 'story'>, string> = {
  photo: 'image/*,.heic,.heif',
  video: 'video/*,.mov,.m4v,.3gp',
  audio: 'audio/*,.m4a,.mp3,.wav,.aac,.ogg,.opus,.flac,.amr',
  document: 'application/pdf,image/*,.pdf,.heic,.tif,.tiff',
};

export const DEFAULT_SITE_TITLE = 'סבא דודו';
export const DEFAULT_SUBTITLE = 'ארכיון הזיכרונות המשפחתי';

export function resolveMime(claimed: string | null | undefined, filename: string): string {
  const clean = (claimed || '').split(';')[0].trim().toLowerCase();
  if (clean && clean !== 'application/octet-stream') return clean;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME[ext] ?? 'application/octet-stream';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
