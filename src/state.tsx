import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AuthStatus, CurrentUser, SiteSettings } from '../shared/types';
import { DEFAULT_SITE_TITLE, DEFAULT_SUBTITLE } from '../shared/constants';
import { api } from './api/client';

interface AppState {
  status: AuthStatus | null;
  user: CurrentUser | null;
  isAdmin: boolean;
  settings: SiteSettings;
  refresh: () => Promise<void>;
  refreshSettings: () => Promise<void>;
}

const EMPTY_SETTINGS: SiteSettings = {
  siteTitle: DEFAULT_SITE_TITLE,
  subtitle: DEFAULT_SUBTITLE,
  heroFileId: null,
  heroTraits: { quotes: [], symbols: [], details: [] },
  homePhotos: [],
};

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [settings, setSettings] = useState<SiteSettings>(EMPTY_SETTINGS);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshSettings = useCallback(async () => {
    try {
      setSettings(await api.settings());
    } catch {
      /* לא מחובר */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await api.status();
      // ההגדרות נטענות לפני הצגת האפליקציה, כדי שטפסים לא ייפתחו עם ערכים ריקים
      if (s.user) await refreshSettings();
      else setSettings({ ...EMPTY_SETTINGS, siteTitle: s.siteTitle });
      setStatus(s);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [refreshSettings]);

  useEffect(() => {
    refresh();
    const onUnauthorized = () => refresh();
    window.addEventListener('saba:unauthorized', onUnauthorized);
    return () => window.removeEventListener('saba:unauthorized', onUnauthorized);
  }, [refresh]);

  useEffect(() => {
    document.title = settings.siteTitle;
  }, [settings.siteTitle]);

  const value = useMemo<AppState>(
    () => ({ status, user: status?.user ?? null, isAdmin: status?.user?.role === 'admin', settings, refresh, refreshSettings }),
    [status, settings, refresh, refreshSettings],
  );

  if (!status) {
    return (
      <div className="boot" role="status">
        {loadError ? (
          <div className="boot__error">
            <p>{loadError}</p>
            <button className="btn btn--primary" onClick={refresh}>נסו שוב</button>
          </div>
        ) : (
          <span className="boot__mark" aria-label="טוען">ד</span>
        )}
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

// ---------------- הודעות (toasts) ----------------

interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
}

const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ---------------- טעינת נתונים ----------------

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loader()
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}
