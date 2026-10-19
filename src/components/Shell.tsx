import { NavLink, Outlet, Link, useLocation } from 'react-router';
import { useEffect } from 'react';
import { ITEM_KINDS, KIND_LABELS } from '../../shared/constants';
import { fileUrl } from '../api/client';
import { useApp } from '../state';
import { Icon, KIND_ICON } from './Icon';

export function HeroAvatar({ size = 44 }: { size?: number }) {
  const { settings } = useApp();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {settings.heroFileId ? <img src={fileUrl(settings.heroFileId)} alt="" /> : <span className="avatar__mono">ד</span>}
    </span>
  );
}

/** מסגרת האפליקציה: כותרת עליונה + חמש הלשוניות (תחתונות בטלפון, עליונות במחשב). */
export function Shell() {
  const { settings } = useApp();
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        דילוג לתוכן
      </a>
      <header className="topbar">
        <div className="topbar__inner">
          <Link to="/home" className="topbar__brand" aria-label={`${settings.siteTitle} — מסך הבית`}>
            <HeroAvatar size={42} />
            <span className="topbar__title">{settings.siteTitle}</span>
          </Link>
          <nav className="topbar__actions" aria-label="פעולות">
            <NavLink to="/search" className="icon-btn icon-btn--labeled">
              <Icon name="search" />
              <span>חיפוש</span>
            </NavLink>
            <NavLink to="/settings" className="icon-btn icon-btn--labeled">
              <Icon name="settings" />
              <span>הגדרות</span>
            </NavLink>
          </nav>
        </div>
        <nav className="tabs tabs--top" aria-label="קטגוריות">
          {ITEM_KINDS.map((k) => (
            <NavLink key={k} to={`/c/${k}`} className="tabs__tab">
              <Icon name={KIND_ICON[k]} />
              <span>{KIND_LABELS[k].plural}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <main id="main" className="main">
        <Outlet />
      </main>
      <nav className="tabs tabs--bottom" aria-label="ניווט ראשי">
        <NavLink to="/home" end className="tabs__tab">
          <Icon name="home" size={24} />
          <span>בית</span>
        </NavLink>
        {ITEM_KINDS.map((k) => (
          <NavLink key={k} to={`/c/${k}`} className="tabs__tab">
            <Icon name={KIND_ICON[k]} size={24} />
            <span>{KIND_LABELS[k].plural}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
