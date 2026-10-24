import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** זורק שגיאה עם הודעה בעברית שמוצגת למשתמש. */
export function fail(status: ContentfulStatusCode, message: string): never {
  throw new HTTPException(status, { message });
}

export const now = () => Date.now();

export function newId(): string {
  return crypto.randomUUID();
}

export function str(value: unknown, max: number, field: string, required = false): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) fail(400, `השדה ״${field}״ הוא חובה`);
    return null;
  }
  if (typeof value !== 'string') fail(400, `ערך לא תקין בשדה ״${field}״`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(400, `השדה ״${field}״ הוא חובה`);
  if (trimmed.length > max) fail(400, `השדה ״${field}״ ארוך מדי`);
  return trimmed || null;
}

export function intOrNull(value: unknown, field: string, min: number, max: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `ערך לא תקין בשדה ״${field}״`);
  return n;
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') throw new Error();
    return body as T;
  } catch {
    fail(400, 'בקשה לא תקינה');
  }
}

/** בונה placeholders ל-IN (?, ?, ?) */
export const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');
