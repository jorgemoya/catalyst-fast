'use client';

import NextLink from 'next/link';
import { useLocale } from 'next-intl';
import { type ComponentPropsWithRef, useState } from 'react';

import { localizeHref } from '~/lib/i18n/href';

/**
 * `next/link`, with the active locale applied to internal hrefs.
 *
 * Was a plain re-export, whose own comment promised this seam "when
 * locale-prefixed hrefs return in Phase 8". Phase 8 shipped and the seam was
 * never wired, which left a real bug: a Spanish shopper clicking the logo, a
 * category, or the cart landed back in English, because the href said `/` and
 * the proxy reads an unprefixed path as the default locale. Measured before the
 * fix — 29 of 29 internal links on `/es/` were unprefixed.
 *
 * **Why `'use client'` is the cheap option here, not the expensive one.**
 * `next/link` is already a Client Component, so this adds one thin wrapper to
 * the bundle and nothing else. Critically it does *not* pull parents into the
 * client: `children` are still rendered on the server and passed through the
 * boundary, so `<Link><Image/></Link>` keeps its server-rendered image.
 *
 * `useLocale()` reads next-intl's context, **not** URL data — so unlike
 * `usePathname()` it does not force a Suspense boundary or evict the link from
 * the static shell. That distinction is the whole reason this works; the locale
 * switcher next door has to avoid `usePathname()` for exactly that reason.
 *
 * Every consumer sits under `app/[locale]`, which mounts
 * `NextIntlClientProvider`, so the context is always present.
 *
 * The prefixing rules — and the paths deliberately exempt from them — live in
 * `lib/i18n/href.ts`, unit-tested there.
 */
export type LinkProps = ComponentPropsWithRef<typeof NextLink>;

/*
 * **Prefetching: the cheap shell on sight, the full page on intent.**
 *
 * With partial prefetching, a default `<Link>` in the viewport prefetches only
 * the route's App Shell — shared by every link to that route, so a grid of 24
 * product cards costs one prefetch, not 24. But the shell cannot hold anything
 * that depends on the URL's `params`, and on a product page that is everything:
 * the first click on any product showed the full-page skeleton.
 *
 * `prefetch={true}` resolves that per link, at the cost of one server render per
 * *visible* link — which on a listing grid is one per card. So this upgrades a
 * link to the full prefetch only when the shopper shows **intent**: pointer
 * hover, touch start, or keyboard focus. That is what Catalyst's `Link` did too
 * (hover → `router.prefetch`), and what Next's docs recommend for card grids.
 * Hover usually precedes the click by a few hundred milliseconds, enough for a
 * warm prefetch to land.
 *
 * An explicit `prefetch` from the caller always wins — `prefetch={false}` on
 * checkout must never be upgraded.
 */
export function Link({ href, prefetch, onMouseEnter, onTouchStart, onFocus, ...props }: LinkProps) {
  const locale = useLocale();
  const [intent, setIntent] = useState(false);

  /*
   * `href` may be a `UrlObject`. Only its `pathname` is a route, so that is the
   * only part localized; `query` and `hash` pass through untouched.
   */
  const localized =
    typeof href === 'string'
      ? localizeHref(href, locale)
      : { ...href, ...(href.pathname && { pathname: localizeHref(href.pathname, locale) }) };

  if (prefetch !== undefined) {
    return (
      <NextLink
        href={localized}
        onFocus={onFocus}
        onMouseEnter={onMouseEnter}
        onTouchStart={onTouchStart}
        prefetch={prefetch}
        {...props}
      />
    );
  }

  return (
    <NextLink
      href={localized}
      onFocus={(event) => {
        setIntent(true);
        onFocus?.(event);
      }}
      onMouseEnter={(event) => {
        setIntent(true);
        onMouseEnter?.(event);
      }}
      onTouchStart={(event) => {
        setIntent(true);
        onTouchStart?.(event);
      }}
      prefetch={intent ? true : null}
      {...props}
    />
  );
}
