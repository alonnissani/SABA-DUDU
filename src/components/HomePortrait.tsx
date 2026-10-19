import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { HomePhoto } from '../../shared/types';
import { fileUrl } from '../api/client';

const LAST_KEY = 'saba:home-portrait-last';

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
function writeLast(id: string) {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    /* אחסון לא זמין */
  }
}

/** בוחר תמונה אקראית מהאוסף, בלי לחזור על התמונה שהוצגה בפעם הקודמת */
export function pickHomePhoto(list: HomePhoto[], last: string | null): HomePhoto | null {
  if (!list.length) return null;
  const pool = list.length > 1 ? list.filter((p) => p.itemId !== last) : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * התמונה העגולה הגדולה בדף הבית: מתחלפת בכל כניסה מתוך ״תמונות לדף הבית״ (הגדרות),
 * ממוקדת על הפנים לפי הנקודה שהמנהל סימן, ונכנסת ב-fade עדין.
 */
export function HomePortrait({ photos, size, isAdmin }: { photos: HomePhoto[]; size: number; isAdmin: boolean }) {
  // נבחר פעם אחת בכל כניסה לדף הבית
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const photo = useMemo(() => pickHomePhoto(photos, readLast()), []);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (photo) writeLast(photo.itemId);
  }, [photo]);

  if (!photo) {
    return (
      <span className="portrait portrait--empty" style={{ width: size, height: size, fontSize: size * 0.4 }}>
        <span className="avatar__mono" aria-hidden="true">ד</span>
        {isAdmin && (
          <Link to="/settings/home-photos" className="portrait__hint">
            בחירת תמונות
          </Link>
        )}
      </span>
    );
  }
  return (
    <span className="portrait" style={{ width: size, height: size }} data-item={photo.itemId}>
      <img
        src={fileUrl(photo.fileId)}
        alt=""
        decoding="async"
        className={loaded ? 'is-loaded' : undefined}
        onLoad={() => setLoaded(true)}
        style={{
          objectPosition: `${photo.x}% ${photo.y}%`,
          transformOrigin: `${photo.x}% ${photo.y}%`,
          transform: photo.zoom > 1 ? `scale(${photo.zoom})` : undefined,
        }}
      />
    </span>
  );
}
