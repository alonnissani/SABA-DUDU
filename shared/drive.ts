// קישורי Google Drive: זיהוי מזהה הקובץ מכל צורות הקישור הנפוצות.

const ID = /^[A-Za-z0-9_-]{20,100}$/;

/** מחזיר את מזהה הקובץ מקישור שיתוף של Google Drive, או null אם הקישור אינו תקין. */
export function parseDriveFileId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (host !== 'drive.google.com' && host !== 'docs.google.com') return null;
  // https://drive.google.com/file/d/<id>/view?usp=sharing  (וגם /u/0/file/d/<id>)
  const m = /\/file\/(?:u\/\d+\/)?d\/([^/?#]+)/.exec(url.pathname);
  const candidate = m?.[1] ?? url.searchParams.get('id');
  return candidate && ID.test(candidate) ? candidate : null;
}

export const driveViewUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;
export const drivePreviewUrl = (id: string) => `https://drive.google.com/file/d/${id}/preview`;
export const driveThumbUrl = (id: string) => `https://drive.google.com/thumbnail?id=${id}&sz=w800`;

export interface DriveFolderRef {
  folderId: string;
  /** מפתח משאב לקישורים ישנים (resourcekey=...) — נדרש לחלק מהתיקיות שנשתפו לפני 2021 */
  resourceKey: string | null;
}

/** מחזיר את מזהה התיקייה מקישור תיקייה של Google Drive, או null אם הקישור אינו תקין. */
export function parseDriveFolder(input: string): DriveFolderRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname.toLowerCase() !== 'drive.google.com') return null;
  // https://drive.google.com/drive/folders/<id>?usp=sharing (וגם /drive/u/0/folders/<id>), או open?id=<id>
  const m = /\/folders\/([^/?#]+)/.exec(url.pathname);
  const candidate = m?.[1] ?? (url.pathname === '/open' ? url.searchParams.get('id') : null);
  if (!candidate || !ID.test(candidate)) return null;
  const rk = url.searchParams.get('resourcekey');
  return { folderId: candidate, resourceKey: rk && /^[A-Za-z0-9_-]{1,100}$/.test(rk) ? rk : null };
}

export const driveFolderUrl = (ref: DriveFolderRef) =>
  `https://drive.google.com/drive/folders/${ref.folderId}${ref.resourceKey ? `?resourcekey=${ref.resourceKey}` : ''}`;

/**
 * תמונות מ-Google Drive מוצגות באתר כ״קבצים וירטואליים״: המזהה מתחיל ב-gd: והקובץ עצמו
 * נשאר בדרייב — ה-Worker מעביר אותו מגוגל (ממוזערת או תצוגה גדולה), בלי עותק ב-R2.
 */
export const DRIVE_FILE_PREFIX = 'gd:';
export const driveVirtualId = (fileId: string, role: 'original' | 'thumb') => `${DRIVE_FILE_PREFIX}${fileId}${role === 'thumb' ? ':t' : ''}`;
export function parseDriveVirtualId(id: string): { fileId: string; role: 'original' | 'thumb' } | null {
  if (!id.startsWith(DRIVE_FILE_PREFIX)) return null;
  const rest = id.slice(DRIVE_FILE_PREFIX.length);
  const thumb = rest.endsWith(':t');
  const fileId = thumb ? rest.slice(0, -2) : rest;
  return ID.test(fileId) ? { fileId, role: thumb ? 'thumb' : 'original' } : null;
}
