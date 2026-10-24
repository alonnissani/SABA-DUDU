import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import type { ItemSummary } from '../../shared/types';
import { KIND_LABELS, STORY_TYPE_LABEL } from '../../shared/constants';
import { accessibleTitle, displayTitle, formatDate, formatDuration, itemDateLabel, originalOf, previewUrl } from '../lib/media';
import { SafeImg } from './Common';
import { Icon, KIND_ICON } from './Icon';
import { AudioPlayer } from './AudioPlayer';
import { fileUrl } from '../api/client';

/** תאריך ההעלאה (פרט מערכת) לא מוצג בסיפורים, בהקלטות ובמסמכים — רק התאריך שהוא חלק מהתוכן */
const HIDE_UPLOAD_DATE: ItemSummary['kind'][] = ['story', 'audio', 'document'];

export function ItemMeta({ item, showKind }: { item: ItemSummary; showKind?: boolean }) {
  const date = itemDateLabel(item);
  return (
    <p className="meta">
      {showKind && <span className="meta__kind">{KIND_LABELS[item.kind].singular}</span>}
      {date && (
        <span className="meta__date">
          <Icon name="calendar" size={15} />
          {date}
        </span>
      )}
      <span>
        {item.kind === 'story' ? 'נכתב' : 'הועלה'} ע״י {item.createdBy.name}
      </span>
      {!HIDE_UPLOAD_DATE.includes(item.kind) && <span className="meta__muted">{formatDate(item.createdAt)}</span>}
    </p>
  );
}

export function TagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <ul className="tag-list" aria-label="תגיות">
      {tags.map((t) => (
        <li key={t} className="tag">
          #{t}
        </li>
      ))}
    </ul>
  );
}

/** תמונה בגלריה — בסגנון תמונה מודבקת באלבום. הגודל נקבע ע״י הקולאז׳ (PhotoCollage) לפי יחס התמונה. */
export function PhotoTile({ item, onOpen, priority }: { item: ItemSummary; onOpen: () => void; priority?: boolean }) {
  const src = previewUrl(item);
  const [loaded, setLoaded] = useState(false);
  const o = originalOf(item);
  const title = displayTitle(item);
  const date = itemDateLabel(item);
  return (
    <figure className="photo-tile">
      <button className="photo-tile__btn" onClick={onOpen} aria-label={title ? `פתיחת התמונה: ${title}` : 'פתיחת התמונה'}>
        <span className={`photo-tile__img ${loaded || !src ? 'is-loaded' : ''}`}>
          {src ? (
            <img
              src={src}
              alt=""
              loading={priority ? 'eager' : 'lazy'}
              fetchPriority={priority ? 'high' : 'auto'}
              decoding="async"
              onLoad={() => setLoaded(true)}
              onError={() => setLoaded(true)}
            />
          ) : (
            <span className="photo-tile__noprev"><Icon name="photo" size={32} />{o?.mime.split('/')[1]?.toUpperCase()}</span>
          )}
        </span>
      </button>
      {(title || date) && (
        <figcaption className="photo-tile__cap">
          {title && <span className="photo-tile__title">{title}</span>}
          {date && <span className="photo-tile__date">{date}</span>}
        </figcaption>
      )}
    </figure>
  );
}

/** כרטיס סרטון — לחיצה מעבירה לדף הסרטון; הניגון מתחיל רק בלחיצה על Play שם */
export function VideoCard({ item }: { item: ItemSummary }) {
  const src = previewUrl(item);
  const o = originalOf(item);
  // מקור הסרטון — לא מוצג למשתמשים (רק לזיהוי בבדיקות)
  const source = item.externalVideo ? 'drive' : 'upload';
  const content = (
    <>
      <span className="media-card__thumb">
        {src ? (
          <SafeImg src={src} alt="" loading="lazy" decoding="async" fallback={<span className="media-card__noprev"><Icon name="video" size={30} /></span>} />
        ) : (
          <span className="media-card__noprev"><Icon name="video" size={30} /></span>
        )}
        <span className="media-card__play" aria-hidden="true">
          <Icon name="play" size={15} />
        </span>
        {o?.duration ? <span className="media-card__dur">{formatDuration(o.duration)}</span> : null}
      </span>
      <span className="media-card__body">
        <span className="card__title">{item.title}</span>
        {itemDateLabel(item) && <span className="media-card__date">{itemDateLabel(item)}</span>}
      </span>
    </>
  );
  return (
    <Link to={`/item/${item.id}`} className="card media-card" data-source={source}>
      {content}
    </Link>
  );
}

export function AudioCard({ item, autoPlay, onEnded }: { item: ItemSummary; autoPlay?: boolean; onEnded?: () => void }) {
  const o = originalOf(item);
  return (
    <article className="card audio-card">
      <div className="audio-card__head">
        <span className="audio-card__icon" aria-hidden="true">
          <Icon name="audio" size={26} />
        </span>
        <div>
          <Link to={`/item/${item.id}`} className="card__title card__title--link">
            {item.title}
          </Link>
          <ItemMeta item={item} />
        </div>
      </div>
      {item.description && <p className="card__desc">{item.description}</p>}
      {o && (
        <AudioPlayer
          src={fileUrl(o.id)}
          knownDuration={o.duration}
          title={item.title}
          compact
          waveform={item.waveform}
          itemId={item.id}
          fileSize={o.size}
          autoPlay={autoPlay}
          onEnded={onEnded}
        />
      )}
    </article>
  );
}

export function StoryCard({ item, className, style }: { item: ItemSummary; className?: string; style?: CSSProperties }) {
  return (
    <Link to={`/item/${item.id}`} className={`card story-card ${item.coverFileId ? 'story-card--photo' : ''} ${className ?? ''}`} style={style}>
      {item.storyType && <span className="badge">{STORY_TYPE_LABEL[item.storyType]}</span>}
      {item.coverFileId ? (
        <span className="story-card__head">
          <img className="story-card__thumb" src={fileUrl(item.coverFileId)} alt="" loading="lazy" decoding="async" />
          <span className="story-card__title">{item.title}</span>
        </span>
      ) : (
        <span className="story-card__title">{item.title}</span>
      )}
      {item.excerpt && <span className="story-card__excerpt">{item.excerpt}</span>}
      <span className="story-card__foot">
        <ItemMeta item={item} />
        {item.commentCount > 0 && (
          <span className="story-card__comments">
            <Icon name="comment" size={16} />
            {item.commentCount}
          </span>
        )}
      </span>
    </Link>
  );
}

/** תמונת ברירת המחדל של מסמכים — מוגשת רק למשתמשים מחוברים */
const DOCUMENT_COVER_URL = '/api/assets/document-cover';

export function DocumentCard({ item }: { item: ItemSummary }) {
  const src = previewUrl(item);
  return (
    <Link to={`/item/${item.id}`} className="card doc-card">
      {/* מסמך עם סריקה או תמונה מקדימה — מוצג כמות שהוא; אחרת (למשל PDF) — תמונת ברירת המחדל הקבועה */}
      <span className={`doc-card__sheet ${src ? '' : 'doc-card__sheet--cover'}`} aria-hidden="true">
        <img src={src ?? DOCUMENT_COVER_URL} alt="" loading="lazy" decoding="async" />
      </span>
      <span className="doc-card__body">
        <span className="card__title">{item.title}</span>
        {item.description && <span className="card__desc">{item.description}</span>}
        <ItemMeta item={item} />
      </span>
    </Link>
  );
}

/** שורת תוצאה כללית — לחיפוש, לסל המחזור ולצירוף פריטים. */
export function ItemRowCard({ item, to, children }: { item: ItemSummary; to?: string; children?: React.ReactNode }) {
  const src = previewUrl(item);
  const title = displayTitle(item);
  const icon = <Icon name={KIND_ICON[item.kind]} size={26} />;
  const inner = (
    <>
      <span className="row-card__thumb" aria-hidden="true">
        {src ? <SafeImg src={src} alt="" loading="lazy" decoding="async" fallback={icon} /> : icon}
      </span>
      <span className="row-card__body">
        {title ? <span className="card__title">{title}</span> : <span className="visually-hidden">{accessibleTitle(item)}</span>}
        {(item.excerpt || item.description) && <span className="card__desc card__desc--clamp">{item.excerpt ?? item.description}</span>}
        <ItemMeta item={item} showKind />
      </span>
    </>
  );
  return (
    <div className="card row-card">
      {to ? (
        <Link to={to} className="row-card__link">
          {inner}
        </Link>
      ) : (
        <div className="row-card__link">{inner}</div>
      )}
      {children && <div className="row-card__actions">{children}</div>}
    </div>
  );
}
