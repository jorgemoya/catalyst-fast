import 'server-only';

import { locale } from 'next/root-params';

import { DEFAULT_LOCALE } from '~/lib/config/channels';

/**
 * The active locale, for cached catalog reads.
 *
 * **Reading this inside a `use cache` body does two jobs at once**, and they must
 * stay together:
 *
 *  1. it supplies `Accept-Language`, so BigCommerce returns the right
 *     translations for product names, descriptions and category names;
 *  2. it puts the locale in the **cache key**, because a `use cache` entry
 *     includes the root params read within its body.
 *
 * Doing only the first would be a correctness bug. Measured before this existed:
 * `/es/garden/` reused 14 of the 15 entries warmed by `/en/garden/`, so a
 * translated catalog would have served Spanish shoppers whatever language
 * happened to warm the entry first.
 *
 * **Not usable everywhere.** `next/root-params` is rejected in Route Handlers
 * and in the proxy — Turbopack fails the build with "'next/root-params' can only
 * be used inside the App Directory". So this lives in `data/` rather than in the
 * BigCommerce client, and `data/settings.ts` deliberately does not use it,
 * because `app/api/events/route.ts` imports that module.
 */
// cache-audit: dynamic — reads the locale root param rather than BigCommerce.
// It must NOT be cached: its whole purpose is to be read *inside* a caller's
// cached body so the locale lands in that caller's key.
export async function activeLocale(): Promise<string> {
  return (await locale()) ?? DEFAULT_LOCALE;
}
