import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { ItemSummary } from '../../shared/types';
import { StoryCard } from './ItemCards';

/** מספר העמודות לפי רוחב המסך: לפחות 2 גם בטלפון (כרטיסים קומפקטיים), 3 מ-900px */
const BREAKPOINTS: [number, number][] = [[900, 3]];

function columnsFor(width: number): number {
  return BREAKPOINTS.find(([min]) => width >= min)?.[1] ?? 2;
}

function useColumnCount(): number {
  const [cols, setCols] = useState(() => columnsFor(window.innerWidth));
  useEffect(() => {
    const queries = BREAKPOINTS.map(([min]) => window.matchMedia(`(min-width: ${min}px)`));
    const update = () => setCols(columnsFor(window.innerWidth));
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);
  return cols;
}

/** hash יציב של מזהה — כדי שלכל סיפור יהיה ״מראה״ קבוע בין טעינות */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const TILTS = [-0.9, -0.45, 0.35, 0.8, -0.65, 0.55];
const QUOTE_TYPES = new Set(['saying', 'joke']);

/** גובה משוער של כרטיס — לחלוקה מאוזנת בין העמודות */
function estimate(item: ItemSummary): number {
  return 150 + item.title.length * 1.2 + Math.min(item.excerpt?.length ?? 0, 240) * 0.55 + (item.coverFileId ? 20 : 0);
}

/**
 * לוח סיפורים מרחף: כרטיסים בגדלים ובגוונים שונים, בהטיה קלה, מפוזרים בעמודות (Masonry).
 * הפריטים מחולקים לפי הסדר (האקראי) לעמודה הקצרה ביותר, כך שפריטים שנטענים בגלילה
 * נוספים לסוף העמודות והכרטיסים הקיימים לא זזים.
 */
export function StoryBoard({ items }: { items: ItemSummary[] }) {
  const cols = useColumnCount();
  const columns = useMemo(() => {
    const out = Array.from({ length: cols }, () => ({ h: 0, items: [] as ItemSummary[] }));
    for (const it of items) {
      const target = out.reduce((a, b) => (b.h < a.h ? b : a));
      target.items.push(it);
      target.h += estimate(it);
    }
    return out.map((c) => c.items);
  }, [items, cols]);

  return (
    <div className="story-board" data-cols={cols}>
      {columns.map((col, ci) => (
        <div key={ci} className="story-board__col">
          {col.map((it) => {
            const h = hash(it.id);
            const len = it.excerpt?.length ?? 0;
            const quote = QUOTE_TYPES.has(it.storyType ?? '') || (len > 0 && len < 40);
            const classes = [
              'story-card--float',
              `story-card--tone${(h >>> 3) % 4}`,
              `story-card--deco${(h >>> 6) % 3}`,
              quote ? 'story-card--quote' : '',
              len > 180 ? 'story-card--long' : '',
            ].join(' ');
            const tilt = { '--tilt': `${TILTS[h % TILTS.length]}deg` } as CSSProperties;
            // מרווח עליון משתנה לפיזור (הריחוף עצמו — לכל עמודה, ב-CSS)
            const float = { '--mt': `${((h >>> 9) % 3) * 5}px` } as CSSProperties;
            return (
              <div key={it.id} className="story-float" style={float}>
                <StoryCard item={it} className={classes} style={tilt} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
