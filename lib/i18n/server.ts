import 'server-only';

import { createTranslator } from 'next-intl';

import { activeLocale as localeFromRootParam } from '~/data/locale';
import { activeLocale as localeFromHeader } from '~/lib/currency';

import {
  formatCurrencyIn,
  formatDateIn,
  formatDateOnlyIn,
  messagesFor,
} from './messages';

/**
 * Locale-aware helpers for Server Components.
 *
 * **These take the locale explicitly. They must not use `next-intl/server`.**
 *
 * An earlier version wrapped `getTranslations()` and `getFormatter()`, on the
 * reasoning that a request config reading root params never touches `headers()`
 * and is therefore safe inside `use cache`. The config part of that is true —
 * `i18n/request.ts` resolves correctly. What is not true is that the helpers can
 * *reach* it from a cached scope.
 *
 * Measured: rendering one listing page produced **152 `FORMATTING_ERROR:
 * Incorrect locale information provided (undefined)`** and 16 `INVALID_MESSAGE`,
 * while `getRequestConfig` ran only 5 times. Inside a `'use cache'` body
 * next-intl cannot see the request config, so it falls back to an undefined
 * locale — and does so **silently**, which is why this survived a green test
 * suite.
 *
 * It survived because the damage is invisible until a message needs the locale:
 *
 *   t('Header.cart')                      → plain lookup, no locale, fine
 *   t('Header.shopAllCategory', {category}) → ICU formatter, INVALID_MESSAGE
 *   format.number(…, {currency})          → Intl.NumberFormat, FORMATTING_ERROR
 *
 * So the chrome rendered in Spanish and only parameterized strings and money
 * broke, on cached pages only.
 *
 * The fix is to go back to what this module did originally: read the locale from
 * the **root param** — which genuinely is legal inside `use cache`, because it is
 * part of the route rather than the request — and build a translator and
 * formatters from it directly. `createTranslator` is next-intl's pure core; it
 * takes a locale and messages and touches no request state.
 */

async function translatorFor(locale: string) {
  return createTranslator({ locale, messages: messagesFor(locale) });
}

export async function getT() {
  return translatorFor(await localeFromRootParam());
}

/**
 * Translator for **Server Actions and Route Handlers**.
 *
 * `next/root-params` is unavailable in both — Turbopack rejects the import
 * outright — so the locale comes from the header the proxy sets instead. Reading
 * a header is illegal inside `use cache`, which is exactly why this is a separate
 * export rather than a fallback inside `getT`: the distinction has to be visible
 * at the call site.
 */
export async function getTForAction() {
  return translatorFor(await localeFromHeader());
}

/**
 * Number and date formatting, locale-aware.
 *
 * Locale changes how money reads, not just the words around it: `$1,234.50` in
 * `en` is `1234,50 US$` in `es`. Formatting Spanish copy with an English
 * formatter looks fine to whoever wrote it and wrong to everyone who speaks the
 * language.
 *
 * These delegate to the memoized `Intl` formatters in `./messages`, which take
 * the locale as an argument and so work identically inside and outside a cached
 * scope.
 */
export async function getFormatCurrency() {
  const locale = await localeFromRootParam();

  return (amount: number, currencyCode: string) => formatCurrencyIn(locale, amount, currencyCode);
}

export async function getFormatDate() {
  const locale = await localeFromRootParam();

  return (date: Date | string) => formatDateIn(locale, date);
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
  const locale = await localeFromRootParam();

  return (date: Date | string) => formatDateOnlyIn(locale, date);
}
