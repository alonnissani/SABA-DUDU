import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../lib/media';
import { Icon } from './Icon';

/** נגן שמע מעוצב: הפעלה/עצירה, דילוג 15 שניות, סרגל התקדמות ואורך ההקלטה. */
export function AudioPlayer({ src, knownDuration, title, compact }: { src: string; knownDuration?: number | null; title: string; compact?: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(knownDuration ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

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
    a.addEventListener('ended', onPause);
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
      a.removeEventListener('ended', onPause);
      a.removeEventListener('waiting', onWaiting);
      a.removeEventListener('canplay', onCanPlay);
      a.removeEventListener('playing', onCanPlay);
      a.removeEventListener('error', onError);
      window.removeEventListener('saba:audio-play', onOther);
    };
  }, []);

  const toggle = () => {
    const a = ref.current!;
    if (a.paused) a.play().catch(() => setError(true));
    else a.pause();
  };
  const skip = (d: number) => {
    const a = ref.current!;
    a.currentTime = Math.max(0, Math.min((duration ?? a.duration) || 0, a.currentTime + d));
  };
  const max = duration ?? 0;
  const pct = max ? (time / max) * 100 : 0;

  return (
    <div className={`player ${compact ? 'player--compact' : ''}`}>
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
      </div>
      <div className="player__track" dir="ltr">
        <span className="player__time">{formatDuration(time)}</span>
        <input
          type="range"
          className="player__range"
          min={0}
          max={max || 1}
          step={0.1}
          value={Math.min(time, max || 1)}
          style={{ '--pct': `${pct}%` } as React.CSSProperties}
          onChange={(e) => {
            ref.current!.currentTime = Number(e.target.value);
            setTime(Number(e.target.value));
          }}
          aria-label="מיקום בהקלטה"
          aria-valuetext={`${formatDuration(time)} מתוך ${formatDuration(duration)}`}
        />
        <span className="player__time">{formatDuration(duration)}</span>
      </div>
      {error && <p className="player__error">לא ניתן להשמיע את הקובץ בדפדפן זה. אפשר להוריד את קובץ המקור ולהשמיע במכשיר.</p>}
    </div>
  );
}
