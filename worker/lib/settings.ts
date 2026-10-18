import type { HeroTraits, SiteSettings } from '../../shared/types';
import { DEFAULT_SITE_TITLE, DEFAULT_SUBTITLE } from '../../shared/constants';
import { now } from './http';

const DEFAULTS: Record<string, string> = {
  site_title: DEFAULT_SITE_TITLE,
  subtitle: DEFAULT_SUBTITLE,
  hero_file_id: '',
  hero_traits: JSON.stringify({ quotes: [], symbols: [], details: [] } satisfies HeroTraits),
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

export async function getSiteSettings(db: D1Database): Promise<SiteSettings> {
  const rows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const map = { ...DEFAULTS, ...Object.fromEntries(rows.results.map((r) => [r.key, r.value])) };
  return {
    siteTitle: map.site_title,
    subtitle: map.subtitle,
    heroFileId: map.hero_file_id || null,
    heroTraits: parseTraits(map.hero_traits),
  };
}
