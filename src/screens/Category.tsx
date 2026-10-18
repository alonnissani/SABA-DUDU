import { useEffect, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import type { ItemKind, ItemSummary } from '../../shared/types';
import { ITEM_KINDS, KIND_LABELS, STORY_TYPES } from '../../shared/constants';
import { api } from '../api/client';
import { useLoad } from '../state';
import { EmptyState, ErrorBox, PageHeader, Spinner } from '../components/Common';
import { Icon, KIND_ICON } from '../components/Icon';
import { AudioCard, DocumentCard, PhotoTile, StoryCard, VideoCard } from '../components/ItemCards';
import { Lightbox } from '../components/Lightbox';

const PAGE = 30;

const EMPTY_TEXT: Record<ItemKind, { title: string; text: string; cta: string }> = {
  photo: { title: 'עדיין אין תמונות באלבום', text: 'העלו את התמונה הראשונה של סבא דודו — אפשר לבחור כמה תמונות יחד.', cta: 'העלאת תמונות' },
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
  const sort = params.get('sort') ?? 'new';
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

  const query = { kind, sort, tag: tag || undefined, decade: decade ? Number(decade) : undefined, storyType: storyType || undefined, limit: PAGE };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.list({ ...query, offset: 0 });
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
    setLoadingMore(true);
    try {
      const res = await api.list({ ...query, offset: items.length });
      setItems((prev) => [...prev, ...res.items]);
      setTotal(res.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

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

  return (
    <div className={`category category--${kind}`}>
      <PageHeader
        title={label.plural}
        icon={KIND_ICON[kind]}
        subtitle={loading ? undefined : total ? `${total} ${total === 1 ? label.singular : label.plural}` : undefined}
        actions={
          <Link to={`/c/${kind}/new`} className="btn btn--primary">
            <Icon name="plus" />
            {addLabel}
          </Link>
        }
      />

      {(total > 0 || filtered) && (
        <div className="filters" role="group" aria-label="מיון וסינון">
          <label className="select">
            <span className="visually-hidden">מיון</span>
            <select value={sort} onChange={(e) => setParam('sort', e.target.value === 'new' ? '' : e.target.value)}>
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
            <button className="btn btn--text" onClick={() => setParams(sort !== 'new' ? { sort } : {}, { replace: true })}>
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
            action={
              <Link to={`/c/${kind}/new`} className="btn btn--primary">
                <Icon name="plus" />
                {EMPTY_TEXT[kind].cta}
              </Link>
            }
          />
        )
      ) : (
        <>
          {kind === 'photo' && (
            <div className="gallery">
              {items.map((it, i) => (
                <PhotoTile key={it.id} item={it} onOpen={() => setOpen(i)} />
              ))}
            </div>
          )}
          {kind === 'video' && <div className="grid grid--media">{items.map((it) => <VideoCard key={it.id} item={it} />)}</div>}
          {kind === 'audio' && <div className="list">{items.map((it) => <AudioCard key={it.id} item={it} />)}</div>}
          {kind === 'story' && <div className="grid grid--stories">{items.map((it) => <StoryCard key={it.id} item={it} />)}</div>}
          {kind === 'document' && <div className="grid grid--docs">{items.map((it) => <DocumentCard key={it.id} item={it} />)}</div>}
          {items.length < total && (
            <div className="load-more">
              <button className="btn btn--ghost" onClick={more} disabled={loadingMore}>
                {loadingMore ? 'טוען…' : `הצגת עוד (${total - items.length})`}
              </button>
            </div>
          )}
        </>
      )}

      {open !== null && kind === 'photo' && (
        <Lightbox
          items={items}
          index={open}
          onIndex={(i) => {
            setOpen(i);
            if (i >= items.length - 3 && items.length < total && !loadingMore) more();
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
