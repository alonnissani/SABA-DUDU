import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { useApp } from '../state';
import { ErrorBox, Field, Ornament, Spinner } from '../components/Common';

function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { settings } = useApp();
  return (
    <div className="auth">
      <div className="auth__card">
        <Link to="/" className="auth__brand">
          <span className="auth__mono" aria-hidden="true">ד</span>
          <span>{settings.siteTitle}</span>
        </Link>
        <Ornament />
        <h1 className="auth__title">{title}</h1>
        {subtitle && <p className="auth__sub">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

function useSubmit(fn: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

export function LoginScreen() {
  const { user, refresh, status } = useApp();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const next = params.get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/home';
  const { busy, error, submit } = useSubmit(async () => {
    await api.login(email, password);
    await refresh();
    navigate(target, { replace: true });
  });
  if (status?.setupRequired) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to={target} replace />;
  return (
    <AuthLayout title="כניסה לבני המשפחה" subtitle="הזינו את הדוא״ל והסיסמה שבחרתם בהצטרפות">
      <form className="form" onSubmit={submit}>
        <Field label="דוא״ל">
          <input type="email" autoComplete="email" inputMode="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="סיסמה">
          <input type="password" autoComplete="current-password" dir="ltr" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <button className="btn btn--primary btn--block" disabled={busy}>
          {busy ? 'נכנסים…' : 'כניסה'}
        </button>
      </form>
      <p className="auth__foot">אין לכם חשבון? בקשו קישור הזמנה ממנהל האתר במשפחה. שכחתם סיסמה? המנהל יכול לשלוח לכם קישור לאיפוס.</p>
    </AuthLayout>
  );
}

function PasswordFields({ password, setPassword, confirm, setConfirm }: { password: string; setPassword: (v: string) => void; confirm: string; setConfirm: (v: string) => void }) {
  return (
    <>
      <Field label="סיסמה" hint="לפחות 8 תווים">
        <input type="password" autoComplete="new-password" dir="ltr" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="אימות סיסמה">
        <input type="password" autoComplete="new-password" dir="ltr" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
    </>
  );
}

function checkMatch(password: string, confirm: string) {
  if (password !== confirm) throw new Error('הסיסמאות אינן תואמות');
}

/** הקמת המערכת ויצירת המנהל הראשון — פעם אחת בלבד, עם קוד ההקמה (SETUP_TOKEN). */
export function SetupScreen() {
  const { status, user, refresh } = useApp();
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { busy, error, submit } = useSubmit(async () => {
    checkMatch(password, confirm);
    await api.setup({ token, name, email, password });
    await refresh();
    navigate('/settings/hero', { replace: true });
  });
  // אחרי ההקמה — ישר לבחירת התמונה הראשית
  if (!status?.setupRequired) return <Navigate to={user ? '/settings/hero' : '/'} replace />;
  return (
    <AuthLayout title="הקמת הארכיון" subtitle="יצירת חשבון מנהל המערכת הראשון. קוד ההקמה הוגדר כסוד בשרת (SETUP_TOKEN).">
      <form className="form" onSubmit={submit}>
        <Field label="קוד הקמה">
          <input type="password" dir="ltr" required value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="השם שלך">
          <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="דוא״ל">
          <input type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Field>
        <PasswordFields password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} />
        {error && <ErrorBox message={error} />}
        <button className="btn btn--primary btn--block" disabled={busy}>
          {busy ? 'יוצרים…' : 'יצירת חשבון מנהל'}
        </button>
      </form>
    </AuthLayout>
  );
}

export function InviteScreen() {
  const { token = '' } = useParams();
  const { user, refresh } = useApp();
  const navigate = useNavigate();
  const [check, setCheck] = useState<{ ok: boolean; email: string | null; error?: string } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    api.checkInvite(token)
      .then((r) => {
        setCheck({ ok: true, email: r.email });
        if (r.email) setEmail(r.email);
      })
      .catch((e: Error) => setCheck({ ok: false, email: null, error: e.message }));
  }, [token]);
  const { busy, error, submit } = useSubmit(async () => {
    checkMatch(password, confirm);
    await api.acceptInvite({ token, name, email, password });
    await refresh();
    navigate('/home', { replace: true });
  });
  if (user) return <Navigate to="/home" replace />;
  return (
    <AuthLayout title="ברוכים הבאים למשפחה" subtitle="הוזמנתם להצטרף לארכיון הזיכרונות. בחרו שם וסיסמה.">
      {!check ? (
        <Spinner />
      ) : !check.ok ? (
        <ErrorBox message={check.error ?? 'הקישור אינו תקין'} />
      ) : (
        <form className="form" onSubmit={submit}>
          <Field label="השם שיוצג לבני המשפחה" hint="לדוגמה: נכדה מיכל, דודה רותי">
            <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <Field label="דוא״ל">
            <input type="email" dir="ltr" required value={email} readOnly={Boolean(check.email)} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <PasswordFields password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} />
          {error && <ErrorBox message={error} />}
          <button className="btn btn--primary btn--block" disabled={busy}>
            {busy ? 'מצטרפים…' : 'הצטרפות'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetScreen() {
  const { token = '' } = useParams();
  const { refresh } = useApp();
  const navigate = useNavigate();
  const [check, setCheck] = useState<{ ok: boolean; name?: string; error?: string } | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    api.checkReset(token)
      .then((r) => setCheck({ ok: true, name: r.name }))
      .catch((e: Error) => setCheck({ ok: false, error: e.message }));
  }, [token]);
  const { busy, error, submit } = useSubmit(async () => {
    checkMatch(password, confirm);
    await api.reset(token, password);
    await refresh();
    navigate('/home', { replace: true });
  });
  return (
    <AuthLayout title="בחירת סיסמה חדשה" subtitle={check?.name ? `שלום ${check.name}` : undefined}>
      {!check ? (
        <Spinner />
      ) : !check.ok ? (
        <ErrorBox message={check.error ?? 'הקישור אינו תקין'} />
      ) : (
        <form className="form" onSubmit={submit}>
          <PasswordFields password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} />
          {error && <ErrorBox message={error} />}
          <button className="btn btn--primary btn--block" disabled={busy}>
            {busy ? 'שומרים…' : 'שמירת סיסמה'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
