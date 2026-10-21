import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import type { ItemKind, ItemSummary } from '../../shared/types';
import { ITEM_KINDS, KIND_LABELS, STORY_TYPES } from '../../shared/constants';
import { api } from '../api/client';
import { useApp, useLoad, useToast } from '../state';
import { EmptyState, ErrorBox, Modal, PageHeader, Spinner } from '../components/Common';
import { accessibleTitle } from '../lib/media';
import { Icon, KIND_ICON } from '../components/Icon';
import { AudioCard, DocumentCard, VideoCard } from '../components/ItemCards';
import { PhotoCollage } from '../components/PhotoCollage';
import { StoryBoard } from '../components/StoryBoard';
import { Lightbox } from '../components/Lightbox';

const PAGE = 30;
const CONTINUOUS_KEY = 'saba:audio-continuous';
const RANDOM_KINDS: ItemKind[] = ['photo', 'video', 'story'];

const EMPTY_TEXT: Record<ItemKind, { title: string; text: string; cta: string }> = {
  photo: { title: 'עדיין אין תמונות באלבום', text: 'התמונות מגיעות מתיקיית Google Drive המשפחתית ומופיעות כאן אחרי הסנכרון.', cta: 'הוספת תמונות' },
  video: { title: 'עדיין אין סרטונים', text: 'סרטון משמחה משפחתית, מטיול או מסתם יום רגיל — הכול שווה שמירה.', cta: 'העלאת סרטון' },
  audio: { title: 'עדיין אין הקלטות', text: 'הקלטות של סבא נשמרות כאן באיכות המקורית, כדי שנוכל לשמוע את קולו.', cta: 'העלאת הקלטה' },
  story: { title: 'עדיין לא נכתבו סיפורים', text: 'זיכרון אישי, בדיחה שסבא סיפר או משפט שהיה אומר — כל סיפור הוא אוצר.', cta: 'כתיבת סיפור' },
  document: { title: 'עדיין אין מסמכים', text: 'מכתבים, תעודות, גלויות ומסמכים ישנים — סרקו או צלמו והעלו.', cta: 'העלאת מסמך' },
};

export function CategoryScreen() {
  const { kind } = useParams();
  if (!kind || !(ITEM_KINDS as string[]).includes(kind)) return <Navigate to="/home" replace />;
  return <CategoryList key={kind} kind={kind as ItemKind} />;
}

function CategoryList({ kind }: { kind: ItemKind }) {
  const [params, setParams] = useSearchParams();
  // בתמונות, בסרטונים ובסיפורים — סדר אקראי כברירת מחדל. ה-seed נקבע פעם אחת בכל כניסה ללשונית,
  // כך שבזמן גלילה הסדר יציב ובכניסה הבאה הוא מתערבב מחדש.
  const defaultSort = RANDOM_KINDS.includes(kind) ? 'random' : 'new';
  const sort = params.get('sort') ?? defaultSort;
  const [seed] = useState(() => 1 + Math.floor(Math.random() * 2_147_483_646));
  const tag = params.get('tag') ?? '';
  const decade = params.get('decade') ?? '';
  const storyType = params.get('type') ?? '';
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const facets = useLoad(() => api.facets(kind), [kind]);
  const { isAdmin, settings } = useApp();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState<ItemSummary | null>(null);
  // הקלטות: השמעה ברצף — בסוף הקלטה מתחילה הבאה ברשימה
  const [continuous, setContinuousState] = useState(() => {
    try {
      return localStorage.getItem(CONTINUOUS_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const setContinuous = (v: boolean) => {
    setContinuousState(v);
    try {
      localStorage.setItem(CONTINUOUS_KEY, v ? '1' : '0');
    } catch {
      /* לא חובה */
    }
  };
  const [autoPlayId, setAutoPlayId] = useState<string | null>(null);

  /** לחיצה על סרטון פותחת חלונית צפייה בתוך האתר — בלי מסך מלא או סיבוב כפויים */
  const [deleting, setDeleting] = useState(false);

  /** מחיקה רכה (מנהל בלבד, נאכף בשרת) — הגלריה מתעדכנת מיד */
  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.remove(confirmDelete.id);
      const remaining = items.filter((i) => i.id !== confirmDelete.id);
      setItems(remaining);
      // אם המחיקה נעשתה מתוך התצוגה המלאה — עוברים לתמונה הבאה, או סוגרים אם לא נשארו
      setOpen((o) => (o === null ? null : remaining.length ? Math.min(o, remaining.length - 1) : null));
      setTotal((t) => Math.max(0, t - 1));
      // הרשימה בשרת התקצרה בפריט אחד — כדי לא לדלג על פריט בעמוד הבא
      fetched.current = Math.max(0, fetched.current - 1);
      toast('התמונה הועברה לסל המחזור. אפשר לשחזר אותה מההגדרות.');
      setConfirmDelete(null);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const fetched = useRef(0);
  const busyMore = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const query = { kind, sort, seed: sort === 'random' ? seed : undefined, tag: tag || undefined, decade: decade ? Number(decade) : undefined, storyType: storyType || undefined, limit: PAGE };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.list({ ...query, offset: 0 });
      fetched.current = res.items.length;
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, sort, tag, decade, storyType]);

  const more = async () => {
    if (busyMore.current) return;
    busyMore.current = true;
    setLoadingMore(true);
    try {
      const res = await api.list({ ...query, offset: fetched.current });
      fetched.current += res.items.length;
      // הגנה מכפילויות אם נוסף פריט בזמן הגלילה
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...res.items.filter((i) => !seen.has(i.id))];
      });
      setTotal(res.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyMore.current = false;
      setLoadingMore(false);
    }
  };

  // טעינה הדרגתית: כשמתקרבים לסוף הרשימה, העמוד הבא נטען אוטומטית
  const hasMore = !loading && fetched.current < total;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && more(), { rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, items.length]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const decades = [...new Set((facets.data?.years ?? []).map((y) => Math.floor(y.year / 10) * 10))];
  const filtered = Boolean(tag || decade || storyType);
  const label = KIND_LABELS[kind];
  const addLabel = kind === 'story' ? 'סיפור חדש' : `הוספת ${label.singular}`;
  // תמונות מועלות דרך תיקיית Google Drive המשפחתית (כשהחיבור פעיל)
  const driveUrl = kind === 'photo' ? settings.driveFolderUrl : null;
  const addButton = (text: string) =>
    driveUrl ? (
      <a href={driveUrl} target="_blank" rel="noopener noreferrer" className="btn btn--primary">
        <Icon name="upload" />
        הוספת תמונות לדרייב
      </a>
    ) : (
      <Link to={`/c/${kind}/new`} className="btn btn--primary">
        <Icon name="plus" />
        {text}
      </Link>
    );

  return (
    <div className={`category category--${kind}`}>
      <PageHeader
        title={label.plural}
        icon={KIND_ICON[kind]}
        subtitle={loading ? undefined : total ? `${total} ${total === 1 ? label.singular : label.plural}` : undefined}
        actions={addButton(addLabel)}
      />
      {driveUrl && (
        <p className="drive-note">
          <Icon name="photo" size={18} />
          <span>מעלים תמונות לתיקייה המשפחתית ב-Google Drive, והן מופיעות כאן אוטומטית בסנכרון הבא (עד שעה). ההעלאה לדרייב לפי ההרשאות שלכם ב-Google.</span>
        </p>
      )}

      {(total > 0 || filtered) && (
        <div className={`filters ${kind === 'story' ? 'filters--compact' : ''}`} role="group" aria-label="מיון וסינון">
          <label className="select">
            <span className="visually-hidden">מיון</span>
            <select value={sort} onChange={(e) => setParam('sort', e.target.value === defaultSort ? '' : e.target.value)}>
              {RANDOM_KINDS.includes(kind) && <option value="random">סדר אקראי</option>}
              <option value="new">החדשים ביותר</option>
              <option value="old">הוותיקים ביותר (לפי העלאה)</option>
              <option value="year_asc">לפי שנה — מהמוקדם</option>
              <option value="year_desc">לפי שנה — מהמאוחר</option>
              <option value="title">לפי כותרת (א-ת)</option>
            </select>
          </label>
          {kind === 'story' && (
            <label className="select">
              <span className="visually-hidden">סוג סיפור</span>
              <select value={storyType} onChange={(e) => setParam('type', e.target.value)}>
                <option value="">כל סוגי הסיפורים</option>
                {STORY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {decades.length > 0 && (
            <label className="select">
              <span className="visually-hidden">עשור</span>
              <select value={decade} onChange={(e) => setParam('decade', e.target.value)}>
                <option value="">כל השנים</option>
                {decades.map((d) => (
                  <option key={d} value={d}>
                    שנות ה-{String(d).slice(2)} ({d})
                  </option>
                ))}
              </select>
            </label>
          )}
          {(facets.data?.tags.length ?? 0) > 0 && (
            <label className="select">
              <span className="visually-hidden">תגית</span>
              <select value={tag} onChange={(e) => setParam('tag', e.target.value)}>
                <option value="">כל התגיות</option>
                {facets.data!.tags.map((t) => (
                  <option key={t.id} value={t.name}>
                    #{t.name} ({t.count})
                  </option>
                ))}
              </select>
            </label>
          )}
          {filtered && (
            <button className="btn btn--text" onClick={() => setParams(sort !== defaultSort ? { sort } : {}, { replace: true })}>
              ניקוי סינון
            </button>
          )}
        </div>
      )}

      {error && <ErrorBox message={error} onRetry={load} />}
      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState icon="search" title="לא נמצאו פריטים התואמים לסינון" />
        ) : (
          <EmptyState
            icon={KIND_ICON[kind]}
            title={EMPTY_TEXT[kind].title}
            text={EMPTY_TEXT[kind].text}
            action={addButton(EMPTY_TEXT[kind].cta)}
          />
        )
      ) : (
        <>
          {kind === 'photo' && (
            <PhotoCollage items={items} onOpen={setOpen} />
          )}
          {kind === 'video' && <div className="grid grid--media">{items.map((it) => <VideoCard key={it.id} item={it} />)}</div>}
          {kind === 'audio' && (
            <>
              <div className="audio-toolbar">
                <button type="button" className={`chip ${continuous ? 'is-active' : ''}`} aria-pressed={continuous} onClick={() => setContinuous(!continuous)}>
                  <Icon name="audio" size={16} />
                  השמעה ברצף
                </button>
              </div>
              <div className="list">
                {items.map((it, i) => (
                  <AudioCard
                    key={it.id}
                    item={it}
                    autoPlay={autoPlayId === it.id}
                    onEnded={() => {
                      const next = items[i + 1];
                      if (continuous && next) setAutoPlayId(next.id);
                      // לקראת סוף הרשימה — טוענים עוד הקלטות, כדי שהרצף ימשיך
                      if (continuous && i + 3 >= items.length && fetched.current < total) more();
                    }}
                  />
                ))}
              </div>
            </>
          )}
          {kind === 'story' && <StoryBoard items={items} />}
          {kind === 'document' && <div className="grid grid--docs">{items.map((it) => <DocumentCard key={it.id} item={it} />)}</div>}
          {hasMore && (
            <div className="load-more" ref={sentinel}>
              <button className="btn btn--ghost" onClick={more} disabled={loadingMore}>
                {loadingMore ? 'טוען…' : `הצגת עוד (${total - fetched.current})`}
              </button>
            </div>
          )}
        </>
      )}


      {confirmDelete && (
        <Modal title="מחיקת תמונה" onClose={() => setConfirmDelete(null)}>
          <p>
            למחוק את {accessibleTitle(confirmDelete) === 'תמונה' ? 'התמונה' : `״${accessibleTitle(confirmDelete)}״`}? היא תועבר לסל המחזור, הקובץ יישמר, ואפשר יהיה לשחזר אותה מתוך ״הגדרות ← ניהול תכנים״.
          </p>
          <div className="form__actions">
            <button className="btn btn--ghost" onClick={() => setConfirmDelete(null)}>
              ביטול
            </button>
            <button className="btn btn--danger" onClick={doDelete} disabled={deleting}>
              {deleting ? 'מוחק…' : 'מחיקה'}
            </button>
          </div>
        </Modal>
      )}

      {open !== null && kind === 'photo' && (
        <Lightbox
          items={items}
          index={open}
          onIndex={(i) => {
            setOpen(i);
            if (i >= items.length - 3 && fetched.current < total) more();
          }}
          onClose={() => setOpen(null)}
          onDelete={isAdmin ? (it) => setConfirmDelete(it) : undefined}
        />
      )}
    </div>
  );
}
