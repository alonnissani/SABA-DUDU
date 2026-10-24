import { useState } from 'react';
import { Field } from './Common';

export interface MetaValues {
  description: string;
  dateText: string;
  dateYear: string;
  people: string;
  tags: string[];
}

export const emptyMeta = (): MetaValues => ({ description: '', dateText: '', dateYear: '', people: '', tags: [] });

/** שנה מתוך הטקסט החופשי, אם לא הוזנה שנה במפורש: ״קיץ 1974״ ← 1974 */
export function resolveYear(m: MetaValues): number | null {
  const explicit = Number(m.dateYear);
  if (m.dateYear && Number.isInteger(explicit)) return explicit;
  const found = /(18|19|20)\d{2}/.exec(m.dateText);
  return found ? Number(found[0]) : null;
}

export function metaPayload(m: MetaValues) {
  return {
    description: m.description.trim() || undefined,
    dateText: m.dateText.trim() || undefined,
    dateYear: resolveYear(m),
    people: m.people.trim() || undefined,
    tags: m.tags,
  };
}

export function TagInput({ value, onChange, suggestions = [] }: { value: string[]; onChange: (v: string[]) => void; suggestions?: string[] }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const parts = raw.split(/[,،]/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
    const next = [...value];
    for (const p of parts) if (!next.some((t) => t.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next.slice(0, 20));
    setDraft('');
  };
  const listId = 'tag-suggestions';
  return (
    <div className="tag-input">
      <ul className="tag-list">
        {value.map((t) => (
          <li key={t} className="tag tag--removable">
            #{t}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`הסרת התגית ${t}`}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="tag-input__row">
        <input
          value={draft}
          list={suggestions.length ? listId : undefined}
          onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (draft.trim()) add(draft);
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
          placeholder="לדוגמה: יום הולדת, טיולים"
          aria-label="הוספת תגית"
        />
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => draft.trim() && add(draft)} disabled={!draft.trim()}>
          הוספה
        </button>
      </div>
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
}

export function MetaFields({ value, onChange, suggestions, hideDescription, peopleLabel = 'מי מופיע / קשור' }: {
  value: MetaValues;
  onChange: (v: MetaValues) => void;
  suggestions?: string[];
  hideDescription?: boolean;
  peopleLabel?: string;
}) {
  const set = <K extends keyof MetaValues>(k: K, v: MetaValues[K]) => onChange({ ...value, [k]: v });
  return (
    <>
      {!hideDescription && (
        <Field label="תיאור (לא חובה)">
          <textarea rows={3} value={value.description} onChange={(e) => set('description', e.target.value)} placeholder="מה רואים, איפה ומתי, מה מיוחד ברגע הזה" />
        </Field>
      )}
      <div className="field-row">
        <Field label="תאריך או תקופה (לא חובה)" hint="טקסט חופשי, למשל ״קיץ 1974״ או ״בערך 1960״">
          <input value={value.dateText} onChange={(e) => set('dateText', e.target.value)} />
        </Field>
        <Field label="שנה משוערת" hint="משמשת למיון ולסינון">
          <input type="number" inputMode="numeric" min={1850} max={2100} value={value.dateYear} placeholder={resolveYear({ ...value, dateYear: '' })?.toString() ?? ''} onChange={(e) => set('dateYear', e.target.value)} />
        </Field>
      </div>
      <Field label={`${peopleLabel} (לא חובה)`}>
        <input value={value.people} onChange={(e) => set('people', e.target.value)} placeholder="לדוגמה: סבא, סבתא, דודה רותי" />
      </Field>
      <div className="field">
        <span className="field__label">תגיות (לא חובה)</span>
        <TagInput value={value.tags} onChange={(t) => set('tags', t)} suggestions={suggestions} />
      </div>
    </>
  );
}
