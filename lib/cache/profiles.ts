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
 * **`revalidate` is the freshness guarantee.** There are no BigCommerce webhooks
 * (a decision, recorded in the plan's Phase 9), so a product edit shows up within
 * the `product` profile's `revalidate`, a settings change within `settings`'s.
 * Raising these trades freshness for origin load directly.
 *
 * **Which directive.** Profiles say *how long*; the directive says *where*.
 * Shared catalog reads in `data/` are `'use cache: remote'`. Plain `'use cache'`
 * is per-instance memory, and measured on a fresh `next start`, every page —
 * prebuilt or not — re-ran its header, settings and page reads to render its
 * request-time parts: 13 shared reads plus the page's own, per instance. On
 * serverless, where instances are many and short-lived, that is paid again and
 * again against BigCommerce's rate limit. Remote makes it once per region.
 * Plain `'use cache'` is kept only for build-time reads (`getProductIds` and
 * friends), where there is no instance to share with. Self-hosted without
 * `CACHE_HANDLER=kv`, remote falls back to the same in-memory handler, so the
 * choice costs nothing there.
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
  // Private, per-shopper — but session data rides in the App Shell too (Next's
  // partial-prefetching docs: "the App Shell still carries session content").
  'session',
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
  /*
   * **`stale: 3600` on everything a product or unfiltered listing page
   * caches** — settings, navigation, product, reviews, listing, session. `stale` is *client-side only*: how long the browser keeps a
   * visited page before asking the server again, and the shortest `stale` in a
   * page wins for the whole page. These are the profiles a product page is made
   * of, so together they let a revisit within the hour render with no request
   * and no skeleton. The parts that genuinely change by the minute — default
   * price and stock — are not cached into the page at all; they stream at
   * request time into their own boundary (`StreamedDefaultVariant`). The server
   * keeps refreshing on `revalidate` regardless; a reload always gets it.
   */
  /** Site settings, currencies, tax display, inventory display settings. */
  settings: { stale: 3600, revalidate: 3600, expire: 86_400 },
  /** Category tree, header nav, footer links, a category's subcategories. */
  navigation: { stale: 3600, revalidate: 1800, expire: 86_400 },
  /** Product core content: name, description, media, options, specs. */
  product: { stale: 3600, revalidate: 900, expire: 86_400 },
  /** Webpages, blog posts — merchant content that changes rarely. */
  content: { stale: 300, revalidate: 3600, expire: 604_800 },
  /** Product reviews (read path). */
  reviews: { stale: 3600, revalidate: 3600, expire: 86_400 },
  /**
   * Prices. On the product page they render at request time, so this `stale`
   * no longer limits how long that page is kept; listing cards still carry
   * their price in the shell. Personalized prices never come through here — see
   * `data/customer/pricing.ts`.
   */
  price: { stale: 300, revalidate: 300, expire: 3600 },
  /**
   * Unfiltered / default-key listing pages, which we want in the shell.
   *
   * `stale: 3600` like the product page, so a category revisited within the
   * hour renders from the browser. Unlike the product page, the grid *is* the
   * page and can't stream separately, so card prices and out-of-stock badges
   * can be up to an hour old on such a revisit. Accepted: the server still
   * refreshes every `revalidate`, a reload gets it, and the product page a
   * shopper clicks through to always streams live price and stock.
   */
  listing: { stale: 3600, revalidate: 600, expire: 7200 },

  // ── Streamed holes by construction (stale < MIN_SHELL_STALE) ───────────────
  /**
   * Inventory. `expire` sits exactly at MIN_PRERENDERABLE_EXPIRE — any lower and
   * it could never be prerendered even in principle.
   */
  inventory: { stale: 60, revalidate: 30, expire: 300 },
  /**
   * Filtered, sorted and paginated listings, and search results. High key
   * cardinality — one entry per filter combination — so it stays out of the
   * prefetched App Shell.
   *
   * Raising `stale` here does **not** keep these views in the browser: they
   * read `searchParams`, so they render at request time, and the browser keeps
   * request-time data for `staleTimes.dynamic` (default 0) regardless of
   * `stale`. Measured: a sorted view revisited after 5s was refetched with
   * `stale: 299`. On revisit the cached unfiltered grid shows first (the nested
   * fallback) and the refined results swap in.
   */
  search: { stale: 60, revalidate: 300, expire: 1800 },
  /** Cart by id. Invalidated precisely by `updateTag(tags.cart(id))`. */
  cart: { stale: 30, revalidate: 60, expire: 300 },

  // ── Per-shopper, in the browser ────────────────────────────────────────────
  /**
   * `'use cache: private'` reads of the shopper's own state: cart badge, account
   * menu, wishlist hearts, selected currency, personalized price. Only `stale`
   * means anything here — these never reach a server store.
   *
   * **An hour, not 30 seconds, because the shortest `stale` in a page sets how
   * long the browser keeps the *whole* page.** At 30s, these per-shopper
   * bits made the router drop every product page half a minute after a visit:
   * clicking back to a warm product showed the full-page skeleton (measured: no
   * skeleton at 5s, skeleton at 40s, 75s and 200s). Product content can't sit
   * in the prefetched App Shell — it depends on `params` — so nothing covered
   * for it.
   *
   * Nothing a shopper does is delayed by this: every action that changes this
   * state calls `refresh()`, and the currency switch sets a cookie, which also
   * clears the browser's cache. What can lag, up to an hour in a tab left
   * open, is a change made *elsewhere* — another tab, another device, a price
   * list edited in the control panel.
   */
  session: { stale: 3600, revalidate: 3600, expire: 3600 },
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
