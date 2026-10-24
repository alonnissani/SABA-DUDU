import { Hono } from 'hono';
import type { AppEnv } from '../env';
import type { ItemKind, SearchResults } from '../../shared/types';
import { ITEM_KINDS } from '../../shared/constants';
import { requireUser } from '../lib/auth';
import { fail } from '../lib/http';
import { toSummaries } from '../lib/items';
import { searchItems } from '../lib/search';

export const searchRoutes = new Hono<AppEnv>();

/** חיפוש טקסטואלי על פני כל חמש הקטגוריות. */
searchRoutes.get('/', async (c) => {
  requireUser(c);
  const q = (c.req.query('q') ?? '').slice(0, 200);
  const kindParam = c.req.query('kind');
  let kind: ItemKind | null = null;
  if (kindParam) {
    if (!(ITEM_KINDS as string[]).includes(kindParam)) fail(400, 'קטגוריה לא תקינה');
    kind = kindParam as ItemKind;
  }
  const rows = await searchItems(c.env.DB, q, { kind });
  const items = await toSummaries(c.env.DB, rows);
  const result: SearchResults = {
    query: q,
    total: items.length,
    groups: ITEM_KINDS.map((k) => ({ kind: k, items: items.filter((i) => i.kind === k) })).filter((g) => g.items.length),
  };
  return c.json(result);
});
