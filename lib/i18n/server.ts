import 'server-only';

import { getFormatter, getTranslations } from 'next-intl/server';

import { activeLocale } from '~/lib/currency';

/**
 * Locale-aware helpers for Server Components.
 *
 * **Thin wrappers over next-intl's own server helpers**, not a reimplementation.
 * An earlier version hand-rolled a translator because `getRequestConfig` looked
 * request-scoped, which would have made every page dynamic. That reasoning was
 * wrong: `requestLocale` is a *getter*, and a config that reads the `locale`
 * root param instead never touches `headers()`. Verified — a `use cache`
 * function calling `getTranslations()` prerenders per locale. See
 * `i18n/request.ts`.
 *
 * The wrappers survive that correction for one reason: they are the seam. Every
 * Server Component already says `const t = await getT()`, so swapping the
 * implementation underneath cost nothing, and a future change to how locale is
 * resolved will cost nothing either.
 *
 * `getT()` returns the same `t('Namespace.key')` callable as before.
 */

export async function getT() {
  return getTranslations();
}

/**
 * Translator for **Server Actions and Route Handlers**.
 *
 * `next/root-params` is unavailable in both, so `i18n/request.ts` cannot resolve
 * the locale on its own there. Passing an explicit `locale` takes next-intl's
 * `localeOverride` path, which short-circuits the `requestLocale` getter — so
 * this stays free of `headers()` inside next-intl, even though we read one
 * header ourselves to learn the locale the proxy resolved.
 */
export async function getTForAction() {
  return getTranslations({ locale: await activeLocale() });
}

/**
 * Number and date formatting, locale-aware.
 *
 * Locale changes how money reads, not just the words around it: `$1,234.50` in
 * `en` is `1234,50 US$` in `es`. Formatting Spanish copy with an English
 * formatter looks fine to whoever wrote it and wrong to everyone who speaks the
 * language.
 *
 * These return plain callables with the same signatures the previous
 * hand-rolled helpers had, so call sites are unchanged.
 */
export async function getFormatCurrency() {
  const format = await getFormatter();

  return (amount: number, currencyCode: string) =>
    format.number(amount, { style: 'currency', currency: currencyCode });
}

export async function getFormatDate() {
  const format = await getFormatter();

  return (date: Date | string) =>
    format.dateTime(typeof date === 'string' ? new Date(date) : date, { dateStyle: 'medium' });
}

/**
 * For a *calendar date* the shopper picked — a delivery date, an engraving date.
 *
 * These have no time and no timezone: "December 24th" means that day wherever
 * you are. `domain/cart-line.ts` anchors them at UTC midnight on submission, so
 * they must be read back in UTC too. Formatting one with `getFormatDate`
 * instead silently shifts it a day for every viewer west of UTC.
 */
export async function getFormatDateOnly() {
  const format = await getFormatter();

  return (date: Date | string) =>
    format.dateTime(typeof date === 'string' ? new Date(date) : date, {
      dateStyle: 'medium',
      timeZone: 'UTC',
    });
}
