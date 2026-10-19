import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { ItemSummary } from '../../shared/types';
import { StoryCard } from './ItemCards';

/** מספר העמודות לפי רוחב המסך: עמודה אחת בטלפון (כדי לא לדחוס טקסט), 2 מ-560px, 3 מ-960px */
const BREAKPOINTS: [number, number][] = [
  [960, 3],
  [560, 2],
];

function columnsFor(width: number): number {
  return BREAKPOINTS.find(([min]) => width >= min)?.[1] ?? 1;
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
  return 150 + item.title.length * 1.2 + Math.min(item.excerpt?.length ?? 0, 240) * 0.55;
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
            const style = {
              '--tilt': `${TILTS[h % TILTS.length]}deg`,
              '--mt': `${((h >>> 9) % 3) * 6}px`,
              // בעמודה אחת (טלפון) — רוחב מעט שונה ויישור מתחלף, כדי שזה לא ייראה כמו רשימה
              '--mx': `${((h >>> 11) % 3) * 14}px`,
            } as CSSProperties;
            return <StoryCard key={it.id} item={it} className={classes} style={style} />;
          })}
        </div>
      ))}
    </div>
  );
}
