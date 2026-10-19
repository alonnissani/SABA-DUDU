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
