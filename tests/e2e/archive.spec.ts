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
    const img = page.locator('.memory__media--fit img');
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
    await shot(page, '18-desktop-gallery');
    await page.goto('/settings/backups');
    await shot(page, '19-desktop-backups');
    await page.goto('/');
    await page.waitForTimeout(1600);
    await shot(page, '20-desktop-landing');
  });
});
