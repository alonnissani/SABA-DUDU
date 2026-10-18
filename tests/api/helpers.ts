import { SELF } from 'cloudflare:test';

export const ORIGIN = 'https://saba.test';

/** לקוח HTTP קטן עם ״עוגיות״ — מדמה דפדפן של בן משפחה. */
export class Client {
  cookie = '';

  async req(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set('cookie', this.cookie);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(init.json);
    }
    if (init.method && init.method !== 'GET' && !headers.has('origin')) headers.set('origin', ORIGIN);
    const res = await SELF.fetch(`${ORIGIN}${path}`, { ...init, headers, body });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = /sd_session=([^;]*)/.exec(set);
      if (m) this.cookie = m[1] ? `sd_session=${m[1]}` : '';
    }
    return res;
  }

  get(path: string) {
    return this.req(path);
  }
  post(path: string, json?: unknown) {
    return this.req(path, { method: 'POST', json: json ?? {} });
  }
  patch(path: string, json: unknown) {
    return this.req(path, { method: 'PATCH', json });
  }
  put(path: string, json: unknown) {
    return this.req(path, { method: 'PUT', json });
  }
  del(path: string) {
    return this.req(path, { method: 'DELETE' });
  }
}

// קבצים מינימליים עם חתימות אמיתיות
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
export const PDF = new TextEncoder().encode('%PDF-1.4\n%test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
export const MP3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
export const MP4_HEAD = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);

export async function setupAdmin(): Promise<Client> {
  const admin = new Client();
  const res = await admin.post('/api/auth/setup', {
    token: 'test-setup-token-123', name: 'מנהל', email: 'admin@family.test', password: 'admin-password-1',
  });
  if (res.status !== 200) throw new Error(`setup failed ${res.status} ${await res.text()}`);
  return admin;
}

export async function inviteMember(admin: Client, email = 'member@family.test', name = 'בן משפחה'): Promise<Client> {
  const inv = (await (await admin.post('/api/admin/invites', { role: 'member' })).json()) as { url: string };
  const token = inv.url.split('/invite/')[1];
  const member = new Client();
  const res = await member.post('/api/auth/accept-invite', { token, name, email, password: 'member-password-1' });
  if (res.status !== 200) throw new Error(`accept failed ${res.status} ${await res.text()}`);
  return member;
}

export async function upload(client: Client, kind: string, bytes: Uint8Array, name: string, mime: string, role = 'original') {
  return client.req(`/api/uploads/direct?kind=${kind}&role=${role}&name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': mime },
    body: bytes,
  });
}

export async function createMedia(client: Client, kind: string, bytes: Uint8Array, name: string, mime: string, extra: Record<string, unknown> = {}) {
  const up = await upload(client, kind, bytes, name, mime);
  if (up.status !== 200) throw new Error(`upload failed ${up.status} ${await up.text()}`);
  const file = (await up.json()) as { id: string };
  const res = await client.post('/api/items', { kind, title: name, files: [{ id: file.id }], ...extra });
  if (res.status !== 201) throw new Error(`create failed ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string; files: { id: string }[] };
}
