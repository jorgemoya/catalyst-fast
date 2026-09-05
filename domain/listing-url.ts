import type { RawSearchParams } from './listing-params';

/**
 * Builds listing URLs by mutating the current query string.
 *
 * This exists so facet controls can be **server-rendered links** rather than a
 * client island. Catalyst's `filters-panel.tsx` was 373 lines of `'use client'`
 * that received raw promises and called `use()` on them; here each facet option
 * is an `<a href>` whose target the server already computed.
 *
 * That is a better fit for a PLP than an island:
 *   - zero client JS for the primary refinement interaction
 *   - every refinement is a real URL, so crawlers can traverse the facet space
 *     and the browser's back button works without any history shimming
 *   - links get prefetched on hover by the router, so a click often resolves
 *     from an already-warm cache entry
 *
 * The trade-off is no optimistic in-place update — a refinement is a navigation.
 * With the unfiltered view prerendered and filtered views cached, that navigation
 * is fast enough that optimistic UI would mostly be hiding latency that isn't
 * there. If it turns out to matter, a `useOptimistic` wrapper can be added around
 * these links without changing their URLs.
 */

/** Params that must reset when a refinement changes — staying on page 4 of a
 * different result set is meaningless and usually lands on an empty page. */
const PAGINATION_PARAMS = ['after', 'before'];

function toSearchParams(raw: RawSearchParams): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
    } else if (typeof value === 'string' && value !== '') {
      params.set(key, value);
    }
  }

  return params;
}

const finalize = (pathname: string, params: URLSearchParams): string => {
  params.sort();

  const queryString = params.toString();

  return queryString ? `${pathname}?${queryString}` : pathname;
};

/** Adds or removes one value from a multi-value facet param. */
export function toggleValueHref(
  pathname: string,
  raw: RawSearchParams,
  paramName: string,
  value: string,
): string {
  const params = toSearchParams(raw);
  const current = params.getAll(paramName);
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];

  params.delete(paramName);
  next.forEach((item) => params.append(paramName, item));
  PAGINATION_PARAMS.forEach((param) => params.delete(param));

  return finalize(pathname, params);
}

/** Sets a single-value param, or clears it when `value` is undefined. */
export function setValueHref(
  pathname: string,
  raw: RawSearchParams,
  paramName: string,
  value: string | undefined,
): string {
  const params = toSearchParams(raw);

  if (value === undefined || value === '') {
    params.delete(paramName);
  } else {
    params.set(paramName, value);
  }

  PAGINATION_PARAMS.forEach((param) => params.delete(param));

  return finalize(pathname, params);
}

/** Cursor navigation. Unlike refinements, this preserves the current filters. */
export function cursorHref(
  pathname: string,
  raw: RawSearchParams,
  direction: 'after' | 'before',
  cursor: string,
): string {
  const params = toSearchParams(raw);

  PAGINATION_PARAMS.forEach((param) => params.delete(param));
  params.set(direction, cursor);

  return finalize(pathname, params);
}

/** Clears every refinement, keeping only params the page itself owns. */
export function resetFiltersHref(pathname: string, raw: RawSearchParams): string {
  const params = new URLSearchParams();
  const term = raw.term;

  // A search page without its term is a different page, not an unfiltered one.
  if (typeof term === 'string' && term !== '') {
    params.set('term', term);
  }

  return finalize(pathname, params);
}
