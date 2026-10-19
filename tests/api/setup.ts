import { beforeEach } from 'vitest';
import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      MEDIA: R2Bucket;
      BACKUP?: R2Bucket;
      SETUP_TOKEN?: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

const TABLES = [
  'search_index', 'external_media', 'drive_photos', 'story_images', 'item_links', 'item_tags', 'comments', 'transcripts', 'files', 'uploads', 'items', 'tags',
  'password_resets', 'invites', 'sessions', 'login_attempts', 'settings', 'audit_log', 'backup_runs', 'users',
];

async function clearBucket(bucket: R2Bucket | undefined) {
  if (!bucket) return;
  const list = await bucket.list();
  if (list.objects.length) await bucket.delete(list.objects.map((o) => o.key));
}

// כל בדיקה מתחילה מארכיון ריק
beforeEach(async () => {
  await env.DB.batch(TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await clearBucket(env.MEDIA);
  await clearBucket(env.BACKUP);
});
