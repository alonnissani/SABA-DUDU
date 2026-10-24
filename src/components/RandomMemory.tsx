import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { ItemSummary } from '../../shared/types';
import { STORY_TYPE_LABEL } from '../../shared/constants';
import { api, fileUrl } from '../api/client';
import { displayTitle, displayableImage, originalOf, previewUrl } from '../lib/media';
import { Icon } from './Icon';
import { ErrorBox, SafeImg } from './Common';
import { Lightbox } from './Lightbox';

const PHOTO_HISTORY = 'saba:random-history';
const STORY_HISTORY = 'saba:random-story-history';
const HISTORY_MAX = 25;

function readHistory(key: string): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function writeHistory(key: string, ids: string[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify(ids.slice(-HISTORY_MAX)));
  } catch {
    /* אחסון לא זמין */
  }
}

/** פריט אקראי שלא הוצג לאחרונה (כל סוג עם היסטוריה משלו) */
async function pickRandom(key: string, kind?: 'story'): Promise<{ item: ItemSummary | null; total: number }> {
  const history = readHistory(key);
  const res = await api.random(history, kind);
  if (res.item) {
    const h = history.filter((id) => id !== res.item!.id);
    h.push(res.item.id);
    writeHistory(key, h.length >= res.total ? h.slice(-1) : h);
  }
  return res;
}

/**
 * ״זיכרון מסבא״ — תמונה אקראית גדולה מהגלריה, ומתחתיה סיפור אקראי (כותרת וקטע קצר).
 * ״עוד זיכרון״ מחליף את שניהם, בלי לחזור על מה שהוצג לאחרונה. התמונה והסיפור לא קשורים זה לזה.
 */
export function RandomMemory() {
  const [photo, setPhoto] = useState<ItemSummary | null>(null);
  const [story, setStory] = useState<ItemSummary | null>(null);
  const [totals, setTotals] = useState<{ photos: number; stories: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anim, setAnim] = useState(0);
  const [zoom, setZoom] = useState(false);

  const next = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [p, st] = await Promise.all([pickRandom(PHOTO_HISTORY), pickRandom(STORY_HISTORY, 'story')]);
      setPhoto(p.item);
      setStory(st.item);
      setTotals({ photos: p.total, stories: st.total });
      setAnim((a) => a + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    next();
  }, [next]);

  if (error) return <ErrorBox message={error} onRetry={next} />;

  if (totals && totals.photos === 0 && totals.stories === 0) {
    return (
      <section className="memory memory--empty" aria-labelledby="memory-title">
        <div className="memory__label">
          <Icon name="sparkle" size={18} />
          <h2 id="memory-title">זיכרון מסבא</h2>
        </div>
        <p className="memory__empty-title">עדיין אין תמונות בגלריה.</p>
        <p className="memory__empty-text">התמונות מגיעות מתיקיית Google Drive המשפחתית — וכאן יופיע בכל פעם זיכרון אחר מסבא דודו.</p>
        <div className="memory__empty-actions">
          <Link to="/c/photo/new" className="btn btn--primary">
            <Icon name="plus" />
            הוספת תמונות
          </Link>
          <Link to="/c/story/new" className="btn btn--ghost">
            כתיבת סיפור
          </Link>
        </div>
      </section>
    );
  }

  const canShuffle = !busy && totals !== null && (totals.photos > 1 || totals.stories > 1);
  return (
    <section className="memory" aria-labelledby="memory-title" aria-busy={busy}>
      <div className="memory__label">
        <Icon name="sparkle" size={18} />
        <h2 id="memory-title">זיכרון מסבא</h2>
      </div>
      {!totals ? (
        <div className="memory__skeleton" aria-hidden="true" />
      ) : (
        <>
          {photo && (
            <button key={`p${anim}`} type="button" className="memory__card memory__card--button" onClick={() => setZoom(true)}>
              <MemoryPhoto item={photo} />
              <span className="visually-hidden">פתיחת התמונה בגודל מלא</span>
            </button>
          )}
          {photo && displayTitle(photo) && <p className="memory__caption">{displayTitle(photo)}</p>}
          {story && <MemoryStory key={`s${anim}`} item={story} />}
        </>
      )}
      <button className="btn btn--ghost btn--sm memory__more" onClick={next} disabled={!canShuffle}>
        <Icon name="shuffle" />
        עוד זיכרון
      </button>
      {zoom && photo && <Lightbox items={[photo]} index={0} onIndex={() => undefined} onClose={() => setZoom(false)} />}
    </section>
  );
}

/** התמונה במלואה (contain), ביחס המקורי — גדולה, ובאיכות שמתאימה למסך (ממוזערת או התצוגה הגדולה) */
function MemoryPhoto({ item }: { item: ItemSummary }) {
  const thumb = previewUrl(item);
  const o = originalOf(item);
  const full = o && displayableImage(o) ? fileUrl(o.id) : null;
  const icon = (
    <span className="memory__media memory__media--icon" aria-hidden="true">
      <Icon name="photo" size={44} />
    </span>
  );
  const src = thumb ?? full;
  if (!src) return icon;
  return (
    <span className="memory__media memory__media--photo memory__media--fit">
      {/* בטלפון — הממוזערת (800px) מספיקה לרוחב המסך וקלה בהרבה; במחשב — התצוגה הגדולה */}
      <picture>
        {thumb && full && <source media="(min-width: 760px)" srcSet={full} />}
        <SafeImg
          src={src}
          width={o?.width ?? undefined}
          height={o?.height ?? undefined}
          alt=""
          decoding="async"
          fallback={icon}
        />
      </picture>
    </span>
  );
}

/** סיפור אקראי — כותרת, תמונת הסיפור בקטן משמאל לה (אם יש), וקישור לסיפור המלא */
function MemoryStory({ item }: { item: ItemSummary }) {
  return (
    <article className="memory__story" aria-labelledby={`memory-story-${item.id}`}>
      <span className="memory__kind">
        <Icon name="story" size={16} />
        {item.storyType ? STORY_TYPE_LABEL[item.storyType] : 'סיפור'}
      </span>
      <div className="memory__story-head">
        <h3 id={`memory-story-${item.id}`} className="memory__story-title">
          {item.title}
        </h3>
        {item.coverFileId && <img className="memory__story-thumb" src={fileUrl(item.coverFileId)} alt="" loading="lazy" decoding="async" />}
      </div>
      <Link to={`/item/${item.id}`} className="memory__story-link">
        לקריאת הסיפור המלא
        <Icon name="chevronLeft" size={16} />
      </Link>
    </article>
  );
}
