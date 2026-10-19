import { useState } from 'react';
import { formatBytes } from '../../../shared/constants';
import { api, fileUrl, uploadFile } from '../../api/client';
import { imageMeta } from '../../lib/media';
import { ensureWaveform } from '../../lib/waveform';
import { useLoad, useToast } from '../../state';
import { ErrorBox, ProgressBar, Spinner } from '../../components/Common';
import { Icon } from '../../components/Icon';

export function ExportSection() {
  return (
    <div className="stack">
      <div className="panel">
        <h2 className="panel__title">1. קובץ הנתונים (manifest)</h2>
        <p className="muted">
          קובץ JSON עם כל המידע: פריטים, כותרות, תיאורים, סיפורים, תגובות, תגיות, ומשתמשים — וקישור הורדה לכל קובץ מקור. מומלץ לשמור עותק מדי פעם.
        </p>
        <a className="btn btn--primary" href="/api/admin/export" download>
          <Icon name="download" />
          הורדת קובץ הנתונים
        </a>
      </div>
      <div className="panel">
        <h2 className="panel__title">2. כל קובצי המקור</h2>
        <p className="muted">
          הורדה מלאה של כל התמונות, הסרטונים, ההקלטות והמסמכים במקור מתבצעת במחשב, באמצעות סקריפט שמצורף לפרויקט (מתאים גם לארכיונים גדולים מאוד):
        </p>
        <pre className="code" dir="ltr">npm run export-archive -- --url https://YOUR-SITE --email you@example.com</pre>
        <p className="muted">הסקריפט ישאל את הסיסמה, ישמור את כל הקבצים בתיקייה <bdi>export/</bdi> לפי קטגוריות, ויכול להמשיך מאיפה שעצר.</p>
      </div>
      <div className="panel">
        <h2 className="panel__title">3. גיבוי בסיס הנתונים</h2>
        <pre className="code" dir="ltr">npx wrangler d1 export saba-dudu-db --remote --output backup.sql</pre>
      </div>
    </div>
  );
}

export function BackupsSection() {
  const toast = useToast();
  const status = useLoad(() => api.admin.backups(), []);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      const r = await api.admin.runBackup();
      toast(r.message, r.status === 'failed' ? 'error' : 'ok');
      status.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setRunning(false);
    }
  };
  if (status.loading) return <Spinner />;
  if (status.error) return <ErrorBox message={status.error} onRetry={status.reload} />;
  const s = status.data!;
  const pct = s.filesTotal ? s.filesBackedUp / s.filesTotal : 1;
  const STATUS: Record<string, string> = { ok: 'הצליח', partial: 'חלקי', failed: 'נכשל', running: 'רץ', skipped: 'דולג' };

  return (
    <div className="stack">
      <ul className="backup-list">
        <li className="panel backup backup--ok">
          <Icon name="check" />
          <div>
            <strong>קובצי המקור — אחסון קבוע ב-Cloudflare R2</strong>
            <p className="muted">כל קובץ נשמר באיכות המקורית, תחת שם ייחודי שלא נדרס. מחיקה היא ״רכה״ — הקבצים לא נמחקים פיזית. סה״כ {s.filesTotal} קבצים ({formatBytes(s.bytesTotal)}).</p>
          </div>
        </li>
        <li className="panel backup backup--ok">
          <Icon name="check" />
          <div>
            <strong>בסיס הנתונים — Time Travel של Cloudflare D1</strong>
            <p className="muted">
              מובנה ב-Cloudflare ופעיל אוטומטית: מאפשר לשחזר את בסיס הנתונים לכל נקודה בזמן ב-30 הימים האחרונים (7 ימים בתוכנית החינמית), באמצעות <bdi dir="ltr">wrangler d1 time-travel</bdi>.
            </p>
          </div>
        </li>
        <li className={`panel backup ${s.backupBucketConfigured ? (s.lastRun?.status === 'failed' ? 'backup--bad' : 'backup--ok') : 'backup--todo'}`}>
          <Icon name={s.backupBucketConfigured ? 'shield' : 'alert'} />
          <div>
            <strong>עותק גיבוי נפרד (bucket גיבוי + snapshot לילי)</strong>
            {s.backupBucketConfigured ? (
              <>
                <p className="muted">מוגדר ופעיל. כל לילה מועתקים קבצים חדשים ל-bucket הגיבוי ונשמר עותק של בסיס הנתונים.</p>
                <ProgressBar value={pct} label="קבצים מגובים" />
                <p className="small">
                  {s.filesBackedUp} מתוך {s.filesTotal} קבצים מגובים
                  {s.lastRun && ` · גיבוי אחרון: ${new Date(s.lastRun.startedAt).toLocaleString('he-IL')} (${STATUS[s.lastRun.status]})`}
                </p>
                {s.lastRun?.message && <p className="muted small">{s.lastRun.message}</p>}
                <button className="btn btn--primary btn--sm" onClick={run} disabled={running}>
                  {running ? 'מגבה…' : 'הרצת גיבוי עכשיו'}
                </button>
              </>
            ) : (
              <p className="muted">
                <strong>עדיין לא מוגדר — דורש הגדרה חד-פעמית ב-Cloudflare.</strong> יש ליצור bucket שני (<bdi dir="ltr">saba-dudu-backup</bdi>) ולהפעיל את השורה BACKUP בקובץ <bdi dir="ltr">wrangler.jsonc</bdi>. ההוראות המלאות ב-README. עד אז מומלץ לייצא את הארכיון מדי פעם (״ייצוא הארכיון״).
              </p>
            )}
          </div>
        </li>
        <li className="panel backup backup--todo">
          <Icon name="alert" />
          <div>
            <strong>עותק מחוץ ל-Cloudflare</strong>
            <p className="muted">לא ממומש אוטומטית. מומלץ להריץ מדי כמה חודשים את סקריפט הייצוא ולשמור את התיקייה בכונן חיצוני או בענן אחר.</p>
          </div>
        </li>
      </ul>
      {s.recentRuns.length > 0 && (
        <div className="panel">
          <h2 className="panel__title">היסטוריית גיבויים</h2>
          <ul className="rows">
            {s.recentRuns.map((r) => (
              <li key={r.id} className="rows__row">
                <span>{new Date(r.startedAt).toLocaleString('he-IL')}</span>
                <span className="muted small">
                  {STATUS[r.status]} · {r.filesCopied} קבצים · {formatBytes(r.bytesCopied)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * יצירת תמונות ממוזערות לתמונות שהועלו בלעדיהן (למשל תמונות ישנות או HEIC).
 * הממוזערת נוצרת בדפדפן של המנהל ונשמרת כקובץ נוסף — קובץ המקור לא משתנה ולא נמחק.
 */
export function ThumbsSection() {
  const toast = useToast();
  const missing = useLoad(() => api.admin.missingThumbs(), []);
  const [progress, setProgress] = useState<{ done: number; total: number; ok: number; failed: number } | null>(null);
  const running = progress !== null && progress.done < progress.total;

  const run = async () => {
    const list = missing.data ?? [];
    const state = { done: 0, total: list.length, ok: 0, failed: 0 };
    setProgress({ ...state });
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const m = list[next++];
        try {
          const res = await fetch(fileUrl(m.fileId), { credentials: 'same-origin' });
          if (!res.ok) throw new Error();
          const meta = await imageMeta(await res.blob());
          if (!meta.preview) throw new Error();
          const thumb = await uploadFile(meta.preview, {
            kind: 'photo', role: 'thumb', name: `preview.${meta.preview.type === 'image/webp' ? 'webp' : 'jpg'}`, mime: meta.preview.type,
          });
          await api.admin.attachThumb(m.itemId, { fileId: thumb.id, width: meta.width, height: meta.height });
          state.ok++;
        } catch {
          state.failed++;
        }
        state.done++;
        setProgress({ ...state });
      }
    };
    await Promise.all([worker(), worker()]);
    toast(state.failed ? `נוצרו ${state.ok} תמונות ממוזערות. ${state.failed} לא נוצרו — ראו הסבר למטה.` : `נוצרו ${state.ok} תמונות ממוזערות`);
    missing.reload();
  };

  return (
    <div className="stack">
      <div className="panel">
        <h2 className="panel__title">תמונות ממוזערות</h2>
        <p className="muted">
          הגלריה טוענת גרסה קטנה וקלה של כל תמונה (WebP), והמקור באיכות מלאה נטען רק כשפותחים תמונה. לתמונות חדשות זה קורה אוטומטית בהעלאה.
          כאן אפשר ליצור גרסה קטנה לתמונות שעדיין אין להן. התמונות המקוריות לא משתנות ולא נמחקות.
        </p>
        {missing.loading ? (
          <Spinner />
        ) : missing.error ? (
          <ErrorBox message={missing.error} onRetry={missing.reload} />
        ) : (
          <>
            <p className="small">
              {missing.data!.length ? `${missing.data!.length} תמונות עדיין בלי גרסה מוקטנת.` : 'לכל התמונות כבר יש גרסה מוקטנת ✓'}
            </p>
            {progress && (
              <>
                <ProgressBar value={progress.total ? progress.done / progress.total : 1} label="יצירת תמונות ממוזערות" />
                <p className="small">
                  {progress.done} / {progress.total} · נוצרו {progress.ok}
                  {progress.failed ? ` · לא נוצרו ${progress.failed}` : ''}
                </p>
              </>
            )}
            {missing.data!.length > 0 && (
              <button className="btn btn--primary" onClick={run} disabled={running}>
                {running ? 'יוצר…' : 'יצירת תמונות ממוזערות עכשיו'}
              </button>
            )}
            <p className="muted small">
              התהליך רץ בדפדפן הזה — יש להשאיר את הדף פתוח עד הסיום. תמונות HEIC (מאייפון) ניתנות להמרה רק מספארי; אם חלק לא נוצרו, נסו שוב מאייפון או ממק.
            </p>
          </>
        )}
      </div>
      <WaveformsPanel />
    </div>
  );
}

/** גלי קול להקלטות קיימות — מחושבים בדפדפן מהקובץ ונשמרים (ההקלטות עצמן לא משתנות) */
function WaveformsPanel() {
  const toast = useToast();
  const missing = useLoad(() => api.admin.missingWaveforms(), []);
  const [progress, setProgress] = useState<{ done: number; total: number; ok: number; failed: number } | null>(null);
  const running = progress !== null && progress.done < progress.total;

  const run = async () => {
    const list = missing.data ?? [];
    const state = { done: 0, total: list.length, ok: 0, failed: 0 };
    setProgress({ ...state });
    // אחת אחרי השנייה — פענוח הקלטה תופס זיכרון
    for (const m of list) {
      const peaks = await ensureWaveform(m.itemId, fileUrl(m.fileId), m.size);
      if (peaks) state.ok++;
      else state.failed++;
      state.done++;
      setProgress({ ...state });
    }
    toast(state.failed ? `נוצרו ${state.ok} גלי קול. ${state.failed} לא נוצרו (פורמט שהדפדפן לא מפענח, או קובץ גדול מאוד).` : `נוצרו ${state.ok} גלי קול`);
    missing.reload();
  };

  return (
    <div className="panel">
      <h2 className="panel__title">גלי קול להקלטות</h2>
      <p className="muted">
        בנגן ההקלטות מוצג גל הקול של כל הקלטה. להקלטות חדשות הוא נוצר בהעלאה, ולהקלטות ישנות — בהשמעה הראשונה. כאן אפשר ליצור אותו לכולן מראש. ההקלטות עצמן לא משתנות.
      </p>
      {missing.loading ? (
        <Spinner />
      ) : missing.error ? (
        <ErrorBox message={missing.error} onRetry={missing.reload} />
      ) : (
        <>
          <p className="small">{missing.data!.length ? `${missing.data!.length} הקלטות עדיין בלי גל קול.` : 'לכל ההקלטות כבר יש גל קול ✓'}</p>
          {progress && (
            <>
              <ProgressBar value={progress.total ? progress.done / progress.total : 1} label="יצירת גלי קול" />
              <p className="small">
                {progress.done} / {progress.total} · נוצרו {progress.ok}
                {progress.failed ? ` · לא נוצרו ${progress.failed}` : ''}
              </p>
            </>
          )}
          {missing.data!.length > 0 && (
            <button className="btn btn--primary" onClick={run} disabled={running}>
              {running ? 'יוצר…' : 'יצירת גלי קול עכשיו'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
