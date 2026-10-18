import type { ItemDetail, ItemKind } from '../../shared/types';
import { ALLOWED_MIME, MAX_FILE_SIZE, formatBytes, resolveMime } from '../../shared/constants';
import { api, uploadFile, type NewItem } from '../api/client';
import { audioMeta, imageMeta, videoMeta, type MediaMeta } from './media';

export type MediaKind = Exclude<ItemKind, 'story'>;

/** בדיקה מקדימה בדפדפן (השרת בודק שוב). מחזיר הודעת שגיאה או null. */
export function precheck(kind: MediaKind, file: File): string | null {
  const mime = resolveMime(file.type, file.name);
  if (!ALLOWED_MIME[kind].includes(mime)) return `סוג הקובץ אינו נתמך כאן (${file.name.split('.').pop()?.toUpperCase() || mime})`;
  if (file.size === 0) return 'הקובץ ריק';
  if (file.size > MAX_FILE_SIZE[kind]) return `הקובץ גדול מדי (מקסימום ${formatBytes(MAX_FILE_SIZE[kind])})`;
  return null;
}

/** מזהה קטגוריה לפי סוג הקובץ — לצירוף קבצים לסיפור. */
export function kindForFile(file: File): MediaKind | null {
  const mime = resolveMime(file.type, file.name);
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'document';
  return null;
}

export type Stage = 'preparing' | 'uploading' | 'saving';

/**
 * העלאת קובץ אחד כפריט בארכיון:
 * 1. הפקת מידות/משך ותמונה ממוזערת בדפדפן (המקור לא משתנה)
 * 2. העלאת קובץ המקור (עם התקדמות, ובחלקים אם הוא גדול)
 * 3. העלאת הממוזערת
 * 4. יצירת הפריט
 */
export async function uploadAsItem(
  kind: MediaKind,
  file: File,
  fields: Omit<NewItem, 'kind' | 'files'>,
  onStage: (stage: Stage, progress: number) => void,
  signal?: AbortSignal,
): Promise<ItemDetail> {
  const mime = resolveMime(file.type, file.name);
  onStage('preparing', 0);
  let meta: MediaMeta = {};
  if (kind === 'photo' || (kind === 'document' && mime.startsWith('image/'))) meta = await imageMeta(file);
  else if (kind === 'video') meta = await videoMeta(file);
  else if (kind === 'audio') meta = await audioMeta(file);
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  onStage('uploading', 0);
  const original = await uploadFile(file, {
    kind, name: file.name, mime, signal,
    onProgress: (l, t) => onStage('uploading', t ? l / t : 0),
  });
  const files: NonNullable<NewItem['files']> = [{ id: original.id, width: meta.width, height: meta.height, duration: meta.duration }];
  if (meta.preview) {
    try {
      const p = await uploadFile(meta.preview, {
        kind, role: kind === 'video' ? 'poster' : 'thumb', name: `preview.${meta.preview.type === 'image/webp' ? 'webp' : 'jpg'}`, mime: meta.preview.type, signal,
      });
      files.push({ id: p.id });
    } catch {
      /* ממוזערת היא תוספת — אם נכשלה, ממשיכים בלעדיה */
    }
  }
  onStage('saving', 1);
  return api.create({ ...fields, kind, files });
}
