import type { HeroTraits, HomePhoto, HomePhotoSetting, SiteSettings } from '../../shared/types';
import { placeholders } from './http';
import { DEFAULT_SITE_TITLE, DEFAULT_SUBTITLE } from '../../shared/constants';
import { now } from './http';

const DEFAULTS: Record<string, string> = {
  site_title: DEFAULT_SITE_TITLE,
  subtitle: DEFAULT_SUBTITLE,
  hero_file_id: '',
  hero_traits: JSON.stringify({ quotes: [], symbols: [], details: [] } satisfies HeroTraits),
  home_photos: '[]',
};

export async function getSetting(db: D1Database, key: string): Promise<string> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? DEFAULTS[key] ?? '';
}

export async function setSetting(db: D1Database, key: string, value: string, userId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(key, value, now(), userId)
    .run();
}

function parseTraits(raw: string): HeroTraits {
  try {
    const v = JSON.parse(raw) as Partial<HeroTraits>;
    return {
      quotes: Array.isArray(v.quotes) ? v.quotes.filter((q) => typeof q === 'string') : [],
      symbols: Array.isArray(v.symbols) ? v.symbols.filter((s) => s && typeof s.label === 'string') : [],
      details: Array.isArray(v.details) ? v.details.filter((d) => d && typeof d.label === 'string') : [],
    };
  } catch {
    return { quotes: [], symbols: [], details: [] };
  }
}

export function parseHomePhotos(raw: string): HomePhotoSetting[] {
  try {
    const v = JSON.parse(raw) as HomePhotoSetting[];
    return Array.isArray(v) ? v.filter((p) => p && typeof p.itemId === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * אוסף ״תמונות לדף הבית״ עם הקובץ להצגה. מסנן תמונות שנמחקו,
 * ואת התמונה הראשית של הכותרת — כדי שאותה תמונה לא תופיע פעמיים.
 */
async function resolveHomePhotos(db: D1Database, list: HomePhotoSetting[], heroFileId: string): Promise<HomePhoto[]> {
  if (!list.length) return [];
  const ids = list.map((p) => p.itemId);
  const rows = await db
    .prepare(
      `SELECT i.id AS item_id, f.id AS file_id, f.role FROM items i JOIN files f ON f.item_id = i.id
       WHERE i.id IN (${placeholders(ids.length)}) AND i.kind = 'photo' AND i.deleted_at IS NULL AND f.role IN ('original', 'thumb')`,
    )
    .bind(...ids)
    .all<{ item_id: string; file_id: string; role: string }>();
  const byItem = new Map<string, { original?: string; thumb?: string }>();
  for (const r of rows.results) {
    const e = byItem.get(r.item_id) ?? {};
    if (r.role === 'original') e.original = r.file_id;
    else e.thumb = r.file_id;
    byItem.set(r.item_id, e);
  }
  return list.flatMap((p) => {
    const f = byItem.get(p.itemId);
    if (!f?.original || f.original === heroFileId) return [];
    return [{ ...p, fileId: f.thumb ?? f.original }];
  });
}

export async function getSiteSettings(db: D1Database): Promise<SiteSettings> {
  const rows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const map = { ...DEFAULTS, ...Object.fromEntries(rows.results.map((r) => [r.key, r.value])) };
  return {
    siteTitle: map.site_title,
    subtitle: map.subtitle,
    heroFileId: map.hero_file_id || null,
    heroTraits: parseTraits(map.hero_traits),
    homePhotos: await resolveHomePhotos(db, parseHomePhotos(map.home_photos).slice(0, 100), map.hero_file_id),
  };
}
