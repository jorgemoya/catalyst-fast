/**
 * The locale → storefront mapping.
 *
 * BigCommerce models an international storefront as a **channel**: a locale gets
 * its own channel id and its own catalog visibility. So "which locale" and
 * "which BigCommerce backend" are the same question, and this file is the single
 * place that answers it.
 *
 * **This file holds only what BigCommerce cannot tell us.** The locale list comes
 * from `data/locales.ts` and the currency list from `data/currencies.ts` — both
 * read from the store, because a merchant who enables a language or a currency
 * in the control panel should not also have to open a pull request. What remains
 * here is the mapping from a locale to a channel id, and the choice of which
 * currency gets baked into the prerendered shell. Neither is derivable: the
 * channel is infrastructure, and the shell currency is a traffic judgement.
 *
 * Adding a locale is: enable it in BigCommerce, add `messages/<locale>.json`,
 * deploy. An entry here is only needed to point it at a different channel or a
 * different shell currency. No routing changes — the `[locale]` root param
 * already exists.
 */

export interface ChannelConfig {
  /** BigCommerce channel id backing this locale. */
  channelId: string;
  /**
   * The currency rendered in the prerendered shell.
   *
   * Load-bearing for caching, not just display: prices in this currency are
   * baked into the static shell and cost nothing, while any other currency
   * arrives as a streamed overlay. Making this the currency most of your
   * traffic uses is the single highest-leverage setting in this file.
   */
  defaultCurrency: string;
}

/**
 * `en` is the default, so the proxy hides its prefix and every English URL is
 * unchanged. `es` is served from `/es/…`. See `proxies/locale.ts`.
 *
 * **Both point at the same BigCommerce channel today.** Catalog content —
 * product names, descriptions, category names — therefore appears in whatever
 * language that channel holds.
 *
 * That is a *content* limitation, not a plumbing one. Every cached catalog read
 * sends `Accept-Language` **and is issued against `channelId` below**, both keyed
 * by locale (see `data/locale.ts`), so translated content flows through the
 * moment a merchant adds translations to the channel or points a locale at its
 * own channel here.
 *
 * Verified two ways: `Accept-Language` currently returns identical content for
 * en/es/fr because no translations are configured; and setting `es` to a throwaway
 * channel id sent `/es/` traffic to `store-<hash>-<that-id>`, confirming the
 * channel is actually threaded rather than merely declared. It was merely
 * declared until then — this field existed and nothing read it.
 *
 * **One caveat if you split channels.** `query` derives the channel from the
 * locale it is given, so cached reads are covered automatically. `mutate` takes
 * the same optional `locale` but callers must pass it; on a single-channel store
 * omitting it is invisible, and on a split one it means a cart written to the
 * wrong catalog. Audit the mutation call sites before pointing a locale at its
 * own channel.
 */
export const CHANNELS: Record<string, ChannelConfig> = {
  en: {
    channelId: process.env.BIGCOMMERCE_CHANNEL_ID ?? '1',
    defaultCurrency: 'USD',
  },
  es: {
    // Same channel as `en` for now — see the note above on catalog content.
    channelId: process.env.BIGCOMMERCE_CHANNEL_ID ?? '1',
    // Euro first for a Spanish storefront: this is the currency baked into the
    // prerendered shell, so it should be the one most of that locale's traffic
    // uses.
    defaultCurrency: 'EUR',
  },
};

export const DEFAULT_LOCALE = 'en';

export function channelFor(locale: string): ChannelConfig {
  return CHANNELS[locale] ?? CHANNELS[DEFAULT_LOCALE]!;
}

/**
 * Whether a path segment names a locale we serve.
 *
 * **The one locale check that stays static, on purpose.** Everything else reads
 * the list from BigCommerce, but this runs in the proxy, on every request,
 * before routing — and it is a *guard*, not a source of truth. Making it a
 * network read (even a KV-cached one, which is what Catalyst does) puts a
 * dependency with a failure mode in front of every page on the site, to decide
 * something that cannot change without a deploy anyway: a locale is only
 * servable if `messages/<code>.json` exists, and that is settled at build time.
 *
 * The cost of the static list is bounded and benign. A locale enabled in
 * BigCommerce but absent here is not routed — the same outcome as one with no
 * catalogue, which is what `data/locales.ts` already enforces. The two lists are
 * kept honest by `scripts/build-config.ts`, which runs on every build and warns
 * when the store offers a locale this file or `messages/` does not know about.
 */
export function isLocale(segment: string): boolean {
  return Object.hasOwn(CHANNELS, segment);
}

/**
 * Narrows an arbitrary string to a currency the store can actually transact in,
 * falling back to the locale's shell currency.
 *
 * Every entry point that accepts a currency runs it through here. Covered by
 * `channels.spec.ts`, which asserts the property the rest of the system leans
 * on: every rejected value collapses to the *same* fallback.
 */
export function resolveCurrency(
  locale: string,
  requested: string | null | undefined,
  /**
   * Codes BigCommerce reports as transactional, from `getSwitchableCurrencies`.
   *
   * Passed in rather than read from config: the store is the authority on which
   * currencies exist, and this function's job is only to reject anything outside
   * that set. Validation matters because the value arrives from a cookie and
   * ends up in a cache key — an unchecked currency is an unbounded key space
   * handed to anyone with a browser.
   */
  available: readonly string[],
): string {
  const fallback = channelFor(locale).defaultCurrency;

  if (!requested) {
    return fallback;
  }

  const normalized = requested.trim().toUpperCase();

  return available.includes(normalized) ? normalized : fallback;
}
