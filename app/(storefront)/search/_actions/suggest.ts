'use server';

import { searchListing } from '~/data/search';
import { DEFAULT_LIMIT } from '~/domain/listing-params';
import { MIN_QUERY_LENGTH, type Suggestion } from '~/domain/suggestions';

/**
 * Quick-search suggestions for the header island.
 *
 * Reads the *same* `searchListing` cache the full results page uses, keyed by the
 * same canonical shape — so a shopper who types "pot", sees suggestions, then
 * presses Enter lands on a results page that is already warm, and two shoppers
 * searching the same term share one origin request.
 *
 * The suggestion key deliberately carries only `term` and `limit`. Adding
 * anything request-derived would fragment the cache across visitors for a feature
 * whose whole value is that popular terms are shared.
 *
 * The constant and the return type live in `domain/suggestions.ts`, not here: a
 * `'use server'` module may export only async functions, and exporting anything
 * else silently strips *all* of its exports.
 */

const SUGGESTION_LIMIT = 5;

export async function searchSuggestions(rawTerm: string): Promise<Suggestion[]> {
  const term = rawTerm.trim();

  if (term.length < MIN_QUERY_LENGTH) {
    return [];
  }

  // `DEFAULT_LIMIT`, not `SUGGESTION_LIMIT`, is deliberate: it produces the same
  // cache key the results page will use for this term, so the suggestion request
  // warms the page the shopper is about to open. Trimming to five happens after
  // the cache, where it costs nothing.
  const listing = await searchListing({ term, limit: DEFAULT_LIMIT });

  return listing.products.slice(0, SUGGESTION_LIMIT).map((product) => ({
    id: product.id,
    title: product.title,
    href: product.href,
    image: product.image ?? null,
  }));
}
