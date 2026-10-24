/**
 * מטמון קטן בזיכרון של ה-Worker (לכל isolate בנפרד) עם תפוגה קצרה.
 * חוסך שאילתות D1 חוזרות כשגלריה טוענת עשרות תמונות בבת אחת.
 */
export class TtlCache<V> {
  private map = new Map<string, { value: V; until: number }>();
  constructor(private ttlMs: number, private max = 2000) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.until < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, { value, until: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}
