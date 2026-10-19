import { useState, type CSSProperties, type ReactNode } from 'react';

/** שבעת הזיכרונות המאוירים. המיקום והגודל נקבעים ב-CSS (‎.mem--{name}‎), התנועה — כאן. */
const MEMORIES = ['coffee', 'pickles', 'kiddush', 'marhaba', 'fish', 'medic', 'swimmer'] as const;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const sign = () => (Math.random() < 0.5 ? -1 : 1);

/**
 * אקראיות מבוקרת: לכל אלמנט משך, השהיה (שלילית — מתחיל מנקודה אחרת במסלול), טווח וכיוון משלו.
 * נקבע מחדש בכל כניסה למסך הפתיחה, ולכן התנועה מתחילה מחדש ושונה מעט בכל פעם.
 */
function motion(): CSSProperties {
  const drift = rand(17, 31);
  const sway = rand(9, 15);
  return {
    '--drift-dur': `${drift.toFixed(1)}s`,
    '--drift-delay': `${(-rand(0, drift)).toFixed(1)}s`,
    '--drift-dir': Math.random() < 0.5 ? 'normal' : 'reverse',
    '--dx': `${(sign() * rand(6, 13)).toFixed(1)}px`,
    '--dy': `${(sign() * rand(6, 14)).toFixed(1)}px`,
    '--sway-dur': `${sway.toFixed(1)}s`,
    '--sway-delay': `${(-rand(0, sway)).toFixed(1)}s`,
    '--rot': `${(sign() * rand(3, 6)).toFixed(1)}deg`,
  } as CSSProperties;
}

/** זיכרונות מרחפים סביב המסגרת המרכזית. דקורטיבי בלבד: לא חוסם לחיצות ולא מוקרא לקוראי מסך. */
export function FloatingMemories({ children }: { children: ReactNode }) {
  const [styles] = useState(() => MEMORIES.map(motion));
  return (
    <div className="orbit">
      {children}
      <div className="orbit__layer" aria-hidden="true">
        {MEMORIES.map((name, i) => (
          <span key={name} className={`mem mem--${name}`} style={{ ...styles[i], animationDelay: `${0.7 + i * 0.12}s` }}>
            <span className="mem__drift">
              <img className="mem__img" src={`/landing/${name}.webp`} alt="" decoding="async" draggable={false} />
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
