import type { NextRequest } from 'next/server';

import { DEFAULT_LOCALE, isLocale } from '~/lib/config/channels';

/**
 * Locale detection and prefixing for the proxy.
 *
 * The app is structured as `app/[locale]/…` so locale is a **root param**, which
 * is the only way to read it inside `use cache` without prop drilling. But a
 * root param is a URL segment, and this store has exactly one locale — so
 * exposing `/en/garden/` would change every indexed URL on a live storefront to
 * say something no shopper needs to see.
 *
 * The prefix is therefore an *internal* detail. Public URLs are unchanged; the
 * proxy rewrites `/garden/` to `/en/garden/` on the way in. When a second locale
 * ships, `/fr/garden/` starts working with no routing changes — only an entry in
 * `lib/config/channels.ts`.
 *
 * The consequence to keep in mind: **the locale prefix must be added to every
 * rewrite target**, including the pass-through case. A rewrite that forgets it
 * lands on a path with no matching route and 404s.
 */

export interface DetectedLocale {
  locale: string;
  /** The path with any locale prefix removed, always starting with `/`. */
  pathname: string;
  /**
   * Whether the incoming URL carried the prefix. Used to decide whether the
   * default locale should be redirected back to its canonical, prefix-free URL.
   */
  hadPrefix: boolean;
}

export function detectLocale(request: NextRequest): DetectedLocale {
  const pathname = request.nextUrl.pathname;
  const [, first, ...rest] = pathname.split('/');

  if (first && isLocale(first)) {
    return {
      locale: first,
      // Preserve the trailing slash shape: `/en/garden/` → `/garden/`, and
      // `/en` → `/`. Getting this wrong feeds `with-routes` a path that differs
      // from the one it would otherwise cache, producing duplicate KV entries
      // for the same page.
      pathname: `/${rest.join('/')}` || '/',
      hadPrefix: true,
    };
  }

  return { locale: DEFAULT_LOCALE, pathname, hadPrefix: false };
}

/**
 * Prefixes an internal path with the locale segment.
 *
 * Applied to every rewrite target the proxy produces. `/category/23` becomes
 * `/en/category/23`, which is where the route actually lives now.
 */
export function withLocalePrefix(pathname: string, locale: string): string {
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;

  return `/${locale}${normalized === '/' ? '' : normalized}`;
}

/**
 * Whether a request for the **default** locale arrived with its prefix visible.
 *
 * `/en/garden/` and `/garden/` would otherwise both serve the same page, which
 * is a duplicate-content problem and splits the cache across two keys for one
 * page. The caller redirects these to the canonical prefix-free URL.
 *
 * Non-default locales keep their prefix — it is the only thing distinguishing
 * them.
 */
export function shouldStripPrefix({ locale, hadPrefix }: DetectedLocale): boolean {
  return hadPrefix && locale === DEFAULT_LOCALE;
}

/**
 * Header carrying the resolved locale to code that cannot use root params.
 *
 * `next/root-params` is documented as unavailable in Client Components, **Server
 * Actions and Route Handlers**. Those are exactly the places that still need to
 * know the locale — an add-to-cart action has to price in the right currency,
 * and the checkout handoff has to reach the right channel. The proxy already
 * resolved the locale to route the request, so it passes the answer along rather
 * than making every action re-derive it.
 *
 * Server Components should keep using `locale()` from `next/root-params`: it is
 * readable inside `use cache`, whereas reading a header is not.
 */
export const LOCALE_HEADER = 'x-cf-locale';
