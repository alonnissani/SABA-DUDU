import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { FIXTURES } from './global-setup';

const SHOTS = path.resolve('test-results/screens');
const SETUP_TOKEN = process.env.E2E_SETUP_TOKEN ?? 'local-dev-setup-token';
const ADMIN = { name: 'מנהל הבדיקה', email: 'admin@e2e.test', password: 'e2e-admin-pass' };
const fx = (f: string) => path.join(FIXTURES, f);
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
  await expect(page.getByText('הארכיון עדיין ריק')).toBeVisible();
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

test('העלאת תמונות מרובות, גלריה ותצוגה במסך מלא', async ({ page }) => {
  await login(page);
  await page.goto('/c/photo/new');
  await page.locator('input[type=file]').setInputFiles([fx('photo-a.jpg'), fx('photo-b.jpg')]);
  const titles = page.locator('.pending__title');
  await expect(titles).toHaveCount(2);
  await titles.nth(0).fill('ביום ההולדת ה-80');
  await titles.nth(1).fill('בחצר הבית');
  await page.getByLabel('תאריך או תקופה (לא חובה)').fill('קיץ 1985');
  await page.getByLabel('הוספת תגית').fill('משפחה');
  await page.getByRole('button', { name: 'הוספה' }).click();
  await shot(page, '04-photo-upload-form');
  await page.getByRole('button', { name: 'שמירה' }).click();
  await expect(page).toHaveURL(/\/c\/photo$/, { timeout: 30_000 });
  await expect(page.locator('.photo-tile')).toHaveCount(2);
  await page.waitForTimeout(600);
  await shot(page, '05-gallery');

  await page.locator('.photo-tile__btn').first().click();
  const lb = page.locator('.lightbox');
  await expect(lb).toBeVisible();
  await page.getByRole('button', { name: 'הגדלה' }).click();
  await expect(page.locator('.lightbox__img')).toHaveAttribute('style', /scale\(1\.5\)/);
  const dl = page.getByRole('link', { name: 'הורדת קובץ המקור' });
  await expect(dl).toHaveAttribute('href', /download=1/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, '06-lightbox.png') });
  await page.getByRole('button', { name: 'סגירה' }).click();
  await expect(lb).toBeHidden();

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
  await card.getByRole('button', { name: /השמעת/ }).click();
  await expect(card.getByRole('button', { name: /השהיית/ })).toBeVisible();
  await card.getByRole('button', { name: /השהיית/ }).click();
  await shot(page, '07-audio-list');
});

test('העלאת סרטון ומסמך', async ({ page }) => {
  await login(page);
  await page.goto('/c/video/new');
  await page.locator('input[type=file]').setInputFiles(fx('clip.webm'));
  await page.locator('.pending__title').fill('ריקוד במסיבת יום ההולדת');
  await page.getByRole('button', { name: 'שמירה' }).click();
  await expect(page).toHaveURL(/\/c\/video$/, { timeout: 30_000 });
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
  await page.locator('.doc-card').first().click();
  await expect(page.locator('iframe.doc-view__frame')).toBeVisible();
  await shot(page, '10-document-page');
});

test('סיפור עם צירוף, ״גם אני זוכר את זה״', async ({ page }) => {
  await login(page);
  await page.goto('/c/story/new');
  await page.getByText('בדיחה של סבא').click();
  await page.getByLabel('כותרת').fill('הבדיחה מיום ההולדת');
  await page.getByLabel('הסיפור').fill('בכל יום הולדת סבא היה עומד, מרים כוס ואומר משפט אחד קבוע.\nכולם כבר ידעו מה יבוא — ובכל זאת צחקו.');
  await page.getByRole('button', { name: 'בחירה מהארכיון' }).click();
  await page.getByRole('button', { name: 'צירוף' }).first().click();
  await page.getByRole('button', { name: 'סיום' }).click();
  await shot(page, '11-story-form');
  await page.getByRole('button', { name: 'שמירה ופרסום' }).click();
  await expect(page).toHaveURL(/\/item\//);
  await expect(page.locator('.sheet__title')).toHaveText('הבדיחה מיום ההולדת');
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
  for (const label of ['תמונות', 'סרטונים', 'הקלטות', 'סיפורים', 'מסמכים']) {
    await expect(page.locator('.search__group h2', { hasText: label })).toBeVisible();
  }
  await shot(page, '13-search');
  await page.locator('.chips').getByRole('button', { name: 'הקלטות' }).click();
  await expect(page.locator('.search__group')).toHaveCount(1);
});

test('זיכרון אקראי במסך הבית', async ({ page }) => {
  await login(page);
  const title = page.locator('.memory__title');
  await expect(title).toBeVisible();
  const seen = new Set([await title.textContent()]);
  for (let i = 0; i < 4; i++) {
    const before = await title.textContent();
    await page.getByRole('button', { name: 'עוד זיכרון' }).click();
    await expect(title).not.toHaveText(before!);
    seen.add(await title.textContent());
  }
  expect(seen.size).toBeGreaterThanOrEqual(5);
  await page.waitForTimeout(500);
  await shot(page, '14-home-memory');
  await page.locator('.memory__card').click();
  await expect(page).toHaveURL(/\/item\//);
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

test('תמונה בלי כותרת מוצגת בלי מזהה טכני', async ({ page }) => {
  await login(page);
  await page.goto('/c/photo/new');
  await page.locator('input[type=file]').setInputFiles(fx('IMG_8813.jpg'));
  await expect(page.locator('.pending__title')).toHaveValue('');
  await page.getByRole('button', { name: 'שמירה' }).click();
  await expect(page).toHaveURL(/\/c\/photo$/, { timeout: 30_000 });
  await expect(page.locator('.photo-tile')).toHaveCount(3);
  const captions = await page.locator('.photo-tile__title').allTextContents();
  expect(captions.sort()).toEqual(['ביום ההולדת ה-80', 'בחצר הבית'].sort());
  await expect(page.locator('.gallery')).not.toContainText('8813');
  await expect(page.locator('.gallery')).not.toContainText('IMG');
  await shot(page, '22-gallery-untitled');
});

test('סרטון מקישור Google Drive', async ({ page }) => {
  await login(page);
  const fileId = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  await page.goto('/c/video/new');
  await page.getByRole('radio', { name: /קישור ל-Google Drive/ }).click();
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
  await expect(page.locator('.media-card__source')).toHaveCount(1);
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

test('גלריה: ממוזערות בלבד, המקור נטען רק בפתיחה; 2 עמודות בנייד', async ({ page }) => {
  await login(page);
  await page.goto('/c/photo/new');
  await page.locator('input[type=file]').setInputFiles(fx('big-photo.jpg'));
  await page.locator('.pending__title').fill('צילום גדול');
  await page.getByRole('button', { name: 'שמירה' }).click();
  await expect(page).toHaveURL(/\/c\/photo$/, { timeout: 60_000 });

  const items = ((await (await page.request.get('/api/items?kind=photo&limit=100')).json()) as { items: { title: string; files: { id: string; role: string; size: number }[] }[] }).items;
  const big = items.find((i) => i.title === 'צילום גדול')!;
  const orig = big.files.find((f) => f.role === 'original')!;
  const thumb = big.files.find((f) => f.role === 'thumb')!;
  expect(thumb).toBeTruthy();

  const requested = new Map<string, number>();
  page.on('response', async (r) => {
    const m = /\/api\/files\/([0-9a-f-]{36})/.exec(r.url());
    if (m) requested.set(m[1], Number(r.headers()['content-length'] ?? 0));
  });
  await page.reload();
  await expect(page.locator('.photo-tile__img.is-loaded').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(requested.has(thumb.id)).toBe(true);
  expect(requested.has(orig.id)).toBe(false);
  console.log(`[gallery] original ${(orig.size / 1024).toFixed(0)}KB → thumbnail ${(thumb.size / 1024).toFixed(0)}KB`);
  expect(thumb.size).toBeLessThan(orig.size / 5);

  const cols = await page.locator('.gallery').evaluate((el) => getComputedStyle(el).columnCount);
  expect(cols).toBe('3');

  // פתיחה — רק אז נטען המקור
  await page.locator('.photo-tile', { hasText: 'צילום גדול' }).locator('.photo-tile__btn').click();
  await expect(page.locator('.lightbox')).toBeVisible();
  await expect.poll(() => requested.has(orig.id)).toBe(true);
  await page.getByRole('button', { name: 'סגירה' }).click();
  // המקור נשמר ללא שינוי (בייט-לבייט)
  const { readFileSync } = await import('node:fs');
  const served = Buffer.from(await (await page.request.get(`/api/files/${orig.id}`)).body());
  expect(served.equals(readFileSync(fx('big-photo.jpg')))).toBe(true);
});

test('גלריה: סדר אקראי בכל כניסה, טעינה הדרגתית בלי כפילויות או חוסרים', async ({ page }) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5e4c7d10000000049454e44ae426082', 'hex');
  for (let i = 0; i < 40; i++) {
    const up = (await (await page.request.post(`/api/uploads/direct?kind=photo&role=original&name=bulk${i}.png`, { data: png, headers: { 'content-type': 'image/png', origin } })).json()) as { id: string };
    await page.request.post('/api/items', { data: { kind: 'photo', title: `מספר ${i}`, files: [{ id: up.id }] }, headers: { origin } });
  }
  const total = ((await (await page.request.get('/api/items?kind=photo&limit=1')).json()) as { total: number }).total;
  expect(total).toBeGreaterThan(40);

  const seeds: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname === '/api/items' && u.searchParams.get('kind') === 'photo' && u.searchParams.get('offset') === '0') seeds.push(u.searchParams.get('seed') ?? '');
  });
  const firstTitles = async () => {
    await expect(page.locator('.photo-tile').first()).toBeVisible();
    return (await page.locator('.photo-tile').evaluateAll((els) => els.slice(0, 12).map((e) => e.textContent ?? ''))).join('|');
  };
  const nav = page.locator('.tabs--bottom');
  await nav.getByRole('link', { name: 'תמונות' }).click();
  const a = await firstTitles();
  await nav.getByRole('link', { name: 'בית' }).click();
  await nav.getByRole('link', { name: 'תמונות' }).click();
  const b = await firstTitles();
  // (בפיתוח React מריץ effects פעמיים, ולכן אותו seed יכול להופיע פעמיים באותה כניסה)
  expect(new Set(seeds).size).toBeGreaterThanOrEqual(2);
  expect(a).not.toBe(b);

  // גלילה עד הסוף — טעינה אוטומטית של כל התמונות, כל אחת פעם אחת
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

test('סרטונים: תצוגה מלאה ביחס המקורי וכפתור מסך מלא', async ({ page }) => {
  await login(page);
  await page.goto('/c/video');
  // 2 כרטיסים בשורה ב-390px
  const cols = await page.locator('.grid--media').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(cols).toBe(2);
  // לחיצה על כרטיס — מסך מלא מיד, בלי לחיצה נוספת
  await page.locator('.media-card', { hasNot: page.locator('.media-card__source') }).first().click();
  const tv = page.locator('.theater video');
  await expect(tv).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName ?? null)).toBe('HTML');
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
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();

  // דף הסרטון עצמו — כפתור מסך מלא
  await page.locator('.media-card', { hasNot: page.locator('.media-card__source') }).first().click();
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

  // סרטון Google Drive — לחיצה בגלריה פותחת מסך מלא עם הנגן המוטמע
  await page.goto('/c/video');
  await page.locator('.media-card', { has: page.locator('.media-card__source') }).first().click();
  await expect(page.locator('.theater__frame iframe')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName ?? null)).toBe('HTML');
  await expect(page.getByRole('link', { name: 'פתיחה ב-Google Drive' })).toBeVisible();
  await page.getByRole('link', { name: 'לדף הסרטון ותגובות' }).click();
  await expect(page.locator('.drive-frame iframe')).toBeVisible();
  await page.getByRole('button', { name: 'צפייה במסך מלא' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className ?? null)).toContain('drive-frame');
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.getByRole('link', { name: 'פתיחה ב-Google Drive' })).toBeVisible();
});

test('יצירת ממוזערות לתמונות קיימות — המקור לא משתנה', async ({ page }) => {
  await login(page);
  const origin = new URL(page.url()).origin;
  const { readFileSync } = await import('node:fs');
  const jpg = readFileSync(fx('photo-b.jpg'));
  const up = (await (await page.request.post('/api/uploads/direct?kind=photo&role=original&name=old-without-thumb.jpg', { data: jpg, headers: { 'content-type': 'image/jpeg', origin } })).json()) as { id: string };
  const item = (await (await page.request.post('/api/items', { data: { kind: 'photo', title: 'ישנה בלי ממוזערת', files: [{ id: up.id }] }, headers: { origin } })).json()) as { id: string };

  await page.goto('/settings/thumbs');
  await expect(page.getByText(/תמונות עדיין בלי גרסה מוקטנת/)).toBeVisible();
  await page.getByRole('button', { name: 'יצירת תמונות ממוזערות עכשיו' }).click();
  await expect(page.getByText('לכל התמונות כבר יש גרסה מוקטנת ✓')).toBeVisible({ timeout: 60_000 });
  await shot(page, '28-thumbs-backfill');

  const detail = (await (await page.request.get(`/api/items/${item.id}`)).json()) as { files: { id: string; role: string; mime: string }[] };
  const t = detail.files.find((f) => f.role === 'thumb');
  expect(t?.mime).toBe('image/webp');
  const served = Buffer.from(await (await page.request.get(`/api/files/${up.id}`)).body());
  expect(served.equals(jpg)).toBe(true);
});

test('מחיקת תמונה מהגלריה (מנהל) — עם אישור ועדכון מיידי', async ({ page }) => {
  await login(page);
  await page.goto('/c/photo?sort=new');
  const tiles = page.locator('.photo-tile');
  await expect(tiles.first().locator('img')).toBeVisible();
  const totalOf = async () => Number(/\d+/.exec((await page.locator('.page-head__sub').textContent()) ?? '')![0]);
  const before = await totalOf();
  const src = await tiles.first().locator('img').getAttribute('src');
  await tiles.first().locator('.photo-tile__delete').click();
  const dialog = page.locator('dialog');
  await expect(dialog).toContainText('סל המחזור');
  await dialog.getByRole('button', { name: 'ביטול' }).click();
  await expect(page.locator(`.photo-tile img[src="${src}"]`)).toHaveCount(1);
  await tiles.first().locator('.photo-tile__delete').click();
  await page.locator('dialog').getByRole('button', { name: 'מחיקה' }).click();
  await expect(page.locator(`.photo-tile img[src="${src}"]`)).toHaveCount(0);
  await expect.poll(totalOf).toBe(before - 1);
  await shot(page, '33-gallery-dense-delete');
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
  await expect(member.locator('.photo-tile__delete')).toHaveCount(0);
  await member.goto('/c/story');
  await member.locator('.story-card').first().click();
  await expect(member.getByRole('button', { name: 'גם אני זוכר את זה' })).toBeVisible();
  await expect(member.getByRole('button', { name: 'מחיקה' })).toHaveCount(0);
  await expect(member.getByRole('button', { name: 'עריכה' })).toHaveCount(0);
  const id = member.url().split('/item/')[1];
  const res = await member.request.delete(`/api/items/${id}`, { headers: { origin: new URL(member.url()).origin } });
  expect(res.status()).toBe(403);
  await member.goto('/settings');
  await expect(member.getByRole('link', { name: 'ניהול משתמשים' })).toHaveCount(0);
  await shot(member, '15-member-settings');

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
  await page.locator('.doc-card').first().click();
  await page.getByRole('button', { name: 'מחיקה' }).click();
  await page.locator('dialog').getByRole('button', { name: 'מחיקה' }).click();
  await expect(page).toHaveURL(/\/c\/document$/);
  await expect(page.getByText('עדיין אין מסמכים')).toBeVisible();
  await page.goto('/settings/content');
  await expect(page.locator('.row-card')).toHaveCount(1);
  await shot(page, '16-trash');
  await page.getByRole('button', { name: 'שחזור' }).click();
  await expect(page.getByText('סל המחזור ריק.')).toBeVisible();
  await page.goto('/c/document');
  await expect(page.locator('.doc-card')).toHaveCount(1);
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
    expect(await page.locator('.gallery').evaluate((el) => getComputedStyle(el).columnCount)).toBe('7');
    await shot(page, '18-desktop-gallery');
    await page.goto('/c/video');
    expect(await page.locator('.grid--media').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(4);
    await shot(page, '30-desktop-videos');
    await page.setViewportSize({ width: 768, height: 1000 });
    expect(await page.locator('.grid--media').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/settings/backups');
    await shot(page, '19-desktop-backups');
    await page.goto('/');
    await page.waitForTimeout(1600);
    await shot(page, '20-desktop-landing');
  });
});
