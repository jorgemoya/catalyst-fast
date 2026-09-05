import { kv } from '~/lib/kv';

/**
 * A Next.js `CacheHandler` backed by the same KV infrastructure the proxy uses
 * for route resolution. This is what makes `'use cache: remote'` real when
 * self-hosting — on Vercel the platform supplies its own handler and this file
 * is never registered (see the `CACHE_HANDLER` check in next.config.ts).
 *
 * Interface per `next/dist/server/lib/cache-handlers/types.d.ts`. Three details
 * in that contract drive most of the code here:
 *
 *  1. `CacheEntry.value` is a `ReadableStream`, not a buffer. It must be fully
 *     drained before storing, and a *fresh* stream handed out on every `get` —
 *     a stream can only be read once.
 *  2. `set` receives a *pending* promise whose stream may still be filling, and
 *     a concurrent `get` for the same key must wait for it rather than miss.
 *  3. The stream may error partway with partial data. A partial entry must not
 *     be stored, or we'd serve truncated RSC payloads.
 *
 * Tag invalidation is a separate manifest: `revalidateTag`/`updateTag` land in
 * `updateTags`, which records a revalidation timestamp per tag. `getExpiration`
 * then reports the newest such timestamp, and any entry older than it is stale.
 */

type Timestamp = number;

interface CacheEntry {
  value: ReadableStream<Uint8Array>;
  tags: string[];
  stale: number;
  timestamp: Timestamp;
  expire: number;
  revalidate: number;
}

/** What actually goes into KV. `value` is base64 because KV stores JSON. */
interface StoredEntry {
  value: string;
  tags: string[];
  stale: number;
  timestamp: Timestamp;
  expire: number;
  revalidate: number;
}

const ENTRY_PREFIX = 'nc:entry:';
const TAG_PREFIX = 'nc:tag:';

const encodeValue = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const decodeValue = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'base64'));

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  // Any error here propagates to the caller, which is what we want: `set` then
  // declines to store rather than persisting a truncated payload.
  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    total += value.length;
  }

  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

const toStream = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

class KvCacheHandler {
  /**
   * In-flight `set` operations. Without this, a `get` arriving between `set`
   * being called and the write landing in KV would report a miss and trigger a
   * duplicate origin fetch — exactly the stampede this handler exists to prevent.
   */
  private pending = new Map<string, Promise<void>>();

  /**
   * Local view of tag revalidation timestamps, refreshed per request via
   * `refreshTags`. Avoids a KV round trip per tag on every cache read.
   */
  private tagManifest = new Map<string, Timestamp>();

  async get(cacheKey: string, softTags: string[]): Promise<CacheEntry | undefined> {
    // Wait out an in-flight write for this key before declaring a miss.
    await this.pending.get(cacheKey);

    const stored = await kv.get<StoredEntry>(`${ENTRY_PREFIX}${cacheKey}`);

    if (!stored) {
      return undefined;
    }

    const ageSeconds = (Date.now() - stored.timestamp) / 1000;

    if (ageSeconds > stored.expire) {
      return undefined;
    }

    // Both the entry's own tags and the soft tags Next passes in can invalidate it.
    const invalidatedAt = await this.getExpiration([...stored.tags, ...softTags]);

    if (invalidatedAt > stored.timestamp) {
      return undefined;
    }

    return {
      // A fresh stream per get — streams are single-use.
      value: toStream(decodeValue(stored.value)),
      tags: stored.tags,
      stale: stored.stale,
      timestamp: stored.timestamp,
      expire: stored.expire,
      revalidate: stored.revalidate,
    };
  }

  async set(cacheKey: string, pendingEntry: Promise<CacheEntry>): Promise<void> {
    const write = (async () => {
      try {
        const entry = await pendingEntry;
        const bytes = await drain(entry.value);

        const stored: StoredEntry = {
          value: encodeValue(bytes),
          tags: entry.tags,
          stale: entry.stale,
          timestamp: entry.timestamp,
          expire: entry.expire,
          revalidate: entry.revalidate,
        };

        // `ex` bounds the physical lifetime so abandoned keys can't accumulate.
        // Generously longer than `expire` so a logically-stale entry is still
        // present to serve while it revalidates in the background.
        await kv.set(`${ENTRY_PREFIX}${cacheKey}`, stored, { ex: Math.ceil(entry.expire * 2) });
      } catch {
        // Partial or errored stream, or KV unavailable. Store nothing — a cache
        // miss costs an origin fetch; a truncated entry corrupts the response.
      } finally {
        this.pending.delete(cacheKey);
      }
    })();

    this.pending.set(cacheKey, write);

    return write;
  }

  async refreshTags(): Promise<void> {
    // Timestamps are read on demand in `getExpiration` and cached in
    // `tagManifest` for the rest of the request. Clearing here is what scopes
    // that memoization to a single request.
    this.tagManifest.clear();

    return Promise.resolve();
  }

  async getExpiration(tags: string[]): Promise<Timestamp> {
    if (tags.length === 0) {
      return 0;
    }

    const unknown = tags.filter((tag) => !this.tagManifest.has(tag));

    if (unknown.length > 0) {
      const values = await kv.mget<Timestamp>(...unknown.map((tag) => `${TAG_PREFIX}${tag}`));

      unknown.forEach((tag, index) => {
        this.tagManifest.set(tag, values[index] ?? 0);
      });
    }

    return Math.max(0, ...tags.map((tag) => this.tagManifest.get(tag) ?? 0));
  }

  async updateTags(tags: string[], durations?: { expire?: number }): Promise<void> {
    // `expire: 0` is a hard purge, so date it to now. Anything else marks the tag
    // revalidated as of now too — entries older than this timestamp go stale.
    const revalidatedAt = Date.now();

    await Promise.all(
      tags.map(async (tag) => {
        this.tagManifest.set(tag, revalidatedAt);

        await kv.set(`${TAG_PREFIX}${tag}`, revalidatedAt, {
          ex: durations?.expire ?? 60 * 60 * 24 * 30,
        });
      }),
    );
  }
}

const kvCacheHandler = new KvCacheHandler();

export default kvCacheHandler;
