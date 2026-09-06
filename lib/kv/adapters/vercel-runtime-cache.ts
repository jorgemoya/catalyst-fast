import { getCache } from '@vercel/functions';

import type { KvAdapter, SetCommandOptions } from '../types.ts';

const loggingEnabled = (): boolean =>
  (process.env.NODE_ENV !== 'production' && process.env.KV_LOGGER !== 'false') ||
  process.env.KV_LOGGER === 'true';

/**
 * Vercel Runtime Cache. Preferred on Vercel because it's regionally colocated
 * with the function, so a hit costs far less than a round trip to Upstash.
 *
 * Every read is individually guarded: one unreachable key must not blank the
 * whole batch, and a cache outage must degrade to an origin fetch rather than
 * a 500.
 */
export class RuntimeCacheAdapter implements KvAdapter {
  private cache = getCache();

  async mget<Data>(...keys: string[]): Promise<Array<Data | null>> {
    try {
      const values = await Promise.all(
        keys.map(async (key) => {
          try {
            const cachedValue: unknown = await this.cache.get(key);

            this.log(`GET - Key: ${key} - Found: ${cachedValue !== null}`);

            return cachedValue ?? null;
          } catch (error) {
            this.log(`GET ERROR - Key: ${key} - ${describe(error)}`);

            return null;
          }
        }),
      );


      return values as Array<Data | null>;
    } catch (error) {
      this.log(`ACCESS ERROR - returning null values - ${describe(error)}`);

      return keys.map(() => null);
    }
  }

  async set<Data>(key: string, value: Data, _opts?: SetCommandOptions): Promise<Data | null> {
    try {
      await this.cache.set(key, value);
      this.log(`SET - Key: ${key} - Success`);
    } catch (error) {
      this.log(`SET ERROR - Key: ${key} - ${describe(error)}`);
    }

    return value;
  }

  private log(message: string): void {
    if (loggingEnabled()) {

      console.log(`[BigCommerce] Runtime Cache ${message}`);
    }
  }
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';
