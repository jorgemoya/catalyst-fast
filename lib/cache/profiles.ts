/**
 * `cacheLife` profiles, shared between `next.config.ts` (registration) and the
 * `cacheLife('<name>')` calls in `data/`.
 *
 * Three floors from `next/dist/server/use-cache/constants.js` are hard design
 * constraints, not tuning knobs:
 *
 *   MIN_PRERENDERABLE_EXPIRE = 300  — below this `expire`, the entry can never
 *                                     be prerendered at all.
 *   MIN_SHELL_STALE          = 300  — below this `stale`, the entry is EXCLUDED
 *                                     from the static shell. This is the line
 *                                     between "in the shell" and "a hole".
 *   MIN_PREFETCHABLE_STALE   = 30   — below this `stale`, the scope drops out
 *                                     of prefetches entirely. Never go under.
 *
 * So the `stale` value is the load-bearing decision on each profile: `stale: 300`
 * is a deliberate choice to put that data in the prerendered shell, and anything
 * under 300 is a deliberate choice to make it a streamed hole.
 *
 * Treat `revalidate` as a safety net only. Freshness is driven by BigCommerce
 * webhooks calling `revalidateTag` (see `app/api/webhooks/bigcommerce`), which is
 * what turns origin QPS from "proportional to traffic" into "proportional to
 * catalog change rate".
 */

export interface CacheProfile {
  /** Client may serve this without re-checking the server, in seconds. */
  stale: number;
  /** After this many seconds, refresh in the background on the next request. */
  revalidate: number;
  /** With no traffic for this long, the entry is dropped. */
  expire: number;
}

export const MIN_PRERENDERABLE_EXPIRE = 300;
export const MIN_SHELL_STALE = 300;
export const MIN_PREFETCHABLE_STALE = 30;

/**
 * Profiles whose data belongs in the **App Shell** — the prefetch payload a
 * `<Link>` fetches ahead of a click. Membership requires `stale >= 300`, so this
 * list is what `assertProfileFloors` checks that floor against.
 *
 * The three below it are deliberately outside the shell: they are either
 * request-shaped (`cart`), high-cardinality (`search`), or too volatile to bake
 * into an artifact reused for minutes (`inventory`).
 */
export const SHELL_PROFILES = [
  'settings',
  'navigation',
  'product',
  'content',
  'reviews',
  'price',
  'listing',
] as const;

/*
 * There is deliberately no `route` profile.
 *
 * The plan called for a `'use cache'` in-app fallback beside the proxy's KV
 * route lookup, and the profile was registered for it. The fallback was never
 * built — `data/routing.ts` has no cached functions at all — so the profile sat
 * with zero consumers, which is the same dead-config pattern that had
 * `channelFor().channelId` silently ignored and `defaultKey` dropping the
 * currency. Registering a profile nothing calls makes the cache model look
 * richer than it is.
 *
 * Route resolution lives entirely in `proxies/with-routes.ts` against KV, with
 * its own 30m/7d window. If the in-app fallback is ever built, add the profile
 * back with it, not before.
 */
export const cacheProfiles = {
  // ── In the static shell (stale >= MIN_SHELL_STALE) ──────────────────────────
  /** Site settings, currencies, tax display, inventory display settings. */
  settings: { stale: 300, revalidate: 3600, expire: 86_400 },
  /** Category tree, header nav, footer links. */
  navigation: { stale: 300, revalidate: 1800, expire: 86_400 },
  /** Product core content: name, description, media, options, specs. */
  product: { stale: 300, revalidate: 900, expire: 86_400 },
  /** Webpages, blog posts — merchant content that changes rarely. */
  content: { stale: 300, revalidate: 3600, expire: 604_800 },
  /** Product reviews (read path). */
  reviews: { stale: 300, revalidate: 3600, expire: 86_400 },
  /**
   * Prices. `stale: 300` is deliberate: it puts the default-variant price in the
   * prerendered shell. Personalized prices never come through here — see
   * `data/customer/pricing.ts`.
   */
  price: { stale: 300, revalidate: 300, expire: 3600 },
  /** Unfiltered / default-key listing pages, which we want in the shell. */
  listing: { stale: 300, revalidate: 600, expire: 7200 },

  // ── Streamed holes by construction (stale < MIN_SHELL_STALE) ───────────────
  /**
   * Inventory. `expire` sits exactly at MIN_PRERENDERABLE_EXPIRE — any lower and
   * it could never be prerendered even in principle.
   */
  inventory: { stale: 60, revalidate: 30, expire: 300 },
  /** Filtered listings and search results. High key cardinality. */
  search: { stale: 60, revalidate: 300, expire: 1800 },
  /** Cart by id. Invalidated precisely by `updateTag(tags.cart(id))`. */
  cart: { stale: 30, revalidate: 60, expire: 300 },
} as const satisfies Record<string, CacheProfile>;


/**
 * Guards the floors above at module load, so a bad edit fails fast in `next.config.ts`
 * rather than silently dropping a route out of the static shell months later.
 *
 * Takes the profiles as an argument, defaulted to the real ones, purely so
 * `profiles.spec.ts` can prove each branch actually throws. A guard nobody has
 * watched fire is indistinguishable from a guard that does not work.
 */
export function assertProfileFloors(profiles: Record<string, CacheProfile> = cacheProfiles): void {
  for (const [name, profile] of Object.entries(profiles)) {
    if (profile.expire < MIN_PRERENDERABLE_EXPIRE) {
      throw new Error(
        `cacheLife profile "${name}" has expire=${profile.expire}, below MIN_PRERENDERABLE_EXPIRE ` +
          `(${MIN_PRERENDERABLE_EXPIRE}). It could never be prerendered.`,
      );
    }

    if (profile.stale < MIN_PREFETCHABLE_STALE) {
      throw new Error(
        `cacheLife profile "${name}" has stale=${profile.stale}, below MIN_PREFETCHABLE_STALE ` +
          `(${MIN_PREFETCHABLE_STALE}). It would drop out of prefetches.`,
      );
    }

    if ((SHELL_PROFILES as readonly string[]).includes(name) && profile.stale < MIN_SHELL_STALE) {
      throw new Error(
        `cacheLife profile "${name}" is listed in SHELL_PROFILES but has stale=${profile.stale}, ` +
          `below MIN_SHELL_STALE (${MIN_SHELL_STALE}). Its data would silently drop out of the ` +
          `App Shell — prefetched links would render a skeleton instead of content.`,
      );
    }

    if (profile.revalidate > profile.expire) {
      throw new Error(
        `cacheLife profile "${name}" has revalidate=${profile.revalidate} > expire=${profile.expire}. ` +
          `The entry would expire before it ever refreshed.`,
      );
    }
  }
}

assertProfileFloors();
