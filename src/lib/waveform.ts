import { api } from '../api/client';

/** מספר העמודות בגל הקול */
export const WAVE_BARS = 160;
/** מעל הגודל הזה לא מפענחים בדפדפן (זיכרון בטלפון) — הנגן מציג פס התקדמות רגיל */
export const WAVE_MAX_BYTES = 80 * 1024 * 1024;

/**
 * גל קול אמיתי מתוך ההקלטה: מפענחים את הקובץ (בקצב דגימה נמוך, כדי לחסוך זיכרון),
 * מחשבים עוצמה (RMS) לכל אחת מ-160 עמודות ומנרמלים ל-0-99. הקובץ עצמו לא משתנה.
 */
export async function computePeaks(data: ArrayBuffer, bars = WAVE_BARS): Promise<number[] | null> {
  try {
    const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx(1, 1, 8000);
    const buf = await ctx.decodeAudioData(data);
    const channels = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    const len = buf.length;
    if (!len) return null;
    const per = len / bars;
    const step = Math.max(1, Math.floor(per / 400));
    const rms: number[] = [];
    for (let b = 0; b < bars; b++) {
      const start = Math.floor(b * per);
      const end = Math.min(len, Math.floor((b + 1) * per));
      let sum = 0;
      let n = 0;
      for (let i = start; i < end; i += step) {
        let v = 0;
        for (const ch of channels) v += ch[i];
        v /= channels.length;
        sum += v * v;
        n++;
      }
      rms.push(n ? Math.sqrt(sum / n) : 0);
    }
    const max = Math.max(...rms);
    if (!max) return rms.map(() => 2);
    // עקומה עדינה — כדי שקטעים שקטים (דיבור רך) עדיין ייראו
    return rms.map((v) => Math.max(2, Math.min(99, Math.round(99 * (v / max) ** 0.7))));
  } catch {
    return null;
  }
}

const pending = new Map<string, Promise<number[] | null>>();

/** גל קול להקלטה קיימת שאין לה עדיין: מחושב מהקובץ (מהמטמון של הדפדפן) ונשמר בשרת פעם אחת */
export function ensureWaveform(itemId: string, src: string, size?: number): Promise<number[] | null> {
  if (size && size > WAVE_MAX_BYTES) return Promise.resolve(null);
  let p = pending.get(itemId);
  if (!p) {
    p = fetch(src, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
      .then((buf) => (buf.byteLength > WAVE_MAX_BYTES ? null : computePeaks(buf)))
      .then(async (peaks) => {
        if (peaks) await api.saveWaveform(itemId, peaks).catch(() => undefined);
        return peaks;
      })
      .catch(() => null);
    pending.set(itemId, p);
  }
  return p;
}
