import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ItemSummary } from '../../shared/types';
import { fileUrl } from '../api/client';
import { displayableImage, originalOf, previewUrl } from '../lib/media';
import { Icon } from './Icon';
import { ItemMeta, TagList } from './ItemCards';

const MAX_SCALE = 5;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** צפייה בתמונה במסך מלא: הגדלה/הקטנה (כפתורים, גלגלת, צביטה, הקשה כפולה), גרירה ודפדוף. */
export function Lightbox({ items, index, onIndex, onClose }: { items: ItemSummary[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const item = items[index];
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [swipe, setSwipe] = useState(0);
  const [showInfo, setShowInfo] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number; start: { x: number; y: number }; pos: { x: number; y: number } } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

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
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(1); // בעברית — ״הבא״ משמאל
      else if (e.key === 'ArrowRight') go(-1);
      else if (e.key === '+' || e.key === '=') setScale((s) => clamp(s * 1.4, 1, MAX_SCALE));
      else if (e.key === '-') setScale((s) => clamp(s / 1.4, 1, MAX_SCALE));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  useEffect(() => {
    if (scale === 1) setPos({ x: 0, y: 0 });
  }, [scale]);

  if (!item) return null;
  const original = originalOf(item);
  const full = original && displayableImage(original) ? fileUrl(original.id) : null;
  const preview = previewUrl(item);

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
    pointers.current.delete(e.pointerId);
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
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`תמונה: ${item.title}`}>
      <div className="lightbox__bar">
        <button ref={closeRef} className="lb-btn" onClick={onClose} aria-label="סגירה">
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
          {original && (
            <a className="lb-btn" href={fileUrl(original.id, true)} aria-label="הורדת קובץ המקור">
              <Icon name="download" />
            </a>
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
        onDoubleClick={() => setScale((s) => (s > 1 ? 1 : 2.5))}
      >
        <div className="lightbox__img" style={{ transform: `translate(${pos.x + swipe}px, ${pos.y}px) scale(${scale})`, transition: gesture.current ? 'none' : undefined }}>
          {preview && !loaded && <img src={preview} alt="" className="lightbox__preview" draggable={false} />}
          {full ? (
            <img key={full} src={full} alt={item.title} draggable={false} onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} style={{ opacity: loaded || !preview ? 1 : 0 }} />
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
          <h2>{item.title}</h2>
          {item.description && <p className="lightbox__desc">{item.description}</p>}
          {item.people && <p className="lightbox__people">בתמונה: {item.people}</p>}
          <ItemMeta item={item} />
          <TagList tags={item.tags} />
          <Link to={`/item/${item.id}`} className="lightbox__more" onClick={onClose}>
            לדף התמונה המלא
          </Link>
        </div>
      )}
    </div>
  );
}
