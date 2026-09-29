'use client';

import { useLocale } from 'next-intl';
import { useEffect } from 'react';

import { localizeHref } from '~/lib/i18n/href';

/**
 * Full-document navigation, for the moves that change a **root param**.
 *
 * `[locale]` and `[audience]` both sit above the root layout. Next's router only
 * treats a *different root layout* as a hard navigation, and it compares
 * segment names, not values (`isNavigatingToNewRootLayout`) — so `/en/…` to
 * `/es/…`, or a `public` render to a `restricted` one, is attempted as a soft
 * navigation that re-renders `<html>` itself. Measured, on both: the document
 * ends up with two headers and two `<main>`s until the next reload. Verified to
 * predate the audience segment — the locale switcher did it too.
 *
 * So every move known to cross a root param goes through the browser instead:
 * the locale switcher, and sign-in / registration / sign-out, which change the
 * audience at the *same* visible URLs. A document load is also the cleanest way
 * to drop a router cache built for the previous audience.
 */
export function navigateDocument(href: string) {
  window.location.assign(href);
}

/**
 * What an auth action returns on success instead of calling `redirect()`.
 *
 * A Server Action `redirect()` is a soft navigation — the exact case above. It
 * also dropped the locale: `redirect('/account/orders')` sent a Spanish shopper
 * to English. The client resolves the path under its own locale instead.
 */
export interface DocumentNavigationResult {
  navigateTo: string;
}

export function isDocumentNavigation(value: unknown): value is DocumentNavigationResult {
  return typeof value === 'object' && value !== null && 'navigateTo' in value;
}

/** Performs a `DocumentNavigationResult` once an action returns one. */
export function useDocumentNavigation(result: unknown) {
  const locale = useLocale();
  const target = isDocumentNavigation(result) ? result.navigateTo : null;

  useEffect(() => {
    if (target) {
      navigateDocument(localizeHref(target, locale));
    }
  }, [target, locale]);
}
