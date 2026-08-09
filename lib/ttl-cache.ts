export class BoundedTtlCache<T> {
  private readonly data = new Map<string, { at: number; value: T }>();
  constructor(private readonly maxEntries: number, private readonly ttlMs: number) {
    if (maxEntries < 1 || ttlMs < 1) throw new Error("invalid cache bounds");
  }
  get(key: string, now = Date.now()): T | undefined {
    const hit = this.data.get(key);
    if (!hit) return undefined;
    if (now - hit.at >= this.ttlMs) { this.data.delete(key); return undefined; }
    this.data.delete(key);
    this.data.set(key, hit);
    return hit.value;
  }
  set(key: string, value: T, now = Date.now()) {
    this.data.delete(key);
    this.data.set(key, { at: now, value });
    while (this.data.size > this.maxEntries) {
      const first = this.data.keys().next().value as string | undefined;
      if (first == null) break;
      this.data.delete(first);
    }
  }
  get size() { return this.data.size; }
}
