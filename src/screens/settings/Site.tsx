import { useState, type FormEvent } from 'react';
import type { HeroTraits } from '../../../shared/types';
import { api, fileUrl, uploadFile } from '../../api/client';
import { resolveMime } from '../../../shared/constants';
import { useApp, useLoad, useToast } from '../../state';
import { ErrorBox, Field, Modal, ProgressBar, Spinner } from '../../components/Common';
import { Icon } from '../../components/Icon';
import { accessibleTitle, displayTitle, previewUrl } from '../../lib/media';
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
