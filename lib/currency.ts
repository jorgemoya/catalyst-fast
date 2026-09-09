import 'server-only';

import { cacheLife } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { locale } from 'next/root-params';

import { getSwitchableCurrencies } from '~/data/currencies';
import { getStoreSettings } from '~/data/settings';
import { CONSENT_COOKIE_NAME, hasConsentFor, parseConsent } from '~/domain/consent';
import { normalizeLocale } from '~/lib/i18n/messages';
import { LOCALE_HEADER } from '~/proxies/locale';
import { channelFor, resolveCurrency } from '~/lib/config/channels';

/**
 * The shopper's chosen display currency.
 *
 * **The rule that makes this safe: a cached function never reads this.** It is
 * passed *into* cached reads as an explicit argument, so a price entry is keyed
 * by currency and shared by every shopper using it — rather than the cookie
 * being read inside a cached body, which would either poison the entry or force
 * the read dynamic. Catalyst's `getPreferredCurrencyCode()` did exactly that,
 * from inside price paths, and it is called out in plan §7.5 as a known carrier.
 *
 * **Where it may be called.** Only from something already dynamic — a Server
 * Action, a route handler, or a `'use cache: private'` scope. Calling it from a
 * component that currently lands in the static shell will pull that component
 * out of the shell for *every* visitor, including the majority who never touch
 * the switcher. That is the whole cost model here:
 *
 *   default currency  → shell renders it, zero cookie reads, fully static
 *   chosen currency   → resolved in a path that was already a hole
 *
 * So the shell always renders `channel.defaultCurrency`, and regions that are
 * already dynamic (the refined listing grid, the cart, the price overlay) read
 * the cookie and ask for the shopper's currency instead.
 */

export const CURRENCY_COOKIE = 'cf.currency';

/**
 * Resolves the selected currency, falling back to the channel default.
 *
 * `'use cache: private'` rather than a bare cookie read: it dedupes within a
 * render (several regions ask for it) and, unlike a plain dynamic read, keeps
 * the caller prefetchable.
 *
 * The value is validated against the channel's configured list — see
 * `resolveCurrency`. It arrives from a cookie, which is shopper-controlled, and
 * it becomes part of a cache key; an unvalidated currency is an unbounded key
 * space handed to anyone with a browser.
 */
export async function getSelectedCurrency(): Promise<string> {
  'use cache: private';
  cacheLife({ stale: 30 });

  const locale = await activeLocale();
  const [store, available] = await Promise.all([cookies(), getSwitchableCurrencies()]);

  return resolveCurrency(
    locale,
    store.get(CURRENCY_COOKIE)?.value,
    available.map((currency) => currency.code),
  );
}

/**
 * The locale, readable from **anywhere** — including Server Actions and Route
 * Handlers, where `next/root-params` is not available.
 *
 * Prefers the header the proxy set, because that is the one source that works in
 * every context. A request that never passed through the proxy (a direct hit on
 * an excluded path) falls back to the default locale rather than throwing.
 */
export async function activeLocale(): Promise<string> {
  const requestHeaders = await headers();

  return normalizeLocale(requestHeaders.get(LOCALE_HEADER));
}

/**
 * The selected currency, for Server Actions and Route Handlers.
 *
 * Same as `getSelectedCurrency` minus the private cache scope, which is not
 * available in those contexts.
 */
export async function getSelectedCurrencyForAction(): Promise<string> {
  const locale = await activeLocale();
  const [store, available] = await Promise.all([cookies(), getSwitchableCurrencies()]);

  return resolveCurrency(
    locale,
    store.get(CURRENCY_COOKIE)?.value,
    available.map((currency) => currency.code),
  );
}

/**
 * The currency the prerendered shell is built in.
 *
 * Safe inside `use cache` — it reads configuration and the locale root param,
 * never a cookie.
 */
export async function getDefaultCurrency(): Promise<string> {
  /*
   * `normalizeLocale`, not `?? 'en'`. The root param is an empty string while the
   * param-independent fallback shell prerenders, and `??` passes that through —
   * `channelFor('')` then silently falls back to the default channel, so `/es/`
   * would be built in USD rather than EUR. Same defect as the `Intl` crash, minus
   * the crash, which is what made it survive longer.
   */
  return channelFor(normalizeLocale(await locale())).defaultCurrency;
}

/**
 * Whether a *preference* may be persisted for this shopper.
 *
 * The display currency is a `functionality` cookie — the category the banner
 * describes as "remembers choices like your currency". Reading the consent
 * cookie here is legal because every caller is already dynamic (a Server
 * Action); it must never be read from a cached scope.
 *
 * With cookie consent switched off in BigCommerce there is no banner and nothing
 * to withhold, so the preference is stored — that is the merchant's decision to
 * make, and `hasConsentFor` encodes it.
 */
export async function hasFunctionalityConsent(): Promise<boolean> {
  const [store, settings] = await Promise.all([cookies(), getStoreSettings()]);
  const consent = parseConsent(store.get(CONSENT_COOKIE_NAME)?.value);

  return hasConsentFor(consent, 'functionality', settings.cookieConsentEnabled);
}
