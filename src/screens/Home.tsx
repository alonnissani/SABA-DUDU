import { Link } from 'react-router';
import { ITEM_KINDS, KIND_LABELS } from '../../shared/constants';
import { useApp } from '../state';
import { RandomMemory } from '../components/RandomMemory';
import { Icon, KIND_ICON } from '../components/Icon';
import { HeroAvatar } from '../components/Shell';

const KIND_BLURB = {
  photo: 'אלבום התמונות המשפחתי',
  video: 'רגעים מצולמים',
  audio: 'הקול של סבא',
  story: 'זיכרונות, בדיחות ומשפטים',
  document: 'מכתבים, תעודות וגלויות',
} as const;

export function HomeScreen() {
  const { settings, user } = useApp();
  return (
    <div className="home">
      <section className="home__hello">
        <HeroAvatar size={72} />
        <div>
          <h1 className="home__title">{settings.siteTitle}</h1>
          <p className="home__sub">שלום {user?.name}, טוב שבאת להיזכר.</p>
        </div>
        <Link to="/search" className="home__search">
          <Icon name="search" />
          <span>חיפוש בכל הזיכרונות…</span>
        </Link>
      </section>

      <RandomMemory />

      <section aria-labelledby="cats-title">
        <h2 id="cats-title" className="section-title">
          הארכיון
        </h2>
        <ul className="cats">
          {ITEM_KINDS.map((k, i) => (
            <li key={k} style={{ animationDelay: `${i * 60}ms` }}>
              <Link to={`/c/${k}`} className={`cat cat--${k}`}>
                <span className="cat__icon">
                  <Icon name={KIND_ICON[k]} size={30} />
                </span>
                <span className="cat__name">{KIND_LABELS[k].plural}</span>
                <span className="cat__blurb">{KIND_BLURB[k]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
