import { devices, expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { FIXTURES } from './global-setup';
import { MOCK_FOLDER, setDriveMock } from './drive-mock';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';

// תיקיית Google Drive המדומה: 44 תמונות (אופקיות ואנכיות), חלקן בתיקיית משנה
const DRIVE_URL = `https://drive.google.com/drive/folders/${MOCK_FOLDER}?usp=sharing`;
const SUB_FOLDER = { id: '1E2eSubFolderAbcdefghijklmno', parent: MOCK_FOLDER, mime: 'application/vnd.google-apps.folder' };
const drivePhoto = (n: number, parent = MOCK_FOLDER) => ({
  id: `1E2eDrivePhoto${String(n).padStart(3, '0')}abcdefghijk`,
  parent,
  mime: 'image/jpeg',
  width: n % 2 ? 900 : 1200,
  height: n % 2 ? 1200 : 900,
});
const BASE_PHOTOS = [...Array.from({ length: 42 }, (_, i) => drivePhoto(i + 1)), SUB_FOLDER, drivePhoto(43, SUB_FOLDER.id), drivePhoto(44, SUB_FOLDER.id)];

const SHOTS = path.resolve('test-results/screens');
const SETUP_TOKEN = process.env.E2E_SETUP_TOKEN ?? 'local-dev-setup-token';
const ADMIN = { name: 'מנהל הבדיקה', email: 'admin@e2e.test', password: 'e2e-admin-pass' };
const fx = (f: string) => path.join(FIXTURES, f);
/**
 * סרטון ״ישן״ שהועלה לאתר לפני שהסרטונים עברו לקישורי Drive בלבד.
 * האתר כבר לא מאפשר ליצור כאלה, ולכן נכתב ישירות ל-D1 ול-R2 המקומיים (כמו npm run e2e:reset).
 */
function seedLegacyVideo(title: string) {
  const itemId = randomUUID();
  const fileId = randomUUID();
  const key = `originals/video/legacy/${fileId}.webm`;
  const wrangler = (args: string[]) => execFileSync('npx', ['wrangler', ...args], { stdio: 'pipe' });
  wrangler(['r2', 'object', 'put', `saba-dudu-media/${key}`, '--local', '--file', fx('clip.webm'), '--content-type', 'video/webm']);
  const size = statSync(fx('clip.webm')).size;
  const t = Date.now();
  const admin = "(SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)";
  wrangler(['d1', 'execute', 'saba-dudu-db', '--local', '--command', [
    `INSERT INTO items (id, kind, title, created_by, created_at, updated_at) VALUES ('${itemId}', 'video', '${title}', ${admin}, ${t}, ${t});`,
    `INSERT INTO files (id, item_id, role, r2_key, mime, size, original_name, duration, created_by, created_at) VALUES ('${fileId}', '${itemId}', 'original', '${key}', 'video/webm', ${size}, 'clip.webm', 3, ${admin}, ${t});`,
    `INSERT INTO transcripts (item_id, status, updated_at) VALUES ('${itemId}', 'none', ${t});`,
  ].join(' ')]);
  return itemId;
}
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

async function expectTabsVisible(page: Page) {
  const tabs = page.locator('.tabs--bottom .tabs__tab');
  await expect(tabs).toHaveCount(6);
  const { width: vw, height: vh } = page.viewportSize()!;
  for (let i = 0; i < 6; i++) {
    const box = (await tabs.nth(i).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(vh);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vw + 0.5);
    // הכיתוב לא נחתך
    const clipped = await tabs.nth(i).locator('span').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped).toBe(false);
  }
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('מסך פתיחה והקמת מנהל ראשון', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'סבא דודו' })).toBeVisible();
  await expect(page.locator('.frame__placeholder')).toBeVisible();
  await page.waitForTimeout(1600);
  await shot(page, '01-landing-mobile');
  await page.getByRole('button', { name: 'כניסה לזיכרונות' }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel('קוד הקמה').fill(SETUP_TOKEN);
  await page.getByLabel('השם שלך').fill(ADMIN.name);
  await page.getByLabel('דוא״ל').fill(ADMIN.email);
  await page.getByLabel('סיסמה', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('אימות סיסמה').fill(ADMIN.password);
  await page.getByRole('button', { name: 'יצירת חשבון מנהל' }).click();
  await expect(page).toHaveURL(/\/settings\/hero$/);
});

async function login(page: Page, email = ADMIN.email, password = ADMIN.password) {
  await page.goto('/login');
  await page.getByLabel('דוא״ל').fill(email);
  await page.getByLabel('סיסמה').fill(password);
  await page.getByRole('button', { name: 'כניסה' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

test('מסך בית ריק, לשוניות נגישות ומצבי ריק', async ({ page }) => {
  await login(page);
  await expect(page.getByText('עדיין אין תמונות בגלריה')).toBeVisible();
  await expectTabsVisible(page);
  await noHorizontalScroll(page);
  await shot(page, '02-home-empty');
  for (const [kind, text] of [['photo', 'עדיין אין תמונות'], ['video', 'עדיין אין סרטונים'], ['audio', 'עדיין אין הקלטות'], ['story', 'עדיין לא נכתבו'], ['document', 'עדיין אין מסמכים']]) {
    await page.locator('.tabs--bottom').getByRole('link', { name: { photo: 'תמונות', video: 'סרטונים', audio: 'הקלטות', story: 'סיפורים', document: 'מסמכים' }[kind]! }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${kind}$`));
    await expect(page.getByText(text)).toBeVisible();
  }
  await shot(page, '03-documents-empty');
});

test('Google Drive: חיבור התיקייה, הגלריה מהדרייב ותצוגה במסך מלא', async ({ page }) => {
  await login(page);
  await setDriveMock({ fail: null, files: BASE_PHOTOS });
  // אין העלאה לגלריה דרך האתר — רק דרך הדרייב
  await page.goto('/c/photo/new');
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'חיבור Google Drive' })).toBeVisible();

  await page.goto('/settings/drive');
  await expect(page.locator('.drive-state')).toContainText('לא מחובר');
  const input = page.getByLabel('קישור לתיקיית Google Drive');
  // קישור לא תקין (למשל אלבום Google Photos)
  await input.fill('https://photos.app.goo.gl/LiqUPzShxxnfGjCb6');
  await page.getByRole('button', { name: 'חיבור תיקייה' }).click();
  await expect(page.getByText('אינו קישור לתיקייה')).toBeVisible();
  // תיקייה שלא קיימת / לא משותפת
  await input.fill('https://drive.google.com/drive/folders/1E2eMissingFolderAbcdefghij');
  await page.getByRole('button', { name: 'חיבור תיקייה' }).click();
  await expect(page.getByText('התיקייה לא נמצאה')).toBeVisible();
  // התיקייה הנכונה — חיבור וסנכרון ראשון (כולל תיקיית משנה)
  await input.fill(DRIVE_URL);
  await page.getByRole('button', { name: 'חיבור תיקייה' }).click();
  await expect(page.locator('.drive-state')).toContainText('מחובר', { timeout: 15_000 });
  await expect(page.getByTestId('drive-count')).toHaveText('44');
  await page.screenshot({ path: path.join(SHOTS, '43-drive-settings.png') });

  await page.goto('/c/photo');
  const add = page.getByRole('link', { name: 'הוספת תמונות לדרייב' });
  await expect(add).toHaveAttribute('href', `https://drive.google.com/drive/folders/${MOCK_FOLDER}`);
  await expect(add).toHaveAttribute('target', '_blank');
  await expect(page.locator('.drive-note')).toBeVisible();
  await expect(page.locator('.page-head__sub')).toContainText('44');
  const imgs = page.locator('.photo-tile img');
  await expect.poll(() => imgs.evaluateAll((els) => els.filter((e) => (e as HTMLImageElement).naturalWidth > 0).length)).toBeGreaterThan(5);
  expect(await page.locator('.photo-tile img:not([src*="/api/files/gd:"])').count()).toBe(0);
  await page.waitForTimeout(600);
  await shot(page, '05-gallery');

  await page.locator('.photo-tile__btn').first().click();
  const lb = page.locator('.lightbox');
  await expect(lb).toBeVisible();
  const full = page.locator('.lightbox .lightbox__img img').last();
  await expect(full).toHaveAttribute('src', /\/api\/files\/gd:[^:]+$/);
  await expect.poll(() => full.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'הגדלה' }).click();
  await expect(page.locator('.lightbox__img')).toHaveAttribute('style', /scale\(1\.5\)/);
  // בתוך האתר: בלי קישור ל-Google Drive (גם לא ״הורדה״ שמעבירה לגוגל) ובלי תאריך העלאה
  await expect(page.getByRole('link', { name: 'הורדת קובץ המקור' })).toHaveCount(0);
  await expect(lb.locator('a[href*="google.com"]')).toHaveCount(0);
  await expect(lb.locator('.meta')).toHaveCount(0);
  expect(await lb.evaluate((el) => getComputedStyle(el.querySelector('.lightbox__img img:last-child')!).objectFit)).toBe('contain');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, '06-lightbox.png') });
  await page.getByRole('button', { name: 'סגירה' }).click();
  await expect(lb).toBeHidden();
  await expect(page).toHaveURL(/\/c\/photo$/);
  // ״חזרה״ בטלפון סוגרת את התצוגה ונשארים בגלריה
  await page.locator('.photo-tile__btn').first().click();
  await expect(lb).toBeVisible();
  await page.goBack();
  await expect(lb).toBeHidden();
  await expect(page).toHaveURL(/\/c\/photo$/);
  await expect(page.locator('.photo-tile').first()).toBeVisible();
  // החלקה עוברת לתמונה הבאה (גרירה ימינה = הבאה, בעברית)
  await page.locator('.photo-tile__btn').first().click();
  await expect(page.locator('.lightbox__count')).toHaveText(/^1 \/ /);
  const stage = (await page.locator('.lightbox__stage').boundingBox())!;
  await page.mouse.move(stage.x + stage.width * 0.3, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * 0.55, stage.y + stage.height / 2, { steps: 6 });
  await page.mouse.move(stage.x + stage.width * 0.75, stage.y + stage.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.lightbox__count')).toHaveText(/^2 \/ /);
  await page.getByRole('button', { name: 'סגירה' }).click();
  await expect(lb).toBeHidden();
  await expect(page).toHaveURL(/\/c\/photo$/);
  // הדף ״הוספת תמונות״ מפנה עכשיו לתיקייה
  await page.goto('/c/photo/new');
  await expect(page.getByRole('link', { name: 'הוספת תמונות לדרייב' })).toBeVisible();
});

test('העלאת הקלטה, נגן שמע ואורך ההקלטה', async ({ page }) => {
  await login(page);
  await page.goto('/c/audio/new');
  await page.locator('input[type=file]').setInputFiles(fx('tone.wav'));
  await page.locator('.pending__title').fill('סבא שר ביום הולדת');
  await page.getByRole('button', { name: 'שמירה' }).click();
  await expect(page).toHaveURL(/\/c\/audio$/, { timeout: 30_000 });
  const card = page.locator('.audio-card').first();
  await expect(card.locator('.player__time').last()).toHaveText('0:06');
  // גל קול אמיתי — חושב מהקובץ בהעלאה ונשמר בשרת
  await expect(card.locator('.wave__bars').first()).toBeVisible();
  const audioItems = async () => ((await (await page.request.get('/api/items?kind=audio&sort=new&limit=50')).json()) as { items: { id: string; title: string; waveform: number[] | null; files: { id: string }[] }[] }).items;
  const uploaded = (await audioItems()).find((i) => i.title === 'סבא שר ביום הולדת')!;
  expect(uploaded.waveform).toHaveLength(160);
  expect(Math.max(...uploaded.waveform!)).toBe(99);
  // מהירות השמעה
  await card.getByRole('button', { name: /מהירות השמעה/ }).click();
  await expect(card.getByRole('button', { name: /מהירות השמעה/ })).toHaveText('1.25×');
  await card.getByRole('button', { name: /השמעת/ }).click();
  await expect(card.getByRole('button', { name: /השהיית/ })).toBeVisible();
  expect(await card.locator('audio').evaluate((a: HTMLAudioElement) => a.playbackRate)).toBe(1.25);
  // התקדמות: הזמן שעבר והזמן שנותר, והחלק ״שהושמע״ של הגל מתקדם
  await expect(card.locator('.player__time').last()).toHaveText(/^−0:0\d$/);
  await expect.poll(() => card.locator('.wave').evaluate((w) => parseFloat(getComputedStyle(w).getPropertyValue('--pct')))).toBeGreaterThan(5);
  await card.getByRole('button', { name: /השהיית/ }).click();
  await card.getByRole('button', { name: /מהירות השמעה/ }).click({ clickCount: 4 });
  await expect(card.getByRole('button', { name: /מהירות השמעה/ })).toHaveText('1×');
  await page.waitForTimeout(300);
  await shot(page, '07-audio-list');

  // הקלטה ״ישנה״ בלי גל קול — הגל מחושב בהשמעה הראשונה ונשמר; ההקלטה עצמה לא משתנה
  const origin = new URL(page.url()).origin;
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(fx('tone.wav'));
  const up = (await (await page.request.post('/api/uploads/direct?kind=audio&role=original&name=old.wav', { headers: { origin, 'content-type': 'audio/wav' }, data: bytes })).json()) as { id: string };
  const created = await page.request.post('/api/items', { headers: { origin }, data: { kind: 'audio', title: 'הקלטה ישנה של סבא', files: [{ id: up.id, duration: 6 }] } });
  expect(created.status()).toBe(201);
  const old = (await audioItems()).find((i) => i.title === 'הקלטה ישנה של סבא')!;
  expect(old.waveform).toBeNull();
  await page.reload();
  const oldCard = page.locator('.audio-card', { hasText: 'הקלטה ישנה של סבא' });
  await expect(oldCard.locator('.wave--flat')).toBeVisible();
  await oldCard.getByRole('button', { name: /השמעת/ }).click();
  await expect(oldCard.locator('.wave__bars').first()).toBeVisible({ timeout: 15_000 });
  await oldCard.getByRole('button', { name: /השהיית/ }).click();
  await expect.poll(async () => (await audioItems()).find((i) => i.title === 'הקלטה ישנה של סבא')!.waveform?.length ?? 0).toBe(160);
  const original = await page.request.get(`/api/files/${up.id}`);
  expect(Buffer.from(await original.body()).equals(bytes)).toBe(true);

  // השמעה ברצף: בסוף ההקלטה הראשונה מתחילה הבאה ברשימה
  await expect(page.getByRole('button', { name: 'השמעה ברצף' })).toHaveAttribute('aria-pressed', 'true');
  const cards = page.locator('.audio-card');
  await cards.nth(0).getByRole('button', { name: /השמעת/ }).click();
  await expect(cards.nth(0).getByRole('button', { name: /השהיית/ })).toBeVisible();
  await cards.nth(0).locator('audio').evaluate((a: HTMLAudioElement) => { a.currentTime = Math.max(0, a.duration - 0.4); });
  await expect(cards.nth(1).getByRole('button', { name: /השהיית/ })).toBeVisible({ timeout: 10_000 });
  await cards.nth(1).getByRole('button', { name: /השהיית/ }).click();
});

test('סרטון: רק קישור Drive (אין העלאה מהמכשיר); סרטון ישן שהועלה כקובץ ממשיך לעבוד; העלאת מסמך', async ({ page }) => {
  await login(page);
  await page.goto('/c/video/new');
  await expect(page.getByLabel('קישור שיתוף מ-Google Drive')).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(page.getByText('העלאת קובץ מהמכשיר')).toHaveCount(0);
  await shot(page, '08a-video-link-only');
  // גם בטופס הסיפור אי אפשר להעלות קובץ סרטון
  await page.goto('/c/story/new');
  expect(await page.locator('.attach-actions input[type=file]').getAttribute('accept')).not.toContain('video');

  // סרטון שהועלה לאתר בעבר (לפני השינוי) — מוצג ומתנגן כרגיל
  const legacyId = seedLegacyVideo('ריקוד במסיבת יום ההולדת');
  // עריכה דרך האתר מעדכנת גם את אינדקס החיפוש
  const edited = await page.request.patch(`/api/items/${legacyId}`, { data: { title: 'ריקוד במסיבת יום ההולדת' }, headers: { origin: new URL(page.url()).origin } });
  expect(edited.status()).toBe(200);
  await page.goto('/c/video');
  await expect(page.locator('.media-card__dur')).toHaveText('0:03');
  await shot(page, '08-videos');
  await page.locator('.media-card').first().click();
  await expect(page.locator('.theater video')).toBeVisible();
  await page.getByRole('link', { name: 'לדף הסרטון ותגובות' }).click();
  await expect(page.locator('video.video')).toBeVisible();
  const playable = await page.locator('video.video').evaluate((v: HTMLVideoElement) => new Promise((r) => {
    if (v.readyState >= 1) r(v.duration);
    v.addEventListener('loadedmetadata', () => r(v.duration));
    v.load();
  }));
  expect(Number(playable)).toBeGreaterThan(2);
  await shot(page, '09-video-page');

  await page.goto('/c/document/new');
  await page.locator('input[type=file]').setInputFiles(fx('letter.pdf'));
  await page.locator('.pending__title').fill('הזמנה למסיבה');
  await page.getByLabel('תיאור (לא חובה)').fill('הזמנה מודפסת למסיבת יום ההולדת');
  await page.getByRole('button', { name: 'שמירה' }).click();
  await expect(page).toHaveURL(/\/c\/document$/, { timeout: 30_000 });
  // PDF בלי תמונה מקדימה — תמונת ברירת המחדל הקבועה, ביחס המקורי שלה (2:3), בלי מתיחה
  const cover = page.locator('.doc-card__sheet--cover img');
  await expect(cover).toHaveCount(1);
  await expect.poll(() => cover.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  const c = await cover.evaluate((el: HTMLImageElement) => {
    const r = el.getBoundingClientRect();
    return { box: r.width / r.height, natural: el.naturalWidth / el.naturalHeight };
  });
  expect(Math.abs(c.box - 2 / 3)).toBeLessThan(0.02);
  expect(Math.abs(c.natural - 2 / 3)).toBeLessThan(0.02);
  await page.locator('.doc-card').first().click();
  await expect(page.locator('iframe.doc-view__frame')).toBeVisible();
  await shot(page, '10-document-page');
});

test('סיפור עם צירוף ותמונה משלו, ״גם אני זוכר את זה״ — התמונה לא נכנסת לגלריה', async ({ page }) => {
  await login(page);
  const galleryTotal = async () => ((await (await page.request.get('/api/items?kind=photo&limit=1')).json()) as { total: number }).total;
  const before = await galleryTotal();
  await page.goto('/c/story/new');
  await page.getByText('בדיחה של סבא').click();
  await page.getByLabel('כותרת').fill('הבדיחה מיום ההולדת');
  await page.getByLabel('הסיפור').fill('בכל יום הולדת סבא היה עומד, מרים כוס ואומר משפט אחד קבוע.\nכולם כבר ידעו מה יבוא — ובכל זאת צחקו.');
  await page.getByRole('button', { name: 'בחירה מהארכיון' }).click();
  // תמונות הגלריה לא מוצעות לצירוף — לסיפור יש תמונות משלו
  await expect(page.locator('dialog .chips').getByRole('tab', { name: 'תמונות' })).toHaveCount(0);
  await page.getByRole('button', { name: 'צירוף' }).first().click();
  await page.getByRole('button', { name: 'סיום' }).click();
  await page.locator('.attach-actions input[type=file]').setInputFiles(fx('photo-a.jpg'));
  await expect(page.getByText('תמונה לסיפור')).toBeVisible();
  await shot(page, '11-story-form');
  await page.getByRole('button', { name: 'שמירה ופרסום' }).click();
  await expect(page).toHaveURL(/\/item\//, { timeout: 30_000 });
  await expect(page.locator('.sheet__title')).toHaveText('הבדיחה מיום ההולדת');
  await expect(page.locator('.sheet__photo img')).toBeVisible();
  await expect.poll(() => page.locator('.sheet__photo img').evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  // התמונה של הסיפור לא נוספה לגלריה
  expect(await galleryTotal()).toBe(before);
  await page.getByRole('button', { name: 'גם אני זוכר את זה' }).click();
  await page.getByLabel('מה את/ה זוכר/ת?').fill('נכון! ואז סבתא תמיד גלגלה עיניים.');
  await page.getByRole('button', { name: 'פרסום' }).click();
  await expect(page.locator('.comment--memory')).toBeVisible();
  await shot(page, '12-story-page');
});

test('חיפוש בכל הקטגוריות', async ({ page }) => {
  await login(page);
  await page.goto('/search');
  await page.getByLabel('מה מחפשים?').fill('יום הולדת');
  await page.getByRole('button', { name: 'חיפוש', exact: true }).click();
  await expect(page.getByText(/נמצאו \d+ תוצאות/)).toBeVisible();
  for (const label of ['סרטונים', 'הקלטות', 'סיפורים', 'מסמכים']) {
    await expect(page.locator('.search__group h2', { hasText: label })).toBeVisible();
  }
  await shot(page, '13-search');
  await page.locator('.chips').getByRole('button', { name: 'הקלטות' }).click();
  await expect(page.locator('.search__group')).toHaveCount(1);
});

test('בלי תאריכי העלאה בסיפורים, בהקלטות ובמסמכים — רק תאריכים שהם חלק מהתוכן', async ({ page }) => {
  await login(page);
  const year = String(new Date().getFullYear());
  for (const kind of ['story', 'audio', 'document']) {
    await page.goto(`/c/${kind}`);
    const cards = page.locator(kind === 'story' ? '.story-card' : kind === 'audio' ? '.audio-card' : '.doc-card');
    await expect(cards.first()).toBeVisible();
    await expect(cards.locator('.meta .meta__muted')).toHaveCount(0);
    for (const t of await cards.allInnerTexts()) expect(t, kind).not.toContain(year);
    const list = (await (await page.request.get(`/api/items?kind=${kind}&limit=1`)).json()) as { items: { id: string }[] };
    await page.goto(`/item/${list.items[0].id}`);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('.meta .meta__muted')).toHaveCount(0);
    await expect(page.locator(kind === 'story' ? '.sheet__byline' : '.meta').first()).not.toContainText(year);
  }
  // תאריך שהוא חלק מהתוכן (״תאריך או תקופה״) — עדיין מוצג
  const origin = new URL(page.url()).origin;
  const s = (await (await page.request.post('/api/items', { data: { kind: 'story', title: 'קיץ בחוף', body: 'ים', storyType: 'family', dateText: 'קיץ 1974' }, headers: { origin } })).json()) as { id: string };
  await page.goto(`/item/${s.id}`);
  await expect(page.locator('.sheet__byline')).toContainText('קיץ 1974');
  await shot(page, '13b-story-no-upload-date');
});

test('אייקון האפליקציה (PWA): ״דודו״, גרסה מעודכנת במניפסט ובמטמון', async ({ page }) => {
  await page.goto('/');
  const manifest = (await (await page.request.get('/manifest.webmanifest')).json()) as { short_name: string; icons: { src: string; sizes: string; purpose: string }[] };
  expect(manifest.short_name).toBe('סבא דודו');
  for (const want of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
    const icon = manifest.icons.find((i) => i.sizes === want[0] && i.purpose === want[1] && i.src.endsWith('.png?v=2'));
    expect(icon, want.join(' ')).toBeTruthy();
    const res = await page.request.get(icon!.src);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  }
  expect(await (await page.request.get('/icons/icon.svg?v=2')).text()).toContain('>דודו</text>');
  expect(await page.locator('link[rel=apple-touch-icon]').getAttribute('href')).toBe('/icons/apple-touch-icon.png?v=2');
  expect(await (await page.request.get('/sw.js')).text()).toContain("'saba-shell-v2'");
});

test('מסך הטעינה מציג ״דודו״', async ({ page }) => {
  // מאטים את בדיקת ההתחברות כדי לראות את מסך הטעינה
  await page.route('**/api/auth/status', async (r) => {
    await new Promise((res) => setTimeout(res, 1500));
    await r.continue();
  });
  await page.goto('/home');
  const mark = page.locator('.boot__mark');
  await expect(mark).toHaveText('דודו');
  const box = (await mark.boundingBox())!;
  expect(box.width).toBeLessThan(page.viewportSize()!.width);
  await page.screenshot({ path: path.join(SHOTS, '00-boot.png') });
  await page.unroute('**/api/auth/status');
});

test('זיכרון אקראי במסך הבית — תמונות מהגלריה בלבד', async ({ page }) => {
  await login(page);
  const img = page.locator('.memory__media--photo.memory__media--fit img');
  await expect(img).toBeVisible();
  const srcOf = async () => (await img.getAttribute('src')) ?? '';
  const seen = new Set([await srcOf()]);
  for (let i = 0; i < 4; i++) {
    const before = await srcOf();
    await page.getByRole('button', { name: 'עוד זיכרון' }).click();
    // לא אותה תמונה פעמיים ברציפות
    await expect.poll(srcOf).not.toBe(before);
    seen.add(await srcOf());
  }
  expect(seen.size).toBeGreaterThanOrEqual(5);
  for (const src of seen) expect(src).toContain('/api/files/gd:');
  await page.waitForTimeout(500);
  await shot(page, '14-home-memory');
  // תמונה גדולה: כמעט כל רוחב הכרטיס (אופקית) או עד הגובה המרבי (אנכית); נפתחת בגודל מלא בלחיצה
  const big = await img.evaluate((el: HTMLImageElement) => {
    const r = el.getBoundingClientRect();
    const card = el.closest('.memory')!.getBoundingClientRect();
    return { w: r.width, h: r.height, cw: card.width, vh: innerHeight };
  });
  expect(big.w > big.cw * 0.85 || big.h >= Math.min(0.62 * big.vh, 560) - 2).toBe(true);
  await page.locator('.memory__card').click();
  await expect(page.locator('.lightbox')).toBeVisible();
  await expect(page.locator('.lightbox .lightbox__img img').last()).toHaveAttribute('src', /\/api\/files\/gd:/);
  await page.getByRole('button', { name: 'סגירה' }).click();
  await expect(page.locator('.lightbox')).toHaveCount(0);
  await expect(page).toHaveURL(/\/home$/);

  // מתחת לתמונה — סיפור אקראי: רק הכותרת (בלי תוכן הסיפור) וקישור לסיפור המלא
  const storyBox = page.locator('.memory__story');
  await expect(storyBox).toBeVisible();
  await expect(storyBox.locator('.memory__story-title')).not.toBeEmpty();
  await expect(storyBox.locator('.memory__story-excerpt')).toHaveCount(0);
  // לסיפור עם תמונה — התמונה שלו בקטן, משמאל לכותרת
  for (let i = 0; i < 40 && !(await storyBox.locator('.memory__story-thumb').count()); i++) {
    await page.getByRole('button', { name: 'עוד זיכרון' }).click();
    await page.waitForTimeout(150);
  }
  const thumb = storyBox.locator('.memory__story-thumb');
  await expect(thumb).toBeVisible();
  await expect.poll(() => thumb.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  const tb = (await thumb.boundingBox())!;
  const ttl = (await storyBox.locator('.memory__story-title').boundingBox())!;
  expect(tb.width).toBeLessThanOrEqual(64);
  expect(tb.x + tb.width).toBeLessThanOrEqual(ttl.x + 1);
  expect(Math.abs(tb.y + tb.height / 2 - (ttl.y + ttl.height / 2))).toBeLessThan(30);
  await storyBox.screenshot({ path: path.join(SHOTS, '14c-memory-story-thumb.png') });
  // ״עוד זיכרון״ מחליף גם את הסיפור (כשיש יותר מסיפור אחד)
  const stories = ((await (await page.request.get('/api/random?kind=story')).json()) as { total: number }).total;
  if (stories > 1) {
    const title = await storyBox.locator('.memory__story-title').textContent();
    await page.getByRole('button', { name: 'עוד זיכרון' }).click();
    await expect.poll(() => storyBox.locator('.memory__story-title').textContent()).not.toBe(title);
  }
  await page.waitForTimeout(400);
  await shot(page, '14b-home-memory-story');
  const storyTitle = (await storyBox.locator('.memory__story-title').textContent())!;
  await storyBox.getByRole('link', { name: 'לקריאת הסיפור המלא' }).click();
  await expect(page).toHaveURL(/\/item\//);
  await expect(page.locator('.sheet__title')).toHaveText(storyTitle);
});

test('לשונית ״בית״ בתפריט התחתון — מכל לשונית, עם חיווי', async ({ page }) => {
  await login(page);
  const nav = page.locator('.tabs--bottom');
  await expect(nav.getByRole('link', { name: 'בית' })).toHaveAttribute('aria-current', 'page');
  for (const label of ['תמונות', 'סרטונים', 'הקלטות', 'סיפורים', 'מסמכים']) {
    await nav.getByRole('link', { name: label }).click();
    await expect(nav.getByRole('link', { name: 'בית' })).not.toHaveAttribute('aria-current', 'page');
    await nav.getByRole('link', { name: 'בית' }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByRole('heading', { name: 'זיכרון מסבא' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'בית' })).toHaveAttribute('aria-current', 'page');
  }
  // גם מדף פריט ומההגדרות
  await page.goto('/settings');
  await nav.getByRole('link', { name: 'בית' }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.setViewportSize({ width: 320, height: 640 });
  await expectTabsVisible(page);
  await noHorizontalScroll(page);
  await page.screenshot({ path: path.join(SHOTS, '21-bottom-nav-320.png') });
  await page.setViewportSize({ width: 390, height: 844 });
});

test('תמונות מהדרייב מוצגות בלי שמות קבצים או מזהים טכניים', async ({ page }) => {
  await login(page);
  await page.goto('/c/photo');
  await expect(page.locator('.photo-tile').first()).toBeVisible();
  await expect(page.locator('.photo-tile__title')).toHaveCount(0);
  for (const t of ['drive-', '.jpg', '1E2e', 'IMG']) await expect(page.locator('.gallery')).not.toContainText(t);
  await shot(page, '22-gallery-untitled');
});

test('סרטון מקישור Google Drive', async ({ page }) => {
  await login(page);
  const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  await page.goto('/c/video/new');
  const input = page.getByLabel('קישור שיתוף מ-Google Drive');
  await input.fill('https://example.com/video');
  await expect(page.getByText('זה לא נראה כמו קישור לקובץ ב-Google Drive')).toBeVisible();
  await input.fill(`https://drive.google.com/file/d/${fileId}/view?usp=sharing`);
  await expect(page.locator('.drive-frame--preview iframe')).toHaveAttribute('src', `https://drive.google.com/file/d/${fileId}/preview`);
  await page.getByLabel('כותרת', { exact: true }).fill('ריקוד מהדרייב');
  await shot(page, '23-drive-form');
  await page.getByRole('button', { name: 'שמירה' }).click();
  await expect(page).toHaveURL(/\/item\//);
  await expect(page.locator('.drive-frame iframe')).toHaveAttribute('src', `https://drive.google.com/file/d/${fileId}/preview`);
  await expect(page.getByRole('link', { name: 'פתיחה ב-Google Drive' })).toHaveAttribute('href', `https://drive.google.com/file/d/${fileId}/view`);
  await expect(page.getByRole('link', { name: /הורדת קובץ המקור/ })).toHaveCount(0);
  await shot(page, '24-drive-video-page');
  // החלפת הקישור בעריכה
  const newId = '9ZyXwVuTsRqPoNmLkJiHgFeDcBa98765';
  await page.getByRole('button', { name: 'עריכה' }).click();
  await page.getByLabel('קישור ל-Google Drive').fill(`https://drive.google.com/open?id=${newId}`);
  await page.locator('dialog').getByRole('button', { name: 'שמירה' }).click();
  await expect(page.locator('.drive-frame iframe')).toHaveAttribute('src', `https://drive.google.com/file/d/${newId}/preview`);
  // מופיע ברשימת הסרטונים לצד הסרטון שהועלה כקובץ
  await page.goto('/c/video');
  await expect(page.locator('.media-card')).toHaveCount(2);
  await expect(page.locator('.media-card[data-source="drive"]')).toHaveCount(1);
  // בלי תגית ״Drive״ על הכרטיסים
  for (const t of await page.locator('.media-card').allInnerTexts()) expect(t).not.toContain('Drive');
  await expect(page.locator('.media-card__source')).toHaveCount(0);
});

test('״זיכרון מסבא״ מציג תמונה אנכית ואופקית במלואה', async ({ page }) => {
  await login(page);
  const seen = new Set<string>();
  for (let i = 0; i < 40 && seen.size < 2; i++) {
    const img = page.locator('.memory__media--photo.memory__media--fit img');
    if (await img.count()) {
      await expect(img).toBeVisible();
      await img.evaluate((el: HTMLImageElement) => el.decode().catch(() => undefined));
      const m = await img.evaluate((el: HTMLImageElement) => {
        const r = el.getBoundingClientRect();
        return { fit: getComputedStyle(el).objectFit, rw: r.width, rh: r.height, nw: el.naturalWidth, nh: el.naturalHeight, vw: innerWidth };
      });
      expect(m.fit).toBe('contain');
      if (m.nw && m.nh) {
        // היחס המוצג זהה ליחס המקורי — כלומר אין חיתוך
        expect(Math.abs(m.rw / m.rh - m.nw / m.nh)).toBeLessThan(0.03);
        expect(m.rw).toBeLessThanOrEqual(m.vw);
        // גדולה: אופקית — כמעט כל רוחב הכרטיס; אנכית — עד הגובה המרבי
        const cw = (await page.locator('.memory').boundingBox())!.width;
        expect(m.rw > cw * 0.85 || m.rh >= Math.min(0.62 * 844, 560) - 2).toBe(true);
        const shape = m.nh > m.nw ? 'portrait' : 'landscape';
        if (!seen.has(shape)) {
          seen.add(shape);
          await page.locator('.memory').screenshot({ path: path.join(SHOTS, `25-memory-${shape}.png`) });
        }
      }
    }
    await page.getByRole('button', { name: 'עוד זיכרון' }).click();
    await page.waitForTimeout(250);
  }
  expect([...seen].sort()).toEqual(['landscape', 'portrait']);
});

test('גלריה: ממוזערות בלבד, התצוגה הגדולה נטענת רק בפתיחה; 3 עמודות בנייד', async ({ page }) => {
  await login(page);
  const requested: string[] = [];
  page.on('request', (r) => {
    const m = /\/api\/files\/(gd:[^?]+)/.exec(r.url());
    if (m) requested.push(decodeURIComponent(m[1]));
  });
  const pages: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname === '/api/items' && u.searchParams.get('kind') === 'photo') pages.push(u.searchParams.get('limit') ?? '');
  });
  await page.goto('/c/photo');
  await expect(page.locator('.photo-tile__img.is-loaded').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(requested.length).toBeGreaterThan(0);
  // רק ממוזערות (:t) — לא התצוגה הגדולה; טעינה עצלה ובעמודים של 30
  expect(requested.every((id) => id.endsWith(':t'))).toBe(true);
  expect(await page.locator('.photo-tile img[loading="lazy"]').count()).toBeGreaterThan(0);
  expect(pages.every((l) => l === '30')).toBe(true);
  expect(await page.locator('.gallery').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2);
  // קולאז׳: כל תמונה ביחס הממדים המקורי שלה (בלי חיתוך), וחלק מהאופקיות ברוחב כפול
  await expect.poll(() => page.locator('.photo-tile img').evaluateAll((els) => els.filter((e) => (e as HTMLImageElement).naturalWidth > 0).length)).toBeGreaterThan(8);
  const ratios = await page.locator('.photo-tile img').evaluateAll((els) =>
    (els as HTMLImageElement[]).filter((e) => e.naturalWidth > 0).map((e) => {
      const r = e.getBoundingClientRect();
      return Math.abs(r.width / r.height - e.naturalWidth / e.naturalHeight) / (e.naturalWidth / e.naturalHeight);
    }),
  );
  expect(Math.max(...ratios)).toBeLessThan(0.03);
  expect(await page.locator('.gallery__cell--wide').count()).toBeGreaterThan(0);
  const cellW = await page.locator('.gallery__cell').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  expect(new Set(cellW).size).toBeGreaterThan(1);
  // פתיחה — רק אז נטענת התצוגה הגדולה
  await page.locator('.photo-tile__btn').first().click();
  await expect(page.locator('.lightbox')).toBeVisible();
  await expect.poll(() => requested.some((id) => !id.endsWith(':t'))).toBe(true);
  await page.getByRole('button', { name: 'סגירה' }).click();
  // הורדת המקור — הפניה ישירה לגוגל (אין עותק אצלנו)
  const first = ((await (await page.request.get('/api/items?kind=photo&limit=1')).json()) as { items: { files: { id: string; role: string }[] }[] }).items[0];
  const dl = await page.request.get(`/api/files/${first.files.find((f) => f.role === 'original')!.id}?download=1`, { maxRedirects: 0 });
  expect(dl.status()).toBe(302);
  expect(dl.headers()['location']).toContain('drive.google.com');
});

test('גלריה: סדר אקראי בכל כניסה, טעינה הדרגתית בלי כפילויות או חוסרים', async ({ page }) => {
  await login(page);
  const total = ((await (await page.request.get('/api/items?kind=photo&limit=1')).json()) as { total: number }).total;
  expect(total).toBe(44);
  const seeds: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname === '/api/items' && u.searchParams.get('kind') === 'photo' && u.searchParams.get('offset') === '0') seeds.push(u.searchParams.get('seed') ?? '');
  });
  const firstSrcs = async () => {
    await expect(page.locator('.photo-tile').first()).toBeVisible();
    return (await page.locator('.photo-tile img').evaluateAll((els) => els.slice(0, 12).map((e) => e.getAttribute('src') ?? ''))).join('|');
  };
  const nav = page.locator('.tabs--bottom');
  await nav.getByRole('link', { name: 'תמונות' }).click();
  const a = await firstSrcs();
  await nav.getByRole('link', { name: 'בית' }).click();
  await nav.getByRole('link', { name: 'תמונות' }).click();
  const b = await firstSrcs();
  expect(new Set(seeds).size).toBeGreaterThanOrEqual(2);
  expect(a).not.toBe(b);
  for (let i = 0; i < 30; i++) {
    if ((await page.locator('.photo-tile').count()) >= total) break;
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(250);
  }
  await expect(page.locator('.photo-tile')).toHaveCount(total);
  const srcs = await page.locator('.photo-tile img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).getAttribute('src')));
  expect(new Set(srcs).size).toBe(srcs.length);
  await shot(page, '26-gallery-random');
});

test('סרטונים: חלונית צפייה ביחס המקורי, בלי מסך מלא כפוי; מסך מלא דרך הנגן', async ({ page }) => {
  await login(page);
  await page.goto('/c/video');
  // כרטיסים קומפקטיים: 3 בשורה ב-390px, 2 במסך צר מאוד; תמונה מקדימה ביחס 16:9 וכותרת בשורה אחת
  const cols = () => page.locator('.grid--media').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(await cols()).toBe(3);
  const thumb = await page.locator('.media-card__thumb').first().boundingBox();
  expect(Math.abs(thumb!.width / thumb!.height - 16 / 9)).toBeLessThan(0.05);
  expect(await page.locator('.media-card .card__title').first().evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('nowrap');
  await page.setViewportSize({ width: 340, height: 844 });
  expect(await cols()).toBe(2);
  await page.setViewportSize({ width: 390, height: 844 });
  // לחיצה על כרטיס — חלונית צפייה בתוך האתר, בלי מסך מלא כפוי
  await page.locator('.media-card[data-source="upload"]').first().click();
  const tv = page.locator('.theater video');
  await expect(tv).toBeVisible();
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  // נגן אחד בלבד, בלי שום שכבה מעליו
  await expect(page.locator('.theater__frame > *')).toHaveCount(1);
  expect(await page.locator('.theater__frame').evaluate((f) => {
    const r = f.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.tagName;
  })).toBe('VIDEO');
  await tv.evaluate((v: HTMLVideoElement) => (v.readyState >= 1 ? null : new Promise((r) => v.addEventListener('loadedmetadata', r))));
  const t = await tv.evaluate((v: HTMLVideoElement) => {
    const r = v.getBoundingClientRect();
    const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
    return { fit: getComputedStyle(v).objectFit, w: v.videoWidth * s, h: v.videoHeight * s, bw: r.width, bh: r.height, vw: innerWidth, vh: innerHeight };
  });
  expect(t.fit).toBe('contain');
  // התוכן נכנס כולו לתוך הנגן (ללא חיתוך) והנגן לא חורג מהמסך
  expect(t.w).toBeLessThanOrEqual(t.bw + 1);
  expect(t.h).toBeLessThanOrEqual(t.bh + 1);
  expect(t.bw).toBeLessThanOrEqual(t.vw);
  await page.screenshot({ path: path.join(SHOTS, '29-video-theater.png') });
  await page.getByRole('button', { name: 'סגירה' }).click();
  await expect(page.locator('.theater')).toHaveCount(0);
  // Esc ולחיצה על הרקע סוגרים גם הם
  await page.locator('.media-card[data-source="upload"]').first().click();
  await expect(tv).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.theater')).toHaveCount(0);
  await page.locator('.media-card[data-source="upload"]').first().click();
  await expect(tv).toBeVisible();
  await page.locator('.theater__stage').click({ position: { x: 4, y: 4 } });
  await expect(page.locator('.theater')).toHaveCount(0);
  await expect(page).toHaveURL(/\/c\/video$/);

  // דף הסרטון עצמו — כפתור מסך מלא
  await page.locator('.media-card[data-source="upload"]').first().click();
  await page.getByRole('link', { name: 'לדף הסרטון ותגובות' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  const video = page.locator('video.video');
  await expect(video).toBeVisible();
  await video.evaluate((v: HTMLVideoElement) => (v.readyState >= 1 ? null : new Promise((r) => v.addEventListener('loadedmetadata', r))));
  const m = await video.evaluate((v: HTMLVideoElement) => {
    const r = v.getBoundingClientRect();
    return { fit: getComputedStyle(v).objectFit, ratio: r.width / r.height, natural: v.videoWidth / v.videoHeight, right: r.right, vw: innerWidth };
  });
  expect(m.fit).toBe('contain');
  expect(Math.abs(m.ratio - m.natural)).toBeLessThan(0.03);
  expect(m.right).toBeLessThanOrEqual(m.vw);
  await shot(page, '27-video-page');
  await page.getByRole('button', { name: 'צפייה במסך מלא' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName ?? null)).toBe('VIDEO');
  await page.evaluate(() => document.exitFullscreen());

  // סרטון Google Drive — לחיצה בגלריה פותחת את החלונית עם הנגן המוטמע (עם מסך מלא משלו)
  await page.goto('/c/video');
  await page.locator('.media-card[data-source="drive"]').first().click();
  const iframe = page.locator('.theater__frame iframe');
  await expect(iframe).toBeVisible();
  await expect(page.locator('.theater__frame > *')).toHaveCount(1);
  expect(await page.locator('.theater__frame').evaluate((f) => {
    const r = f.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.tagName;
  })).toBe('IFRAME');
  expect(await iframe.getAttribute('allowfullscreen')).not.toBeNull();
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  await expect(page.getByRole('link', { name: 'פתיחה ב-Google Drive' })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'פתיחה ב-Google Drive' })).toHaveAttribute('href', /drive\.google\.com/);
  await page.getByRole('link', { name: 'לדף הסרטון ותגובות' }).click();
  await expect(page.locator('.drive-frame iframe')).toBeVisible();
  await page.getByRole('button', { name: 'צפייה במסך מלא' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className ?? null)).toContain('drive-frame');
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByRole('link', { name: 'פתיחה ב-Google Drive' })).toBeVisible();
});

test('יצירת ממוזערות למסמכים שהם תמונות — המקור לא משתנה', async ({ page }) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  const { readFileSync } = await import('node:fs');
  const jpg = readFileSync(fx('photo-b.jpg'));
  const up = (await (await page.request.post('/api/uploads/direct?kind=document&role=original&name=scan-without-thumb.jpg', { data: jpg, headers: { 'content-type': 'image/jpeg', origin } })).json()) as { id: string };
  const item = (await (await page.request.post('/api/items', { data: { kind: 'document', title: 'סריקה בלי ממוזערת', files: [{ id: up.id }] }, headers: { origin } })).json()) as { id: string };
  await page.goto('/settings/thumbs');
  await expect(page.getByText(/בלי גרסה מוקטנת/)).toBeVisible();
  await page.getByRole('button', { name: 'יצירת תמונות ממוזערות עכשיו' }).click();
  await expect(page.getByText('לכל התמונות כבר יש גרסה מוקטנת ✓')).toBeVisible({ timeout: 60_000 });
  await shot(page, '28-thumbs-backfill');
  const detail = (await (await page.request.get(`/api/items/${item.id}`)).json()) as { files: { id: string; role: string; mime: string }[] };
  expect(detail.files.find((f) => f.role === 'thumb')?.mime).toBe('image/webp');
  const served = Buffer.from(await (await page.request.get(`/api/files/${up.id}`)).body());
  expect(served.equals(jpg)).toBe(true);
});

test('מחיקת תמונה (מנהל) — מתוך התצוגה המלאה בלבד, עם אישור ועדכון מיידי', async ({ page }) => {
  await login(page);
  await page.goto('/c/photo?sort=new');
  const tiles = page.locator('.photo-tile');
  await expect(tiles.first().locator('img')).toBeVisible();
  // הגלריה נקייה — אין כפתורי מחיקה על התמונות הממוזערות
  await expect(page.locator('.photo-tile button[aria-label*="מחיקת"]')).toHaveCount(0);
  const totalOf = async () => Number(/\d+/.exec((await page.locator('.page-head__sub').textContent()) ?? '')![0]);
  const before = await totalOf();
  const src = await tiles.first().locator('img').getAttribute('src');
  await tiles.first().locator('.photo-tile__btn').click();
  const del = page.locator('.lightbox__tools').getByRole('button', { name: 'מחיקת התמונה' });
  await expect(del).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '34-lightbox-delete.png') });
  await del.click();
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('סל המחזור');
  await dialog.getByRole('button', { name: 'ביטול' }).click();
  await expect(page.locator('.lightbox')).toBeVisible();
  await del.click();
  await page.locator('dialog').getByRole('button', { name: 'מחיקה' }).click();
  // התצוגה עוברת לתמונה הבאה, והגלריה מתעדכנת מיד
  await expect(page.locator('.lightbox')).toBeVisible();
  await page.getByRole('button', { name: 'סגירה' }).click();
  await expect(page.locator(`.photo-tile img[src="${src}"]`)).toHaveCount(0);
  await expect.poll(totalOf).toBe(before - 1);
  await shot(page, '33-gallery-clean');
  // הקובץ נשאר בדרייב — וסנכרון לא מחזיר תמונה שהמנהל הסיר
  const origin = new URL(page.url()).origin;
  const sync = (await (await page.request.post('/api/admin/drive/sync', { headers: { origin } })).json()) as { sync: { ok: boolean; total: number } };
  expect(sync.sync).toMatchObject({ ok: true, total: 44 });
  await page.reload();
  await expect.poll(totalOf).toBe(before - 1);
  // משוחזר מסל המחזור — כדי לא לשנות את שאר הבדיקות
  await page.goto('/settings/content');
  await page.getByRole('button', { name: 'שחזור' }).first().click();
  await expect(page.getByText('סל המחזור ריק.')).toBeVisible();
});

test('דף הבית: תמונה מתחלפת מהאוסף, שונה מהכותרת, וברכה עם שם פרטי', async ({ page }) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  const photos = ((await (await page.request.get('/api/items?kind=photo&limit=100')).json()) as { items: { id: string; title: string; files: { id: string; role: string; width: number | null }[] }[] }).items;
  const withThumb = photos.filter((p) => p.files.some((f) => f.role === 'thumb') && (p.files.find((f) => f.role === 'original')?.width ?? 0) > 100).slice(0, 4);
  expect(withThumb.length).toBeGreaterThanOrEqual(3);
  // התמונה הראשית (בכותרת) היא אחת מהן — ולכן אסור שתוצג בעיגול
  await page.request.put('/api/admin/hero', { data: { itemId: withThumb[0].id }, headers: { origin } });
  const res = await page.request.put('/api/admin/settings', {
    data: { homePhotos: withThumb.map((p, i) => ({ itemId: p.id, x: 50, y: 30 + i, zoom: 1.2 })) },
    headers: { origin },
  });
  expect(res.status()).toBe(200);

  const seen: string[] = [];
  for (let i = 0; i < 6; i++) {
    await page.goto('/home');
    const portrait = page.locator('.home__hello .portrait');
    await expect(portrait.locator('img.is-loaded')).toBeVisible();
    seen.push((await portrait.getAttribute('data-item'))!);
  }
  expect(seen).not.toContain(withThumb[0].id);
  for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  expect(new Set(seen).size).toBeGreaterThanOrEqual(2);
  const headerSrc = await page.locator('.topbar .avatar img').getAttribute('src');
  const portraitSrc = await page.locator('.home__hello .portrait img').getAttribute('src');
  expect(portraitSrc).not.toBe(headerSrc);
  await expect(page.locator('.home__sub')).toHaveText('שלום מנהל, טוב שבאת להיזכר.');
  await shot(page, '31-home-portrait');

  // הגדרות: האוסף מוצג ונפתח לכיוון
  await page.goto('/settings/home-photos');
  await expect(page.locator('.home-photos__item')).toHaveCount(withThumb.length - 1);
  await page.getByRole('button', { name: 'כיוון' }).first().click();
  await page.locator('.focus-editor__image img').click({ position: { x: 10, y: 10 } });
  await page.screenshot({ path: path.join(SHOTS, '32-focus-editor.png') });
  await page.locator('dialog').getByRole('button', { name: 'סיום' }).click();
  await page.getByRole('button', { name: 'שמירת האוסף' }).click();
  await expect(page.getByText('האוסף נשמר')).toBeVisible();

  // ניקוי: בלי תמונה ראשית ואוסף (כדי שבדיקות אחרות יתחילו ממצב נקי)
  await page.request.put('/api/admin/hero', { data: { clear: true }, headers: { origin } });
  await page.request.put('/api/admin/settings', { data: { homePhotos: [] }, headers: { origin } });
});

test('בן משפחה מוזמן — אין לו אפשרות מחיקה, והשרת חוסם', async ({ page, browser }) => {
  await login(page);
  await page.goto('/settings/invites');
  await page.getByRole('button', { name: 'יצירת קישור הזמנה' }).click();
  const url = await page.getByLabel('הקישור').inputValue();
  expect(url).toMatch(/\/invite\//);

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'he-IL' });
  const member = await ctx.newPage();
  await member.goto(url);
  await member.getByLabel('השם שיוצג לבני המשפחה').fill('נכדה');
  await member.getByLabel('דוא״ל').fill('member@e2e.test');
  await member.getByLabel('סיסמה', { exact: true }).fill('member-pass-1');
  await member.getByLabel('אימות סיסמה').fill('member-pass-1');
  await member.getByRole('button', { name: 'הצטרפות' }).click();
  await expect(member).toHaveURL(/\/home$/);

  await member.goto('/c/photo');
  await expect(member.locator('.photo-tile').first()).toBeVisible();
  await member.locator('.photo-tile__btn').first().click();
  await expect(member.locator('.lightbox')).toBeVisible();
  await expect(member.getByRole('button', { name: 'מחיקת התמונה' })).toHaveCount(0);
  await member.getByRole('button', { name: 'סגירה' }).click();
  await member.goto('/c/story');
  // הכרטיסים מרחפים בעדינות כל הזמן — לחיצה בלי לחכות ל״יציבות״
  await member.locator('.story-card').first().click({ force: true });
  await expect(member.getByRole('button', { name: 'גם אני זוכר את זה' })).toBeVisible();
  await expect(member.getByRole('button', { name: 'מחיקה' })).toHaveCount(0);
  await expect(member.getByRole('button', { name: 'עריכה' })).toHaveCount(0);
  const id = member.url().split('/item/')[1];
  const res = await member.request.delete(`/api/items/${id}`, { headers: { origin: new URL(member.url()).origin } });
  expect(res.status()).toBe(403);
  // סרטונים ומסמכים — גם כאן אין מחיקה
  for (const kind of ['video', 'document']) {
    const list = (await (await member.request.get(`/api/items?kind=${kind}&limit=1`)).json()) as { items: { id: string }[] };
    await member.goto(`/item/${list.items[0].id}`);
    await expect(member.locator('.item__actions')).toBeVisible();
    await expect(member.getByRole('button', { name: 'מחיקה' })).toHaveCount(0);
    await expect(member.getByRole('button', { name: 'עריכה' })).toHaveCount(0);
  }
  // הגדרות: רק ״החשבון שלי״ ו״הזמנת בני משפחה״
  await member.goto('/settings');
  await expect(member.locator('.settings__link')).toHaveCount(2);
  await expect(member.locator('.settings__link')).toHaveText(['החשבון שלי', 'הזמנת בני משפחה']);
  await shot(member, '15-member-settings');
  for (const sub of ['users', 'content', 'drive', 'backups']) {
    await member.goto(`/settings/${sub}`);
    await expect(member).toHaveURL(/\/settings$/);
  }
  // בן משפחה מזמין בן משפחה — בלי בחירת הרשאה
  await member.goto('/settings/invites');
  await expect(member.getByLabel('הרשאה')).toHaveCount(0);
  await member.getByLabel(/למי ההזמנה/).fill('הנין');
  await member.getByRole('button', { name: 'יצירת קישור הזמנה' }).click();
  const memberInvite = await member.getByLabel('הקישור').inputValue();
  expect(memberInvite).toMatch(/\/invite\//);
  await member.getByRole('button', { name: 'סגירה' }).click();
  await expect(member.getByRole('heading', { name: 'ההזמנות שלי' })).toBeVisible();
  await expect(member.locator('.rows__row')).toHaveCount(1);
  await expect(member.locator('.rows__row')).toContainText('הנין');
  await shot(member, '15b-member-invite');
  const guestCtx = await browser.newContext({ locale: 'he-IL' });
  const guest = await guestCtx.newPage();
  await guest.goto(memberInvite);
  await guest.getByLabel('השם שיוצג לבני המשפחה').fill('נין');
  await guest.getByLabel('דוא״ל').fill('guest@e2e.test');
  await guest.getByLabel('סיסמה', { exact: true }).fill('guest-pass-1');
  await guest.getByLabel('אימות סיסמה').fill('guest-pass-1');
  await guest.getByRole('button', { name: 'הצטרפות' }).click();
  await expect(guest).toHaveURL(/\/home$/);
  const guestRole = ((await (await guest.request.get('/api/auth/status')).json()) as { user: { role: string } }).user.role;
  expect(guestRole).toBe('member');
  await guestCtx.close();

  // קבצים לא נגישים ללא התחברות
  const anon = await browser.newContext();
  const fileId = await page.evaluate(async () => ((await (await fetch('/api/items?kind=photo')).json()) as { items: { files: { id: string }[] }[] }).items[0].files[0].id);
  const anonRes = await anon.request.get(new URL(`/api/files/${fileId}`, page.url()).toString());
  expect(anonRes.status()).toBe(401);
  await anon.close();
  await ctx.close();
});

test('מנהל מוחק ומשחזר', async ({ page }) => {
  await login(page);
  await page.goto('/c/document');
  await expect(page.locator('.doc-card').first()).toBeVisible();
  const docs = await page.locator('.doc-card').count();
  await page.locator('.doc-card').first().click();
  await page.getByRole('button', { name: 'מחיקה' }).click();
  await page.locator('dialog').getByRole('button', { name: 'מחיקה' }).click();
  await expect(page).toHaveURL(/\/c\/document$/);
  await expect(page.locator('.doc-card')).toHaveCount(docs - 1);
  await page.goto('/settings/content');
  await expect(page.locator('.row-card')).toHaveCount(1);
  await shot(page, '16-trash');
  await page.getByRole('button', { name: 'שחזור' }).click();
  await expect(page.getByText('סל המחזור ריק.')).toBeVisible();
  await page.goto('/c/document');
  await expect(page.locator('.doc-card')).toHaveCount(docs);
});

test('הגדרות מסך פתיחה ותמונה ראשית', async ({ page }) => {
  await login(page);
  await page.goto('/settings/hero');
  await page.getByRole('button', { name: 'בחירה מאלבום התמונות' }).click();
  await page.locator('.pick-grid__btn').first().click();
  await expect(page.locator('.hero-edit__preview img')).toBeVisible();
  await page.goto('/settings/site');
  await page.getByRole('button', { name: 'הוספת משפט' }).click();
  await page.getByLabel('משפט 1').fill('(משפט לדוגמה לבדיקה)');
  await page.getByRole('button', { name: 'שמירת ההגדרות' }).click();
  await expect(page.getByText('ההגדרות נשמרו')).toBeVisible();
  await page.goto('/');
  await expect(page.locator('.frame__photo')).toBeVisible();
  await expect(page.locator('.traits__quote')).toBeVisible();
  // מחזירים למצב ללא תוכן לדוגמה
  await page.goto('/settings/site');
  await page.locator('.list-editor__row').first().getByRole('button', { name: 'הסרה' }).click();
  await page.getByRole('button', { name: 'שמירת ההגדרות' }).click();
  await page.goto('/settings/hero');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'הסרת התמונה הראשית' }).click();
  await expect(page.getByText('עדיין לא נבחרה תמונה')).toBeVisible();
});

test('סרטונים וסיפורים: סדר אקראי בכל כניסה, בלי כפילויות או חוסרים', async ({ page }) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  for (let i = 0; i < 36; i++) {
    await page.request.post('/api/items', { data: { kind: 'story', title: `סיפור מספר ${i}`, body: `תוכן הסיפור ${i}`, storyType: 'family' }, headers: { origin } });
  }
  const totals = {} as Record<string, number>;
  for (const k of ['video', 'story']) totals[k] = ((await (await page.request.get(`/api/items?kind=${k}&limit=1`)).json()) as { total: number }).total;
  expect(totals.story).toBeGreaterThan(36);

  const seen: Record<string, Set<string>> = { video: new Set(), story: new Set() };
  page.on('request', (r) => {
    const u = new URL(r.url());
    const k = u.searchParams.get('kind') ?? '';
    if (u.pathname === '/api/items' && k in seen && u.searchParams.get('offset') === '0') {
      expect(u.searchParams.get('sort')).toBe('random');
      seen[k].add(u.searchParams.get('seed') ?? '');
    }
  });
  const nav = page.locator('.tabs--bottom');
  const storyTitles = async () => {
    await expect(page.locator('.story-card').first()).toBeVisible();
    return (await page.locator('.story-card__title').evaluateAll((els) => els.slice(0, 10).map((e) => e.textContent ?? ''))).join('|');
  };
  await nav.getByRole('link', { name: 'סיפורים' }).click();
  const a = await storyTitles();
  await nav.getByRole('link', { name: 'סרטונים' }).click();
  await expect(page.locator('.media-card').first()).toBeVisible();
  await nav.getByRole('link', { name: 'סיפורים' }).click();
  const b = await storyTitles();
  await nav.getByRole('link', { name: 'בית' }).click();
  await nav.getByRole('link', { name: 'סרטונים' }).click();
  await expect(page.locator('.media-card')).toHaveCount(totals.video);
  expect(seen.story.size).toBeGreaterThanOrEqual(2);
  expect(seen.video.size).toBeGreaterThanOrEqual(2);
  expect(a).not.toBe(b);
  // כל הסרטונים מוצגים (הרשימה מסוננת מכפילויות לפי מזהה) — כולל סרטוני Drive
  await expect(page.locator('.media-card[data-source="drive"]')).not.toHaveCount(0);

  // גלילה עד הסוף בסיפורים — כל סיפור פעם אחת
  await nav.getByRole('link', { name: 'סיפורים' }).click();
  await expect(page.locator('.story-card').first()).toBeVisible();
  for (let i = 0; i < 30; i++) {
    if ((await page.locator('.story-card').count()) >= totals.story) break;
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(250);
  }
  await expect(page.locator('.story-card')).toHaveCount(totals.story);
  const hrefs = await page.locator('.story-card').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? e.querySelector('a')?.getAttribute('href')));
  expect(new Set(hrefs).size).toBe(totals.story);

  // לוח מרחף: שתי עמודות גם בטלפון, בלי חפיפה בין כרטיסים, בלי גלילה אופקית, טקסט קריא
  await expect(page.locator('.story-board__col')).toHaveCount(2);
  const layout = await page.locator('.story-card').evaluateAll((els) => {
    const boxes = els.map((e) => {
      const r = e.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top + scrollY, b: r.bottom + scrollY };
    });
    // חפיפה מקסימלית בין שני כרטיסים כלשהם (סובלנות קטנה בגלל ההטיה והריחוף)
    let overlap = 0;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], c = boxes[j];
        const w = Math.min(a.r, c.r) - Math.max(a.l, c.l), h = Math.min(a.b, c.b) - Math.max(a.t, c.t);
        if (w > 0 && h > 0) overlap = Math.max(overlap, Math.min(w, h));
      }
    const fonts = els.flatMap((e) => Array.from(e.querySelectorAll('.story-card__title, .story-card__excerpt')).map((t) => parseFloat(getComputedStyle(t).fontSize)));
    const tilts = new Set(els.map((e) => (e as HTMLElement).style.getPropertyValue('--tilt')));
    const maxRight = Math.max(...boxes.map((b) => b.r)), minLeft = Math.min(...boxes.map((b) => b.l));
    return { overlap, minFont: Math.min(...fonts), tilts: tilts.size, inside: minLeft >= 0 && maxRight <= innerWidth, bob: getComputedStyle(els[0].parentElement!).animationName };
  });
  expect(layout.overlap).toBeLessThan(6);
  expect(layout.minFont).toBeGreaterThanOrEqual(12);
  expect(layout.tilts).toBeGreaterThan(2);
  expect(layout.inside).toBe(true);
  expect(layout.bob).toBe('story-bob');
  await noHorizontalScroll(page);
  await page.setViewportSize({ width: 340, height: 844 });
  await expect(page.locator('.story-board__col')).toHaveCount(2);
  await noHorizontalScroll(page);
  await page.setViewportSize({ width: 390, height: 844 });
  // כפתורי הסינון קומפקטיים
  await page.evaluate(() => scrollTo(0, 0));
  for (const h of await page.locator('.filters--compact select').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeLessThanOrEqual(36);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, '39-stories-board.png') });
});

test('תמונה לסיפור: ממוזערת לצד הכותרת, הוספה, החלפה והסרה בעריכה — בלי לגעת בגלריה', async ({ page }) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  const body = 'סבא היה מכין קפה שחור בכל בוקר ויושב במרפסת, ומספר לנו על הימים ההם.';
  const story = (await (await page.request.post('/api/items', { data: { kind: 'story', title: 'הבוקר במרפסת', body, storyType: 'family' }, headers: { origin } })).json()) as { id: string };
  const cardOf = () => page.locator('.story-card', { has: page.getByText('הבוקר במרפסת') });
  const summary = async () =>
    ((await (await page.request.get('/api/items?kind=story&limit=100')).json()) as { items: { id: string; coverFileId: string | null; title: string; excerpt: string }[] }).items.find((i) => i.id === story.id)!;
  expect((await summary()).coverFileId).toBeNull();
  const galleryTotal = async () => ((await (await page.request.get('/api/items?kind=photo&limit=1')).json()) as { total: number }).total;
  const galleryBefore = await galleryTotal();

  const openEdit = async () => {
    await page.goto(`/item/${story.id}`);
    await page.getByRole('button', { name: /עריכה/ }).first().click();
    await expect(page.locator('.story-photo')).toBeVisible();
  };
  // הוספה — העלאה ישירה לסיפור (אין בחירה מגלריית התמונות)
  await openEdit();
  await expect(page.getByRole('button', { name: 'בחירה מהאלבום' })).toHaveCount(0);
  await page.locator('.story-photo input[type=file]').setInputFiles(fx('photo-b.jpg'));
  await expect(page.locator('.story-photo__preview img')).toBeVisible();
  await page.getByRole('button', { name: 'שמירה', exact: true }).click();
  await expect(page.locator('.story-photo')).toHaveCount(0, { timeout: 30_000 });
  expect(await galleryTotal()).toBe(galleryBefore);
  const first = (await summary()).coverFileId;
  expect(first).not.toBeNull();
  // בדף הסיפור — התמונה גדולה מתחת לכותרת, ברוחב הדף וביחס המקורי (בלי חיתוך), ולחיצה פותחת אותה בגודל מלא
  const photoBtn = page.locator('.sheet__head .sheet__photo');
  await expect(photoBtn.locator('img')).toBeVisible();
  await expect.poll(() => photoBtn.locator('img').evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  const pb = (await photoBtn.boundingBox())!;
  const tb = (await page.locator('.sheet__head .sheet__title').boundingBox())!;
  const sheet = (await page.locator('.sheet').boundingBox())!;
  expect(pb.width).toBeGreaterThan(sheet.width * 0.85);
  expect(pb.y).toBeGreaterThanOrEqual(tb.y + tb.height - 1);
  const img = await photoBtn.locator('img').evaluate((el: HTMLImageElement) => {
    const r = el.getBoundingClientRect();
    return { ratio: r.width / r.height, natural: el.naturalWidth / el.naturalHeight, fit: getComputedStyle(el).objectFit, h: r.height, vh: innerHeight };
  });
  expect(Math.abs(img.ratio - img.natural)).toBeLessThan(0.02);
  expect(img.fit).toBe('contain');
  expect(img.h).toBeGreaterThan(300);
  expect(img.h).toBeLessThanOrEqual(img.vh * 0.8);
  // אין תאריך העלאה בשורת הכותב
  await expect(page.locator('.sheet__byline')).not.toContainText(/\d{4}/);
  await expect(page.locator('.linked-photos')).toHaveCount(0);
  await noHorizontalScroll(page);
  await page.screenshot({ path: path.join(SHOTS, '42-story-page-photo.png') });
  // במחשב — גדולה, ממורכזת וכולה בתוך המסך
  await page.setViewportSize({ width: 1366, height: 900 });
  const desk = await photoBtn.locator('img').evaluate((el: HTMLImageElement) => {
    const r = el.getBoundingClientRect();
    return { ratio: r.width / r.height, natural: el.naturalWidth / el.naturalHeight, h: r.height, vh: innerHeight };
  });
  expect(Math.abs(desk.ratio - desk.natural)).toBeLessThan(0.02);
  expect(desk.h).toBeGreaterThan(500);
  expect(desk.h).toBeLessThanOrEqual(desk.vh * 0.8);
  await page.screenshot({ path: path.join(SHOTS, '42b-story-page-photo-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await photoBtn.click();
  const full = page.locator('.lightbox .lightbox__img img').last();
  await expect(full).toBeVisible();
  await expect(full).toHaveAttribute('src', /\/api\/files\//);
  await expect.poll(() => full.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'סגירה' }).click();
  await expect(page.locator('.lightbox')).toHaveCount(0);
  await page.goto('/c/story?sort=new');
  const thumb = cardOf().locator('.story-card__thumb');
  await expect(thumb).toBeVisible();
  const t = (await thumb.boundingBox())!;
  expect(t.width).toBeLessThanOrEqual(60);
  await page.evaluate(() => document.querySelector('.story-card--photo')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, '41-story-thumb.png') });

  // החלפה בהעלאת תמונה חדשה
  await openEdit();
  await page.locator('.story-photo input[type=file]').setInputFiles(fx('photo-a.jpg'));
  await page.getByRole('button', { name: 'שמירה', exact: true }).click();
  await expect(page.locator('.story-photo')).toHaveCount(0, { timeout: 30_000 });
  const second = (await summary()).coverFileId;
  expect(second).not.toBeNull();
  expect(second).not.toBe(first);

  expect(await galleryTotal()).toBe(galleryBefore);

  // הסרה — רק מהסיפור; שאר פרטי הסיפור והגלריה לא משתנים
  const photosBefore = await galleryTotal();
  await openEdit();
  await page.getByRole('button', { name: 'הסרת התמונה' }).click();
  await page.getByRole('button', { name: 'שמירה', exact: true }).click();
  await expect(page.locator('.story-photo')).toHaveCount(0);
  const after = await summary();
  expect(after.coverFileId).toBeNull();
  await expect(page.locator('.sheet__photo')).toHaveCount(0);
  expect(after.title).toBe('הבוקר במרפסת');
  expect(after.excerpt).toBe(body);
  expect(((await (await page.request.get('/api/items?kind=photo&limit=1')).json()) as { total: number }).total).toBe(photosBefore);
  await page.goto('/c/story?sort=new');
  await expect(cardOf()).toBeVisible();
  await expect(cardOf().locator('.story-card__thumb')).toHaveCount(0);
});

test('מסך פתיחה: זיכרונות מרחפים, לא חוסמים, וחזרה מהכותרת בלי התנתקות', async ({ page }) => {
  await login(page);
  // מכל לשונית — האווטאר והכיתוב ״חזרה לדף הכניסה״ מובילים למסך הפתיחה
  for (const tab of ['תמונות', 'סרטונים', 'סיפורים']) {
    await page.locator('.tabs--bottom').getByRole('link', { name: tab }).click();
    const back = page.locator('.topbar__brand');
    await expect(back.locator('.topbar__back')).toHaveText('חזרה לדף הכניסה');
    await expect(back).toHaveAttribute('href', '/');
    await expect(back.locator('.avatar')).toHaveCSS('width', '42px');
  }
  const delays = async () => page.locator('.mem').evaluateAll((els) => els.map((e) => (e as HTMLElement).style.getPropertyValue('--drift-delay')).join(','));
  await page.locator('.topbar__back').click();
  await expect(page).toHaveURL(/\/$/);
  const mems = page.locator('.mem img');
  await expect(mems).toHaveCount(7);
  await expect.poll(() => mems.evaluateAll((els) => els.filter((e) => (e as HTMLImageElement).naturalWidth > 0).length)).toBe(7);
  // התמונות שקופות (WebP עם alpha) ומונפשות ב-transform
  expect(await page.locator('.mem__drift').first().evaluate((e) => getComputedStyle(e).animationName)).toBe('mem-drift');
  expect(await page.locator('.orbit__layer').evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
  // התנועה מורגשת כבר בשניות הראשונות
  const centers = () => mems.evaluateAll((els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }));
  const c0 = await centers();
  await page.waitForTimeout(2000);
  const c1 = await centers();
  const moved = c0.map((p, i) => Math.hypot(p[0] - c1[i][0], p[1] - c1[i][1]));
  expect(moved.filter((d) => d > 4).length).toBeGreaterThanOrEqual(5);
  expect(Math.max(...moved)).toBeGreaterThan(8);
  // אף אלמנט לא מסתיר את התמונה המרכזית או את כפתור הכניסה
  const overlap = await page.evaluate(() => {
    const inter = (a: DOMRect, b: DOMRect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const photo = document.querySelector('.frame__mat > *')!.getBoundingClientRect();
    const cta = document.querySelector('.landing__cta')!.getBoundingClientRect();
    const title = document.querySelector('.landing__title')!.getBoundingClientRect();
    return Array.from(document.querySelectorAll('.mem img')).map((i) => {
      const b = i.getBoundingClientRect();
      return { photo: inter(b, photo) / (b.width * b.height), cta: inter(b, cta), title: inter(b, title), edge: Math.max(0, -b.left, b.right - innerWidth) };
    });
  });
  for (const o of overlap) {
    // (מסגרת התמונה המסובבת גדלה בסיבוב, ופינותיה שקופות — לכן סובלנות קטנה)
    expect(o.photo).toBeLessThan(0.12);
    expect(o.cta).toBe(0);
    expect(o.title).toBe(0);
    // חריגה של שבר פיקסל בקצה המסך נחתכת בלי גלילה — לא נראית
    expect(o.edge).toBeLessThan(2);
  }
  await noHorizontalScroll(page);
  const cta = page.getByRole('button', { name: 'כניסה לזיכרונות' });
  const box = (await cta.boundingBox())!;
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.textContent, [box.x + box.width / 2, box.y + box.height / 2])).toContain('כניסה לזיכרונות');
  await page.waitForTimeout(1800);
  await shot(page, '37-landing-memories');
  const first = await delays();
  // ״כניסה לזיכרונות״ — חזרה לאתר בלי התחברות מחדש
  await cta.click();
  await expect(page).toHaveURL(/\/home$/);
  // חזרה נוספת — האנימציה מתחילה מחדש עם תזמונים חדשים
  await page.locator('.topbar__brand').click();
  await expect(page.locator('.mem')).toHaveCount(7);
  expect(await delays()).not.toBe(first);
  await page.setViewportSize({ width: 360, height: 740 });
  await noHorizontalScroll(page);
  await shot(page, '38-landing-memories-360');
});

test('Google Drive: תמונה חדשה מופיעה אחרי סנכרון וב״זיכרון מסבא״, הוסרה — נעלמת, שגיאה — שום דבר לא נמחק', async ({ page }) => {
  await login(page);
  const total = async () => ((await (await page.request.get('/api/items?kind=photo&limit=1')).json()) as { total: number }).total;
  const start = await total();
  // תמונה חדשה בדרייב (ותמונה אחת שהוסרה ממנו)
  const fresh = drivePhoto(45);
  await setDriveMock({ fail: null, files: [...BASE_PHOTOS.filter((f) => f.id !== drivePhoto(2).id), fresh] });
  await page.goto('/settings/drive');
  await expect(page.locator('.drive-state')).toContainText('מחובר');
  await page.getByRole('button', { name: 'סנכרן עכשיו' }).click();
  await expect(page.getByText(/הסנכרון הושלם/).first()).toBeVisible();
  expect(await total()).toBe(start);
  const freshItem = ((await (await page.request.get('/api/items?kind=photo&sort=new&limit=100')).json()) as { items: { id: string; files: { id: string }[] }[] }).items.find((i) => i.files.some((f) => f.id.includes(fresh.id)));
  expect(freshItem).toBeTruthy();

  // שגיאת API — מוצגת, ושום תמונה לא נמחקת
  await setDriveMock({ fail: 500 });
  await page.getByRole('button', { name: 'סנכרן עכשיו' }).click();
  await expect(page.locator('.drive-state')).toContainText('שגיאת חיבור');
  expect(await total()).toBe(start);
  await setDriveMock({ fail: null, files: BASE_PHOTOS.filter((f) => f.id !== drivePhoto(2).id).concat(fresh) });
  await page.getByRole('button', { name: 'סנכרן עכשיו' }).click();
  await expect(page.locator('.drive-state')).toContainText('מחובר');

  // ״זיכרון מסבא״ — יכול להציג את התמונה החדשה
  await page.goto('/home');
  let found = false;
  for (let i = 0; i < 200 && !found; i++) {
    const src = (await page.locator('.memory__media img').first().getAttribute('src')) ?? '';
    found = src.includes(fresh.id);
    if (!found) {
      await page.getByRole('button', { name: 'עוד זיכרון' }).click();
      await page.waitForTimeout(80);
    }
  }
  expect(found).toBe(true);
  await page.locator('.memory__card--button').click();
  await expect(page.locator('.lightbox .lightbox__img img').last()).toHaveAttribute('src', new RegExp(fresh.id));
  await page.getByRole('button', { name: 'סגירה' }).click();
  // התמונה שהוסרה מהדרייב לא מופיעה ב״זיכרון מסבא״ ולא בגלריה
  const all = ((await (await page.request.get('/api/items?kind=photo&limit=100')).json()) as { items: { files: { id: string }[] }[] }).items;
  expect(all.some((i) => i.files.some((f) => f.id.includes(drivePhoto(2).id)))).toBe(false);
  // החזרה למצב הבסיס
  await setDriveMock({ files: BASE_PHOTOS });
  await page.request.post('/api/admin/drive/sync', { headers: { origin: new URL(page.url()).origin } });
  await noHorizontalScroll(page);
});

test('מעבר וניקוי: אין תמונות ישנות, ומפתח ה-API לא נחשף בדפדפן', async ({ page }) => {
  await login(page);
  await page.goto('/settings/drive');
  await expect(page.locator('.migration')).toBeVisible();
  await expect(page.getByTestId('mig-drive')).toHaveText('44');
  await expect(page.getByTestId('mig-legacy')).toHaveText('0');
  await expect(page.getByTestId('mig-linked')).toHaveText('0');
  await page.screenshot({ path: path.join(SHOTS, '45-migration.png'), fullPage: true });
  // המפתח לא מופיע בשום משאב שהדפדפן קיבל
  const html = await page.content();
  expect(html).not.toContain('e2e-drive-key');
  const scripts = await page.evaluate(() => Array.from(document.scripts).map((s) => s.src).filter(Boolean));
  for (const src of scripts) expect(await (await page.request.get(src)).text()).not.toContain('e2e-drive-key');
  for (const api of ['/api/settings', '/api/admin/drive', '/api/admin/drive/migration', '/api/items?kind=photo']) {
    expect(await (await page.request.get(api)).text()).not.toContain('e2e-drive-key');
  }
});

test.describe('מסך פתיחה עם הפחתת תנועה', () => {
  test.use({ reducedMotion: 'reduce' });
  test('prefers-reduced-motion — האלמנטים נשארים במקומם', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.mem')).toHaveCount(7);
    expect(await page.locator('.mem__drift').first().evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
    expect(await page.locator('.mem__img').first().evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  });
});

test.describe('מחשב', () => {
  test.use({ viewport: { width: 1366, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  test('תצוגת מחשב', async ({ page }) => {
    await login(page);
    await expect(page.locator('.tabs--top')).toBeVisible();
    await expect(page.locator('.tabs--bottom')).toBeHidden();
    await page.waitForTimeout(600);
    await shot(page, '17-desktop-home');
    await page.goto('/c/photo');
    await page.waitForTimeout(600);
    expect(await page.locator('.gallery').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBeGreaterThanOrEqual(4);
    await shot(page, '18-desktop-gallery');
    await page.goto('/c/video');
    expect(await page.locator('.grid--media').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(6);
    await shot(page, '30-desktop-videos');
    await page.setViewportSize({ width: 768, height: 1000 });
    expect(await page.locator('.grid--media').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(4);
    await page.goto('/c/story');
    await expect(page.locator('.story-board__col')).toHaveCount(2);
    await page.setViewportSize({ width: 1366, height: 900 });
    await expect(page.locator('.story-board__col')).toHaveCount(3);
    await page.waitForTimeout(700);
    await shot(page, '40-desktop-stories');
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/settings/backups');
    await shot(page, '19-desktop-backups');
    await page.goto('/');
    await page.waitForTimeout(1600);
    await shot(page, '20-desktop-landing');
  });
});

test.describe('Chrome באנדרואיד (אמולציה)', () => {
  // Pixel 7 בלי defaultBrowserType (כולם רצים ב-Chromium ממילא)
  const { defaultBrowserType: _ignored, ...pixel } = devices['Pixel 7'];
  void _ignored;
  test.use({ ...pixel, locale: 'he-IL' });
  test('חלונית Drive: בלי סיבוב או מסך מלא כפויים, התאמה לאנכי ולאופקי, חזרה לארכיון', async ({ page }) => {
    await login(page);
    const vids = ((await (await page.request.get('/api/items?kind=video&limit=50')).json()) as { items: { externalVideo: { fileId: string } | null }[] }).items;
    const driveId = vids.find((v) => v.externalVideo)!.externalVideo!.fileId;
    await page.goto('/c/video');
    const ua = await page.evaluate(() => navigator.userAgent);
    expect(ua).toContain('Android');

    const open = async (ratio: number) => {
      await page.evaluate(([id, r]) => localStorage.setItem(`saba:drive-ratio:${id}`, String(r)), [driveId, ratio] as const);
      await page.locator('.media-card[data-source="drive"]').first().click();
      await expect(page.locator('.theater__frame iframe')).toBeVisible();
      // אין מסך מלא כפוי (ולכן גם אין נעילת כיוון)
      expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
      return page.locator('.theater__frame').evaluate((el) => {
        const r = el.getBoundingClientRect();
        const st = el.parentElement!.getBoundingClientRect();
        // השטח הפנוי לנגן: החלונית פחות הסרגל והשוליים
        return { w: r.width, h: r.height, left: r.left, top: r.top, bottom: r.bottom, aw: innerWidth - 16, ah: st.height - 16, stTop: st.top, vw: innerWidth, vh: innerHeight };
      });
    };

    // אנכי — מנצל את הגובה, במרכז
    const p = await open(9 / 16);
    expect(Math.abs(p.w / p.h - 9 / 16)).toBeLessThan(0.02);
    // ממלא את השטח הפנוי עד הגבול הראשון (רוחב או גובה) — בלי חיתוך
    expect(Math.max(p.w / p.aw, p.h / p.ah)).toBeGreaterThan(0.97);
    expect(p.h).toBeLessThan(p.w * 2);
    expect(p.bottom).toBeLessThanOrEqual(p.vh + 1);
    expect(p.top).toBeGreaterThanOrEqual(p.stTop - 1);
    expect(Math.abs(p.left - (p.vw - p.w) / 2)).toBeLessThan(2);
    // כפתורים: רק סגירה, Drive ודף הסרטון — בלי כפילויות
    await expect(page.locator('.theater__bar .theater__btn')).toHaveCount(3);
    await page.screenshot({ path: path.join(SHOTS, '35-android-drive-portrait.png') });
    // ״חזרה״ של הטלפון — יציאה מהנגן וחזרה לארכיון
    await page.goBack();
    await expect(page.locator('.theater')).toHaveCount(0);
    await expect(page).toHaveURL(/\/c\/video$/);

    // אופקי — מנצל את רוחב המסך
    const l = await open(16 / 9);
    expect(Math.abs(l.w - l.aw)).toBeLessThan(2);
    expect(Math.abs(l.w / l.h - 16 / 9)).toBeLessThan(0.02);
    await page.screenshot({ path: path.join(SHOTS, '36-android-drive-landscape.png') });
    await page.getByRole('button', { name: 'סגירה' }).click();
    await expect(page.locator('.theater')).toHaveCount(0);
    await expect(page).toHaveURL(/\/c\/video$/);

    // סרטון שהועלה — נפתח בחלונית ומתחיל לנגן בנגן המקורי
    await page.locator('.media-card[data-source="upload"]').first().click();
    const v = page.locator('.theater video');
    await expect(v).toBeVisible();
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    await expect.poll(() => v.evaluate((el: HTMLVideoElement) => !el.paused)).toBe(true);
    await expect(page.locator('.theater__bar .theater__btn')).toHaveCount(2);
    await page.goBack();
    await expect(page.locator('.theater')).toHaveCount(0);

    // תמונות מ-Google Drive נטענות גם בכרום באנדרואיד
    await page.goto('/c/photo');
    const driveImgs = page.locator('.photo-tile img[src*="/api/files/gd:"]');
    await expect(driveImgs.first()).toBeVisible();
    await expect.poll(() => driveImgs.first().evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  });
});
