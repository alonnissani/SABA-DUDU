import { Link, NavLink, Navigate, useParams } from 'react-router';
import { useApp } from '../../state';
import { Icon, type IconName } from '../../components/Icon';
import { PageHeader } from '../../components/Common';
import { AccountSection } from './Account';
import { UsersSection, InvitesSection } from './People';
import { ContentSection, TagsSection, ActivitySection } from './Content';
import { HeroSection, SiteSection } from './Site';
import { BackupsSection, ExportSection, ThumbsSection } from './Data';

interface Section {
  path: string;
  label: string;
  icon: IconName;
  admin?: boolean;
  el: () => React.ReactElement;
}

const SECTIONS: Section[] = [
  { path: 'account', label: 'החשבון שלי', icon: 'user', el: () => <AccountSection /> },
  { path: 'invites', label: 'הזמנת בני משפחה', icon: 'link', admin: true, el: () => <InvitesSection /> },
  { path: 'users', label: 'ניהול משתמשים', icon: 'users', admin: true, el: () => <UsersSection /> },
  { path: 'content', label: 'ניהול תכנים ומחיקה', icon: 'archive', admin: true, el: () => <ContentSection /> },
  { path: 'hero', label: 'התמונה הראשית', icon: 'image', admin: true, el: () => <HeroSection /> },
  { path: 'site', label: 'שם האתר ומסך הפתיחה', icon: 'edit', admin: true, el: () => <SiteSection /> },
  { path: 'thumbs', label: 'מהירות הגלריה', icon: 'photo', admin: true, el: () => <ThumbsSection /> },
  { path: 'tags', label: 'תגיות', icon: 'tag', admin: true, el: () => <TagsSection /> },
  { path: 'export', label: 'ייצוא הארכיון', icon: 'download', admin: true, el: () => <ExportSection /> },
  { path: 'backups', label: 'מצב גיבויים', icon: 'shield', admin: true, el: () => <BackupsSection /> },
  { path: 'activity', label: 'יומן פעולות', icon: 'story', admin: true, el: () => <ActivitySection /> },
];

export function SettingsScreen() {
  const { isAdmin } = useApp();
  const { '*': sub = '' } = useParams();
  const visible = SECTIONS.filter((s) => !s.admin || isAdmin);
  const current = visible.find((s) => s.path === sub);
  if (sub && !current) return <Navigate to="/settings" replace />;

  return (
    <div className={`settings ${current ? 'settings--section' : 'settings--index'}`}>
      <aside className="settings__menu">
        <PageHeader title="הגדרות" icon="settings" subtitle={isAdmin ? 'מנהל/ת מערכת' : undefined} />
        <nav aria-label="הגדרות">
          <ul>
            {visible.map((s) => (
              <li key={s.path}>
                <NavLink to={`/settings/${s.path}`} className="settings__link">
                  <Icon name={s.icon} />
                  <span>{s.label}</span>
                  <Icon name="chevronLeft" size={18} className="settings__chev" />
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <section className="settings__content">
        {current ? (
          <>
            <Link to="/settings" className="settings__back">
              <Icon name="chevronRight" size={18} />
              כל ההגדרות
            </Link>
            <h1 className="settings__title">
              <Icon name={current.icon} />
              {current.label}
            </h1>
            {current.el()}
          </>
        ) : (
          <div className="settings__placeholder">
            <Icon name="settings" size={36} />
            <p>בחרו נושא מהרשימה</p>
          </div>
        )}
      </section>
    </div>
  );
}
