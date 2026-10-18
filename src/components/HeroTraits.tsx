import type { HeroTraits } from '../../shared/types';
import { Icon } from './Icon';

/**
 * מאפיינים אישיים של סבא במסך הפתיחה: משפטים שהיה אומר, סמלים וחפצים, ופרטים אישיים.
 * המנהל ממלא אותם בהגדרות; כל עוד הם ריקים — לא מוצג דבר.
 */
export function HeroTraitsView({ traits }: { traits: HeroTraits }) {
  const { quotes, symbols, details } = traits;
  if (!quotes.length && !symbols.length && !details.length) return null;
  return (
    <section className="traits" aria-label="מאפיינים אישיים">
      {quotes.length > 0 && (
        <div className="traits__quotes">
          {quotes.map((q, i) => (
            <blockquote key={i} className="traits__quote" style={{ animationDelay: `${0.9 + i * 0.15}s` }}>
              <Icon name="quote" size={18} />
              <p>{q}</p>
            </blockquote>
          ))}
        </div>
      )}
      {symbols.length > 0 && (
        <ul className="traits__symbols">
          {symbols.map((s, i) => (
            <li key={i}>
              {s.icon && <span className="traits__icon" aria-hidden="true">{s.icon}</span>}
              <span>{s.label}</span>
            </li>
          ))}
        </ul>
      )}
      {details.length > 0 && (
        <dl className="traits__details">
          {details.map((d, i) => (
            <div key={i}>
              <dt>{d.label}</dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
