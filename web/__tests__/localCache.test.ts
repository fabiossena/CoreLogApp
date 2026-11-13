/**
 * Unit tests for the local TTL cache used by CoreLogClient (list queries).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LIST_CACHE_TTL_MS,
  LocalCache,
  getOrLoad,
} from '../src/data/cache/localCache';

describe('LocalCache', () => {
  it('returns a value stored within its TTL', () => {
    let clock = 1_000;
    const cache = new LocalCache(() => clock);

    cache.set('devices', ['VEH-001'], 500);

    clock = 1_499;
    expect(cache.get<string[]>('devices')).toEqual(['VEH-001']);
  });

  it('expires a value once the TTL is reached', () => {
    let clock = 1_000;
    const cache = new LocalCache(() => clock);

    cache.set('devices', ['VEH-001'], 500);

    clock = 1_500;
    expect(cache.get<string[]>('devices')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('returns undefined for unknown keys', () => {
    const cache = new LocalCache();
    expect(cache.get('missing')).toBeUndefined();
  });

  it('deletes entries by key prefix', () => {
    const cache = new LocalCache();
    cache.set('panics:{ack:true}', [1], 10_000);
    cache.set('panics:{ack:false}', [2], 10_000);
    cache.set('devices', [3], 10_000);

    cache.deleteByPrefix('panics:');

    expect(cache.get('panics:{ack:true}')).toBeUndefined();
    expect(cache.get('panics:{ack:false}')).toBeUndefined();
    expect(cache.get('devices')).toEqual([3]);
  });
});

describe('getOrLoad', () => {
  it('loads once and serves the following calls from the cache', async () => {
    const cache = new LocalCache();
    const loader = vi.fn(async () => ['VEH-001']);

    const first = await getOrLoad(cache, 'devices', DEFAULT_LIST_CACHE_TTL_MS, loader);
    const second = await getOrLoad(cache, 'devices', DEFAULT_LIST_CACHE_TTL_MS, loader);

    expect(first).toEqual(['VEH-001']);
    expect(second).toEqual(['VEH-001']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('loads again after the entry expired', async () => {
    let clock = 0;
    const cache = new LocalCache(() => clock);
    let callCount = 0;
    const loader = vi.fn(async (): Promise<string> => {
      callCount += 1;
      return callCount === 1 ? 'first' : 'second';
    });

    expect(await getOrLoad(cache, 'key', 100, loader)).toBe('first');
    clock = 100;
    expect(await getOrLoad(cache, 'key', 100, loader)).toBe('second');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
