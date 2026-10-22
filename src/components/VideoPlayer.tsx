import { useEffect, useRef, useState } from 'react';
import { driveThumbUrl } from '../../shared/drive';
import { formatDuration } from '../lib/media';
import { Icon } from './Icon';

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FsVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitSupportsFullscreen?: boolean };

const fullscreenSupported = () =>
  Boolean(document.fullscreenEnabled || (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled);

/** כניסה למסך מלא לפי בקשת המשתמש. אין נעילת כיוון — המסך מסתובב רק אם המשתמש מסובב את הטלפון. */
export async function enterFullscreen(el: FsElement): Promise<boolean> {
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else return false;
  } catch {
    return false;
  }
  return true;
}

/**
 * סרטון שהועלה לאתר. בדף הסרטון: תמונת שער עם כפתור Play של האתר (בלי פקדי הנגן עדיין, כדי שלא יהיו שני Play).
 * לחיצה — הסרטון מתחיל לנגן במסך מלא של הנגן עצמו: ביחס המקורי, עם מערכת פקדים אחת, בלי נעילת סיבוב.
 * יציאה (״חזרה״/Esc) מחזירה לדף, והנגן נשאר בו עם פקדים.
 */
export function UploadedVideo({ src, poster, width, height, duration }: { src: string; poster?: string; width: number | null; height: number | null; duration: number | null }) {
  const ref = useRef<FsVideo>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(width && height ? { w: width, h: height } : null);
  const [started, setStarted] = useState(false);
  const shape = !dims ? 'unknown' : dims.h > dims.w ? 'portrait' : 'landscape';

  const play = async () => {
    const v = ref.current;
    if (!v) return;
    setStarted(true);
    v.play().catch(() => undefined);
    const ok = fullscreenSupported() && (await enterFullscreen(v));
    // אייפון: מסך מלא של נגן הווידאו המובנה
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
          controls={started}
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
        {!started && (
          <button type="button" className="video-cover__play video-cover__play--over" onClick={play} aria-label="ניגון הסרטון">
            <Icon name="play" size={34} />
          </button>
        )}
      </div>
      {duration ? (
        <div className="video-wrap__bar">
          <span className="meta__muted">אורך: {formatDuration(duration)}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * סרטון מ-Google Drive. בדף הסרטון: תמונת השער ביחס המקורי עם כפתור Play של האתר (בלי הנגן המוטמע,
 * שמנגן בתוך העמוד בצורה לא נוחה). Play פותח את הצופה של Google Drive — כמו החץ בפינת הנגן של גוגל:
 * מותאם לטלפון, אנכי או אופקי, עם הפקדים של גוגל ומסך מלא. ״חזרה״ או X סוגרים וחוזרים לדף.
 */
export function DriveVideo({ fileId, url, title }: { fileId: string; url: string; title: string }) {
  const [ratio, setRatio] = useState<number | null>(() => readDriveRatio(fileId));
  const [thumb, setThumb] = useState<'loading' | 'ok' | 'none'>('loading');

  useEffect(() => {
    setThumb('loading');
    const cached = readDriveRatio(fileId);
    if (cached) setRatio(cached);
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) return setThumb('none');
      setThumb('ok');
      // אם כבר ידוע יחס (נשמר בדפדפן) — הוא קובע; אחרת לומדים מהתמונה הממוזערת
      if (!readDriveRatio(fileId)) {
        setRatio(img.naturalWidth / img.naturalHeight);
        writeDriveRatio(fileId, img.naturalWidth / img.naturalHeight);
      }
    };
    img.onerror = () => setThumb('none');
    img.src = driveThumbUrl(fileId);
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [fileId]);

  const r = ratio ?? 16 / 9;
  return (
    <div className="video-wrap">
      <a
        className={`video-cover ${r < 1 ? 'video-cover--portrait' : ''}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ aspectRatio: String(r) }}
        aria-label={`ניגון הסרטון${title ? `: ${title}` : ''}`}
        data-ratio={r.toFixed(3)}
      >
        {thumb === 'ok' ? (
          <img className="video-cover__img" src={driveThumbUrl(fileId)} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="video-cover__empty" aria-hidden="true">
            <Icon name="video" size={40} />
          </span>
        )}
        <span className="video-cover__play" aria-hidden="true">
          <Icon name="play" size={34} />
        </span>
      </a>
      <div className="video-wrap__bar">
        <span className="meta__muted small">הסרטון נפתח ב-Google Drive. אם הוא לא מתנגן, ייתכן שהרשאות השיתוף שלו מוגבלות.</span>
      </div>
    </div>
  );
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
