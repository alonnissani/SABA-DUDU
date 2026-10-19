import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../lib/media';
import { ensureWaveform } from '../lib/waveform';
import { Icon } from './Icon';

const RATES = [1, 1.25, 1.5, 2, 0.75];
const RATE_KEY = 'saba:audio-rate';

function savedRate(): number {
  try {
    const r = Number(localStorage.getItem(RATE_KEY));
    return RATES.includes(r) ? r : 1;
  } catch {
    return 1;
  }
}

interface Props {
  src: string;
  knownDuration?: number | null;
  title: string;
  compact?: boolean;
  /** גל הקול השמור (אם כבר חושב) */
  waveform?: number[] | null;
  /** מזהה ההקלטה — כדי לחשב ולשמור את גל הקול בהשמעה הראשונה, אם עדיין אין */
  itemId?: string;
  fileSize?: number;
  /** השמעה ברצף: להתחיל לנגן מיד (ההקלטה הקודמת הסתיימה) */
  autoPlay?: boolean;
  onEnded?: () => void;
}

/**
 * נגן שמע: גל קול אמיתי של ההקלטה (התקדמות ההשמעה צובעת אותו), הפעלה/עצירה, דילוג 15 שניות,
 * זמן שעבר וזמן שנותר, ומהירות השמעה. לחיצה או גרירה על הגל מזיזה את מיקום ההשמעה.
 */
export function AudioPlayer({ src, knownDuration, title, compact, waveform, itemId, fileSize, autoPlay, onEnded }: Props) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(knownDuration ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [rate, setRate] = useState(savedRate);
  const [peaks, setPeaks] = useState<number[] | null>(waveform ?? null);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;

  useEffect(() => setPeaks(waveform ?? null), [waveform]);

  useEffect(() => {
    const a = ref.current!;
    const onTime = () => setTime(a.currentTime);
    const onMeta = () => Number.isFinite(a.duration) && setDuration(a.duration);
    const onPlay = () => {
      setPlaying(true);
      // רק נגן אחד מנגן בכל רגע
      window.dispatchEvent(new CustomEvent('saba:audio-play', { detail: a }));
    };
    const onPause = () => setPlaying(false);
    const onEnd = () => {
      setPlaying(false);
      endedRef.current?.();
    };
    const onWaiting = () => setLoading(true);
    const onCanPlay = () => setLoading(false);
    const onError = () => {
      setError(true);
      setLoading(false);
    };
    const onOther = (e: Event) => {
      if ((e as CustomEvent).detail !== a) a.pause();
    };
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('durationchange', onMeta);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnd);
    a.addEventListener('waiting', onWaiting);
    a.addEventListener('canplay', onCanPlay);
    a.addEventListener('playing', onCanPlay);
    a.addEventListener('error', onError);
    window.addEventListener('saba:audio-play', onOther);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('durationchange', onMeta);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnd);
      a.removeEventListener('waiting', onWaiting);
      a.removeEventListener('canplay', onCanPlay);
      a.removeEventListener('playing', onCanPlay);
      a.removeEventListener('error', onError);
      window.removeEventListener('saba:audio-play', onOther);
    };
  }, []);

  useEffect(() => {
    ref.current!.playbackRate = rate;
  }, [rate]);

  // השמעה ברצף — ההקלטה הקודמת הסתיימה, ממשיכים לזו
  useEffect(() => {
    if (!autoPlay) return;
    const a = ref.current!;
    a.closest('.card')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    a.play().catch(() => undefined);
  }, [autoPlay]);

  const startPlay = () => {
    const a = ref.current!;
    a.playbackRate = rate;
    a.play().catch(() => setError(true));
    // הקלטה ישנה בלי גל קול — מחשבים פעם אחת מהקובץ ושומרים
    if (!peaks && itemId) ensureWaveform(itemId, src, fileSize).then((p) => p && setPeaks(p));
  };
  const toggle = () => {
    const a = ref.current!;
    if (a.paused) startPlay();
    else a.pause();
  };
  const skip = (d: number) => {
    const a = ref.current!;
    a.currentTime = Math.max(0, Math.min((duration ?? a.duration) || 0, a.currentTime + d));
    setTime(a.currentTime);
  };
  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    try {
      localStorage.setItem(RATE_KEY, String(next));
    } catch {
      /* לא חובה */
    }
  };
  const max = duration ?? 0;
  const pct = max ? Math.min(100, (time / max) * 100) : 0;
  const started = time > 0 || playing;
  const rateLabel = `${String(rate).replace(/^0\./, '.')}×`;

  return (
    <div className={`player ${compact ? 'player--compact' : ''} ${playing ? 'is-playing' : ''}`}>
      <audio ref={ref} src={src} preload="none" />
      <div className="player__controls">
        <button className="player__skip" onClick={() => skip(-15)} aria-label="אחורה 15 שניות">
          <Icon name="back15" />
          <span>15</span>
        </button>
        <button className={`player__main ${loading ? 'is-loading' : ''}`} onClick={toggle} aria-label={playing ? `השהיית ${title}` : `השמעת ${title}`}>
          <Icon name={playing ? 'pause' : 'play'} size={compact ? 26 : 32} />
        </button>
        <button className="player__skip" onClick={() => skip(15)} aria-label="קדימה 15 שניות">
          <Icon name="fwd15" />
          <span>15</span>
        </button>
        <button className="player__rate" onClick={cycleRate} aria-label={`מהירות השמעה: ${rate}`}>
          {rateLabel}
        </button>
      </div>
      <div className="player__track" dir="ltr">
        <span className="player__time">{formatDuration(time)}</span>
        <div className={`wave ${peaks ? '' : 'wave--flat'}`} style={{ '--pct': `${pct}%` } as React.CSSProperties}>
          {peaks ? (
            <>
              <WaveBars peaks={peaks} className="wave__bars" />
              <WaveBars peaks={peaks} className="wave__bars wave__bars--played" />
            </>
          ) : (
            <span className="wave__line" aria-hidden="true" />
          )}
          <span className="wave__head" aria-hidden="true" />
          <input
            type="range"
            className="wave__range"
            min={0}
            max={max || 1}
            step={0.1}
            value={Math.min(time, max || 1)}
            onChange={(e) => {
              ref.current!.currentTime = Number(e.target.value);
              setTime(Number(e.target.value));
            }}
            aria-label="מיקום בהקלטה"
            aria-valuetext={`${formatDuration(time)} מתוך ${formatDuration(duration)}`}
          />
        </div>
        <span className="player__time" aria-label={started ? 'זמן שנותר' : 'אורך ההקלטה'}>
          {started && max ? `−${formatDuration(Math.max(0, max - time))}` : formatDuration(duration)}
        </span>
      </div>
      {error && <p className="player__error">לא ניתן להשמיע את הקובץ בדפדפן זה. אפשר להוריד את קובץ המקור ולהשמיע במכשיר.</p>}
    </div>
  );
}

/** עמודות גל הקול (SVG) — אותו ציור פעמיים: בסיס, ושכבת ״הושמע״ שנחשפת לפי ההתקדמות */
function WaveBars({ peaks, className }: { peaks: number[]; className: string }) {
  const w = 3;
  return (
    <svg className={className} viewBox={`0 0 ${peaks.length * w} 40`} preserveAspectRatio="none" aria-hidden="true">
      {peaks.map((v, i) => {
        const h = Math.max(2, (v / 99) * 38);
        return <rect key={i} x={i * w + 0.5} y={(40 - h) / 2} width={2} height={h} rx={1} />;
      })}
    </svg>
  );
}
