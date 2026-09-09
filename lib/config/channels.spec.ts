import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, channelFor, isLocale, resolveCurrency } from './channels';

/**
 * The locale → channel mapping and the currency guard.
 *
 * `resolveCurrency` is the only thing standing between a shopper-controlled
 * cookie and a cache key. Everything downstream — `toCurrencyCode`'s cast, the
 * per-currency price entries, the `prices(currencyCode:)` argument — assumes its
 * output is one of a small, closed set. That assumption is worth a test.
 */

// What this store actually reports as transactional. Passed in rather than
// hardcoded in the module under test, which is the point of the change these
// tests cover: BigCommerce owns the list now.
const AVAILABLE = ['USD', 'EUR', 'GBP'];

describe('resolveCurrency', () => {
  it('keeps a currency the store can transact in', () => {
    expect(resolveCurrency('en', 'EUR', AVAILABLE)).toBe('EUR');
    expect(resolveCurrency('en', 'GBP', AVAILABLE)).toBe('GBP');
  });

  it('falls back to the locale default when nothing is chosen', () => {
    expect(resolveCurrency('en', null, AVAILABLE)).toBe('USD');
    expect(resolveCurrency('en', undefined, AVAILABLE)).toBe('USD');
    expect(resolveCurrency('en', '', AVAILABLE)).toBe('USD');
  });

  it('gives each locale its own default, so the shell prices in the right currency', () => {
    expect(resolveCurrency('es', null, AVAILABLE)).toBe('EUR');
  });

  /*
   * The one that matters. An unchecked currency becomes a distinct cache entry,
   * so `?currency=AAA`, `?currency=AAB`, … is an unbounded key space handed to
   * anyone with a browser. Every rejected value must collapse to the *same*
   * fallback, not merely be "handled".
   */
  it('collapses anything the store cannot transact in to one fallback', () => {
    const rejected = ['AAA', 'XYZ', 'AUD', '../../etc', '', '💸', 'USD;DROP'];
    const resolved = new Set(rejected.map((value) => resolveCurrency('en', value, AVAILABLE)));

    expect(resolved).toEqual(new Set(['USD']));
  });

  it('rejects a display-only currency the store lists but cannot charge in', () => {
    // AUD is configured on this store with `isTransactional: false`, so it never
    // reaches `AVAILABLE` — a shopper who forges the cookie still gets USD.
    expect(resolveCurrency('en', 'AUD', AVAILABLE)).toBe('USD');
  });

  it('accepts the casing and whitespace a cookie round trip can introduce', () => {
    expect(resolveCurrency('en', 'eur', AVAILABLE)).toBe('EUR');
    expect(resolveCurrency('en', ' eur ', AVAILABLE)).toBe('EUR');
  });

  it('falls back when the store reports no transactional currencies at all', () => {
    // A misconfigured store must still render prices rather than throw.
    expect(resolveCurrency('en', 'EUR', [])).toBe('USD');
  });

  it('falls back for an unknown locale rather than returning undefined', () => {
    expect(resolveCurrency('de', null, AVAILABLE)).toBe('USD');
  });
});

describe('channelFor', () => {
  it('resolves an unknown locale to the default channel', () => {
    expect(channelFor('de')).toBe(channelFor(DEFAULT_LOCALE));
  });
});

describe('isLocale', () => {
  /*
   * The proxy's routing guard, deliberately static — see the note on the
   * function. These assertions are really about the *shape* of the answer: it
   * must be a closed set, so an arbitrary first path segment is never mistaken
   * for a locale and stripped off the URL.
   */
  it('accepts the locales this repo ships copy for', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('es')).toBe(true);
  });

  it('rejects ordinary path segments that could otherwise be eaten', () => {
    for (const segment of ['cart', 'shop-all', 'account', 'de', 'EN', '']) {
      expect(isLocale(segment)).toBe(false);
    }
  });
});
