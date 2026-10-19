import type {
  AdminUser, ArchiveStats, AuthStatus, BackupStatus, FileInfo, InviteInfo, ItemDetail, ItemKind, ItemSummary,
  SearchResults, SiteSettings, TagInfo, HeroTraits,
} from '../../shared/types';
import { DIRECT_UPLOAD_MAX } from '../../shared/constants';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'אין חיבור לאינטרנט. בדקו את החיבור ונסו שוב.');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('saba:unauthorized'));
    throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? 'אירעה שגיאה. נסו שוב.');
  }
  return data as T;
}

const get = <T>(p: string) => request<T>('GET', p);
const post = <T>(p: string, b: unknown = {}) => request<T>('POST', p, b);
const patch = <T>(p: string, b: unknown) => request<T>('PATCH', p, b);
const put = <T>(p: string, b: unknown) => request<T>('PUT', p, b);
const del = <T>(p: string) => request<T>('DELETE', p);

const qs = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export const fileUrl = (id: string, download = false) => `/api/files/${id}${download ? '?download=1' : ''}`;

export interface ListParams {
  kind?: ItemKind;
  sort?: string;
  /** seed לסדר אקראי יציב */
  seed?: number;
  tag?: string;
  year?: number;
  decade?: number;
  storyType?: string;
  limit?: number;
  offset?: number;
  deleted?: boolean;
}

export interface NewItem {
  kind: ItemKind;
  title: string;
  description?: string;
  body?: string;
  storyType?: string;
  dateText?: string;
  dateYear?: number | null;
  people?: string;
  tags?: string[];
  files?: { id: string; width?: number; height?: number; duration?: number }[];
  linkIds?: string[];
  /** סרטון: קישור שיתוף ל-Google Drive במקום קובץ */
  externalUrl?: string;
}

export const api = {
  status: () => get<AuthStatus>('/auth/status'),
  setup: (b: { token: string; name: string; email: string; password: string }) => post('/auth/setup', b),
  login: (email: string, password: string) => post('/auth/login', { email, password }),
  logout: () => post('/auth/logout'),
  checkInvite: (token: string) => get<{ valid: boolean; email: string | null }>(`/auth/invite/${encodeURIComponent(token)}`),
  acceptInvite: (b: { token: string; name: string; email: string; password: string }) => post('/auth/accept-invite', b),
  checkReset: (token: string) => get<{ name: string; email: string }>(`/auth/reset/${encodeURIComponent(token)}`),
  reset: (token: string, password: string) => post('/auth/reset', { token, password }),
  updateMe: (name: string) => patch('/auth/me', { name }),
  changePassword: (current: string, password: string) => post('/auth/me/password', { current, password }),

  settings: () => get<SiteSettings>('/settings'),
  list: (p: ListParams) => get<{ items: ItemSummary[]; total: number }>(`/items${qs({ ...p, deleted: p.deleted ? '1' : undefined })}`),
  facets: (kind?: ItemKind) => get<{ years: { year: number; count: number }[]; tags: TagInfo[] }>(`/facets${qs({ kind })}`),
  item: (id: string) => get<ItemDetail>(`/items/${id}`),
  create: (b: NewItem) => post<ItemDetail>('/items', b),
  edit: (id: string, b: Partial<NewItem>) => patch<ItemDetail>(`/items/${id}`, b),
  remove: (id: string) => del(`/items/${id}`),
  restore: (id: string) => post(`/items/${id}/restore`),
  comment: (id: string, body: string, kind: 'comment' | 'memory') => post(`/items/${id}/comments`, { body, kind }),
  removeComment: (id: string) => del(`/comments/${id}`),
  random: (exclude: string[]) => get<{ item: ItemSummary | null; total: number }>(`/random${qs({ exclude: exclude.join(',') })}`),
  search: (q: string, kind?: ItemKind) => get<SearchResults>(`/search${qs({ q, kind })}`),
  tags: () => get<TagInfo[]>('/tags'),
  attachable: (kind?: ItemKind) => get<ItemSummary[]>(`/attachable${qs({ kind })}`),

  admin: {
    users: () => get<AdminUser[]>('/admin/users'),
    updateUser: (id: string, b: { role?: string; disabled?: boolean }) => patch(`/admin/users/${id}`, b),
    resetLink: (id: string) => post<{ url: string; expiresInDays: number }>(`/admin/users/${id}/reset-link`),
    invites: () => get<InviteInfo[]>('/admin/invites'),
    createInvite: (b: { role: string; email?: string; note?: string; days?: number }) =>
      post<{ id: string; url: string; expiresAt: number }>('/admin/invites', b),
    revokeInvite: (id: string) => del(`/admin/invites/${id}`),
    saveSettings: (b: { siteTitle?: string; subtitle?: string; heroTraits?: HeroTraits }) => put('/admin/settings', b),
    setHero: (b: { fileId?: string; itemId?: string; clear?: boolean }) => put<{ heroFileId: string | null }>('/admin/hero', b),
    renameTag: (id: number, name: string) => patch(`/admin/tags/${id}`, { name }),
    deleteTag: (id: number) => del(`/admin/tags/${id}`),
    stats: () => get<ArchiveStats>('/admin/stats'),
    backups: () => get<BackupStatus>('/admin/backups'),
    runBackup: () => post<{ status: string; message: string }>('/admin/backups/run'),
    missingThumbs: () => get<{ itemId: string; fileId: string; mime: string; size: number; name: string }[]>('/admin/thumbs/missing'),
    attachThumb: (itemId: string, b: { fileId: string; width?: number; height?: number }) => post(`/admin/items/${itemId}/thumb`, b),
    audit: () => get<{ id: number; action: string; target_type: string; target_id: string; created_at: number; user_name: string }[]>('/admin/audit'),
  },
};

// ---------------- העלאת קבצים ----------------

export type Progress = (loaded: number, total: number) => void;

function xhrSend(method: string, url: string, body: Blob, contentType: string | null, onProgress: (loaded: number) => void, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.withCredentials = true;
    if (contentType) xhr.setRequestHeader('content-type', contentType);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      let data: { error?: string } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* לא JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error ?? 'ההעלאה נכשלה'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'החיבור נקטע במהלך ההעלאה'));
    xhr.onabort = () => reject(new ApiError(-1, 'ההעלאה בוטלה'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(body);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** מעלה קובץ — ישירות אם הוא קטן, או בחלקים עם ניסיונות חוזרים אם הוא גדול. */
export async function uploadFile(
  file: Blob,
  opts: { kind: Exclude<ItemKind, 'story'>; role?: 'original' | 'thumb' | 'poster'; name: string; mime: string; onProgress?: Progress; signal?: AbortSignal },
): Promise<FileInfo> {
  const role = opts.role ?? 'original';
  const total = file.size;
  const report = (n: number) => opts.onProgress?.(Math.min(n, total), total);

  if (total <= DIRECT_UPLOAD_MAX) {
    const url = `/api/uploads/direct${qs({ kind: opts.kind, role, name: opts.name, size: total })}`;
    for (let attempt = 0; ; attempt++) {
      try {
        return (await xhrSend('POST', url, file, opts.mime || 'application/octet-stream', report, opts.signal)) as FileInfo;
      } catch (e) {
        const err = e as ApiError;
        if (err.status !== 0 || attempt >= 2) throw err;
        await sleep(1500 * (attempt + 1));
      }
    }
  }

  const start = await post<{ uploadId: string; partSize: number; parts: number }>('/uploads/multipart', {
    kind: opts.kind, role, name: opts.name, mime: opts.mime, size: total,
  });
  const done: { partNumber: number; etag: string }[] = [];
  const loadedByPart = new Map<number, number>();
  const reportParts = () => report([...loadedByPart.values()].reduce((a, b) => a + b, 0));
  try {
    let next = 1;
    const worker = async () => {
      while (next <= start.parts) {
        const n = next++;
        const chunk = file.slice((n - 1) * start.partSize, Math.min(n * start.partSize, total));
        for (let attempt = 0; ; attempt++) {
          try {
            const res = (await xhrSend('PUT', `/api/uploads/multipart/${start.uploadId}/${n}`, chunk, null, (l) => {
              loadedByPart.set(n, l);
              reportParts();
            }, opts.signal)) as { partNumber: number; etag: string };
            loadedByPart.set(n, chunk.size);
            reportParts();
            done.push(res);
            break;
          } catch (e) {
            const err = e as ApiError;
            if (err.status === -1 || (err.status >= 400 && err.status < 500) || attempt >= 4) throw err;
            loadedByPart.set(n, 0);
            await sleep(2000 * 2 ** attempt);
          }
        }
      }
    };
    // שני חלקים במקביל — איזון בין מהירות ליציבות בחיבור סלולרי
    await Promise.all([worker(), worker()]);
    return await post<FileInfo>(`/uploads/multipart/${start.uploadId}/complete`, { parts: done });
  } catch (e) {
    post(`/uploads/multipart/${start.uploadId}/abort`).catch(() => undefined);
    throw e;
  }
}
