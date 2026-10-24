import { useEffect, useState, type FormEvent } from 'react';
import type { DriveStatus } from '../../../shared/types';
import { parseDriveFolder } from '../../../shared/drive';
import { api, type CleanupReport, type DriveSyncResult } from '../../api/client';
import { formatBytes } from '../../../shared/constants';
import { useApp, useLoad, useToast } from '../../state';
import { ErrorBox, Field, Spinner } from '../../components/Common';
import { Icon } from '../../components/Icon';

const when = (t: number | null) => (t ? new Date(t).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/**
 * חיבור Google Drive (מנהל בלבד): קישור לתיקייה המשפחתית, סנכרון ידני ומצב החיבור.
 * התמונות נשארות בדרייב — באתר נשמרים רק המזהים, והסנכרון האוטומטי רץ פעם בשעה.
 */
export function DriveSection() {
  const toast = useToast();
  const { refreshSettings } = useApp();
  const status = useLoad(() => api.admin.drive(), []);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<'connect' | 'sync' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<DriveSyncResult | null>(null);
  const [s, setS] = useState<DriveStatus | null>(null);

  useEffect(() => {
    if (status.data) {
      setS(status.data);
      setUrl((u) => u || status.data!.folder?.url || '');
    }
  }, [status.data]);

  /** אחרי חיבור/סנכרון: אם נשארו תמונות ממתינות (תיקייה גדולה) — ממשיכים אוטומטית */
  const finish = async (res: { sync: DriveSyncResult; status: DriveStatus }) => {
    let r = res;
    setS(r.status);
    setLast(r.sync);
    for (let i = 0; i < 50 && r.sync.ok && r.sync.pending > 0; i++) {
      r = await api.admin.syncDrive();
      setS(r.status);
      setLast(r.sync);
    }
    toast(r.sync.message, r.sync.ok ? undefined : 'error');
    await refreshSettings();
  };

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!parseDriveFolder(url)) {
      setError('הקישור אינו קישור לתיקייה ב-Google Drive. העתיקו את קישור השיתוף של התיקייה (drive.google.com/drive/folders/…).');
      return;
    }
    setBusy('connect');
    try {
      await finish(await api.admin.connectDrive(url.trim()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setError(null);
    setBusy('sync');
    try {
      await finish(await api.admin.syncDrive());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (status.loading && !s) return <Spinner />;
  if (status.error && !s) return <ErrorBox message={status.error} onRetry={status.reload} />;
  if (!s) return null;

  const state = !s.folder ? 'disconnected' : s.state;
  const LABEL = { disconnected: 'לא מחובר', ok: 'מחובר', error: 'שגיאת חיבור' } as const;
  const changed = s.folder && url.trim() && url.trim() !== s.folder.url;

  return (
    <div className="stack">
      <div className={`panel backup ${state === 'ok' ? 'backup--ok' : state === 'error' ? 'backup--bad' : 'backup--todo'}`} role="status">
        <Icon name={state === 'ok' ? 'check' : 'alert'} />
        <div>
          <strong className="drive-state">מצב החיבור: {LABEL[state]}</strong>
          {s.folder && (
            <p className="muted small">
              תיקייה: <a href={s.folder.url} target="_blank" rel="noopener noreferrer">{s.folder.name}</a>
            </p>
          )}
          <dl className="drive-facts">
            <div>
              <dt>תמונות שזוהו</dt>
              <dd data-testid="drive-count">{s.photoCount.toLocaleString('he-IL')}</dd>
            </div>
            <div>
              <dt>סנכרון אחרון</dt>
              <dd>{when(s.lastSyncAt)}</dd>
            </div>
            {s.pending > 0 && (
              <div>
                <dt>ממתינות להוספה</dt>
                <dd>{s.pending.toLocaleString('he-IL')}</dd>
              </div>
            )}
          </dl>
          {state === 'error' && s.lastError && <p className="drive-error">{s.lastError} (ניסיון אחרון: {when(s.lastAttemptAt)}). התמונות שכבר מוצגות באתר לא נמחקו.</p>}
          {s.folder && (
            <button type="button" className="btn btn--primary btn--sm" onClick={sync} disabled={busy !== null || !s.apiKeyConfigured}>
              <Icon name="shuffle" size={18} />
              {busy === 'sync' ? 'מסנכרן…' : 'סנכרן עכשיו'}
            </button>
          )}
        </div>
      </div>

      {!s.apiKeyConfigured && (
        <div className="panel backup backup--todo">
          <Icon name="alert" />
          <div>
            <strong>נדרש מפתח Google API</strong>
            <p className="muted small">
              כדי לקרוא את רשימת התמונות מהתיקייה, Google מחייבת מפתח API (גם לתיקייה ציבורית). המפתח נשמר כסוד בשרת בלבד ואינו נחשף בדפדפן.
              יש ליצור מפתח ב-Google Cloud (עם Google Drive API מופעל) ולהוסיף אותו ב-Cloudflare כסוד בשם <code>GOOGLE_DRIVE_API_KEY</code>.
            </p>
          </div>
        </div>
      )}

      <form className="panel form" onSubmit={connect}>
        <h2 className="panel__title">{s.folder ? 'החלפת תיקייה' : 'חיבור תיקייה'}</h2>
        <Field
          label="קישור לתיקיית Google Drive"
          hint="בדרייב: לחצו על התיקייה ← שיתוף ← העתקת קישור. התיקייה צריכה להיות משותפת עם ״כל מי שיש לו את הקישור״ (צפייה)."
        >
          <input type="url" dir="ltr" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" />
        </Field>
        {error && <ErrorBox message={error} />}
        {last && <p className={last.ok ? 'drive-msg' : 'drive-error'}>{last.message}</p>}
        <div className="form__actions">
          <button className="btn btn--primary" disabled={busy !== null || !s.apiKeyConfigured || (Boolean(s.folder) && !changed)}>
            <Icon name="link" size={18} />
            {busy === 'connect' ? 'מתחבר ומסנכרן…' : 'חיבור תיקייה'}
          </button>
        </div>
        <p className="muted small">
          החיבור נשמר באופן קבוע. האתר מסתנכרן לבד פעם בשעה: תמונות חדשות מתווספות, ותמונות שהוסרו מהדרייב מוסתרות מהאתר (בלי למחוק דבר בדרייב).
          התמונות לא מועתקות לאחסון של האתר. גלריית התמונות ו״זיכרון מסבא״ מציגים רק את תמונות התיקייה; תמונות של סיפורים נשמרות בנפרד, עם הסיפור.
        </p>
      </form>
      {s.folder && <GalleryMigration onDone={status.reload} />}
    </div>
  );
}

/**
 * מעבר וניקוי הגלריה הישנה: דוח ← הפרדת תמונות הסיפורים (עותקים עצמאיים) ← מחיקת התמונות הישנות מ-R2.
 * שום דבר לא נמחק מ-Google Drive, ותמונות של סיפורים לעולם לא נמחקות כאן.
 */
function GalleryMigration({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const report = useLoad(() => api.admin.migration(), []);
  const [r, setR] = useState<CleanupReport | null>(null);
  const [busy, setBusy] = useState<'separate' | 'cleanup' | null>(null);
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (report.data) setR(report.data);
  }, [report.data]);

  const separate = async () => {
    setBusy('separate');
    setError(null);
    try {
      let copied = 0;
      let failed = 0;
      for (let i = 0; i < 200; i++) {
        const res = await api.admin.separateStories();
        copied += res.result.copied;
        failed += res.result.failed;
        setR(res.report);
        if (res.result.remaining === 0 || res.result.copied === 0) break;
      }
      setMsg(`הופרדו ${copied} תמונות של סיפורים${failed ? ` (${failed} לא הופרדו — הן נשארות ולא יימחקו)` : ''}. בדקו שהסיפורים מציגים את התמונות.`);
      toast('תמונות הסיפורים הופרדו מהגלריה');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const cleanup = async () => {
    setBusy('cleanup');
    setError(null);
    try {
      let items = 0;
      let files = 0;
      let bytes = 0;
      let integrity: Awaited<ReturnType<typeof api.admin.cleanupLegacy>>['integrity'] = null;
      for (let i = 0; i < 500; i++) {
        const res = await api.admin.cleanupLegacy();
        items += res.result.items;
        files += res.result.files;
        bytes += res.result.bytes;
        setR(res.report);
        integrity = res.integrity;
        if (res.result.remaining === 0 || res.result.items === 0) break;
      }
      setMsg(
        `נמחקו ${items} תמונות ישנות (${files} קבצים, ${formatBytes(bytes)}) מאחסון האתר.` +
          (integrity ? ` בדיקת שלמות: ${integrity.storyImagesChecked} קבצי סיפורים נבדקו, ${integrity.missingStoryFiles} חסרים, ${integrity.brokenLinks} הפניות שבורות.` : ''),
      );
      setConfirm('');
      toast('הניקוי הסתיים');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!r) return report.error ? <ErrorBox message={report.error} onRetry={report.reload} /> : <Spinner />;
  const canSeparate = r.storyLinkedPhotos > 0;
  const canCleanup = r.blockers.length === 0 && r.legacy.photos > 0;

  return (
    <div className="panel stack migration">
      <h2 className="panel__title">מעבר וניקוי הגלריה הישנה</h2>
      <dl className="drive-facts">
        <div><dt>תמונות בגלריה החדשה (Drive)</dt><dd data-testid="mig-drive">{r.drive.photos}</dd></div>
        <div><dt>תמונות ישנות באחסון האתר</dt><dd data-testid="mig-legacy">{r.legacy.photos}</dd></div>
        <div><dt>נפח האחסון הישן</dt><dd>{formatBytes(r.legacy.bytes)}</dd></div>
        <div><dt>מצורפות לסיפורים</dt><dd data-testid="mig-linked">{r.storyLinkedPhotos}</dd></div>
        <div><dt>תמונות של סיפורים (נפרדות)</dt><dd>{r.storyImages}</dd></div>
        {r.deleted.items > 0 && <div><dt>נמחקו עד כה</dt><dd data-testid="mig-deleted">{r.deleted.items} ({formatBytes(r.deleted.bytes)})</dd></div>}
      </dl>
      {r.heroProtected && <p className="muted small">התמונה הראשית של האתר שמורה ולא תימחק.</p>}

      <div className="migration__step">
        <strong>1. הפרדת תמונות הסיפורים</strong>
        <p className="muted small">לכל תמונה מהגלריה שמצורפת לסיפור נוצר עותק עצמאי של הסיפור. העותק נבדק, ורק אז הקישור לגלריה מוסר.</p>
        <button type="button" className="btn btn--ghost btn--sm" onClick={separate} disabled={busy !== null || !canSeparate}>
          {busy === 'separate' ? 'מפריד…' : canSeparate ? `הפרדת ${r.storyLinkedPhotos} תמונות של סיפורים` : 'אין תמונות להפרדה ✓'}
        </button>
      </div>

      <div className="migration__step">
        <strong>2. מחיקת התמונות הישנות מאחסון האתר</strong>
        <p className="muted small">
          נמחקות רק תמונות גלריה שהועלו לאתר בעבר (כולל תגובות ותגיות שעליהן). לא נמחק שום דבר מ-Google Drive, ולא תמונות של סיפורים, מסמכים, סרטונים או הקלטות.
        </p>
        {r.blockers.length > 0 && (
          <ul className="drive-error small">
            {r.blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        )}
        {canCleanup && (
          <Field label="לאישור הקלידו: מחיקה">
            <input value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        )}
        <button type="button" className="btn btn--danger-ghost btn--sm" onClick={cleanup} disabled={busy !== null || !canCleanup || confirm.trim() !== 'מחיקה'}>
          <Icon name="trash" size={18} />
          {busy === 'cleanup' ? 'מוחק…' : r.legacy.photos > 0 ? `מחיקת ${r.legacy.photos} תמונות ישנות (${formatBytes(r.legacy.bytes)})` : 'אין תמונות ישנות ✓'}
        </button>
      </div>
      {msg && <p className="drive-msg" data-testid="mig-msg">{msg}</p>}
      {error && <ErrorBox message={error} />}
    </div>
  );
}
