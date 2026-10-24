import { Hono } from 'hono';
import type { AppEnv } from '../env';
import documentCover from '../assets/document-cover.webp?inline';

/**
 * נכסים קבועים של האתר שהם חומר משפחתי (למשל תמונת ברירת המחדל של מסמכים — ציור של סבא).
 * כלולים ב-Worker ולא בתיקיית הקבצים הציבורית, ומוגשים רק למשתמשים מחוברים.
 */
export const assetRoutes = new Hono<AppEnv>();

const decode = (dataUri: string) => Uint8Array.from(atob(dataUri.slice(dataUri.indexOf(',') + 1)), (ch) => ch.charCodeAt(0));
const DOCUMENT_COVER = decode(documentCover);

assetRoutes.get('/document-cover', () =>
  new Response(DOCUMENT_COVER, {
    headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000, immutable' },
  }),
);
