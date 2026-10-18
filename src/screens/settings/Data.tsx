import { useState } from 'react';
import { formatBytes } from '../../../shared/constants';
import { api } from '../../api/client';
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
