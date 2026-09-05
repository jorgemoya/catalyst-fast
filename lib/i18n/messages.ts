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

export const formatDate = (date: Date | string): string =>
  dateFormatter.format(typeof date === 'string' ? new Date(date) : date);
