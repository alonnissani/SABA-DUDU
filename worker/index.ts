import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv, Env } from './env';
import { adminGuard, loadSession, sameOriginGuard, userGuard } from './lib/auth';
import { getSiteSettings } from './lib/settings';
import { runBackup } from './lib/backup';
import { ensureSchema } from './lib/schema';
import { authRoutes } from './routes/auth';
import { itemRoutes } from './routes/items';
import { uploadRoutes } from './routes/uploads';
import { fileRoutes } from './routes/files';
import { searchRoutes } from './routes/search';
import { adminRoutes } from './routes/admin';
import { assetRoutes } from './routes/assets';

const app = new Hono<AppEnv>().basePath('/api');

app.use('*', async (c, next) => {
  await next();
  c.header('x-content-type-options', 'nosniff');
  c.header('referrer-policy', 'same-origin');
  if (!c.res.headers.has('cache-control')) c.header('cache-control', 'no-store');
});
app.use('*', async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});
app.use('*', sameOriginGuard);
app.use('*', loadSession);

app.route('/auth', authRoutes);

// מכאן והלאה — משתמשים מחוברים בלבד
app.use('/uploads/*', userGuard);
app.use('/files/*', userGuard);
app.use('/assets/*', userGuard);
app.use('/search', userGuard);
app.use('/settings', userGuard);
app.use('/admin/*', adminGuard);

app.get('/settings', async (c) => c.json(await getSiteSettings(c.env.DB)));
app.route('/uploads', uploadRoutes);
app.route('/files', fileRoutes);
app.route('/assets', assetRoutes);
app.route('/search', searchRoutes);
app.route('/admin', adminRoutes);
app.route('/', itemRoutes);

app.notFound((c) => c.json({ error: 'לא נמצא' }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: 'אירעה שגיאה בשרת. נסו שוב.' }, 500);
});

export default {
  fetch: app.fetch,
  /** גיבוי לילי — פועל רק אם הוגדר bucket גיבוי (BACKUP). */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runBackup(env, { maxFiles: 300, timeBudgetMs: 10 * 60 * 1000 }));
  },
} satisfies ExportedHandler<Env>;
