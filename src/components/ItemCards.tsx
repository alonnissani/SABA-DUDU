import { Link } from 'react-router';
import type { ItemSummary } from '../../shared/types';
import { KIND_LABELS, STORY_TYPE_LABEL } from '../../shared/constants';
import { formatDate, formatDuration, itemDateLabel, originalOf, previewUrl } from '../lib/media';
import { Icon, KIND_ICON } from './Icon';
import { AudioPlayer } from './AudioPlayer';
import { fileUrl } from '../api/client';

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
      <span className="meta__muted">{formatDate(item.createdAt)}</span>
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

/** תמונה בגלריה — בסגנון תמונה מודבקת באלבום. */
export function PhotoTile({ item, onOpen }: { item: ItemSummary; onOpen: () => void }) {
  const src = previewUrl(item);
  const o = originalOf(item);
  const ratio = o?.width && o?.height ? `${o.width} / ${o.height}` : '4 / 3';
  return (
    <figure className="photo-tile">
      <button className="photo-tile__btn" onClick={onOpen} aria-label={`פתיחת התמונה: ${item.title}`}>
        <span className="photo-tile__img" style={{ aspectRatio: ratio }}>
          {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <span className="photo-tile__noprev"><Icon name="photo" size={32} />{o?.mime.split('/')[1]?.toUpperCase()}</span>}
        </span>
      </button>
      <figcaption className="photo-tile__cap">
        <span className="photo-tile__title">{item.title}</span>
        {itemDateLabel(item) && <span className="photo-tile__date">{itemDateLabel(item)}</span>}
      </figcaption>
    </figure>
  );
}

export function VideoCard({ item }: { item: ItemSummary }) {
  const src = previewUrl(item);
  const o = originalOf(item);
  return (
    <Link to={`/item/${item.id}`} className="card media-card">
      <span className="media-card__thumb">
        {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <span className="media-card__noprev"><Icon name="video" size={36} /></span>}
        <span className="media-card__play" aria-hidden="true">
          <Icon name="play" size={26} />
        </span>
        {o?.duration ? <span className="media-card__dur">{formatDuration(o.duration)}</span> : null}
      </span>
      <span className="media-card__body">
        <span className="card__title">{item.title}</span>
        {item.description && <span className="card__desc">{item.description}</span>}
        <ItemMeta item={item} />
      </span>
    </Link>
  );
}

export function AudioCard({ item }: { item: ItemSummary }) {
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
      {o && <AudioPlayer src={fileUrl(o.id)} knownDuration={o.duration} title={item.title} compact />}
    </article>
  );
}

export function StoryCard({ item }: { item: ItemSummary }) {
  return (
    <Link to={`/item/${item.id}`} className="card story-card">
      {item.storyType && <span className="badge">{STORY_TYPE_LABEL[item.storyType]}</span>}
      <span className="story-card__title">{item.title}</span>
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

export function DocumentCard({ item }: { item: ItemSummary }) {
  const src = previewUrl(item);
  const o = originalOf(item);
  const isPdf = o?.mime === 'application/pdf';
  return (
    <Link to={`/item/${item.id}`} className="card doc-card">
      <span className="doc-card__sheet" aria-hidden="true">
        {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : (
          <span className="doc-card__icon">
            <Icon name="document" size={34} />
            {isPdf ? 'PDF' : o?.mime.split('/')[1]?.toUpperCase()}
          </span>
        )}
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
  const inner = (
    <>
      <span className="row-card__thumb" aria-hidden="true">
        {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <Icon name={KIND_ICON[item.kind]} size={26} />}
      </span>
      <span className="row-card__body">
        <span className="card__title">{item.title}</span>
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
