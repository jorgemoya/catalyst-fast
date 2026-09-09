import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE } from '~/lib/config/channels';

import { localizeHref } from './href';

/**
 * Locale prefixing for outgoing links.
 *
 * The bug this covers was invisible to the existing suite because the locale
 * e2e tests navigate to `/es/...` by URL and never *click* an internal link.
 * Every rule below maps to a way of getting it wrong that still looks fine on
 * the English storefront, which is the only one most people check.
 */
describe('localizeHref', () => {
  it('prefixes an ordinary internal path', () => {
    expect(localizeHref('/garden/', 'es')).toBe('/es/garden/');
    expect(localizeHref('/zz-plant/', 'es')).toBe('/es/zz-plant/');
  });

  /*
   * The reported symptom: the header logo. `/` must become `/es/`, keeping the
   * trailing slash — `/es` would take a 308 from `trailingSlash` on every click.
   */
  it('maps the home link to the localized home, with its trailing slash', () => {
    expect(localizeHref('/', 'es')).toBe('/es/');
  });

  it('leaves the default locale alone, so English keeps clean URLs', () => {
    expect(localizeHref('/garden/', DEFAULT_LOCALE)).toBe('/garden/');
    expect(localizeHref('/', DEFAULT_LOCALE)).toBe('/');
  });

  it('never double-prefixes an already localized path', () => {
    expect(localizeHref('/es/garden/', 'es')).toBe('/es/garden/');
    // Including across locales — the switcher builds these itself.
    expect(localizeHref('/en/garden/', 'es')).toBe('/en/garden/');
  });

  /*
   * Prefixing any of these corrupts the URL rather than localizing it.
   */
  it('leaves anything that is not an absolute app path untouched', () => {
    for (const href of [
      'https://example.com/garden/',
      '//cdn.example.com/x.png',
      '#reviews',
      'mailto:hi@example.com',
      'tel:+15551234',
      'garden/',
    ]) {
      expect(localizeHref(href, 'es')).toBe(href);
    }
  });

  it('leaves framework and API paths alone', () => {
    expect(localizeHref('/_next/static/chunk.js', 'es')).toBe('/_next/static/chunk.js');
    expect(localizeHref('/api/events', 'es')).toBe('/api/events');
  });

  /*
   * These live outside `[locale]`. A prefixed link would 404 — and would do so
   * only for non-default locales, i.e. exactly the traffic nobody smoke-tests.
   */
  it('leaves locale-exempt routes unprefixed', () => {
    expect(localizeHref('/checkout', 'es')).toBe('/checkout');
    expect(localizeHref('/checkout/', 'es')).toBe('/checkout/');
    expect(localizeHref('/login/token/abc123', 'es')).toBe('/login/token/abc123');
  });

  it('still localizes ordinary login and cart routes, which are not exempt', () => {
    expect(localizeHref('/login/', 'es')).toBe('/es/login/');
    expect(localizeHref('/cart/', 'es')).toBe('/es/cart/');
  });

  it('preserves query strings and fragments on the path it prefixes', () => {
    expect(localizeHref('/shop-all/?sort=newest', 'es')).toBe('/es/shop-all/?sort=newest');
    expect(localizeHref('/zz-plant/#reviews', 'es')).toBe('/es/zz-plant/#reviews');
  });
});
