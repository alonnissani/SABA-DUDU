import { useLayoutEffect, useRef, useState } from 'react';
import type { ItemSummary } from '../../shared/types';
import { originalOf } from '../lib/media';
import { PhotoTile } from './ItemCards';

/** גובה ״שורה״ בסיסית ב-grid — הגובה של כל תמונה הוא כפולה שלה, כך שהיחס נשמר כמעט בדיוק */
const ROW = 4;
/** עובי מסגרת ה״נייר״ סביב כל תמונה — חייב להתאים ל-padding של ‎.photo-tile ב-CSS */
const FRAME = 4;

/** מספר עמודות לפי רוחב: לפחות 2 בטלפון */
function columnsFor(width: number): number {
  if (width >= 1180) return 5;
  if (width >= 880) return 4;
  if (width >= 580) return 3;
  return 2;
}

function ratioOf(item: ItemSummary): number {
  const o = originalOf(item);
  return o?.width && o?.height ? o.width / o.height : 4 / 3;
}

/** ״מודגשת״ — בערך אחת מכל שש תמונות אופקיות, קבוע לפי המזהה (לא משתנה בין כניסות) */
function isFeatured(item: ItemSummary): boolean {
  if (ratioOf(item) < 1.15) return false;
  let h = 0;
  for (let i = 0; i < item.id.length; i++) h = (h * 31 + item.id.charCodeAt(i)) | 0;
  return Math.abs(h) % 6 === 0;
}

/**
 * גלריה בסגנון אלבום/קולאז׳: תמונות אנכיות ואופקיות בגדלים משתנים, בלי חיתוך —
 * כל תמונה מקבלת גובה לפי יחס הממדים המקורי שלה, וחלק מהאופקיות מתפרשות על שתי עמודות.
 */
export function PhotoCollage({ items, onOpen }: { items: ItemSummary[]; onOpen: (index: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ cols: number; colWidth: number; gap: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => {
      const width = el.clientWidth;
      const cols = columnsFor(width);
      const gap = width >= 880 ? 12 : 8;
      setLayout((prev) => {
        const colWidth = (width - gap * (cols - 1)) / cols;
        return prev && prev.cols === cols && Math.abs(prev.colWidth - colWidth) < 0.5 && prev.gap === gap ? prev : { cols, colWidth, gap };
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="gallery"
      style={layout ? ({ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`, columnGap: layout.gap, '--gallery-gap': `${layout.gap}px` } as React.CSSProperties) : undefined}
    >
      {layout &&
        items.map((it, i) => {
          const span = isFeatured(it) ? 2 : 1;
          const width = layout.colWidth * span + layout.gap * (span - 1);
          // גובה התמונה (ברוחב שבתוך מסגרת הנייר) + המסגרת (FRAME מכל צד) + הרווח בין התמונות
          const rows = Math.max(1, Math.round(((width - FRAME * 2) / ratioOf(it) + FRAME * 2 + layout.gap) / ROW));
          return (
            <div key={it.id} className={`gallery__cell ${span > 1 ? 'gallery__cell--wide' : ''}`} style={{ gridColumn: `span ${span}`, gridRow: `span ${rows}` }}>
              <PhotoTile item={it} onOpen={() => onOpen(i)} priority={i < 6} />
            </div>
          );
        })}
    </div>
  );
}
