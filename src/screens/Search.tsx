import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import type { ItemKind, SearchResults } from '../../shared/types';
import { ITEM_KINDS, KIND_LABELS } from '../../shared/constants';
import { api } from '../api/client';
import { EmptyState, ErrorBox, PageHeader, Spinner } from '../components/Common';
import { Icon, KIND_ICON } from '../components/Icon';
import { ItemRowCard } from '../components/ItemCards';

/** חיפוש בכל חמש הקטגוריות: כותרות, תיאורים, תוכן סיפורים, תגיות, אנשים, תאריכים, תגובות ושמות מעלים. */
export function SearchScreen() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const kind = (params.get('kind') ?? '') as ItemKind | '';
  const [draft, setDraft] = useState(q);
  const [res, setRes] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!q) inputRef.current?.focus();
  }, [q]);

  useEffect(() => {
    if (!q.trim()) {
      setRes(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    api.search(q, kind || undefined)
      .then((r) => alive && setRes(r))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [q, kind]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (draft.trim()) next.set('q', draft.trim());
    else next.delete('q');
    setParams(next);
    inputRef.current?.blur();
  };
  const setKind = (k: ItemKind | '') => {
    const next = new URLSearchParams(params);
    if (k) next.set('kind', k);
    else next.delete('kind');
    setParams(next, { replace: true });
  };

  return (
    <div className="search">
      <PageHeader title="חיפוש בזיכרונות" icon="search" />
      <form className="search__form" role="search" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="search-input">
          מה מחפשים?
        </label>
        <input
          id="search-input"
          ref={inputRef}
          type="search"
          enterKeyHint="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="לדוגמה: יום הולדת, טיול, 1975, שם של בן משפחה"
        />
        <button className="btn btn--primary">
          <Icon name="search" />
          חיפוש
        </button>
      </form>
      <div className="chips" role="group" aria-label="סינון לפי קטגוריה">
        <button className={`chip ${!kind ? 'is-active' : ''}`} onClick={() => setKind('')} aria-pressed={!kind}>
          הכול
        </button>
        {ITEM_KINDS.map((k) => (
          <button key={k} className={`chip ${kind === k ? 'is-active' : ''}`} onClick={() => setKind(k)} aria-pressed={kind === k}>
            <Icon name={KIND_ICON[k]} size={16} />
            {KIND_LABELS[k].plural}
          </button>
        ))}
      </div>
      <p className="search__help">
        החיפוש מתבצע בכותרות, בתיאורים, בתוכן הסיפורים והתגובות, בתגיות, בשמות אנשים ובתאריכים. חיפוש בתוך הקלטות (תמלול) וחיפוש לפי משמעות — עדיין לא זמינים.
      </p>

      {error && <ErrorBox message={error} />}
      {loading ? (
        <Spinner label="מחפש…" />
      ) : res && res.total === 0 ? (
        <EmptyState icon="search" title={`לא נמצאו תוצאות עבור ״${res.query}״`} text="נסו מילה אחרת, חלק ממילה, או שנה." />
      ) : res ? (
        <div className="search__results" aria-live="polite">
          <p className="search__count">
            נמצאו {res.total} תוצאות עבור ״{res.query}״
          </p>
          {res.groups.map((g) => (
            <section key={g.kind} className="search__group" aria-labelledby={`g-${g.kind}`}>
              <h2 id={`g-${g.kind}`} className="section-title">
                <Icon name={KIND_ICON[g.kind]} />
                {KIND_LABELS[g.kind].plural}
                <span className="count">{g.items.length}</span>
              </h2>
              <ul className="list">
                {g.items.map((it) => (
                  <li key={it.id}>
                    <ItemRowCard item={it} to={`/item/${it.id}`} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
