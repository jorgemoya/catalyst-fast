import { createTranslator } from 'next-intl';

import messages from '~/messages/en.json';

/**
 * Static translator. Copy lives in `messages/en.json` from day one so nothing is
 * hardcoded into JSX, but there is no locale routing, no request-scoped locale,
 * and no `[locale]` segment in v1.
 *
 * This distinction is what makes the whole caching design work. `next-intl`'s
 * server helpers (`getTranslations`, `getFormatter`, `getLocale`) are
 * request-scoped and THROW inside a `'use cache'` body — so using them in `data/`
 * or in any cached component would either fail the build or force the subtree
 * dynamic. `createTranslator` is a pure function of messages, so it is safe
 * everywhere: cached components, client components, and the static shell alike.
 *
 * Phase 8 reintroduces locales as a **root param**, which is readable inside
 * `use cache` (unlike cookies or `getLocale()`). At that point this module takes
 * a locale argument and everything downstream keeps working — which is precisely
 * why the seam is here rather than at every call site.
 */
export const LOCALE = 'en';

export const t = createTranslator({ locale: LOCALE, messages });

/**
 * Intl formatters. Bound to the fixed locale for now, and constructed once —
 * `Intl.NumberFormat` construction is expensive enough to matter when formatting
 * a price per product card across a 50-item grid.
 */
const currencyFormatters = new Map<string, Intl.NumberFormat>();

export function formatCurrency(amount: number, currencyCode: string): string {
  let formatter = currencyFormatters.get(currencyCode);

  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: currencyCode });
    currencyFormatters.set(currencyCode, formatter);
  }

  return formatter.format(amount);
}

const dateFormatter = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' });

/**
 * For a real *instant* — a publish time, an order date. Rendered in the viewer's
 * timezone, which is what they want for a moment in time.
 */
export const formatDate = (date: Date | string): string =>
  dateFormatter.format(typeof date === 'string' ? new Date(date) : date);

const dateOnlyFormatter = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'medium',
  timeZone: 'UTC',
});

/**
 * For a *calendar date* the shopper picked — a delivery date, an engraving date.
 *
 * These have no time and no timezone: "December 24th" means that day wherever
 * you are. `domain/cart-line.ts` anchors them at UTC midnight on submission, so
 * they must be read back in UTC too. Formatting one with `formatDate` instead
 * silently shifts it a day for every viewer west of UTC — observed live: a
 * shopper picked 2026-12-24 and the cart line said "Dec 23, 2026" in
 * America/Chicago.
 *
 * The distinction is the whole reason there are two functions: an instant and a
 * calendar date look identical in the type system and behave differently.
 */
export const formatDateOnly = (iso: string): string => dateOnlyFormatter.format(new Date(iso));
