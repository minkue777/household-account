interface CacheEntry<TValue> {
  readonly value: TValue;
  readonly expiresAtMillis: number;
}

/**
 * Cloud Functions warm instance 안에서만 사용하는 작은 LRU/TTL 캐시입니다.
 * 권한이나 설정의 영구 저장소를 대체하지 않으며 인스턴스 재시작 시 자연스럽게 비워집니다.
 */
export class BoundedTtlCache<TKey, TValue> {
  private readonly entries = new Map<TKey, CacheEntry<TValue>>();

  constructor(
    private readonly options: {
      readonly ttlMillis: number;
      readonly maxEntries: number;
      readonly now?: () => number;
    },
  ) {
    if (
      !Number.isSafeInteger(options.ttlMillis) ||
      options.ttlMillis <= 0 ||
      !Number.isSafeInteger(options.maxEntries) ||
      options.maxEntries <= 0
    ) {
      throw new Error("BOUNDED_TTL_CACHE_OPTIONS_INVALID");
    }
  }

  get(key: TKey): TValue | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAtMillis <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // Map insertion order를 LRU 순서로 사용합니다.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: TKey, value: TValue): void {
    this.removeExpired();
    this.entries.delete(key);
    while (this.entries.size >= this.options.maxEntries) {
      const oldest = this.entries.keys().next().value as TKey | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, {
      value,
      expiresAtMillis: this.now() + this.options.ttlMillis,
    });
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMillis <= now) this.entries.delete(key);
    }
  }
}
