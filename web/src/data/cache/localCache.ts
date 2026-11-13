/**
 * Data layer: small in-memory local cache with TTL.
 *
 * MVVM best practice: a viewmodel should not hit the network on every render
 * cycle or navigation. `CoreLogClient` consults this cache before issuing
 * list queries (devices, panics, trackers, command history, position pages),
 * which keeps the dashboard responsive and reduces backend load.
 *
 * Deliberately simple (YAGNI): a Map of values with absolute expiration
 * timestamps, no LRU, no persistence, no invalidation policies beyond
 * prefix deletion.
 */

/** Minimal cache contract — declared here so clients depend on an abstraction. */
export interface CacheLike {
  /** Returns the cached value, or `undefined` when missing or expired. */
  get<T>(key: string): T | undefined;
  /** Stores a value that expires after `ttlMs` milliseconds. */
  set<T>(key: string, value: T, ttlMs: number): void;
  /** Removes a single entry. Returns `true` when an entry was removed. */
  delete(key: string): boolean;
  /** Removes every entry whose key starts with `prefix`. */
  deleteByPrefix(prefix: string): void;
  /** Removes every entry. */
  clear(): void;
  /** Number of live (non-expired) entries. */
  readonly size: number;
}

interface CacheEntry {
  value: unknown;
  expiresAtMs: number;
}

/** Default TTL for list-query cache entries (10 seconds). */
export const DEFAULT_LIST_CACHE_TTL_MS = 10_000;

/**
 * In-memory TTL cache.
 *
 * @example
 * ```ts
 * const cache = new LocalCache();
 * cache.set('devices', devices, 5_000);
 * cache.get<Device[]>('devices'); // undefined after 5 seconds
 * ```
 */
export class LocalCache implements CacheLike {
  private readonly entries = new Map<string, CacheEntry>();

  /**
   * @param now - Clock function, injectable so tests can control time.
   */
  constructor(private readonly now: () => number = Date.now) {}

  /** {@inheritDoc CacheLike.get} */
  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAtMs <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  /** {@inheritDoc CacheLike.set} */
  set<T>(key: string, value: T, ttlMs: number): void {
    this.entries.set(key, { value, expiresAtMs: this.now() + ttlMs });
  }

  /** {@inheritDoc CacheLike.delete} */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /** {@inheritDoc CacheLike.deleteByPrefix} */
  deleteByPrefix(prefix: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }

  /** {@inheritDoc CacheLike.clear} */
  clear(): void {
    this.entries.clear();
  }

  /** {@inheritDoc CacheLike.size} — expired entries are purged while counting. */
  get size(): number {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMs <= now) {
        this.entries.delete(key);
      }
    }
    return this.entries.size;
  }
}

/**
 * Cache-aside helper: returns the cached value when present, otherwise loads
 * it with `loader` and stores it for `ttlMs` milliseconds.
 *
 * @param cache - Cache to consult.
 * @param key - Cache key.
 * @param ttlMs - Time to live for freshly stored values.
 * @param loader - Fallback loader executed only on a cache miss.
 * @returns The cached or freshly loaded value.
 */
export async function getOrLoad<T>(
  cache: CacheLike,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = cache.get<T>(key);
  if (hit !== undefined) {
    return hit;
  }
  const value = await loader();
  cache.set(key, value, ttlMs);
  return value;
}
