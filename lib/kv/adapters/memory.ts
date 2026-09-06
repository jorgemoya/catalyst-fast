import { LRUCache } from 'lru-cache';

import type { KvAdapter } from '../types.ts';

interface CacheEntry {
  value: unknown;
}

/**
 * How long the L1 copy of a value survives before `KV.mget` consults the shared
 * store again. `KV.mget` skips the shared store whenever memory holds every
 * requested key, so without an expiry that short-circuit would be permanent: the
 * only thing left driving refreshes would be the `expiryTime` callers embed in
 * the value, which refetches from the *origin* rather than re-reading the shared
 * store. Expiring here is what lets one process pick up a value another process
 * already fetched.
 *
 * 60s matches Workers KV's floor for `cacheTtl` on a read, so there's one
 * staleness window rather than one per layer. It stays inside the shortest
 * window callers embed — 5 minutes for store status, 30 for routes.
 */
export const SHARED_STORE_RECHECK_MS = 60_000;

/**
 * Bounds memory under key churn. Cache keys include the query string, so distinct
 * keys accumulate far faster than the number of real paths suggests.
 *
 * Configurable because the right value scales with catalog size. A store with
 * 1000 categories and 1000 brands has ~2000 route keys before products or any
 * `?utm_*` variants, so the 4096 default would thrash: entries evict before the
 * 60s recheck window expires, and every eviction sends a request down
 * `with-routes`' blocking origin fetch instead of its background refresh.
 *
 * Entries are small (a resolved route node plus an expiry timestamp), so raising
 * this is cheap — budget roughly a few hundred bytes each.
 */
const MAX_ENTRIES = Number(process.env.KV_MEMORY_MAX_ENTRIES ?? 4096);

interface MemoryKvAdapterOptions {
  /** Omit for an unbounded window: entries then leave only by LRU eviction. */
  ttlMs?: number;
}

export class MemoryKvAdapter implements KvAdapter {
  private kv: LRUCache<string, CacheEntry>;

  constructor({ ttlMs }: MemoryKvAdapterOptions = {}) {
    this.kv = new LRUCache<string, CacheEntry>({
      max: MAX_ENTRIES,
      // lru-cache rejects a non-positive ttl, so omit the key rather than pass 0.
      ...(ttlMs === undefined ? {} : { ttl: ttlMs }),
      // Deliberately NOT allowStale. Serving an expired entry needs a background
      // refresh to replace it, and `mget` has no waitUntil handle to run one on —
      // a stale value would never be replaced. Expired reads fall through instead.
      //
      // ttlResolution: 0 reads the clock on every lookup rather than debouncing
      // behind a 1ms setTimeout, avoiding a timer per operation on runtimes where
      // timers are tied to the request lifetime.
      ttlResolution: 0,
    });
  }

  async mget<Data>(...keys: string[]): Promise<Array<Data | null>> {
    // LRUCache.get returns undefined past the TTL, so expiry is the cache's job
    // rather than a hand-rolled expiresAt check.
     
    return keys.map((key) => this.kv.get(key)?.value ?? null) as Array<Data | null>;
  }

  async set<Data>(key: string, value: Data, options: { ex?: number } = {}): Promise<Data | null> {
    // `ex` overrides the default window for this entry only.
    this.kv.set(key, { value }, options.ex ? { ttl: options.ex * 1000 } : undefined);

    return value;
  }
}
