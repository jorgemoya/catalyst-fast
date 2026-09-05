import { describe, expect, it } from 'vitest';

import {
  activeFacetCount,
  canonicalizeListingParams,
  DEFAULT_LIMIT,
  defaultKey,
  isFiltered,
  shouldBypassCache,
} from './listing-params';

/**
 * Canonicalization decides the cache key, so every rule here is a cache-hit-rate
 * property, not a formatting preference. Two URLs that mean the same thing must
 * produce byte-identical keys, or the remote cache fills with single-use entries
 * and the listing page ends up slower than no cache at all.
 */
describe('canonicalizeListingParams', () => {
  const cat = { categoryId: 98 };

  describe('rule 1: unknown params are dropped', () => {
    it('ignores tracking params entirely', () => {
      const bare = canonicalizeListingParams({}, cat);
      const tracked = canonicalizeListingParams(
        { utm_source: 'newsletter', fbclid: 'abc', gclid: 'xyz', ref: 'partner' },
        cat,
      );

      expect(tracked).toEqual(bare);
    });

    it('drops the slug param Next injects into searchParams', () => {
      // https://github.com/vercel/next.js/issues/51802 — path params leak into
      // searchParams, and treating `slug` as a facet would fork every key.
      expect(canonicalizeListingParams({ slug: 'plants' }, cat)).toEqual(
        canonicalizeListingParams({}, cat),
      );
    });
  });

  describe('rule 2: order does not matter', () => {
    it('sorts multi-values so ?b=2&b=1 matches ?b=1&b=2', () => {
      const a = canonicalizeListingParams({ brand: ['2', '1'] }, cat);
      const b = canonicalizeListingParams({ brand: ['1', '2'] }, cat);

      expect(a).toEqual(b);
      expect(a.brands).toEqual([1, 2]);
    });

    it('sorts attribute pairs and their values', () => {
      const a = canonicalizeListingParams({ attr_size: ['m', 'l'], attr_color: ['red'] }, cat);
      const b = canonicalizeListingParams({ attr_color: ['red'], attr_size: ['l', 'm'] }, cat);

      expect(a).toEqual(b);
      expect(a.attributes).toEqual([
        ['color', ['red']],
        ['size', ['l', 'm']],
      ]);
    });
  });

  describe('rule 3: defaults collapse to absent', () => {
    it('drops the default sort', () => {
      expect(canonicalizeListingParams({ sort: 'featured' }, cat).sort).toBeUndefined();
    });

    it("drops a category's own configured default sort", () => {
      // A category whose merchant default is "newest" must treat ?sort=newest as
      // the unfiltered view, or its most-linked URL misses the shared entry.
      const key = canonicalizeListingParams(
        { sort: 'newest' },
        { ...cat, defaultSort: 'newest' },
      );

      expect(key.sort).toBeUndefined();
      expect(key).toEqual(canonicalizeListingParams({}, { ...cat, defaultSort: 'newest' }));
    });

    it('keeps a non-default sort', () => {
      expect(canonicalizeListingParams({ sort: 'price-asc' }, cat).sort).toBe('price-asc');
    });

    it('rejects an unknown sort value rather than forwarding it', () => {
      expect(canonicalizeListingParams({ sort: 'bogus' }, cat).sort).toBeUndefined();
    });

    it('drops the default limit', () => {
      expect(canonicalizeListingParams({ limit: String(DEFAULT_LIMIT) }, cat).limit).toBe(
        DEFAULT_LIMIT,
      );
    });

    it('treats falsy boolean params as absent', () => {
      const key = canonicalizeListingParams({ stock: 'false', shipping: '', isFeatured: '0' }, cat);

      expect(key.inStock).toBeUndefined();
      expect(key.freeShipping).toBeUndefined();
      expect(key.isFeatured).toBeUndefined();
    });
  });

  describe('rule 4: bounds', () => {
    // Note this bounds the *page size*, not pagination depth. Cursors are opaque,
    // so there is no page number to cap — a crawler can walk arbitrarily deep.
    // `shouldBypassCache` is what stops that filling the cache.
    it('clamps limit to the maximum', () => {
      expect(canonicalizeListingParams({ limit: '9999' }, cat).limit).toBeLessThanOrEqual(48);
    });

    it('never carries both cursors at once', () => {
      const key = canonicalizeListingParams({ after: 'A', before: 'B' }, cat);

      expect(key.after).toBe('A');
      expect(key.before).toBeUndefined();
    });

    it('ignores non-numeric numeric params', () => {
      expect(canonicalizeListingParams({ minPrice: 'abc' }, cat).minPrice).toBeUndefined();
    });
  });

  it('carries the entity id so two categories never share an entry', () => {
    expect(canonicalizeListingParams({}, { categoryId: 98 })).not.toEqual(
      canonicalizeListingParams({}, { categoryId: 97 }),
    );
  });

  it('accepts truthy stock/shipping spellings', () => {
    expect(canonicalizeListingParams({ stock: 'in_stock' }, cat).inStock).toBe(true);
    expect(canonicalizeListingParams({ shipping: 'free_shipping' }, cat).freeShipping).toBe(true);
  });
});

describe('defaultKey', () => {
  it('strips every refinement but keeps page identity', () => {
    const key = canonicalizeListingParams(
      { brand: ['1'], sort: 'price-asc', minPrice: '10', after: 'CURSOR' },
      { categoryId: 98 },
    );

    // This is what makes the two-read facet diff free: the unrefined read resolves
    // to the same entry the default grid and every unfiltered visitor use.
    expect(defaultKey(key)).toEqual(canonicalizeListingParams({}, { categoryId: 98 }));
  });

  it('preserves a search term, which identifies the page rather than refining it', () => {
    const key = canonicalizeListingParams({ term: 'plant', brand: ['1'] }, {});

    expect(defaultKey(key).term).toBe('plant');
    expect(defaultKey(key).brands).toBeUndefined();
  });
});

describe('isFiltered', () => {
  it('is false for the bare view and for tracking params', () => {
    expect(isFiltered(canonicalizeListingParams({}, { categoryId: 98 }))).toBe(false);
    expect(isFiltered(canonicalizeListingParams({ utm_source: 'x' }, { categoryId: 98 }))).toBe(
      false,
    );
  });

  it.each([
    ['a facet', { brand: ['1'] }],
    ['a sort', { sort: 'price-asc' }],
    ['a cursor', { after: 'CURSOR' }],
  ])('is true for %s', (_label, params) => {
    expect(isFiltered(canonicalizeListingParams(params, { categoryId: 98 }))).toBe(true);
  });
});

describe('shouldBypassCache', () => {
  it('caches ordinary refinements', () => {
    const key = canonicalizeListingParams({ brand: ['1'], minPrice: '10' }, { categoryId: 98 });

    expect(activeFacetCount(key)).toBe(2);
    expect(shouldBypassCache(key)).toBe(false);
  });

  it('bypasses deep refinements, which are single-use by nature', () => {
    const key = canonicalizeListingParams(
      {
        brand: ['1'],
        categoryIn: ['2'],
        minPrice: '10',
        minRating: '4',
        stock: 'true',
        shipping: 'true',
      },
      { categoryId: 98 },
    );

    expect(activeFacetCount(key)).toBeGreaterThan(4);
    expect(shouldBypassCache(key)).toBe(true);
  });
});
