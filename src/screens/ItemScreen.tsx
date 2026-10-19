import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ItemDetail, ItemSummary, StoryImage, StoryType } from '../../shared/types';
import { KIND_LABELS, STORY_TYPES, STORY_TYPE_LABEL, formatBytes } from '../../shared/constants';
import { api, fileUrl } from '../api/client';
import { useApp, useLoad, useToast } from '../state';
import { ErrorBox, Field, Modal, Spinner } from '../components/Common';
import { Icon, KIND_ICON } from '../components/Icon';
import { AudioPlayer } from '../components/AudioPlayer';
import { ItemMeta, ItemRowCard, TagList } from '../components/ItemCards';
import { Lightbox } from '../components/Lightbox';
import { MetaFields, metaPayload, type MetaValues } from '../components/MetaFields';
import { WEB_IMAGES, accessibleTitle, displayTitle, displayableImage, formatDate, originalOf, previewOf, previewUrl } from '../lib/media';
import { parseDriveFileId } from '../../shared/drive';
import { DriveVideo, UploadedVideo } from '../components/VideoPlayer';
import { precheck, uploadStoryImage } from '../lib/uploader';

export function ItemScreen() {
  const { id = '' } = useParams();
  const { data: item, error, loading, reload, setData } = useLoad(() => api.item(id), [id]);
  if (loading && !item) return <Spinner />;
  if (error || !item) return <ErrorBox message={error ?? 'הפריט לא נמצא'} onRetry={reload} />;
  return <ItemView item={item} reload={reload} onChange={setData} />;
}

function ItemView({ item, reload, onChange }: { item: ItemDetail; reload: () => void; onChange: (i: ItemDetail) => void }) {
  const { isAdmin } = useApp();
  const navigate = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const original = originalOf(item);

  const doDelete = async () => {
    setBusy(true);
    try {
      await api.remove(item.id);
      toast('הפריט הועבר לסל המחזור. אפשר לשחזר אותו מההגדרות.');
      navigate(`/c/${item.kind}`, { replace: true });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };
  const doRestore = async () => {
    try {
      await api.restore(item.id);
      toast('הפריט שוחזר');
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <article className={`item item--${item.kind}`}>
      <nav className="crumbs" aria-label="ניווט">
        <Link to={`/c/${item.kind}`}>
          <Icon name="chevronRight" size={18} />
          {KIND_LABELS[item.kind].plural}
        </Link>
      </nav>

      {item.deletedAt && (
        <div className="banner banner--warn" role="status">
          <Icon name="trash" />
          <span>פריט זה נמחק ב-{formatDate(item.deletedAt)} ומוצג רק למנהלים.</span>
          <button className="btn btn--sm btn--primary" onClick={doRestore}>
            <Icon name="restore" size={18} />
            שחזור
          </button>
        </div>
      )}

      {item.kind === 'story' ? (
        <StoryBody item={item} />
      ) : (
        <>
          <header className="item__head">
            <span className="item__kind">
              <Icon name={KIND_ICON[item.kind]} size={18} />
              {KIND_LABELS[item.kind].singular}
            </span>
            {displayTitle(item) ? <h1 className="item__title">{displayTitle(item)}</h1> : <h1 className="visually-hidden">{accessibleTitle(item)}</h1>}
          </header>
          <MediaView item={item} />
          <div className="item__details">
            {item.description && <p className="item__desc">{item.description}</p>}
            {item.people && (
              <p className="item__people">
                <Icon name="users" size={18} />
                {item.people}
              </p>
            )}
            <ItemMeta item={item} />
            <TagList tags={item.tags} />
          </div>
        </>
      )}

      <div className="item__actions">
        {original && (
          <a className="btn btn--ghost" href={fileUrl(original.id, true)} download>
            <Icon name="download" />
            הורדת קובץ המקור
            <small>({formatBytes(original.size)})</small>
          </a>
        )}
        {isAdmin && (
          <>
            <button className="btn btn--ghost" onClick={() => setEditing(true)}>
              <Icon name="edit" />
              עריכה
            </button>
            {!item.deletedAt && (
              <button className="btn btn--danger-ghost" onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" />
                מחיקה
              </button>
            )}
          </>
        )}
      </div>

      {item.kind === 'audio' && (
        <p className="note">
          <Icon name="sparkle" size={16} />
          תמלול אוטומטי וחיפוש בתוך ההקלטה — עדיין לא זמינים. ההקלטה המקורית שמורה ומוכנה לכך בעתיד.
        </p>
      )}

      {(item.links.length > 0 || item.storyImages.length > 1) && (
        <section className="item__links" aria-labelledby="links-title">
          <h2 id="links-title" className="section-title">מצורף לסיפור</h2>
          <LinkedItems item={item} />
        </section>
      )}

      <Comments item={item} onAdded={reload} />

      {editing && (
        <EditItem
          item={item}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            onChange(updated);
            setEditing(false);
            toast('השינויים נשמרו');
          }}
        />
      )}
      {confirmDelete && (
        <Modal title="מחיקת פריט" onClose={() => setConfirmDelete(false)}>
          <p>
            למחוק את ״{accessibleTitle(item)}״? הפריט יועבר לסל המחזור, הקבצים יישמרו, ואפשר יהיה לשחזר אותו בכל עת מתוך ״הגדרות ← ניהול תכנים״.
          </p>
          <div className="form__actions">
            <button className="btn btn--ghost" onClick={() => setConfirmDelete(false)}>
              ביטול
            </button>
            <button className="btn btn--danger" onClick={doDelete} disabled={busy}>
              {busy ? 'מוחק…' : 'מחיקה'}
            </button>
          </div>
        </Modal>
      )}
    </article>
  );
}

function MediaView({ item }: { item: ItemDetail }) {
  const [zoom, setZoom] = useState(false);
  const original = originalOf(item);
  const poster = previewOf(item);
  if (item.externalVideo) return <DriveVideo fileId={item.externalVideo.fileId} url={item.externalVideo.url} title={item.title} />;
  if (!original) return null;

  if (item.kind === 'photo' || (item.kind === 'document' && original.mime.startsWith('image/'))) {
    const src = displayableImage(original) ? fileUrl(original.id) : previewUrl(item);
    return (
      <>
        <figure className={item.kind === 'photo' ? 'mounted' : 'doc-view doc-view--image'}>
          {src ? (
            <button className="mounted__btn" onClick={() => setZoom(true)} aria-label="פתיחה במסך מלא עם הגדלה">
              <img src={src} alt={accessibleTitle(item)} style={original.width && original.height ? { aspectRatio: `${original.width} / ${original.height}` } : undefined} />
              <span className="mounted__zoom" aria-hidden="true">
                <Icon name="fullscreen" size={20} />
              </span>
            </button>
          ) : (
            <p className="muted-center">הדפדפן אינו יכול להציג את הקובץ. אפשר להוריד את קובץ המקור.</p>
          )}
        </figure>
        {zoom && <Lightbox items={[item]} index={0} onIndex={() => undefined} onClose={() => setZoom(false)} />}
      </>
    );
  }

  if (item.kind === 'video') {
    return (
      <UploadedVideo
        src={fileUrl(original.id)}
        poster={poster ? fileUrl(poster.id) : undefined}
        width={original.width}
        height={original.height}
        duration={original.duration}
      />
    );
  }

  if (item.kind === 'audio') {
    return (
      <div className="audio-stage">
        <AudioPlayer src={fileUrl(original.id)} knownDuration={original.duration} title={item.title} />
      </div>
    );
  }

  // PDF
  return (
    <div className="doc-view">
      <iframe className="doc-view__frame" src={`${fileUrl(original.id)}#view=FitH`} title={item.title} />
      <a className="btn btn--ghost btn--sm doc-view__open" href={fileUrl(original.id)} target="_blank" rel="noopener">
        <Icon name="fullscreen" size={18} />
        פתיחה במסך מלא
      </a>
    </div>
  );
}

/** תמונה של סיפור בצורה שהתצוגה המלאה (Lightbox) מכירה — היא לא פריט בגלריה */
function storyImageAsItem(img: StoryImage, story: ItemDetail): ItemSummary {
  return {
    ...story,
    id: img.id,
    kind: 'photo',
    title: '',
    description: null,
    excerpt: null,
    externalVideo: null,
    coverFileId: null,
    commentCount: 0,
    files: [
      { id: img.fileId, role: 'original', mime: img.mime, size: 0, originalName: '', width: img.width, height: img.height, duration: null },
      ...(img.thumbId ? [{ id: img.thumbId, role: 'thumb' as const, mime: 'image/webp', size: 0, originalName: '', width: null, height: null, duration: null }] : []),
    ],
  };
}

function StoryBody({ item }: { item: ItemDetail }) {
  // תמונות הסיפור עצמו (R2, נפרד מהגלריה); הראשונה מוצגת ליד הכותרת
  const photos = item.storyImages.map((img) => storyImageAsItem(img, item));
  const cover = photos[0] ?? null;
  const [open, setOpen] = useState<number | null>(null);
  // בדף הסיפור התמונה גדולה — מוצג המקור (באיכות מלאה) כשהדפדפן יכול להציג אותו
  const coverOriginal = cover ? originalOf(cover) : undefined;
  const coverSrc = cover ? (coverOriginal && WEB_IMAGES.includes(coverOriginal.mime) ? fileUrl(coverOriginal.id) : previewUrl(cover)) : null;
  const coverRatio = coverOriginal?.width && coverOriginal?.height ? `${coverOriginal.width} / ${coverOriginal.height}` : undefined;
  const heading = (
    <>
      <h1 className="sheet__title">{item.title}</h1>
      <p className="sheet__byline">
        מאת {item.createdBy.name}
        {(item.dateText || item.dateYear) && ` · ${item.dateText ?? item.dateYear}`}
      </p>
    </>
  );
  return (
    <div className="sheet">
      {item.storyType && <span className="badge">{STORY_TYPE_LABEL[item.storyType]}</span>}
      {cover && coverSrc ? (
        <div className="sheet__head sheet__head--photo">
          <div className="sheet__heading">{heading}</div>
          <button type="button" className="sheet__photo" onClick={() => setOpen(0)} aria-label="פתיחת התמונה בגודל מלא">
            <img src={coverSrc} alt="" decoding="async" style={{ aspectRatio: coverRatio }} />
          </button>
        </div>
      ) : (
        heading
      )}
      {open !== null && <Lightbox items={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
      <div className={`sheet__body ${item.storyType === 'saying' ? 'sheet__body--saying' : ''}`}>{item.body}</div>
      {item.people && <p className="item__people"><Icon name="users" size={18} />{item.people}</p>}
      <TagList tags={item.tags} />
    </div>
  );
}

function LinkedItems({ item }: { item: ItemDetail }) {
  // שאר תמונות הסיפור (הראשונה כבר מוצגת ליד הכותרת)
  const all = item.storyImages.map((img) => storyImageAsItem(img, item));
  const photos = all.slice(1);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      {photos.length > 0 && (
        <div className="linked-photos linked-photos--story">
          {photos.map((p, i) => (
            <button key={p.id} className="linked-photos__btn" onClick={() => setOpen(i)} aria-label={`פתיחת התמונה ${displayTitle(p) ?? ''}`.trim()}>
              {previewUrl(p) ? <img src={previewUrl(p)!} alt="" loading="lazy" /> : <Icon name="photo" />}
            </button>
          ))}
        </div>
      )}
      <ul className="list">
        {item.links
          .filter((l) => l.kind !== 'photo')
          .map((l) => {
            const o = originalOf(l);
            return (
              <li key={l.id}>
                {l.kind === 'audio' && o ? (
                  <div className="card audio-card">
                    <Link to={`/item/${l.id}`} className="card__title card__title--link">{l.title}</Link>
                    <AudioPlayer src={fileUrl(o.id)} knownDuration={o.duration} title={l.title} compact />
                  </div>
                ) : (
                  <ItemRowCard item={l} to={`/item/${l.id}`} />
                )}
              </li>
            );
          })}
      </ul>
      {open !== null && <Lightbox items={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  );
}

function Comments({ item, onAdded }: { item: ItemDetail; onAdded: () => void }) {
  const { isAdmin } = useApp();
  const toast = useToast();
  const [mode, setMode] = useState<'memory' | 'comment' | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const isStory = item.kind === 'story';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mode || !text.trim()) return;
    setBusy(true);
    try {
      await api.comment(item.id, text.trim(), mode);
      setText('');
      setMode(null);
      toast(mode === 'memory' ? 'הזיכרון שלך נוסף' : 'התגובה נוספה');
      onAdded();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm('למחוק את התגובה?')) return;
    try {
      await api.removeComment(id);
      onAdded();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <section className="comments" aria-labelledby="comments-title">
      <h2 id="comments-title" className="section-title">
        {isStory ? 'זיכרונות ותגובות מהמשפחה' : 'תגובות וזיכרונות'}
        {item.comments.length > 0 && <span className="count">{item.comments.length}</span>}
      </h2>
      {item.comments.length === 0 && !mode && <p className="muted">עוד אין תגובות. אולי גם לך יש מה להוסיף?</p>}
      <ul className="comment-list">
        {item.comments.map((c) => (
          <li key={c.id} className={`comment ${c.kind === 'memory' ? 'comment--memory' : ''}`}>
            {c.kind === 'memory' && (
              <span className="comment__tag">
                <Icon name="heart" size={15} />
                גם אני זוכר
              </span>
            )}
            <p className="comment__body">{c.body}</p>
            <p className="comment__meta">
              {c.createdBy.name} · {formatDate(c.createdAt)}
              {isAdmin && (
                <button className="btn btn--text btn--sm" onClick={() => remove(c.id)}>
                  מחיקה
                </button>
              )}
            </p>
          </li>
        ))}
      </ul>
      {!item.deletedAt &&
        (mode ? (
          <form className="form comment-form" onSubmit={submit}>
            <Field label={mode === 'memory' ? 'מה את/ה זוכר/ת?' : 'תגובה'}>
              <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} required placeholder={mode === 'memory' ? 'גם אני זוכר את זה… ספרו מה אתם זוכרים' : ''} />
            </Field>
            <div className="form__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setMode(null)}>
                ביטול
              </button>
              <button className="btn btn--primary" disabled={busy || !text.trim()}>
                {busy ? 'שולח…' : 'פרסום'}
              </button>
            </div>
          </form>
        ) : (
          <div className="comment-cta">
            <button className="btn btn--primary" onClick={() => setMode('memory')}>
              <Icon name="heart" />
              גם אני זוכר את זה
            </button>
            <button className="btn btn--ghost" onClick={() => setMode('comment')}>
              <Icon name="comment" />
              הוספת תגובה
            </button>
          </div>
        ))}
    </section>
  );
}

function EditItem({ item, onClose, onSaved }: { item: ItemDetail; onClose: () => void; onSaved: (i: ItemDetail) => void }) {
  const [title, setTitle] = useState(item.kind === 'photo' && !displayTitle(item) ? '' : item.title);
  const [externalUrl, setExternalUrl] = useState(item.externalVideo?.url ?? '');
  const [body, setBody] = useState(item.body ?? '');
  const [storyType, setStoryType] = useState<StoryType>(item.storyType ?? 'family');
  const [meta, setMeta] = useState<MetaValues>({
    description: item.description ?? '',
    dateText: item.dateText ?? '',
    dateYear: item.dateYear ? String(item.dateYear) : '',
    people: item.people ?? '',
    tags: item.tags,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // תמונת הסיפור (הראשונה מתמונות הסיפור): אפשר להוסיף, להחליף או להסיר — בלי לגעת בגלריה
  const currentPhoto = item.kind === 'story' ? item.storyImages[0] ?? null : null;
  const [photo, setPhoto] = useState<CoverChoice>({ type: 'keep' });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const m = metaPayload(meta);
      if (photo.type === 'file') {
        // תמונה חדשה נשמרת עם הסיפור עצמו ונכנסת ראשונה; הקודמת (אם הוחלפה) מוסרת מהסיפור
        await api.addStoryImage(item.id, await uploadStoryImage(photo.file));
        if (currentPhoto) await api.removeStoryImage(item.id, currentPhoto.id);
      } else if (photo.type === 'none' && currentPhoto) {
        await api.removeStoryImage(item.id, currentPhoto.id);
      }
      if (item.externalVideo && !parseDriveFileId(externalUrl)) throw new Error('קישור Google Drive לא תקין');
      const updated = await api.edit(item.id, {
        ...(item.externalVideo && externalUrl !== item.externalVideo.url ? { externalUrl } : {}),
        title,
        description: m.description ?? '',
        dateText: m.dateText ?? '',
        dateYear: m.dateYear,
        people: m.people ?? '',
        tags: m.tags,
        ...(item.kind === 'story' ? { body, storyType } : {}),
      });
      onSaved(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="עריכת פריט" onClose={onClose} wide>
      <form className="form" onSubmit={save}>
        <Field label={item.kind === 'photo' ? 'כותרת (לא חובה)' : 'כותרת'}>
          <input required={item.kind !== 'photo'} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {item.externalVideo && (
          <Field label="קישור ל-Google Drive" hint="אפשר להדביק קישור חדש כדי להחליף את הסרטון">
            <input type="url" dir="ltr" required value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} />
          </Field>
        )}
        {item.kind === 'story' && (
          <>
            <Field label="סוג הסיפור">
              <select value={storyType} onChange={(e) => setStoryType(e.target.value as StoryType)}>
                {STORY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </Field>
            <Field label="הסיפור">
              <textarea rows={10} required value={body} onChange={(e) => setBody(e.target.value)} />
            </Field>
          </>
        )}
        {item.kind === 'story' && <StoryPhotoField current={currentPhoto} value={photo} onChange={setPhoto} disabled={busy} />}
        <MetaFields value={meta} onChange={setMeta} hideDescription={item.kind === 'story'} />
        {error && <ErrorBox message={error} />}
        <div className="form__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>ביטול</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button>
        </div>
      </form>
    </Modal>
  );
}

type CoverChoice = { type: 'keep' } | { type: 'none' } | { type: 'file'; file: File; url: string };

/** תמונת הסיפור בעריכה — העלאה חדשה, החלפה או הסרה. תמונות הסיפור נפרדות מהגלריה. */
function StoryPhotoField({ current, value, onChange, disabled }: { current: StoryImage | null; value: CoverChoice; onChange: (v: CoverChoice) => void; disabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const currentUrl = current ? fileUrl(current.thumbId ?? current.fileId) : null;
  const shown = value.type === 'file' ? value.url : value.type === 'keep' ? currentUrl : null;
  const has = Boolean(shown);
  const choose = (v: CoverChoice) => {
    if (value.type === 'file') URL.revokeObjectURL(value.url);
    setError(null);
    onChange(v);
  };
  return (
    <div className="field">
      <span className="field__label">תמונה לסיפור (לא חובה)</span>
      <div className="story-photo">
        <span className="story-photo__preview" aria-hidden="true">
          {shown ? <img src={shown} alt="" /> : <Icon name="photo" size={26} />}
        </span>
        <div className="story-photo__actions">
          <label className={`btn btn--ghost btn--sm ${disabled ? 'is-disabled' : ''}`}>
            <input
              type="file"
              className="visually-hidden"
              accept="image/*,.heic,.heif"
              disabled={disabled}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const err = precheck('photo', f);
                if (err) return setError(err);
                choose({ type: 'file', file: f, url: URL.createObjectURL(f) });
              }}
            />
            <Icon name="upload" size={18} />
            {has ? 'העלאת תמונה אחרת' : 'העלאת תמונה'}
          </label>
          {has && (
            <button type="button" className="btn btn--text btn--sm" onClick={() => choose(current ? { type: 'none' } : { type: 'keep' })} disabled={disabled}>
              הסרת התמונה
            </button>
          )}
        </div>
      </div>
      <p className="field__hint">התמונה נשמרת עם הסיפור בלבד — היא לא חלק מגלריית התמונות.</p>
      {value.type === 'none' && <p className="field__hint">התמונה תוסר מהסיפור בשמירה.</p>}
      {error && <p className="pending__error">{error}</p>}
    </div>
  );
}
