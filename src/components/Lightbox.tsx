import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ItemSummary } from '../../shared/types';
import { fileUrl } from '../api/client';
import { accessibleTitle, displayTitle, displayableImage, originalOf, previewUrl } from '../lib/media';
import { Icon } from './Icon';
import { TagList } from './ItemCards';

const MAX_SCALE = 5;
/** כמה תצוגות פתוחות כרגע (לניהול רשומת ההיסטוריה של ״חזרה״) */
let open = 0;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** תמונה מגלריית Google Drive — מוגשת דרך האתר; ״הורדה״ שלה הייתה מעבירה לגוגל, ולכן אין כפתור כזה */
const isDriveFile = (id: string) => id.startsWith('gd:');

/** כתובת התצוגה הגדולה של פריט (או null אם הדפדפן לא יכול להציג אותו) */
function fullUrl(item: ItemSummary | undefined): string | null {
  const o = item && originalOf(item);
  return o && displayableImage(o) ? fileUrl(o.id) : null;
}

/**
 * צפייה בתמונה במסך מלא, בתוך האתר: הגדלה/הקטנה (כפתורים, גלגלת, צביטה, הקשה כפולה), גרירה,
 * דפדוף בהחלקה, ו״חזרה״ בטלפון סוגרת את התצוגה. התמונה מוצגת בשלמותה (contain) באיכות גבוהה.
 */
export function Lightbox({ items, index, onIndex, onClose, onDelete }: {
  items: ItemSummary[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** מחיקה (מנהל בלבד) — כפתור בסרגל הפעולות, מחוץ לשטח התמונה */
  onDelete?: (item: ItemSummary) => void;
}) {
  const item = items[index];
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [swipe, setSwipe] = useState(0);
  const hasInfo = (it: ItemSummary | undefined) => Boolean(it && (displayTitle(it) || it.description || it.people || it.tags.length));
  const [showInfo, setShowInfo] = useState(() => hasInfo(items[index]));
  const [loaded, setLoaded] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number; start: { x: number; y: number }; pos: { x: number; y: number } } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastTap = useRef({ t: 0, touch: false });

  // ״חזרה״ בטלפון סוגרת את התצוגה (במקום לצאת מהדף)
  const popped = useRef(false);
  const leaving = useRef(false);
  const closeRefFn = useRef(onClose);
  closeRefFn.current = onClose;
  useEffect(() => {
    history.pushState({ sabaLightbox: true }, '');
    const onPop = () => {
      popped.current = true;
      closeRefFn.current();
    };
    window.addEventListener('popstate', onPop);
    open += 1;
    return () => {
      window.removeEventListener('popstate', onPop);
      open -= 1;
      // נסגר בלי ״חזרה״ (למשל אחרי מחיקת התמונה האחרונה) — מסירים את הרשומה שהוספנו.
      // בדיקה מושהית: אם התצוגה נפתחה שוב מיד (StrictMode בפיתוח) — לא נוגעים בהיסטוריה
      if (popped.current || leaving.current) return;
      setTimeout(() => {
        if (open === 0 && (history.state as { sabaLightbox?: boolean } | null)?.sabaLightbox) history.back();
      }, 0);
    };
  }, []);
  const close = useCallback(() => {
    if (!popped.current && (history.state as { sabaLightbox?: boolean } | null)?.sabaLightbox) history.back();
    else onClose();
  }, [onClose]);

  const reset = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
    setSwipe(0);
  };
  const go = useCallback(
    (d: number) => {
      const n = index + d;
      if (n >= 0 && n < items.length) {
        onIndex(n);
        reset();
        setLoaded(false);
      }
    },
    [index, items.length, onIndex],
  );

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const prevFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // כשחלונית אישור פתוחה — Esc סוגר רק אותה
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(1); // בעברית — ״הבא״ משמאל
      else if (e.key === 'ArrowRight') go(-1);
      else if (e.key === '+' || e.key === '=') setScale((s) => clamp(s * 1.4, 1, MAX_SCALE));
      else if (e.key === '-') setScale((s) => clamp(s / 1.4, 1, MAX_SCALE));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, close]);

  useEffect(() => {
    if (scale === 1) setPos({ x: 0, y: 0 });
  }, [scale]);

  // טעינה מוקדמת של התמונה הבאה והקודמת — כדי שהדפדוף יהיה חלק
  useEffect(() => {
    for (const n of [items[index + 1], items[index - 1]]) {
      const u = fullUrl(n);
      if (u) new Image().src = u;
    }
  }, [index, items]);

  useEffect(() => setShowInfo(hasInfo(items[index])), [index, items]);

  if (!item) return null;
  const original = originalOf(item);
  const full = fullUrl(item);
  const preview = previewUrl(item);
  const toggleZoom = () => setScale((s) => (s > 1 ? 1 : 2.5));

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    gesture.current = {
      dist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
      scale,
      start: { x: e.clientX, y: e.clientY },
      pos,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length === 2 && g.dist) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setScale(clamp((g.scale * d) / g.dist, 1, MAX_SCALE));
    } else if (pts.length === 1) {
      const dx = e.clientX - g.start.x;
      const dy = e.clientY - g.start.y;
      if (scale > 1) setPos({ x: g.pos.x + dx, y: g.pos.y + dy });
      else setSwipe(dx);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    // הקשה כפולה במסך מגע — הגדלה/הקטנה
    if (e.pointerType === 'touch' && g && pointers.current.size === 0 && Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < 12) {
      const now = Date.now();
      if (now - lastTap.current.t < 320) {
        toggleZoom();
        lastTap.current = { t: 0, touch: true };
      } else lastTap.current = { t: now, touch: true };
    }
    if (pointers.current.size === 0) {
      if (scale === 1 && Math.abs(swipe) > 60) go(swipe > 0 ? 1 : -1);
      setSwipe(0);
      gesture.current = null;
    } else {
      const [p] = [...pointers.current.values()];
      gesture.current = { dist: 0, scale, start: p, pos };
    }
  };

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={displayTitle(item) ? `תמונה: ${displayTitle(item)}` : 'תמונה'}>
      <div className="lightbox__bar">
        <button ref={closeRef} className="lb-btn lb-btn--close" onClick={close} aria-label="סגירה">
          <Icon name="close" />
        </button>
        <span className="lightbox__count">
          {index + 1} / {items.length}
        </span>
        <div className="lightbox__tools">
          <button className="lb-btn" onClick={() => setScale((s) => clamp(s / 1.5, 1, MAX_SCALE))} aria-label="הקטנה" disabled={scale <= 1}>
            <Icon name="zoomOut" />
          </button>
          <button className="lb-btn" onClick={() => setScale((s) => clamp(s * 1.5, 1, MAX_SCALE))} aria-label="הגדלה" disabled={scale >= MAX_SCALE}>
            <Icon name="zoomIn" />
          </button>
          {original && !isDriveFile(original.id) && (
            <a className="lb-btn" href={fileUrl(original.id, true)} aria-label="הורדת קובץ המקור">
              <Icon name="download" />
            </a>
          )}
          {onDelete && (
            <button className="lb-btn lb-btn--danger" onClick={() => onDelete(item)} aria-label="מחיקת התמונה">
              <Icon name="trash" />
            </button>
          )}
          <button className="lb-btn" onClick={() => setShowInfo((v) => !v)} aria-label={showInfo ? 'הסתרת פרטים' : 'הצגת פרטים'} aria-pressed={showInfo}>
            <Icon name="story" />
          </button>
        </div>
      </div>

      <div
        className="lightbox__stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => setScale((s) => clamp(s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, MAX_SCALE))}
        onDoubleClick={() => {
          // במגע — ההקשה הכפולה כבר טופלה
          if (!lastTap.current.touch) toggleZoom();
          lastTap.current.touch = false;
        }}
      >
        <div className="lightbox__img" style={{ transform: `translate(${pos.x + swipe}px, ${pos.y}px) scale(${scale})`, transition: gesture.current ? 'none' : undefined }}>
          {preview && !loaded && <img src={preview} alt="" className="lightbox__preview" draggable={false} />}
          {full ? (
            <img key={full} src={full} alt={accessibleTitle(item)} draggable={false} onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} style={{ opacity: loaded || !preview ? 1 : 0 }} />
          ) : (
            !preview && <p className="lightbox__unsupported">לא ניתן להציג את הקובץ בדפדפן. אפשר להוריד את קובץ המקור.</p>
          )}
        </div>
      </div>

      {index > 0 && (
        <button className="lightbox__nav lightbox__nav--prev" onClick={() => go(-1)} aria-label="התמונה הקודמת">
          <Icon name="chevronRight" size={30} />
        </button>
      )}
      {index < items.length - 1 && (
        <button className="lightbox__nav lightbox__nav--next" onClick={() => go(1)} aria-label="התמונה הבאה">
          <Icon name="chevronLeft" size={30} />
        </button>
      )}

      {showInfo && (
        <div className="lightbox__info">
          {displayTitle(item) && <h2>{displayTitle(item)}</h2>}
          {item.description && <p className="lightbox__desc">{item.description}</p>}
          {item.people && <p className="lightbox__people">בתמונה: {item.people}</p>}
          <TagList tags={item.tags} />
          <Link
            to={`/item/${item.id}`}
            className="lightbox__more"
            onClick={() => {
              leaving.current = true;
              onClose();
            }}
          >
            לדף התמונה המלא
          </Link>
        </div>
      )}
    </div>
  );
}
