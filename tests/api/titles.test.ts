import { describe, expect, it } from 'vitest';
import { isTechnicalTitle } from '../../shared/titles';
import { parseDriveFileId } from '../../shared/drive';

describe('isTechnicalTitle', () => {
  it.each([
    ['', null], ['8813', null], ['8827', 'IMG_8827.JPG'], ['IMG 8813', 'IMG_8813.jpg'], ['IMG_8813', null],
    ['PXL 20240101 123456789', null], ['WhatsApp Image 2024-01-01 at 10.00.00', null],
    ['3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b', null], ['a8f3c9e1b2d4f6a8c0e2', null], ['DSC_0042', null],
    ['סבא בחתונה', 'סבא בחתונה.jpg'],
  ])('״%s״ טכני', (title, name) => {
    expect(isTechnicalTitle(title, name)).toBe(true);
  });

  it.each([['סבא בים', 'IMG_8813.jpg'], ['ביום ההולדת ה-80', null], ['1985', null], ['Grandpa at the lake', null], ['קיץ 1974', null]])(
    '״%s״ אמיתי',
    (title, name) => {
      expect(isTechnicalTitle(title, name)).toBe(false);
    },
  );
});

describe('parseDriveFileId', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  it.each([
    `https://drive.google.com/file/d/${id}/view?usp=sharing`,
    `https://drive.google.com/file/d/${id}/preview`,
    `https://drive.google.com/file/u/0/d/${id}/view`,
    `https://drive.google.com/open?id=${id}`,
    `https://drive.google.com/uc?export=download&id=${id}`,
    `  https://drive.google.com/file/d/${id}  `,
  ])('%s', (url) => expect(parseDriveFileId(url)).toBe(id));
  it.each(['https://youtube.com/watch?v=abc', 'https://drive.google.com/drive/my-drive', `https://evil.com/file/d/${id}/view`, 'not a url'])(
    'דוחה %s',
    (url) => expect(parseDriveFileId(url)).toBeNull(),
  );
});
