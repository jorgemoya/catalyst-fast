import { describe, expect, it } from 'vitest';

import { cursorHref, resetFiltersHref, setValueHref, toggleValueHref } from './listing-url';

/**
 * These build every refinement link on the listing page. Two properties matter
 * beyond correctness:
 *
 *  - params come out sorted, so the emitted URLs are themselves canonical and
 *    land on the cache entry `canonicalizeListingParams` computes;
 *  - `pathname` is the merchant's vanity URL. Passing the internal
 *    `/category/98` here shipped internal paths into the HTML for crawlers to
 *    follow — a real bug this suite now guards.
 */

const path = '/plants/';

describe('toggleValueHref', () => {
  it('adds a value', () => {
    expect(toggleValueHref(path, {}, 'brand', '1')).toBe('/plants/?brand=1');
  });

  it('removes a value that is already present', () => {
    expect(toggleValueHref(path, { brand: '1' }, 'brand', '1')).toBe('/plants/');
  });

  it('accumulates multiple values on one param', () => {
    expect(toggleValueHref(path, { brand: ['1'] }, 'brand', '2')).toBe('/plants/?brand=1&brand=2');
  });

  it('removes only the toggled value from a multi-select', () => {
    expect(toggleValueHref(path, { brand: ['1', '2'] }, 'brand', '1')).toBe('/plants/?brand=2');
  });

  it('resets pagination, since page 4 of a different result set is meaningless', () => {
    const href = toggleValueHref(path, { after: 'CURSOR', brand: ['1'] }, 'brand', '2');

    expect(href).not.toContain('after');
  });

  it('preserves unrelated params', () => {
    expect(toggleValueHref(path, { sort: 'price-asc' }, 'brand', '1')).toContain('sort=price-asc');
  });

  it('emits sorted params so the URL is itself canonical', () => {
    expect(toggleValueHref(path, { sort: 'price-asc' }, 'brand', '1')).toBe(
      '/plants/?brand=1&sort=price-asc',
    );
  });

  it('keeps the vanity pathname it was given', () => {
    expect(toggleValueHref('/plants/', {}, 'brand', '1').startsWith('/plants/')).toBe(true);
  });
});

describe('setValueHref', () => {
  it('sets a single-value param', () => {
    expect(setValueHref(path, {}, 'minRating', '4')).toBe('/plants/?minRating=4');
  });

  it('replaces rather than appends', () => {
    expect(setValueHref(path, { minRating: '3' }, 'minRating', '4')).toBe('/plants/?minRating=4');
  });

  it('clears the param when given undefined, so a filter is its own undo', () => {
    expect(setValueHref(path, { minRating: '4' }, 'minRating', undefined)).toBe('/plants/');
  });
});

describe('cursorHref', () => {
  it('sets the requested cursor and drops the opposite one', () => {
    expect(cursorHref(path, { before: 'B' }, 'after', 'A')).toBe('/plants/?after=A');
  });

  it('preserves active filters, unlike a refinement', () => {
    expect(cursorHref(path, { brand: ['1'] }, 'after', 'A')).toBe('/plants/?after=A&brand=1');
  });
});

describe('resetFiltersHref', () => {
  it('clears every refinement', () => {
    expect(resetFiltersHref(path, { brand: ['1'], minPrice: '10', sort: 'price-asc' })).toBe(
      '/plants/',
    );
  });

  it('keeps the search term, which identifies the page rather than refining it', () => {
    expect(resetFiltersHref('/search', { term: 'plant', brand: ['1'] })).toBe('/search?term=plant');
  });
});
