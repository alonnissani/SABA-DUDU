import type { CurrentUser } from '../shared/types';

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  /** bucket גיבוי אופציונלי — מוגדר ב-wrangler.jsonc */
  BACKUP?: R2Bucket;
  /** סוד חד-פעמי ליצירת המנהל הראשון (wrangler secret put SETUP_TOKEN) */
  SETUP_TOKEN?: string;
}

export interface AppVariables {
  user: CurrentUser | null;
  sessionId: string | null;
}

export type AppEnv = { Bindings: Env; Variables: AppVariables };
