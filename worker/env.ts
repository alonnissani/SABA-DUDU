import type { CurrentUser } from '../shared/types';

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  /** bucket גיבוי אופציונלי — מוגדר ב-wrangler.jsonc */
  BACKUP?: R2Bucket;
  /** סוד חד-פעמי ליצירת המנהל הראשון (wrangler secret put SETUP_TOKEN) */
  SETUP_TOKEN?: string;
  /** מפתח Google API (Drive API בלבד) לקריאת התיקייה המשפחתית — סוד: wrangler secret put GOOGLE_DRIVE_API_KEY */
  GOOGLE_DRIVE_API_KEY?: string;
  /** לבדיקות בלבד: כתובת חלופית ל-Drive API ולשרת התמונות של גוגל */
  DRIVE_API_BASE?: string;
  DRIVE_IMAGE_BASE?: string;
}

export interface AppVariables {
  user: CurrentUser | null;
  sessionId: string | null;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };
