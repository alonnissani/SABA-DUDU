import type { FileInfo, ItemSummary } from '../../shared/types';
import { fileUrl } from '../api/client';
import { driveThumbUrl } from '../../shared/drive';
import { isTechnicalTitle } from '../../shared/titles';

/** פורמטים שרוב הדפדפנים יודעים להציג. HEIC/TIFF מוצגים רק בחלק מהדפדפנים. */
const WEB_IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

export const originalOf = (item: Pick<ItemSummary, 'files'>): FileInfo | undefined => item.files.find((f) => f.role === 'original');
export const previewOf = (item: Pick<ItemSummary, 'files'>): FileInfo | undefined =>
  item.files.find((f) => f.role === 'thumb' || f.role === 'poster');

/** כתובת לתמונה קטנה לתצוגה בכרטיס — ממוזערת אם יש, אחרת המקור אם הדפדפן יכול להציגו. */
export function previewUrl(item: Pick<ItemSummary, 'files' | 'kind' | 'externalVideo'>): string | null {
  // סרטון מ-Google Drive: תמונה ממוזערת מגוגל (זמינה רק אם הקובץ משותף; אחרת מוצג אייקון)
  if (item.externalVideo) return driveThumbUrl(item.externalVideo.fileId);
  const p = previewOf(item);
  if (p) return fileUrl(p.id);
  const o = originalOf(item);
  if (o && (item.kind === 'photo' || item.kind === 'document') && WEB_IMAGES.includes(o.mime)) return fileUrl(o.id);
  return null;
}

export function displayableImage(f: FileInfo | undefined): boolean {
  return !!f && (WEB_IMAGES.includes(f.mime) || f.mime === 'image/heic' || f.mime === 'image/heif' || f.mime === 'image/tiff');
}

/** רוחב/גובה מקסימלי לתמונה ממוזערת — חד בגלריה ובכרטיס הזיכרון, וקל לטעינה בנייד */
export const THUMB_SIZE = 800;

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.8));
  if (webp && webp.type === 'image/webp') return webp;
  return new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
}

function drawScaled(source: CanvasImageSource, w: number, h: number, max: number): HTMLCanvasElement {
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export interface MediaMeta {
  width?: number;
  height?: number;
  duration?: number;
  preview?: Blob | null;
}

/**
 * מחלץ מידות ויוצר תמונה ממוזערת בדפדפן. קובץ המקור עצמו לא משתנה.
 * אם הדפדפן לא מצליח לפענח (למשל HEIC בכרום) — פשוט אין ממוזערת.
 */
export async function imageMeta(file: Blob): Promise<MediaMeta> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const canvas = drawScaled(bmp, bmp.width, bmp.height, THUMB_SIZE);
    const meta = { width: bmp.width, height: bmp.height, preview: await canvasToBlob(canvas) };
    bmp.close();
    return meta;
  } catch {
    // חלופה: פענוח דרך <img> — למשל HEIC בספארי, שמציג אותו אך לא תמיד דרך createImageBitmap
    return imageMetaViaElement(file);
  }
}

function imageMetaViaElement(file: Blob): Promise<MediaMeta> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (meta: MediaMeta) => {
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    img.onload = async () => {
      try {
        const canvas = drawScaled(img, img.naturalWidth, img.naturalHeight, THUMB_SIZE);
        done({ width: img.naturalWidth, height: img.naturalHeight, preview: await canvasToBlob(canvas) });
      } catch {
        done({});
      }
    };
    img.onerror = () => done({});
    img.src = url;
  });
}

export function videoMeta(file: File): Promise<MediaMeta> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    let settled = false;
    const finish = (meta: MediaMeta) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
      resolve(meta);
    };
    const timer = setTimeout(() => finish({}), 15000);
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, (video.duration || 0) / 3);
    };
    video.onseeked = async () => {
      clearTimeout(timer);
      const base = { width: video.videoWidth || undefined, height: video.videoHeight || undefined, duration: Number.isFinite(video.duration) ? video.duration : undefined };
      try {
        const canvas = drawScaled(video, video.videoWidth, video.videoHeight, THUMB_SIZE);
        finish({ ...base, preview: await canvasToBlob(canvas) });
      } catch {
        finish(base);
      }
    };
    video.onerror = () => {
      clearTimeout(timer);
      finish({});
    };
    video.src = url;
  });
}

export function audioMeta(file: File): Promise<MediaMeta> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const done = (meta: MediaMeta) => {
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    const timer = setTimeout(() => done({}), 10000);
    audio.onloadedmetadata = () => {
      clearTimeout(timer);
      done({ duration: Number.isFinite(audio.duration) ? audio.duration : undefined });
    };
    audio.onerror = () => {
      clearTimeout(timer);
      done({});
    };
    audio.src = url;
  });
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '--:--';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

const dateFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
export const formatDate = (ms: number) => dateFmt.format(new Date(ms));

export function itemDateLabel(item: Pick<ItemSummary, 'dateText' | 'dateYear'>): string | null {
  if (item.dateText) return item.dateText;
  if (item.dateYear) return String(item.dateYear);
  return null;
}

export const fileTitle = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();

/**
 * הכותרת להצגה. בתמונות, כותרת שהיא שם קובץ, מספר או מזהה טכני לא מוצגת (מחזיר null).
 * הכותרת השמורה עצמה לא משתנה.
 */
export function displayTitle(item: Pick<ItemSummary, 'kind' | 'title' | 'files'>): string | null {
  if (item.kind !== 'photo') return item.title;
  return isTechnicalTitle(item.title, originalOf(item)?.originalName) ? null : item.title;
}

/** תווית נגישות לפריט — גם כשאין כותרת מוצגת */
export const accessibleTitle = (item: Pick<ItemSummary, 'kind' | 'title' | 'files'>) => displayTitle(item) ?? 'תמונה';
