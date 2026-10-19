import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { ItemSummary } from '../../shared/types';
import { KIND_LABELS, STORY_TYPE_LABEL } from '../../shared/constants';
import { api } from '../api/client';
import { displayTitle, formatDuration, itemDateLabel, originalOf, previewUrl } from '../lib/media';
import { Icon, KIND_ICON } from './Icon';
import { ErrorBox, SafeImg } from './Common';

const HISTORY_KEY = 'saba:random-history';
const HISTORY_MAX = 25;

function readHistory(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}
function writeHistory(ids: string[]) {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(ids.slice(-HISTORY_MAX)));
  } catch {
    /* אחסון לא זמין */
  }
}

/** ״זיכרון מסבא״ — פריט אקראי מהארכיון, בלי לחזור על מה שהוצג לאחרונה. */
export function RandomMemory() {
  const [item, setItem] = useState<ItemSummary | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anim, setAnim] = useState(0);

  const next = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const history = readHistory();
      // לא שולחים יותר ממספר הפריטים פחות אחד, כדי שתמיד יהיה מה להציג
      const res = await api.random(history);
      setItem(res.item);
      setTotal(res.total);
      if (res.item) {
        const h = history.filter((id) => id !== res.item!.id);
        h.push(res.item.id);
        writeHistory(h.length >= res.total ? h.slice(-1) : h);
      }
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

  if (total === 0) {
    return (
      <section className="memory memory--empty" aria-labelledby="memory-title">
        <div className="memory__label">
          <Icon name="sparkle" size={18} />
          <h2 id="memory-title">זיכרון מסבא</h2>
        </div>
        <p className="memory__empty-title">הארכיון עדיין ריק — וזה המקום להתחיל.</p>
        <p className="memory__empty-text">העלו תמונה, הקלטה או כתבו סיפור, וכאן יופיע בכל פעם זיכרון אחר מסבא דודו.</p>
        <div className="memory__empty-actions">
          <Link to="/c/photo/new" className="btn btn--primary">
            <Icon name="plus" />
            הוספת תמונה
          </Link>
          <Link to="/c/story/new" className="btn btn--ghost">
            כתיבת סיפור
          </Link>
          <Link to="/c/audio/new" className="btn btn--ghost">
            העלאת הקלטה
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="memory" aria-labelledby="memory-title" aria-busy={busy}>
      <div className="memory__label">
        <Icon name="sparkle" size={18} />
        <h2 id="memory-title">זיכרון מסבא</h2>
      </div>
      {!item ? (
        <div className="memory__skeleton" aria-hidden="true" />
      ) : (
        <Link key={anim} to={`/item/${item.id}`} className="memory__card">
          <MemoryPreview item={item} />
          <span className="memory__text">
            <span className="memory__kind">
              <Icon name={KIND_ICON[item.kind]} size={16} />
              {item.kind === 'story' && item.storyType ? STORY_TYPE_LABEL[item.storyType] : KIND_LABELS[item.kind].singular}
            </span>
            {displayTitle(item) && <span className="memory__title">{displayTitle(item)}</span>}
            {item.kind === 'story' && item.excerpt && <span className="memory__excerpt">״{item.excerpt}״</span>}
            {item.kind !== 'story' && item.description && <span className="memory__excerpt">{item.description}</span>}
            <span className="memory__meta">
              {itemDateLabel(item) && `${itemDateLabel(item)} · `}
              {item.kind === 'story' ? 'נכתב' : 'הועלה'} ע״י {item.createdBy.name}
            </span>
          </span>
        </Link>
      )}
      <button className="btn btn--ghost memory__more" onClick={next} disabled={busy || (total ?? 0) < 2}>
        <Icon name="shuffle" />
        עוד זיכרון
      </button>
    </section>
  );
}

function MemoryPreview({ item }: { item: ItemSummary }) {
  const src = previewUrl(item);
  const o = originalOf(item);
  const iconBox = (
    <span className={`memory__media memory__media--icon memory__media--${item.kind}`} aria-hidden="true">
      <Icon name={KIND_ICON[item.kind]} size={44} />
    </span>
  );
  if (src) {
    // התמונה מוצגת במלואה (contain), ביחס הגובה-רוחב המקורי שלה
    return (
      <span className={`memory__media memory__media--${item.kind} memory__media--fit`}>
        <SafeImg src={src} alt="" decoding="async" fallback={iconBox} />
        {item.kind === 'video' && (
          <span className="memory__play" aria-hidden="true">
            <Icon name="play" size={28} />
          </span>
        )}
      </span>
    );
  }
  return (
    <span className={`memory__media memory__media--icon memory__media--${item.kind}`} aria-hidden="true">
      <Icon name={KIND_ICON[item.kind]} size={44} />
      {item.kind === 'audio' && o?.duration ? <span className="memory__dur">{formatDuration(o.duration)}</span> : null}
      {item.kind === 'audio' && (
        <span className="memory__wave">
          {Array.from({ length: 18 }, (_, i) => (
            <i key={i} style={{ height: `${30 + Math.abs(Math.sin(i * 1.7)) * 70}%` }} />
          ))}
        </span>
      )}
    </span>
  );
}
