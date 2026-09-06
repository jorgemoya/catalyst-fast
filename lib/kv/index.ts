import { MemoryKvAdapter, SHARED_STORE_RECHECK_MS } from './adapters/memory.ts';
import type { KvAdapter, SetCommandOptions } from './types.ts';

interface Config {
  logger?: boolean;
}

/**
 * L1 in front of whichever adapter `createKVAdapter` selects. Expires so a
 * process periodically re-reads the shared store and picks up values other
 * processes wrote.
 */
const memoryKv = new MemoryKvAdapter({ ttlMs: SHARED_STORE_RECHECK_MS });

/**
 * Note the explicit field declarations and assignments below, rather than
 * TypeScript parameter properties.
 *
 * This module is reachable from `lib/cache/handlers/kv.ts`, and Next loads a
 * cache handler through Node's **type-stripping** loader — which only accepts
 * erasable TypeScript. A parameter property has runtime meaning, so it fails
 * with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` and takes the whole build with it.
 * Same reason every import in this subtree carries an explicit `.ts` extension.
 */
class KV<Adapter extends KvAdapter> implements KvAdapter {
  private kv?: Adapter;
  private memoryKv = memoryKv;
  private createAdapter: () => Promise<Adapter>;
  private config: Config;

  constructor(createAdapter: () => Promise<Adapter>, config: Config = {}) {
    this.createAdapter = createAdapter;
    this.config = config;
  }

  async get<Data>(key: string): Promise<Data | null> {
    const [value] = await this.mget<Data>(key);

    return value ?? null;
  }

  async mget<Data>(...keys: string[]): Promise<Array<Data | null>> {
    const memoryValues = (await this.memoryKv.mget<Data>(...keys)).filter(Boolean);

    // Only short-circuit on a complete hit. A partial hit still needs the shared
    // store, and mixing the two would misalign values with keys.
    if (memoryValues.length === keys.length) {
      this.log(`MGET (L1) - Keys: ${keys.toString()}`);

      return memoryValues;
    }

    const kv = await this.getKv();
    const values = await kv.mget<Data>(...keys);

    this.log(`MGET - Keys: ${keys.toString()}`);

    await Promise.all(
      values.map(async (value, index) => {
        const key = keys[index];

        if (key) {
          await this.memoryKv.set(key, value);
        }
      }),
    );

    return values;
  }

  async set<Data>(key: string, value: Data, opts?: SetCommandOptions): Promise<Data | null> {
    const kv = await this.getKv();

    this.log(`SET - Key: ${key}`);

    await Promise.all([this.memoryKv.set(key, value, opts), kv.set(key, value, opts)]);

    return value;
  }

  private async getKv(): Promise<Adapter> {
    this.kv ??= await this.createAdapter();

    return this.kv;
  }

  private log(message: string): void {
    if (this.config.logger) {

      console.log(`[BigCommerce] KV ${message}`);
    }
  }
}

/**
 * Runtime-detected adapter selection, in priority order. Exported for tests: the
 * choice depends on ambient state (env vars, the Cloudflare context global) that
 * can't be observed through the memoized singleton below.
 */
export async function createKVAdapter(): Promise<KvAdapter> {
  // Regionally colocated with the function on Vercel, so cheapest by far.
  if (process.env.VERCEL === '1') {
    const { RuntimeCacheAdapter } = await import('./adapters/vercel-runtime-cache.ts');

    return new RuntimeCacheAdapter();
  }

  // On Cloudflare Workers each project gets its own KV namespace bound as
  // CATALYST_ROUTES_KV. `getRoutesKvNamespace` returns null on every other
  // runtime, so this is a no-op off Cloudflare.
  const { CloudflareKvAdapter, getRoutesKvNamespace } = await import('./adapters/cloudflare-kv.ts');
  const routesKvNamespace = getRoutesKvNamespace();

  if (routesKvNamespace) {
    return new CloudflareKvAdapter(routesKvNamespace);
  }

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const { UpstashKvAdapter } = await import('./adapters/upstash.ts');

    return new UpstashKvAdapter();
  }

  // Deliberately unbounded in time, unlike the L1 above. This is the fallback
  // when no shared store is configured, so there is nothing to re-read: expiring
  // here would empty both layers together and leave `with-routes` with no cached
  // value, sending every request past the window into a blocking origin fetch
  // rather than its intended background refresh.
  return new MemoryKvAdapter();
}

const adapterInstance = new KV(createKVAdapter, {
  logger:
    (process.env.NODE_ENV !== 'production' && process.env.KV_LOGGER !== 'false') ||
    process.env.KV_LOGGER === 'true',
});

export { adapterInstance as kv };
export type { KvAdapter, SetCommandOptions };
