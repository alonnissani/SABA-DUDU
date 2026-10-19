import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * שרת Google Drive מדומה לבדיקות קצה-לקצה: Drive API (רשימת קבצים) ושרת התמונות של גוגל.
 * ה-Worker המקומי פונה אליו דרך DRIVE_API_BASE / DRIVE_IMAGE_BASE ב-.dev.vars — לא לגוגל באמת.
 */
export const DRIVE_MOCK_PORT = 5199;
export const MOCK_FOLDER = '1E2eFamilyFolderAbcdefghijk';
export const MOCK_KEY = 'e2e-drive-key';

interface MockFile { id: string; parent: string; mime: string; width?: number; height?: number }
const state: { files: MockFile[]; fail: number | null } = { files: [], fail: null };

export function startDriveMock(fixturesDir: string): Server {
  const images = [readFileSync(path.join(fixturesDir, 'photo-a.jpg')), readFileSync(path.join(fixturesDir, 'photo-b.jpg'))];
  const send = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${DRIVE_MOCK_PORT}`);
    if (url.pathname === '/__state' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        Object.assign(state, JSON.parse(raw || '{}'));
        send(res, 200, { ok: true });
      });
      return;
    }
    const img = /^\/d\/([^=]+)=s\d+$/.exec(url.pathname);
    if (img) {
      const i = state.files.findIndex((f) => f.id === img[1]);
      if (i < 0) return send(res, 404, {});
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      return res.end(images[i % 2]);
    }
    if (url.searchParams.get('key') !== MOCK_KEY) return send(res, 400, { error: { message: 'API key not valid' } });
    const meta = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (meta) {
      return meta[1] === MOCK_FOLDER
        ? send(res, 200, { id: MOCK_FOLDER, name: 'תמונות משפחה (בדיקה)', mimeType: 'application/vnd.google-apps.folder' })
        : send(res, 404, { error: { message: 'File not found' } });
    }
    if (url.pathname === '/drive/v3/files') {
      if (state.fail) return send(res, state.fail, { error: { message: 'backendError' } });
      const parent = /'([^']+)' in parents/.exec(url.searchParams.get('q') ?? '')?.[1];
      return send(res, 200, {
        files: state.files
          .filter((f) => f.parent === parent)
          .map((f) => ({ id: f.id, mimeType: f.mime, createdTime: '2024-03-01T09:00:00Z', ...(f.width ? { imageMediaMetadata: { width: f.width, height: f.height } } : {}) })),
      });
    }
    send(res, 404, {});
  });
  server.listen(DRIVE_MOCK_PORT);
  return server;
}

/** קובע את תוכן התיקייה המדומה (מתוך הבדיקה) */
export async function setDriveMock(next: Partial<typeof state>) {
  await fetch(`http://localhost:${DRIVE_MOCK_PORT}/__state`, { method: 'POST', body: JSON.stringify(next) });
}
