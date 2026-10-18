import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { useApp, useLoad, useToast } from '../../state';
import { ErrorBox, Field, Spinner } from '../../components/Common';
import { Icon } from '../../components/Icon';
import { formatDate } from '../../lib/media';

/** קישור שמוצג פעם אחת — עם העתקה ושיתוף */
function OneTimeLink({ url, text, onDone }: { url: string; text: string; onDone: () => void }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('הקישור הועתק');
    } catch {
      toast('לא ניתן להעתיק אוטומטית — סמנו והעתיקו ידנית', 'error');
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: 'סבא דודו', text, url });
    } catch {
      /* המשתמש ביטל */
    }
  };
  return (
    <div className="onetime" role="status">
      <p className="onetime__title">
        <Icon name="check" />
        הקישור נוצר. שלחו אותו לבן המשפחה (בוואטסאפ, SMS או מייל).
      </p>
      <p className="onetime__warn">מטעמי אבטחה הקישור מוצג פעם אחת בלבד וניתן לשימוש פעם אחת.</p>
      <input className="onetime__url" dir="ltr" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="הקישור" />
      <div className="form__actions">
        <button className="btn btn--primary" onClick={copy}>
          העתקת הקישור
        </button>
        {'share' in navigator && (
          <button className="btn btn--ghost" onClick={share}>
            שיתוף…
          </button>
        )}
        <button className="btn btn--text" onClick={onDone}>
          סגירה
        </button>
      </div>
    </div>
  );
}

export function InvitesSection() {
  const toast = useToast();
  const invites = useLoad(() => api.admin.invites(), []);
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [days, setDays] = useState(7);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.admin.createInvite({ role, email: email || undefined, note: note || undefined, days });
      setCreated(res.url);
      setEmail('');
      setNote('');
      invites.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    try {
      await api.admin.revokeInvite(id);
      toast('ההזמנה בוטלה');
      invites.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const status = (i: NonNullable<typeof invites.data>[number]) =>
    i.usedAt ? `נוצלה ע״י ${i.usedBy ?? '—'}` : i.revokedAt ? 'בוטלה' : i.expiresAt < Date.now() ? 'פג תוקף' : `בתוקף עד ${formatDate(i.expiresAt)}`;

  return (
    <div className="stack">
      {created ? (
        <OneTimeLink url={created} text="הוזמנת להצטרף לארכיון הזיכרונות המשפחתי של סבא דודו" onDone={() => setCreated(null)} />
      ) : (
        <form className="panel form" onSubmit={create}>
          <h2 className="panel__title">הזמנה חדשה</h2>
          <p className="muted">אין הרשמה ציבורית. כל בן משפחה מצטרף דרך קישור אישי וחד-פעמי.</p>
          <div className="field-row">
            <Field label="הרשאה">
              <select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
                <option value="member">בן/בת משפחה (צפייה והוספה)</option>
                <option value="admin">מנהל/ת מערכת (כולל מחיקה וניהול)</option>
              </select>
            </Field>
            <Field label="תוקף">
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={1}>יום אחד</option>
                <option value={3}>3 ימים</option>
                <option value={7}>שבוע</option>
                <option value={14}>שבועיים</option>
                <option value={30}>חודש</option>
              </select>
            </Field>
          </div>
          <Field label="דוא״ל (לא חובה)" hint="אם ימולא — רק כתובת זו תוכל להשתמש בקישור">
            <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="למי ההזמנה? (הערה לעצמך, לא חובה)">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="לדוגמה: הנכד יואב" />
          </Field>
          {error && <ErrorBox message={error} />}
          <div className="form__actions">
            <button className="btn btn--primary" disabled={busy}>
              <Icon name="link" />
              {busy ? 'יוצר…' : 'יצירת קישור הזמנה'}
            </button>
          </div>
        </form>
      )}

      <div className="panel">
        <h2 className="panel__title">הזמנות קודמות</h2>
        {invites.loading ? (
          <Spinner />
        ) : invites.error ? (
          <ErrorBox message={invites.error} onRetry={invites.reload} />
        ) : !invites.data?.length ? (
          <p className="muted">עוד לא נשלחו הזמנות.</p>
        ) : (
          <ul className="rows">
            {invites.data.map((i) => (
              <li key={i.id} className="rows__row">
                <div>
                  <strong>{i.note || i.email || 'הזמנה'}</strong>
                  <span className="muted"> · {i.role === 'admin' ? 'מנהל' : 'בן משפחה'} · {status(i)}</span>
                </div>
                {!i.usedAt && !i.revokedAt && i.expiresAt > Date.now() && (
                  <button className="btn btn--text btn--sm" onClick={() => revoke(i.id)}>
                    ביטול
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function UsersSection() {
  const { user: me } = useApp();
  const toast = useToast();
  const users = useLoad(() => api.admin.users(), []);
  const [resetUrl, setResetUrl] = useState<string | null>(null);

  const update = async (id: string, b: { role?: string; disabled?: boolean }, msg: string) => {
    try {
      await api.admin.updateUser(id, b);
      toast(msg);
      users.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const reset = async (id: string) => {
    try {
      setResetUrl((await api.admin.resetLink(id)).url);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (users.loading) return <Spinner />;
  if (users.error) return <ErrorBox message={users.error} onRetry={users.reload} />;
  return (
    <div className="stack">
      {resetUrl && <OneTimeLink url={resetUrl} text="קישור לבחירת סיסמה חדשה בארכיון של סבא דודו" onDone={() => setResetUrl(null)} />}
      <ul className="user-list">
        {users.data!.map((u) => (
          <li key={u.id} className={`panel user ${u.disabledAt ? 'is-disabled' : ''}`}>
            <div className="user__head">
              <span className="user__avatar" aria-hidden="true">{u.name.slice(0, 1)}</span>
              <div>
                <strong>{u.name}</strong> {u.id === me?.id && <span className="badge badge--soft">את/ה</span>}
                <p className="muted">
                  <bdi>{u.email}</bdi> · הצטרף/ה {formatDate(u.createdAt)}
                  {u.lastLoginAt && ` · כניסה אחרונה ${formatDate(u.lastLoginAt)}`}
                </p>
              </div>
            </div>
            <div className="user__actions">
              <label className="select select--sm">
                <span className="visually-hidden">הרשאה של {u.name}</span>
                <select value={u.role} onChange={(e) => update(u.id, { role: e.target.value }, 'ההרשאה עודכנה')}>
                  <option value="member">בן/בת משפחה</option>
                  <option value="admin">מנהל/ת</option>
                </select>
              </label>
              <button className="btn btn--ghost btn--sm" onClick={() => reset(u.id)}>
                קישור לאיפוס סיסמה
              </button>
              {u.id !== me?.id &&
                (u.disabledAt ? (
                  <button className="btn btn--ghost btn--sm" onClick={() => update(u.id, { disabled: false }, 'החשבון הופעל מחדש')}>
                    הפעלה מחדש
                  </button>
                ) : (
                  <button className="btn btn--danger-ghost btn--sm" onClick={() => window.confirm(`להשבית את החשבון של ${u.name}? התכנים שהעלה יישארו.`) && update(u.id, { disabled: true }, 'החשבון הושבת')}>
                    השבתה
                  </button>
                ))}
            </div>
            {u.disabledAt && <p className="muted">החשבון מושבת מאז {formatDate(u.disabledAt)}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
