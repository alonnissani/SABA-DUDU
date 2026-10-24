import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireAdmin } from '../lib/auth';
import { fail, now, readJson } from '../lib/http';
import { audit } from '../lib/audit';
import { parseDriveFolder, driveFolderUrl } from '../../shared/drive';
import { DriveError, checkFolder, getDriveFolder, getDriveStatus, setDriveFolder, syncDrive } from '../lib/drive';
import { cleanupReport, deleteLegacyGallery, integrityCheck, separateStoryImages } from '../lib/galleryCleanup';
import { clearFileCaches } from './files';

/** חיבור Google Drive — מנהל בלבד (מוגן גם ב-adminGuard על /admin/*) */
export const driveRoutes = new Hono<AppEnv>();

driveRoutes.get('/', async (c) => {
  requireAdmin(c);
  return c.json(await getDriveStatus(c.env));
});

/** חיבור תיקייה (או החלפה): בדיקת גישה, שמירה קבועה, וסנכרון ראשון */
driveRoutes.put('/', async (c) => {
  const admin = requireAdmin(c);
  const b = await readJson(c.req.raw);
  const ref = typeof b.url === 'string' ? parseDriveFolder(b.url) : null;
  if (!ref) fail(400, 'קישור התיקייה אינו תקין. העתיקו מ-Google Drive את הקישור לשיתוף התיקייה (drive.google.com/drive/folders/…).');
  let name: string;
  try {
    name = await checkFolder(c.env, ref);
  } catch (e) {
    if (e instanceof DriveError) fail(e.status === 503 ? 503 : 400, e.message);
    throw e;
  }
  const prev = await getDriveFolder(c.env.DB);
  await setDriveFolder(c.env.DB, {
    ...ref,
    url: driveFolderUrl(ref),
    name,
    ownerId: prev?.ownerId ?? admin.id,
    connectedAt: prev?.folderId === ref.folderId ? prev.connectedAt : now(),
  });
  await audit(c.env.DB, admin.id, 'drive.connect', 'settings', ref.folderId);
  const sync = await syncDrive(c.env);
  return c.json({ sync, status: await getDriveStatus(c.env) });
});

driveRoutes.post('/sync', async (c) => {
  const admin = requireAdmin(c);
  if (!(await getDriveFolder(c.env.DB))) fail(400, 'עדיין לא חוברה תיקיית Google Drive.');
  const sync = await syncDrive(c.env);
  await audit(c.env.DB, admin.id, 'drive.sync', 'settings', null);
  return c.json({ sync, status: await getDriveStatus(c.env) });
});

// ---------- מעבר וניקוי הגלריה הישנה ----------

driveRoutes.get('/migration', async (c) => {
  requireAdmin(c);
  return c.json(await cleanupReport(c.env));
});

/** שלב 2: עותקים עצמאיים לתמונות הסיפורים (במנות) */
driveRoutes.post('/migration/separate', async (c) => {
  const admin = requireAdmin(c);
  const r = await separateStoryImages(c.env);
  await audit(c.env.DB, admin.id, 'gallery.separate_stories', 'settings', null);
  clearFileCaches();
  return c.json({ result: r, report: await cleanupReport(c.env) });
});

/** שלב 3: מחיקת תמונות הגלריה הישנות (במנות) — רק אחרי אישור מפורש */
driveRoutes.post('/migration/cleanup', async (c) => {
  const admin = requireAdmin(c);
  const b = await readJson(c.req.raw);
  if (b.confirm !== 'מחיקה') fail(400, 'כדי למחוק יש להקליד ״מחיקה״ לאישור.');
  const r = await deleteLegacyGallery(c.env, admin.id);
  await audit(c.env.DB, admin.id, 'gallery.cleanup', 'settings', null);
  clearFileCaches();
  return c.json({ result: r, report: await cleanupReport(c.env), integrity: r.remaining === 0 ? await integrityCheck(c.env) : null });
});
