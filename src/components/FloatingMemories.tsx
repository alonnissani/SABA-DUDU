import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** שבעת הזיכרונות המאוירים. המיקום והגודל נקבעים ב-CSS (‎.mem--{name}‎), התנועה — כאן. */
const MEMORIES = ['coffee', 'pickles', 'kiddush', 'marhaba', 'fish', 'medic', 'swimmer'] as const;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const sign = () => (Math.random() < 0.5 ? -1 : 1);

interface Motion {
  drift: number;
  driftDelay: number;
  reverse: boolean;
  dx: number;
  dy: number;
  sway: number;
  swayDelay: number;
  rot: number;
}

/**
 * אקראיות מבוקרת: לכל אלמנט משך, השהיה (שלילית — מתחיל מנקודה אחרת במסלול), טווח וכיוון משלו.
 * נקבע מחדש בכל כניסה למסך הפתיחה, ולכן התנועה מתחילה מחדש ושונה מעט בכל פעם.
 */
function motion(): Motion {
  const drift = rand(11, 18);
  const sway = rand(6, 10);
  return {
    drift,
    driftDelay: -rand(0, drift),
    reverse: Math.random() < 0.5,
    dx: sign() * rand(14, 26),
    dy: sign() * rand(14, 26),
    sway,
    swayDelay: -rand(0, sway),
    rot: sign() * rand(5, 9),
  };
}

/** מסלול סגור ולא סימטרי עם שינויי כיוון (נקודות כמכפלות של הטווח) */
const PATH: [number, number, number][] = [
  [0, 0, 0],
  [0.17, 0.9, -0.4],
  [0.34, 0.4, -1],
  [0.51, -0.5, -0.6],
  [0.68, -1, 0.2],
  [0.85, -0.3, 0.7],
  [1, 0, 0],
];

const num = (el: Element, prop: string, fallback: number) => {
  const v = parseFloat(getComputedStyle(el).getPropertyValue(prop));
  return Number.isFinite(v) ? v : fallback;
};

/**
 * התנועה רצה כ-Web Animations עם ערכים מספריים מחושבים מראש — כך הדפדפן מריץ אותה על כרטיס המסך,
 * בלי לחשב סגנונות מחדש בכל פריים (אנימציית CSS עם משתנים בתוך keyframes רצה על ה-thread הראשי וכבדה בטלפונים).
 * הטווחים לכל גודל מסך (‎--ampx/--ampy/--ax/--ay‎) עדיין נקבעים ב-CSS.
 */
function animate(root: HTMLElement, motions: Motion[]): Animation[] {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return [];
  const out: Animation[] = [];
  root.querySelectorAll<HTMLElement>('.mem').forEach((mem, i) => {
    const m = motions[i];
    const drift = mem.querySelector<HTMLElement>('.mem__drift');
    const img = mem.querySelector<HTMLElement>('.mem__img');
    if (!m || !drift || !img) return;
    const ax = num(mem, '--ampx', 1) * num(mem, '--ax', 1);
    const ay = num(mem, '--ampy', 1) * num(mem, '--ay', 1);
    out.push(
      drift.animate(
        PATH.map(([offset, x, y]) => ({ offset, transform: `translate(${(m.dx * ax * x).toFixed(2)}px, ${(m.dy * ay * y).toFixed(2)}px)` })),
        { duration: m.drift * 1000, delay: m.driftDelay * 1000, iterations: Infinity, direction: m.reverse ? 'reverse' : 'normal', easing: 'ease-in-out' },
      ),
      img.animate(
        [{ transform: `rotate(${-m.rot}deg) scale(0.97)` }, { transform: `rotate(${m.rot}deg) scale(1.04)` }],
        { duration: m.sway * 1000, delay: m.swayDelay * 1000, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' },
      ),
    );
  });
  return out;
}

/** זיכרונות מרחפים סביב המסגרת המרכזית. דקורטיבי בלבד: לא חוסם לחיצות ולא מוקרא לקוראי מסך. */
export function FloatingMemories({ children }: { children: ReactNode }) {
  const [motions] = useState(() => MEMORIES.map(motion));
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let running = animate(layer.current!, motions);
    // הטווחים תלויים בגודל המסך — מחשבים מחדש כשהוא משתנה (סיבוב הטלפון, שינוי חלון)
    let t = 0;
    const onResize = () => {
      clearTimeout(t);
      t = window.setTimeout(() => {
        running.forEach((a) => a.cancel());
        running = animate(layer.current!, motions);
      }, 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
      running.forEach((a) => a.cancel());
    };
  }, [motions]);
  return (
    <div className="orbit">
      {children}
      <div className="orbit__layer" aria-hidden="true" ref={layer}>
        {MEMORIES.map((name, i) => (
          <span key={name} className={`mem mem--${name}`} style={{ animationDelay: `${0.7 + i * 0.12}s` } as CSSProperties}>
            <span className="mem__drift">
              <img className="mem__img" src={`/landing/${name}.webp`} alt="" decoding="async" draggable={false} />
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
