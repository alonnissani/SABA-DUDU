import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { ItemSummary } from '../../shared/types';
import { fileUrl } from '../api/client';
import { drivePreviewUrl, driveThumbUrl } from '../../shared/drive';
import { formatDuration } from '../lib/media';
import { Icon } from './Icon';

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FsVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitSupportsFullscreen?: boolean };

const fullscreenSupported = () =>
  Boolean(document.fullscreenEnabled || (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);

/** כניסה למסך מלא, ובנייד — ניסיון לסובב לרוחב כשהסרטון רחב (נתמך באנדרואיד; באייפון הסיבוב טבעי) */
export async function enterFullscreen(el: FsElement, landscape: boolean): Promise<boolean> {
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
  } catch {
    return false;
  }
  try {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (landscape && orientation?.lock) await orientation.lock('landscape');
  } catch {
    /* הדפדפן לא מאפשר נעילת כיוון — בסדר */
  }
  return true;
}

function useFullscreenExitUnlock() {
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) {
        try {
          screen.orientation?.unlock?.();
        } catch {
          /* לא נתמך */
        }
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
}

/** סרטון שהועלה לאתר: מוצג בשלמותו ביחס המקורי, עם כפתור מסך מלא ברור. */
export function UploadedVideo({ src, poster, width, height, duration }: { src: string; poster?: string; width: number | null; height: number | null; duration: number | null }) {
  const ref = useRef<FsVideo>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(width && height ? { w: width, h: height } : null);
  useFullscreenExitUnlock();
  const shape = !dims ? 'unknown' : dims.h > dims.w ? 'portrait' : 'landscape';

  const fullscreen = async () => {
    const v = ref.current;
    if (!v) return;
    const ok = await enterFullscreen(v, shape !== 'portrait');
    // אייפון: מסך מלא של נגן הווידאו המובנה (כולל סיבוב לרוחב)
    if (!ok) v.webkitEnterFullscreen?.();
  };

  return (
    <div className="video-wrap">
      <div className={`video-box video-box--${shape}`}>
        <video
          ref={ref}
          className="video"
          src={src}
          poster={poster}
          controls
          playsInline
          preload="metadata"
          style={dims ? { aspectRatio: `${dims.w} / ${dims.h}` } : undefined}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setDims({ w: v.videoWidth, h: v.videoHeight });
          }}
        >
          הדפדפן אינו תומך בניגון וידאו.
        </video>
      </div>
      <div className="video-wrap__bar">
        {duration ? <span className="meta__muted">אורך: {formatDuration(duration)}</span> : <span />}
        <button className="btn btn--primary btn--sm" onClick={fullscreen}>
          <Icon name="fullscreen" size={18} />
          צפייה במסך מלא
        </button>
      </div>
    </div>
  );
}

/**
 * סרטון מ-Google Drive בנגן המוטמע של גוגל. הניגון והמסך המלא תלויים בהרשאות השיתוף בדרייב ובדפדפן,
 * ולכן תמיד יש גם פתיחה ישירה ב-Google Drive. יחס הגובה-רוחב נלמד מהתמונה הממוזערת של דרייב, אם היא זמינה.
 */
export function DriveVideo({ fileId, url, title }: { fileId: string; url: string; title: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [canFs, setCanFs] = useState(false);
  useFullscreenExitUnlock();

  useEffect(() => {
    setCanFs(fullscreenSupported());
    const cached = readDriveRatio(fileId);
    if (cached) setRatio(cached);
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      setRatio(img.naturalWidth / img.naturalHeight);
      writeDriveRatio(fileId, img.naturalWidth / img.naturalHeight);
    };
    img.src = driveThumbUrl(fileId);
  }, [fileId]);

  const portrait = ratio !== null && ratio < 1;
  const fullscreen = async () => {
    const ok = frame.current && (await enterFullscreen(frame.current, !portrait));
    // אם אין מסך מלא בתוך האתר (למשל אייפון) — פתיחה ישירה ב-Google Drive
    if (!ok) window.open(url, '_blank', 'noopener');
  };

  return (
    <div className="video-wrap">
      <div ref={frame} className={`drive-frame ${portrait ? 'drive-frame--portrait' : ''}`} style={ratio ? { aspectRatio: String(ratio) } : undefined}>
        <iframe
          src={drivePreviewUrl(fileId)}
          title={title || 'סרטון מ-Google Drive'}
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </div>
      <div className="video-wrap__bar">
        <span className="meta__muted small">הסרטון מוצג מ-Google Drive. אם הוא לא מתנגן, ייתכן שהרשאות השיתוף שלו מוגבלות.</span>
        <div className="video-wrap__actions">
          {canFs && (
            <button className="btn btn--primary btn--sm" onClick={fullscreen}>
              <Icon name="fullscreen" size={18} />
              צפייה במסך מלא
            </button>
          )}
          <a className={`btn btn--sm ${canFs ? 'btn--ghost' : 'btn--primary'}`} href={url} target="_blank" rel="noopener noreferrer">
            <Icon name="link" size={18} />
            פתיחה ב-Google Drive
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * כניסה למסך מלא מתוך לחיצה (חייב להיקרא ישירות באירוע הלחיצה, כדי שהדפדפן יאשר).
 * מכניס את כל הדף למסך מלא, והנגן (VideoTheater) ממלא אותו.
 */
export function requestPageFullscreen(landscape: boolean): void {
  const el = document.documentElement as FsElement;
  const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
  if (!req) return;
  Promise.resolve(req())
    .then(async () => {
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      if (landscape && orientation?.lock) await orientation.lock('landscape').catch(() => undefined);
    })
    .catch(() => undefined);
}

// יחס הגובה-רוחב של סרטוני Drive נלמד מהתמונה הממוזערת שלהם; נשמר בדפדפן כדי שבפעם הבאה הנגן ייפתח מיד בגודל הנכון
const RATIO_KEY = 'saba:drive-ratio:';
function readDriveRatio(id: string): number | null {
  try {
    const v = Number(localStorage.getItem(RATIO_KEY + id));
    return v > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeDriveRatio(id: string, r: number) {
  try {
    localStorage.setItem(RATIO_KEY + id, String(r));
  } catch {
    /* אחסון לא זמין */
  }
}

const isFullscreen = () => Boolean(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement);

/**
 * נגן סרטון על כל המסך — נפתח בלחיצה על כרטיס סרטון. הסרטון מוצג בשלמותו ביחס המקורי.
 * אם הדפדפן לא אישר מסך מלא (למשל אייפון), זה ״נגן מוגדל״ עם כפתור מסך מלא ברור.
 */
export function VideoTheater({ item, onClose }: { item: ItemSummary; onClose: () => void }) {
  const videoRef = useRef<FsVideo>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const original = item.files.find((f) => f.role === 'original');
  const poster = item.files.find((f) => f.role === 'poster' || f.role === 'thumb');
  const [ratio, setRatio] = useState<number | null>(original?.width && original?.height ? original.width / original.height : null);
  const ext = item.externalVideo;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !isFullscreen() && close();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ext) return;
    const cached = readDriveRatio(ext.fileId);
    if (cached) setRatio(cached);
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const r = img.naturalWidth / img.naturalHeight;
      setRatio(r);
      writeDriveRatio(ext.fileId, r);
    };
    img.src = driveThumbUrl(ext.fileId);
  }, [ext]);

  const leaveFullscreen = () => {
    if (isFullscreen()) document.exitFullscreen?.().catch(() => undefined);
    try {
      screen.orientation?.unlock?.();
    } catch {
      /* לא נתמך */
    }
  };
  // ״חזרה״ בטלפון סוגרת את הנגן וחוזרת לארכיון (במקום לצאת מדף הגלריה)
  const popped = useRef(false);
  useEffect(() => {
    history.pushState({ sabaTheater: true }, '');
    const onPop = () => {
      popped.current = true;
      leaveFullscreen();
      onClose();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const close = () => {
    leaveFullscreen();
    if (!popped.current && (history.state as { sabaTheater?: boolean } | null)?.sabaTheater) history.back();
    else onClose();
  };


  const r = ratio ?? 16 / 9;
  return (
    <div className="theater" role="dialog" aria-modal="true" aria-label={item.title || 'סרטון'}>
      {/* כפתורים צפים קטנים — בלי סרגל, כדי שהסרטון ינצל את כל המסך */}
      <div className="theater__float">
        <button ref={closeRef} className="lb-btn" onClick={close} aria-label="סגירה וחזרה לארכיון">
          <Icon name="close" />
        </button>
        {ext && (
          <a className="lb-btn" href={ext.url} target="_blank" rel="noopener noreferrer" aria-label="פתיחה ב-Google Drive">
            <Icon name="link" />
          </a>
        )}
        <Link className="lb-btn" to={`/item/${item.id}`} onClick={leaveFullscreen} aria-label="לדף הסרטון ותגובות">
          <Icon name="comment" />
        </Link>
      </div>
      <div className="theater__stage">
        {ext ? (
          // אנכי — מנצל את הגובה; אופקי — את הרוחב; היחס נשמר
          <div className="theater__frame" style={{ aspectRatio: String(r), width: `min(100vw, calc(var(--theater-h) * ${r}))` }}>
            <iframe
              src={drivePreviewUrl(ext.fileId)}
              title={item.title || 'סרטון מ-Google Drive'}
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              referrerPolicy="no-referrer"
            />
          </div>
        ) : original ? (
          <video
            ref={videoRef}
            className="theater__video"
            src={fileUrl(original.id)}
            poster={poster ? fileUrl(poster.id) : undefined}
            controls
            autoPlay
            playsInline
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
