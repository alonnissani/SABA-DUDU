import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../api/client';
import { useApp, useToast } from '../../state';
import { ErrorBox, Field } from '../../components/Common';
import { Icon } from '../../components/Icon';

export function AccountSection() {
  const { user, refresh } = useApp();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.updateMe(name);
      await refresh();
      toast('השם עודכן');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('הסיסמאות החדשות אינן תואמות');
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      toast('הסיסמה הוחלפה. שאר המכשירים נותקו.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    await api.logout().catch(() => undefined);
    await refresh();
    navigate('/', { replace: true });
  };

  return (
    <div className="stack">
      <form className="panel form" onSubmit={saveName}>
        <h2 className="panel__title">פרטים אישיים</h2>
        <p className="muted">דוא״ל: <bdi>{user?.email}</bdi> · הרשאה: {user?.role === 'admin' ? 'מנהל/ת מערכת' : 'בן/בת משפחה'}</p>
        <Field label="השם שמוצג לבני המשפחה">
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="form__actions">
          <button className="btn btn--primary" disabled={!name.trim() || name === user?.name}>שמירת שם</button>
        </div>
      </form>

      <form className="panel form" onSubmit={savePassword}>
        <h2 className="panel__title">החלפת סיסמה</h2>
        <Field label="סיסמה נוכחית">
          <input type="password" dir="ltr" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="סיסמה חדשה" hint="לפחות 8 תווים">
          <input type="password" dir="ltr" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="אימות סיסמה חדשה">
          <input type="password" dir="ltr" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="form__actions">
          <button className="btn btn--primary" disabled={busy}>{busy ? 'שומר…' : 'החלפת סיסמה'}</button>
        </div>
      </form>

      <div className="panel">
        <h2 className="panel__title">התקנה בטלפון</h2>
        <p className="muted">
          אפשר להוסיף את האתר למסך הבית כמו אפליקציה: באייפון — כפתור השיתוף ← ״הוספה למסך הבית״. באנדרואיד — תפריט הדפדפן ← ״התקנת אפליקציה״ / ״הוספה למסך הבית״.
        </p>
      </div>

      <button className="btn btn--ghost btn--block" onClick={logout}>
        <Icon name="logout" />
        התנתקות
      </button>
    </div>
  );
}
