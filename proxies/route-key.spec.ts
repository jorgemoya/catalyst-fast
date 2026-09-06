import { describe, expect, it } from 'vitest';

import { toRouteKeyPath } from './route-key';

/**
 * Route-cache key canonicalization.
 *
 * The proxy's `site.route` lookup runs *before* Next routes the request, on every
 * page, and a miss is a blocking BigCommerce round trip. So the only thing that
 * decides whether a storefront's origin load scales with traffic or with catalog
 * size is what ends up in this key.
 */

const url = (href: string) => new URL(href, 'https://store.example');

describe('toRouteKeyPath', () => {
  it('strips per-click ad identifiers', () => {
    // The measured failure: five visitors from one ad produced five uncached
    // route lookups, because `fbclid` is unique per click.
    expect(toRouteKeyPath(url('/zz-plant/?fbclid=abc123'))).toBe('/zz-plant/');
    expect(toRouteKeyPath(url('/zz-plant/?gclid=xyz'))).toBe('/zz-plant/');
    expect(toRouteKeyPath(url('/zz-plant/?msclkid=1&ttclid=2'))).toBe('/zz-plant/');
  });

  it('strips utm campaign parameters', () => {
    expect(
      toRouteKeyPath(url('/plants/?utm_source=newsletter&utm_medium=email&utm_campaign=spring')),
    ).toBe('/plants/');
  });

  it('collapses every ad click on one path to a single cache key', () => {
    const keys = new Set(
      ['a', 'b', 'c', 'd'].map((id) => toRouteKeyPath(url(`/zz-plant/?fbclid=${id}`))),
    );

    expect(keys.size).toBe(1);
  });

  it('keeps parameters BigCommerce redirect rules can legitimately match', () => {
    // Stripping these would break merchant-configured 301s.
    expect(toRouteKeyPath(url('/legacy/?page=2'))).toBe('/legacy/?page=2');
    expect(toRouteKeyPath(url('/search/?q=pot'))).toBe('/search/?q=pot');
  });

  it('sorts remaining parameters so ordering does not fragment the cache', () => {
    expect(toRouteKeyPath(url('/x/?b=2&a=1'))).toBe(toRouteKeyPath(url('/x/?a=1&b=2')));
  });

  it('keeps real parameters when mixed with tracking noise', () => {
    expect(toRouteKeyPath(url('/x/?utm_source=fb&page=3&fbclid=zz'))).toBe('/x/?page=3');
  });

  it('leaves a bare path untouched', () => {
    expect(toRouteKeyPath(url('/zz-plant/'))).toBe('/zz-plant/');
  });

  it('does not strip a parameter that merely starts with a tracking name', () => {
    // `ref` is stripped; `referrer_code` is a different parameter and must stay.
    expect(toRouteKeyPath(url('/x/?referrer_code=abc'))).toBe('/x/?referrer_code=abc');
    expect(toRouteKeyPath(url('/x/?ref=abc'))).toBe('/x/');
  });
});
