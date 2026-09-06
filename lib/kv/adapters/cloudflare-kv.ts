import type { KvAdapter, SetCommandOptions } from '../types.ts';

/**
 * Minimal structural view of the Workers KV binding — only the two methods this
 * adapter calls. Declared here rather than imported from `@cloudflare/workers-types`
 * so the app stays free of Cloudflare-only type dependencies.
 */
export interface RoutesKvNamespace {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** The per-project KV namespace bound to the Worker by the deploy platform. */
const ROUTES_KV_BINDING = 'CATALYST_ROUTES_KV';

/**
 * Workers KV entries are permanent unless written with an expiration, and nothing
 * here ever deletes a routing key. Keys include the query string, so without a TTL
 * a crawler walking `?utm_*` permutations would grow the namespace — and its
 * billable write volume — without bound, from unauthenticated requests.
 *
 * Deliberately much longer than the *logical* freshness window `with-routes.ts`
 * enforces via the `expiryTime` inside each value (30 min for routes, 5 for store
 * status). Those timers do different jobs: `expiryTime` decides when to
 * revalidate, this decides when to garbage-collect. Setting them equal would
 * delete each entry exactly as it went stale, turning every stale-while-revalidate
 * hit — which serves instantly and refreshes in the background — into a hard miss
 * that blocks on a GraphQL round trip. That would be slower than no cache at all.
 */
const ROUTES_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * `getCloudflareContext()` from `@opennextjs/cloudflare` is, in sync mode, just a
 * read of this global registry symbol. Reading it directly gets the identical
 * value without importing a package that is deliberately absent from
 * package.json (it's only installed for Cloudflare-hosted deployments), and
 * avoids a static import that would break `next build` everywhere else.
 *
 * !! DRIFT WARNING !!
 * This key is an internal detail of `@opennextjs/cloudflare`, not exported API.
 * If a version bump changes it, this adapter silently returns null and every
 * Cloudflare-hosted store quietly downgrades to an in-process cache — no error,
 * no signal. Re-verify on any `@opennextjs/cloudflare` upgrade.
 */
export const CLOUDFLARE_CONTEXT_SYMBOL_KEY = '__cloudflare-context__';

const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for(CLOUDFLARE_CONTEXT_SYMBOL_KEY);

/**
 * Duck-typed rather than a presence check. A merchant can define an env var
 * literally named `CATALYST_ROUTES_KV`, which arrives as a plain string; a
 * truthiness check would accept it and then throw on the first `.get()`.
 */
export function isRoutesKvNamespace(value: unknown): value is RoutesKvNamespace {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return (
    typeof Reflect.get(value, 'get') === 'function' && typeof Reflect.get(value, 'put') === 'function'
  );
}

/**
 * Resolves the routing cache namespace, or null on any runtime that isn't
 * Cloudflare, any Cloudflare runtime where the binding wasn't provisioned, and
 * the env-var collision case above.
 */
export function getRoutesKvNamespace(): RoutesKvNamespace | null {
  const context: unknown = Reflect.get(globalThis, CLOUDFLARE_CONTEXT_SYMBOL);

  if (typeof context !== 'object' || context === null) {
    return null;
  }

  const env: unknown = Reflect.get(context, 'env');

  if (typeof env !== 'object' || env === null) {
    return null;
  }

  return isRoutesKvNamespace(Reflect.get(env, ROUTES_KV_BINDING))
    ?  
      (Reflect.get(env, ROUTES_KV_BINDING) as RoutesKvNamespace)
    : null;
}

export class CloudflareKvAdapter implements KvAdapter {
  // Explicit field, not a parameter property: this module is reachable from the
  // cache handler, which Node loads in type-stripping mode. See lib/kv/index.ts.
  private namespace: RoutesKvNamespace;

  constructor(namespace: RoutesKvNamespace) {
    this.namespace = namespace;
  }

  async mget<Data>(...keys: string[]): Promise<Array<Data | null>> {
    // Workers KV has no multi-get, so fan out. Each get is guarded individually —
    // one unreachable key shouldn't blank the whole batch.
    return Promise.all(
      keys.map(async (key) => {
        try {
          const value = await this.namespace.get(key, 'json');

          this.log(`GET - Key: ${key} - Found: ${value !== null && value !== undefined}`);


          return (value ?? null) as Data | null;
        } catch (error) {
          this.log(`GET ERROR - Key: ${key} - ${describe(error)}`);

          return null;
        }
      }),
    );
  }

  async set<Data>(key: string, value: Data, _opts?: SetCommandOptions): Promise<Data | null> {
    try {
      await this.namespace.put(key, JSON.stringify(value), {
        expirationTtl: ROUTES_CACHE_TTL_SECONDS,
      });
      this.log(`SET - Key: ${key} - Success`);
    } catch (error) {
      this.log(`SET ERROR - Key: ${key} - ${describe(error)}`);
    }

    return value;
  }

  private log(message: string): void {
    const loggingEnabled =
      (process.env.NODE_ENV !== 'production' && process.env.KV_LOGGER !== 'false') ||
      process.env.KV_LOGGER === 'true';

    if (loggingEnabled) {

      console.log(`[BigCommerce] Cloudflare KV ${message}`);
    }
  }
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';
