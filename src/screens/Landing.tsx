import { useNavigate } from 'react-router';
import { fileUrl } from '../api/client';
import { useApp } from '../state';
import { Ornament } from '../components/Common';
import { HeroTraitsView } from '../components/HeroTraits';

/** מסך הפתיחה. התמונה והמאפיינים האישיים מוצגים רק לבני משפחה מחוברים — שום חומר משפחתי לא חשוף לציבור. */
export function Landing() {
  const { user, settings, status } = useApp();
  const navigate = useNavigate();
  const enter = () => navigate(user ? '/home' : status?.setupRequired ? '/setup' : '/login');
  const hasPhoto = Boolean(user && settings.heroFileId);

  return (
    <div className="landing">
      <div className="landing__bg" aria-hidden="true">
        <span className="landing__glow" />
        <svg className="landing__sprig landing__sprig--a" viewBox="0 0 120 240">
          <path d="M60 236C58 170 64 100 92 6" />
          {[30, 62, 94, 126, 158, 190].map((y, i) => (
            <g key={y}>
              <path d={`M${66 - i * 0.6} ${y + 20}c-18-4-30-14-34-28 14 0 28 10 34 28z`} />
              <path d={`M${70 - i * 0.6} ${y + 6}c16-8 30-8 40-2-10 10-26 10-40 2z`} />
            </g>
          ))}
        </svg>
        <svg className="landing__sprig landing__sprig--b" viewBox="0 0 120 240">
          <path d="M60 236C58 170 64 100 92 6" />
          {[40, 80, 120, 160].map((y) => (
            <g key={y}>
              <path d={`M64 ${y + 20}c-18-4-30-14-34-28 14 0 28 10 34 28z`} />
              <path d={`M68 ${y + 6}c16-8 30-8 40-2-10 10-26 10-40 2z`} />
            </g>
          ))}
        </svg>
      </div>

      <div className="landing__content">
        <p className="landing__eyebrow">{settings.subtitle || 'ארכיון הזיכרונות המשפחתי'}</p>
        <h1 className="landing__title">{settings.siteTitle}</h1>
        <Ornament />

        <figure className="frame">
          <span className="frame__corner frame__corner--tl" aria-hidden="true" />
          <span className="frame__corner frame__corner--tr" aria-hidden="true" />
          <span className="frame__corner frame__corner--bl" aria-hidden="true" />
          <span className="frame__corner frame__corner--br" aria-hidden="true" />
          <div className="frame__mat">
            {hasPhoto ? (
              <img className="frame__photo" src={fileUrl(settings.heroFileId!)} alt={`תמונה של ${settings.siteTitle}`} />
            ) : (
              <div className="frame__placeholder">
                <span className="frame__mono" aria-hidden="true">ד</span>
                <span className="frame__note">
                  {user ? 'כאן תופיע תמונתו של סבא דודו' : 'הזיכרונות שמורים לבני המשפחה'}
                </span>
              </div>
            )}
          </div>
        </figure>

        {user && <HeroTraitsView traits={settings.heroTraits} />}

        <button className="btn btn--primary btn--xl landing__cta" onClick={enter}>
          כניסה לזיכרונות
        </button>
        {!user && !status?.setupRequired && <p className="landing__private">אתר פרטי למשפחה בלבד · הכניסה בהזמנה</p>}
      </div>
    </div>
  );
}
