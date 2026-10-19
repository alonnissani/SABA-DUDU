import { useEffect, useRef, useState } from 'react';
import { drivePreviewUrl, driveThumbUrl } from '../../shared/drive';
import { formatDuration } from '../lib/media';
import { Icon } from './Icon';

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FsVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitSupportsFullscreen?: boolean };

const fullscreenSupported = () =>
  Boolean(document.fullscreenEnabled || (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);

/** כניסה למסך מלא, ובנייד — ניסיון לסובב לרוחב כשהסרטון רחב (נתמך באנדרואיד; באייפון הסיבוב טבעי) */
async function enterFullscreen(el: FsElement, landscape: boolean): Promise<boolean> {
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
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => img.naturalWidth && img.naturalHeight && setRatio(img.naturalWidth / img.naturalHeight);
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
          <button className="btn btn--primary btn--sm" onClick={fullscreen}>
            <Icon name="fullscreen" size={18} />
            {canFs ? 'צפייה במסך מלא' : 'מסך מלא ב-Google Drive'}
          </button>
          <a className="btn btn--ghost btn--sm" href={url} target="_blank" rel="noopener noreferrer">
            <Icon name="link" size={18} />
            פתיחה ב-Google Drive
          </a>
        </div>
      </div>
    </div>
  );
}
