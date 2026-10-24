import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import type { ItemKind, ItemSummary, StoryType } from '../../shared/types';
import { ACCEPT_ATTR, ITEM_KINDS, KIND_LABELS, STORY_TYPES, formatBytes } from '../../shared/constants';
import { api, type StoryImageUpload } from '../api/client';
import { useApp, useLoad, useToast } from '../state';
import { ErrorBox, Field, Modal, PageHeader, ProgressBar, Spinner } from '../components/Common';
import { Icon, KIND_ICON } from '../components/Icon';
import { ItemRowCard } from '../components/ItemCards';
import { MetaFields, emptyMeta, metaPayload, type MetaValues } from '../components/MetaFields';
import { fileTitle } from '../lib/media';
import { kindForFile, precheck, uploadAsItem, uploadStoryImage, type MediaKind, type Stage } from '../lib/uploader';
import { drivePreviewUrl, parseDriveFileId } from '../../shared/drive';

export function AddItemScreen() {
  const { kind } = useParams();
  const { settings } = useApp();
  if (!kind || !(ITEM_KINDS as string[]).includes(kind)) return <Navigate to="/home" replace />;
  if (kind === 'story') return <StoryForm />;
  if (kind === 'video') return <VideoForm />;
  // גלריית התמונות מגיעה רק מ-Google Drive — אין העלאה לגלריה דרך האתר
  if (kind === 'photo') return <DrivePhotosNotice url={settings.driveFolderUrl} />;
  return <MediaForm key={kind} kind={kind as MediaKind} />;
}

/** כשתיקיית Google Drive מחוברת — תמונות מועלות לדרייב, לא לאתר (בלי עותק כפול) */
function DrivePhotosNotice({ url }: { url: string | null }) {
  const { isAdmin } = useApp();
  return (
    <div className="add">
      <PageHeader title="הוספת תמונות" icon="photo" />
      <div className="form form--card drive-add">
        <p>
          התמונות של סבא נשמרות בתיקייה המשפחתית ב-Google Drive. מעלים אליה את התמונות — והן מופיעות כאן באתר אוטומטית בסנכרון הבא (עד שעה).
        </p>
        {url ? (
          <p className="muted small">
            ההעלאה מתבצעת בדרייב לפי ההרשאות שלכם ב-Google. אם אין לכם הרשאה להוסיף קבצים לתיקייה, בקשו אותה ממנהל/ת האתר.
          </p>
        ) : (
          <p className="muted small">
            {isAdmin ? 'עדיין לא חוברה תיקייה. חברו אותה בהגדרות ← חיבור Google Drive.' : 'הגלריה עדיין לא חוברה לתיקיית Google Drive. מנהל/ת האתר יחבר/תחבר אותה בקרוב.'}
          </p>
        )}
        <div className="form__actions">
          <Link to="/c/photo" className="btn btn--ghost">חזרה</Link>
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn--primary btn--lg">
              <Icon name="upload" />
              הוספת תמונות לדרייב
            </a>
          ) : (
            isAdmin && (
              <Link to="/settings/drive" className="btn btn--primary btn--lg">
                <Icon name="link" />
                חיבור Google Drive
              </Link>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** אזהרה לפני יציאה מהדף באמצע העלאה */
function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [active]);
}

interface Pending {
  key: string;
  file: File;
  title: string;
  previewUrl: string | null;
  error: string | null;
  stage: Stage | 'waiting' | 'done';
  progress: number;
}

const STAGE_LABEL: Record<Pending['stage'], string> = {
  waiting: 'ממתין',
  preparing: 'מכין תצוגה מקדימה…',
  uploading: 'מעלה',
  saving: 'שומר…',
  done: 'נשמר ✓',
};

function MediaForm({ kind }: { kind: MediaKind }) {
  const navigate = useNavigate();
  const toast = useToast();
  const label = KIND_LABELS[kind];
  const [files, setFiles] = useState<Pending[]>([]);
  const [meta, setMeta] = useState<MetaValues>(emptyMeta());
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tags = useLoad(() => api.tags(), []);
  useLeaveGuard(busy);

  useEffect(() => () => files.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const added: Pending[] = [...list].map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
      file,
      // לתמונות לא ממלאים מראש את שם הקובץ — הכותרת אופציונלית
      title: kind === 'photo' ? '' : fileTitle(file.name),
      previewUrl: kind === 'photo' && /^image\/(jpeg|png|webp|gif|avif)$/.test(file.type) ? URL.createObjectURL(file) : null,
      error: precheck(kind, file),
      stage: 'waiting',
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...added].slice(0, 50));
    if (inputRef.current) inputRef.current.value = '';
  };

  const update = (key: string, patch: Partial<Pending>) => setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (files.some((f) => f.stage !== 'done' && precheck(kind, f.file))) {
      setFormError('יש קבצים שאינם נתמכים — הסירו אותם כדי להמשיך');
      return;
    }
    const todo = files.filter((f) => f.stage !== 'done');
    if (!todo.length) {
      setFormError('יש לבחור לפחות קובץ אחד תקין');
      return;
    }
    if (kind !== 'photo' && todo.some((f) => !f.title.trim())) {
      setFormError('לכל קובץ צריכה להיות כותרת');
      return;
    }
    setBusy(true);
    abort.current = new AbortController();
    let failed = 0;
    for (const f of todo) {
      if (abort.current.signal.aborted) break;
      update(f.key, { error: null, stage: 'preparing', progress: 0 });
      try {
        await uploadAsItem(kind, f.file, { title: f.title.trim(), ...metaPayload(meta) }, (stage, progress) => update(f.key, { stage, progress }), abort.current.signal);
        update(f.key, { stage: 'done', progress: 1 });
      } catch (err) {
        failed++;
        const aborted = (err as Error).name === 'AbortError' || (err as { status?: number }).status === -1;
        update(f.key, { stage: 'waiting', progress: 0, error: aborted ? 'ההעלאה בוטלה' : (err as Error).message });
      }
    }
    setBusy(false);
    abort.current = null;
    if (!failed) {
      toast(todo.length === 1 ? `ה${label.singular} ${kind === 'photo' || kind === 'audio' ? 'נשמרה' : 'נשמר'} בארכיון` : `${todo.length} ${label.plural} נשמרו בארכיון`);
      navigate(`/c/${kind}`);
    } else {
      setFormError(`${failed} מתוך ${todo.length} קבצים לא הועלו. אפשר לנסות שוב — הקבצים שכבר נשמרו לא יועלו פעמיים.`);
    }
  };

  const pending = files.filter((f) => f.stage !== 'done');

  return (
    <div className="add">
      <PageHeader title={kind === 'photo' ? 'העלאת תמונות' : `העלאת ${label.singular}`} icon={KIND_ICON[kind]} />
      <form className="form form--card" onSubmit={submit}>
        <div className="step">
          <span className="step__num">1</span>
          <div className="step__body">
            <h2 className="step__title">בחירת קבצים</h2>
            <label className={`dropzone ${busy ? 'is-disabled' : ''}`}>
              <input ref={inputRef} type="file" accept={ACCEPT_ATTR[kind]} multiple disabled={busy} onChange={(e) => addFiles(e.target.files)} />
              <Icon name="upload" size={34} />
              <span className="dropzone__title">{`בחירת ${label.plural} מהמכשיר`}</span>
              <span className="dropzone__hint">
                {kind === 'audio' ? `קובץ המקור יישמר כפי שהוא — ללא דחיסה וללא שינוי באיכות` : 'קובץ המקור נשמר באיכותו המלאה'}
                {' · אפשר לבחור כמה יחד'}
              </span>
            </label>
          </div>
        </div>

        {files.length > 0 && (
          <ul className="pending">
            {files.map((f) => (
              <li key={f.key} className={`pending__item ${f.stage === 'done' ? 'is-done' : ''} ${f.error ? 'has-error' : ''}`}>
                <span className="pending__thumb" aria-hidden="true">
                  {f.previewUrl ? <img src={f.previewUrl} alt="" /> : <Icon name={KIND_ICON[kind]} size={26} />}
                </span>
                <div className="pending__body">
                  <label className="visually-hidden" htmlFor={`t-${f.key}`}>
                    כותרת עבור {f.file.name}
                  </label>
                  <input
                    id={`t-${f.key}`}
                    className="pending__title"
                    value={f.title}
                    disabled={busy || f.stage === 'done'}
                    onChange={(e) => update(f.key, { title: e.target.value })}
                    placeholder={kind === 'photo' ? 'כותרת (לא חובה)' : 'כותרת'}
                    required={kind !== 'photo'}
                  />
                  <span className="pending__info">
                    {f.file.name} · {formatBytes(f.file.size)}
                  </span>
                  {f.stage !== 'waiting' && f.stage !== 'done' && (
                    <>
                      <ProgressBar value={f.stage === 'uploading' ? f.progress : f.stage === 'saving' ? 1 : 0.02} label={`התקדמות העלאת ${f.title}`} />
                      <span className="pending__stage">
                        {STAGE_LABEL[f.stage]} {f.stage === 'uploading' && `${Math.round(f.progress * 100)}%`}
                      </span>
                    </>
                  )}
                  {f.stage === 'done' && <span className="pending__stage pending__stage--ok">{STAGE_LABEL.done}</span>}
                  {f.error && <span className="pending__error">{f.error}</span>}
                </div>
                {!busy && f.stage !== 'done' && (
                  <button type="button" className="icon-btn" onClick={() => setFiles((p) => p.filter((x) => x.key !== f.key))} aria-label={`הסרת ${f.file.name}`}>
                    <Icon name="close" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="step">
          <span className="step__num">2</span>
          <div className="step__body">
            <h2 className="step__title">פרטים {pending.length > 1 && <small>(יחולו על כל הקבצים)</small>}</h2>
            <MetaFields value={meta} onChange={setMeta} suggestions={tags.data?.map((t) => t.name)} />
          </div>
        </div>

        {formError && <ErrorBox message={formError} />}
        <div className="form__actions">
          {busy ? (
            <button type="button" className="btn btn--ghost" onClick={() => abort.current?.abort()}>
              ביטול העלאה
            </button>
          ) : (
            <Link to={`/c/${kind}`} className="btn btn--ghost">
              חזרה
            </Link>
          )}
          <button className="btn btn--primary btn--lg" disabled={busy || !pending.length}>
            {busy ? 'מעלה…' : 'שמירה'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------- סרטון: קישור ל-Google Drive בלבד (סרטונים לא מועלים לאתר) ----------------

function VideoForm() {
  return (
    <div className="add">
      <PageHeader title="הוספת סרטון" icon="video" />
      <DriveForm />
    </div>
  );
}

function DriveForm() {
  const navigate = useNavigate();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [meta, setMeta] = useState<MetaValues>(emptyMeta());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tags = useLoad(() => api.tags(), []);
  const fileId = parseDriveFileId(url);
  const invalid = url.trim() !== '' && !fileId;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!fileId) {
      setError('הדביקו קישור שיתוף של סרטון מ-Google Drive');
      return;
    }
    setBusy(true);
    try {
      const item = await api.create({ kind: 'video', title: title.trim(), externalUrl: url.trim(), ...metaPayload(meta) });
      toast('הסרטון נוסף לארכיון');
      navigate(`/item/${item.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form form--card" onSubmit={submit}>
      <div className="step">
        <span className="step__num">1</span>
        <div className="step__body">
          <h2 className="step__title">קישור לסרטון</h2>
          <Field label="קישור שיתוף מ-Google Drive" hint="בדרייב: לחיצה על ⋮ ליד הסרטון ← שיתוף ← ״כל מי שיש לו את הקישור״ ← העתקת קישור">
            <input type="url" dir="ltr" inputMode="url" required placeholder="https://drive.google.com/file/d/…/view" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={invalid} />
          </Field>
          {invalid && <p className="pending__error">זה לא נראה כמו קישור לקובץ ב-Google Drive</p>}
          {fileId && (
            <div className="drive-frame drive-frame--preview">
              <iframe src={drivePreviewUrl(fileId)} title="תצוגה מקדימה של הסרטון" allow="autoplay; fullscreen; encrypted-media" allowFullScreen referrerPolicy="no-referrer" />
            </div>
          )}
          {fileId && <p className="field__hint">אם בתצוגה המקדימה מופיעה בקשת גישה — יש לשנות בדרייב את הרשאת השיתוף ל״כל מי שיש לו את הקישור״.</p>}
        </div>
      </div>
      <div className="step">
        <span className="step__num">2</span>
        <div className="step__body">
          <h2 className="step__title">פרטים</h2>
          <Field label="כותרת">
            <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <MetaFields value={meta} onChange={setMeta} suggestions={tags.data?.map((t) => t.name)} />
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      <div className="form__actions">
        <Link to="/c/video" className="btn btn--ghost">
          חזרה
        </Link>
        <button className="btn btn--primary btn--lg" disabled={busy || !fileId}>
          {busy ? 'שומר…' : 'שמירה'}
        </button>
      </div>
    </form>
  );
}

// ---------------- סיפור ----------------

function StoryForm() {
  const navigate = useNavigate();
  const toast = useToast();
  const [storyType, setStoryType] = useState<StoryType | ''>('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [meta, setMeta] = useState<MetaValues>(emptyMeta());
  const [linked, setLinked] = useState<ItemSummary[]>([]);
  const [newFiles, setNewFiles] = useState<{ key: string; file: File; kind: MediaKind; progress: number; error: string | null }[]>([]);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tags = useLoad(() => api.tags(), []);
  useLeaveGuard(busy || Boolean(body.trim()));

  const addNew = (list: FileList | null) => {
    if (!list) return;
    const add = [...list].map((file) => {
      const kind = kindForFile(file);
      const error = kind === 'video' ? 'סרטונים מוסיפים כקישור ל-Google Drive' : kind ? precheck(kind, file) : 'סוג קובץ לא נתמך';
      return { key: `${file.name}-${Math.random()}`, file, kind: (kind ?? 'photo') as MediaKind, progress: 0, error };
    });
    setNewFiles((p) => [...p, ...add].slice(0, 10));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!storyType) {
      setError('בחרו את סוג הסיפור');
      return;
    }
    if (newFiles.some((f) => f.error)) {
      setError('יש קבצים מצורפים שאינם תקינים — הסירו אותם');
      return;
    }
    setBusy(true);
    try {
      const linkIds = linked.map((l) => l.id);
      const images: StoryImageUpload[] = [];
      for (const f of newFiles) {
        // תמונות נשמרות עם הסיפור עצמו (לא בגלריה); הקלטות, סרטונים ומסמכים — כפריטים בלשונית שלהם, מקושרים לסיפור
        if (f.kind === 'photo') {
          images.push(await uploadStoryImage(f.file, (p) => setNewFiles((prev) => prev.map((x) => (x.key === f.key ? { ...x, progress: p } : x)))));
          setNewFiles((prev) => prev.map((x) => (x.key === f.key ? { ...x, progress: 1 } : x)));
          continue;
        }
        const item = await uploadAsItem(
          f.kind,
          f.file,
          { title: `${title.trim()} — ${fileTitle(f.file.name)}`, description: `צורף לסיפור ״${title.trim()}״`, dateText: meta.dateText || undefined, tags: meta.tags },
          (_s, p) => setNewFiles((prev) => prev.map((x) => (x.key === f.key ? { ...x, progress: p } : x))),
        );
        linkIds.push(item.id);
        setNewFiles((prev) => prev.filter((x) => x.key !== f.key));
        setLinked((prev) => [...prev, item]);
      }
      const story = await api.create({ kind: 'story', title: title.trim(), body, storyType, ...metaPayload(meta), description: undefined, linkIds, images });
      toast('הסיפור פורסם — תודה ששיתפת!');
      navigate(`/item/${story.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="add">
      <PageHeader title="סיפור חדש" icon="story" subtitle="כל זיכרון, קטן כגדול, הוא חלק מהסיפור של סבא" />
      <form className="form form--card" onSubmit={submit}>
        <fieldset className="story-types">
          <legend className="field__label">איזה סוג של סיפור?</legend>
          <div className="chips">
            {STORY_TYPES.map((t) => (
              <label key={t.value} className={`chip ${storyType === t.value ? 'is-active' : ''}`}>
                <input type="radio" name="storyType" value={t.value} checked={storyType === t.value} onChange={() => setStoryType(t.value)} />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="כותרת">
          <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="לדוגמה: הפעם שסבא לימד אותי לדוג" />
        </Field>
        <Field label={storyType === 'saying' ? 'המשפט — ומתי סבא היה אומר אותו' : 'הסיפור'}>
          <textarea required rows={10} className="textarea--story" value={body} onChange={(e) => setBody(e.target.value)} placeholder="כתבו בחופשיות…" />
        </Field>
        <MetaFields value={meta} onChange={setMeta} suggestions={tags.data?.map((t) => t.name)} hideDescription peopleLabel="אנשים בסיפור" />

        <div className="field">
          <span className="field__label">תמונות לסיפור, הקלטות או סרטונים (לא חובה)</span>
          <span className="field__hint">תמונות שמעלים כאן נשמרות עם הסיפור בלבד — הן לא מתווספות לגלריה. סרטון מצרפים דרך ״בחירה מהארכיון״, אחרי שהוסף כקישור ל-Google Drive.</span>
          <div className="attach-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setPicker(true)} disabled={busy}>
              <Icon name="link" />
              בחירה מהארכיון
            </button>
            <label className={`btn btn--ghost ${busy ? 'is-disabled' : ''}`}>
              <input type="file" className="visually-hidden" multiple accept="image/*,audio/*,.heic,.m4a,.mp3,.wav" disabled={busy} onChange={(e) => { addNew(e.target.files); e.target.value = ''; }} />
              <Icon name="upload" />
              העלאת קובץ חדש
            </label>
          </div>
          {(linked.length > 0 || newFiles.length > 0) && (
            <ul className="attach-list">
              {linked.map((l) => (
                <li key={l.id}>
                  <ItemRowCard item={l}>
                    {!busy && (
                      <button type="button" className="icon-btn" onClick={() => setLinked((p) => p.filter((x) => x.id !== l.id))} aria-label={`הסרת ${l.title || 'פריט'}`}>
                        <Icon name="close" />
                      </button>
                    )}
                  </ItemRowCard>
                </li>
              ))}
              {newFiles.map((f) => (
                <li key={f.key} className="attach-new">
                  <Icon name={KIND_ICON[f.kind]} />
                  <span className="attach-new__name">{f.file.name}</span>
                  {busy ? <ProgressBar value={f.progress} /> : f.error ? <span className="pending__error">{f.error}</span> : <span className="meta__muted">יועלה בשמירה ({f.kind === 'photo' ? 'תמונה לסיפור' : KIND_LABELS[f.kind].singular})</span>}
                  {!busy && (
                    <button type="button" className="icon-btn" onClick={() => setNewFiles((p) => p.filter((x) => x.key !== f.key))} aria-label={`הסרת ${f.file.name}`}>
                      <Icon name="close" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <ErrorBox message={error} />}
        <div className="form__actions">
          <Link to="/c/story" className="btn btn--ghost">
            חזרה
          </Link>
          <button className="btn btn--primary btn--lg" disabled={busy}>
            {busy ? 'שומר…' : 'שמירה ופרסום'}
          </button>
        </div>
      </form>
      {picker && (
        <AttachPicker
          selected={linked.map((l) => l.id)}
          onClose={() => setPicker(false)}
          onPick={(item) => setLinked((p) => (p.some((x) => x.id === item.id) ? p.filter((x) => x.id !== item.id) : [...p, item]))}
        />
      )}
    </div>
  );
}

/** בחירת פריטים מהארכיון לצירוף לסיפור (הקלטות, סרטונים ומסמכים — תמונות הגלריה לא מצורפות לסיפורים) */
function AttachPicker({ selected, onPick, onClose }: { selected: string[]; onPick: (i: ItemSummary) => void; onClose: () => void }) {
  const [kind, setKind] = useState<ItemKind | ''>('');
  const list = useLoad(() => api.attachable(kind || undefined), [kind]);
  const sel = useMemo(() => new Set(selected), [selected]);
  return (
    <Modal title="בחירת פריטים לצירוף" onClose={onClose} wide>
      <div className="chips chips--tabs" role="tablist">
        {(['', 'audio', 'video', 'document'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={`chip ${kind === k ? 'is-active' : ''}`} onClick={() => setKind(k)}>
            {k ? KIND_LABELS[k].plural : 'הכול'}
          </button>
        ))}
      </div>
      {list.loading ? (
        <Spinner />
      ) : list.error ? (
        <ErrorBox message={list.error} onRetry={list.reload} />
      ) : !list.data?.length ? (
        <p className="muted-center">אין עדיין פריטים בארכיון לצירוף. אפשר להעלות קובץ חדש ישירות מטופס הסיפור.</p>
      ) : (
        <ul className="pick-list">
          {list.data.map((it) => (
            <li key={it.id}>
              <ItemRowCard item={it}>
                <button type="button" className={`btn btn--sm ${sel.has(it.id) ? 'btn--primary' : 'btn--ghost'}`} onClick={() => onPick(it)} aria-pressed={sel.has(it.id)}>
                  {sel.has(it.id) ? (<><Icon name="check" size={18} /> צורף</>) : 'צירוף'}
                </button>
              </ItemRowCard>
            </li>
          ))}
        </ul>
      )}
      <div className="form__actions">
        <button type="button" className="btn btn--primary" onClick={onClose}>
          סיום
        </button>
      </div>
    </Modal>
  );
}
