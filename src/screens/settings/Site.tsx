import { useState, type FormEvent } from 'react';
import type { HeroTraits } from '../../../shared/types';
import { api, fileUrl, uploadFile } from '../../api/client';
import { resolveMime } from '../../../shared/constants';
import { useApp, useLoad, useToast } from '../../state';
import { ErrorBox, Field, Modal, ProgressBar, Spinner } from '../../components/Common';
import { Icon } from '../../components/Icon';
import { accessibleTitle, displayTitle, originalOf, previewUrl } from '../../lib/media';
import { precheck } from '../../lib/uploader';

export function HeroSection() {
  const { settings, refreshSettings } = useApp();
  const toast = useToast();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const bad = precheck('photo', file);
    if (bad) {
      setError(bad);
      return;
    }
    setProgress(0);
    try {
      const f = await uploadFile(file, { kind: 'photo', name: file.name, mime: resolveMime(file.type, file.name), onProgress: (l, t) => setProgress(l / t) });
      await api.admin.setHero({ fileId: f.id });
      await refreshSettings();
      toast('התמונה הראשית הוחלפה');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProgress(null);
    }
  };
  const set = async (b: { itemId?: string; clear?: boolean }, msg: string) => {
    try {
      await api.admin.setHero(b);
      await refreshSettings();
      toast(msg);
      setPicking(false);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="stack">
      <div className="panel hero-edit">
        <div className="hero-edit__preview">
          {settings.heroFileId ? (
            <img src={fileUrl(settings.heroFileId)} alt="התמונה הראשית הנוכחית" />
          ) : (
            <span className="hero-edit__empty">
              <span className="frame__mono" aria-hidden="true">ד</span>
              עדיין לא נבחרה תמונה
            </span>
          )}
        </div>
        <div className="hero-edit__body">
          <p className="muted">התמונה מוצגת במסך הפתיחה ובראש האתר — רק לבני משפחה מחוברים. מומלץ תמונת פורטרט ברורה.</p>
          <label className={`btn btn--primary ${progress !== null ? 'is-disabled' : ''}`}>
            <input type="file" className="visually-hidden" accept="image/*,.heic" disabled={progress !== null} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            <Icon name="upload" />
            העלאת תמונה חדשה
          </label>
          <button className="btn btn--ghost" onClick={() => setPicking(true)}>
            <Icon name="photo" />
            בחירה מאלבום התמונות
          </button>
          {settings.heroFileId && (
            <button className="btn btn--text" onClick={() => window.confirm('להסיר את התמונה הראשית? (התמונה עצמה לא תימחק)') && set({ clear: true }, 'התמונה הוסרה ממסך הפתיחה')}>
              הסרת התמונה הראשית
            </button>
          )}
          {progress !== null && <ProgressBar value={progress} label="העלאת התמונה" />}
          {error && <ErrorBox message={error} />}
        </div>
      </div>
      {picking && <PhotoPicker onPick={(id) => set({ itemId: id }, 'התמונה הראשית הוחלפה')} onClose={() => setPicking(false)} />}
    </div>
  );
}

function PhotoPicker({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const photos = useLoad(() => api.list({ kind: 'photo', limit: 100 }), []);
  return (
    <Modal title="בחירת תמונה מהאלבום" onClose={onClose} wide>
      {photos.loading ? (
        <Spinner />
      ) : photos.error ? (
        <ErrorBox message={photos.error} />
      ) : !photos.data?.items.length ? (
        <p className="muted-center">אין עדיין תמונות באלבום.</p>
      ) : (
        <div className="pick-grid">
          {photos.data.items.map((p) => (
            <button key={p.id} className="pick-grid__btn" onClick={() => onPick(p.id)} aria-label={`בחירת ${accessibleTitle(p)}`}>
              {previewUrl(p) ? <img src={previewUrl(p)!} alt="" loading="lazy" /> : <Icon name="photo" />}
              {displayTitle(p) && <span>{displayTitle(p)}</span>}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ListEditor<T>({ items, onChange, empty, render, add, addLabel }: {
  items: T[];
  onChange: (v: T[]) => void;
  empty: T;
  render: (item: T, set: (v: T) => void, i: number) => React.ReactNode;
  add?: boolean;
  addLabel: string;
}) {
  return (
    <div className="list-editor">
      {items.map((it, i) => (
        <div key={i} className="list-editor__row">
          {render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))), i)}
          <button type="button" className="icon-btn" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="הסרה">
            <Icon name="close" />
          </button>
        </div>
      ))}
      {add !== false && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange([...items, empty])}>
          <Icon name="plus" size={18} />
          {addLabel}
        </button>
      )}
    </div>
  );
}

export function SiteSection() {
  const { settings, refreshSettings } = useApp();
  const toast = useToast();
  const [siteTitle, setSiteTitle] = useState(settings.siteTitle);
  const [subtitle, setSubtitle] = useState(settings.subtitle);
  const [traits, setTraits] = useState<HeroTraits>(settings.heroTraits);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.admin.saveSettings({ siteTitle, subtitle, heroTraits: traits });
      await refreshSettings();
      toast('ההגדרות נשמרו');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={save}>
      <div className="panel form">
        <h2 className="panel__title">שם וכותרות</h2>
        <Field label="שם האתר">
          <input required maxLength={60} value={siteTitle} onChange={(e) => setSiteTitle(e.target.value)} />
        </Field>
        <Field label="כותרת משנה (מוצגת במסך הפתיחה)">
          <input maxLength={160} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
        </Field>
      </div>

      <div className="panel form">
        <h2 className="panel__title">מאפיינים אישיים במסך הפתיחה</h2>
        <p className="muted">כל מה שתוסיפו כאן יופיע מתחת לתמונה במסך הפתיחה. השאירו ריק כדי לא להציג.</p>

        <h3 className="panel__sub">משפטים שסבא היה אומר</h3>
        <ListEditor
          items={traits.quotes}
          onChange={(quotes) => setTraits({ ...traits, quotes })}
          empty=""
          addLabel="הוספת משפט"
          render={(q, set, i) => <input value={q} onChange={(e) => set(e.target.value)} maxLength={300} aria-label={`משפט ${i + 1}`} placeholder="המשפט, כפי שסבא אמר אותו" />}
        />

        <h3 className="panel__sub">סמלים וחפצים המזוהים איתו</h3>
        <ListEditor
          items={traits.symbols}
          onChange={(symbols) => setTraits({ ...traits, symbols })}
          empty={{ icon: '', label: '' }}
          addLabel="הוספת סמל"
          render={(s, set, i) => (
            <>
              <input className="input--emoji" value={s.icon} onChange={(e) => set({ ...s, icon: e.target.value })} maxLength={8} aria-label={`סמל ${i + 1} — אימוג׳י`} placeholder="🎩" />
              <input value={s.label} onChange={(e) => set({ ...s, label: e.target.value })} maxLength={80} aria-label={`סמל ${i + 1} — תיאור`} placeholder="תיאור, למשל: הכובע האהוב" />
            </>
          )}
        />

        <h3 className="panel__sub">פרטים אישיים</h3>
        <ListEditor
          items={traits.details}
          onChange={(details) => setTraits({ ...traits, details })}
          empty={{ label: '', value: '' }}
          addLabel="הוספת פרט"
          render={(d, set, i) => (
            <>
              <input value={d.label} onChange={(e) => set({ ...d, label: e.target.value })} maxLength={60} aria-label={`פרט ${i + 1} — כותרת`} placeholder="למשל: נולד ב" />
              <input value={d.value} onChange={(e) => set({ ...d, value: e.target.value })} maxLength={200} aria-label={`פרט ${i + 1} — ערך`} placeholder="הערך" />
            </>
          )}
        />
      </div>
      {error && <ErrorBox message={error} />}
      <div className="form__actions form__actions--sticky">
        <button className="btn btn--primary btn--lg" disabled={busy}>{busy ? 'שומר…' : 'שמירת ההגדרות'}</button>
      </div>
    </form>
  );
}

// ---------- תמונות לדף הבית ----------

interface HomeEntry {
  itemId: string;
  x: number;
  y: number;
  zoom: number;
  src: string;
}

function Circle({ entry, size }: { entry: HomeEntry; size: number }) {
  return (
    <span className="portrait" style={{ width: size, height: size }}>
      <img
        src={entry.src}
        alt=""
        className="is-loaded"
        style={{ objectPosition: `${entry.x}% ${entry.y}%`, transformOrigin: `${entry.x}% ${entry.y}%`, transform: entry.zoom > 1 ? `scale(${entry.zoom})` : undefined }}
      />
    </span>
  );
}

/**
 * אוסף התמונות שמתחלפות בעיגול הגדול בדף הבית. לכל תמונה המנהל מסמן היכן הפנים ומגדיל לפי הצורך,
 * כדי שהפנים יישבו היטב בעיגול. התמונה הראשית (בכותרת) לא נכללת, כדי שלא תופיע פעמיים.
 */
export function HomePhotosSection() {
  const { settings, refreshSettings } = useApp();
  const toast = useToast();
  const [entries, setEntries] = useState<HomeEntry[]>(() => settings.homePhotos.map((p) => ({ ...p, src: fileUrl(p.fileId) })));
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.admin.saveSettings({ homePhotos: entries.map(({ itemId, x, y, zoom }) => ({ itemId, x, y, zoom })) });
      await refreshSettings();
      toast('האוסף נשמר');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="panel">
        <p className="muted">
          בכל כניסה לדף הבית העיגול הגדול שליד הברכה מציג תמונה אחרת מהאוסף הזה, בלי לחזור על התמונה הקודמת. התמונה הקטנה בכותרת קבועה ואינה משתתפת.
          מומלץ לבחור תמונות שבהן הפנים של סבא ברורות, וללחוץ ״כיוון״ כדי לסמן את מקום הפנים.
        </p>
        <div className="form__actions form__actions--start">
          <button className="btn btn--ghost" onClick={() => setPicking(true)}>
            <Icon name="plus" />
            הוספת תמונות מהאלבום
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="muted-center">עדיין לא נבחרו תמונות. עד אז יוצג בעיגול סמל ״ד״.</p>
      ) : (
        <ul className="home-photos">
          {entries.map((e, i) => (
            <li key={e.itemId} className="home-photos__item">
              <Circle entry={e} size={96} />
              <div className="home-photos__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => setEditing(i)}>
                  כיוון
                </button>
                <button className="btn btn--text btn--sm" onClick={() => setEntries((p) => p.filter((_, j) => j !== i))}>
                  הסרה
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="form__actions form__actions--sticky">
        <button className="btn btn--primary btn--lg" onClick={save} disabled={busy}>
          {busy ? 'שומר…' : 'שמירת האוסף'}
        </button>
      </div>

      {picking && (
        <MultiPhotoPicker
          selected={entries.map((e) => e.itemId)}
          heroFileId={settings.heroFileId}
          onClose={() => setPicking(false)}
          onToggle={(item, src) =>
            setEntries((prev) =>
              prev.some((e) => e.itemId === item) ? prev.filter((e) => e.itemId !== item) : [...prev, { itemId: item, x: 50, y: 35, zoom: 1, src }],
            )
          }
        />
      )}
      {editing !== null && entries[editing] && (
        <FocusEditor
          entry={entries[editing]}
          onClose={() => setEditing(null)}
          onChange={(next) => setEntries((prev) => prev.map((e, j) => (j === editing ? next : e)))}
        />
      )}
    </div>
  );
}

function MultiPhotoPicker({ selected, heroFileId, onToggle, onClose }: {
  selected: string[];
  heroFileId: string | null;
  onToggle: (itemId: string, src: string) => void;
  onClose: () => void;
}) {
  const photos = useLoad(() => api.list({ kind: 'photo', limit: 100 }), []);
  const sel = new Set(selected);
  const list = (photos.data?.items ?? []).filter((p) => originalOf(p)?.id !== heroFileId && previewUrl(p));
  return (
    <Modal title="בחירת תמונות לדף הבית" onClose={onClose} wide>
      {photos.loading ? (
        <Spinner />
      ) : photos.error ? (
        <ErrorBox message={photos.error} />
      ) : !list.length ? (
        <p className="muted-center">אין תמונות זמינות באלבום.</p>
      ) : (
        <div className="pick-grid">
          {list.map((p) => (
            <button
              key={p.id}
              className={`pick-grid__btn ${sel.has(p.id) ? 'is-selected' : ''}`}
              onClick={() => onToggle(p.id, previewUrl(p)!)}
              aria-pressed={sel.has(p.id)}
              aria-label={`${sel.has(p.id) ? 'הסרת' : 'בחירת'} ${accessibleTitle(p)}`}
            >
              <img src={previewUrl(p)!} alt="" loading="lazy" />
              {sel.has(p.id) && (
                <span className="pick-grid__check" aria-hidden="true">
                  <Icon name="check" size={18} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <div className="form__actions">
        <button className="btn btn--primary" onClick={onClose}>
          סיום
        </button>
      </div>
    </Modal>
  );
}

/** סימון מקום הפנים: הקשה על התמונה קובעת את המרכז, והמחוון מגדיל */
function FocusEditor({ entry, onChange, onClose }: { entry: HomeEntry; onChange: (e: HomeEntry) => void; onClose: () => void }) {
  const setFromPointer = (ev: React.PointerEvent<HTMLImageElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const x = Math.round(((ev.clientX - r.left) / r.width) * 100);
    const y = Math.round(((ev.clientY - r.top) / r.height) * 100);
    onChange({ ...entry, x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) });
  };
  return (
    <Modal title="כיוון התמונה בעיגול" onClose={onClose} wide>
      <p className="muted">הקישו על הפנים של סבא בתמונה. אפשר להגדיל אם הפנים קטנות.</p>
      <div className="focus-editor">
        <div className="focus-editor__image">
          <img src={entry.src} alt="" onPointerDown={setFromPointer} draggable={false} />
          <span className="focus-editor__dot" style={{ left: `${entry.x}%`, top: `${entry.y}%` }} aria-hidden="true" />
        </div>
        <div className="focus-editor__side">
          <Circle entry={entry} size={140} />
          <label className="field">
            <span className="field__label">הגדלה</span>
            <input type="range" min={1} max={3} step={0.1} value={entry.zoom} onChange={(e) => onChange({ ...entry, zoom: Number(e.target.value) })} />
          </label>
        </div>
      </div>
      <div className="form__actions">
        <button className="btn btn--primary" onClick={onClose}>
          סיום
        </button>
      </div>
    </Modal>
  );
}
