/**
 * Canonicalization of listing URL params into a stable cache key.
 *
 * **This is the single most important file for PLP cache hit rate.** Search params
 * are unbounded — `utm_*`, `fbclid`, `gclid`, and whatever else an ad network
 * appends — and every distinct key produces a distinct cache entry. Without
 * discipline the remote cache fills with single-use entries and the PLP ends up
 * *slower* than Catalyst's uncached version, because it pays cache writes on top
 * of the same origin requests.
 *
 * Five rules, in order:
 *   1. Keep only known keys and known facet ids. Everything else is dropped, so
 *      `?utm_source=x` shares an entry with the bare URL.
 *   2. Sort keys and multi-values, so `?b=2&a=1` and `?a=1&b=2` are one entry.
 *   3. Drop values equal to the default — `sort=featured` and page 1 collapse to
 *      absent, which is what makes the unfiltered key the shared common case.
 *   4. Clamp the page size, and never carry both cursors at once.
 *   5. Above a facet-count threshold, bypass the cache entirely (see
 *      `shouldBypassCache`). Deep filter combinations are long-tail by nature and
 *      would otherwise evict the entries that actually get reused.
 */

export const SORT_OPTIONS = [
  { value: 'featured', label: 'Featured', bc: 'FEATURED' },
  { value: 'newest', label: 'Newest', bc: 'NEWEST' },
  { value: 'best-selling', label: 'Best selling', bc: 'BEST_SELLING' },
  { value: 'a-to-z', label: 'A to Z', bc: 'A_TO_Z' },
  { value: 'z-to-a', label: 'Z to A', bc: 'Z_TO_A' },
  { value: 'best-reviewed', label: 'Best reviewed', bc: 'BEST_REVIEWED' },
  { value: 'price-asc', label: 'Price: low to high', bc: 'LOWEST_PRICE' },
  { value: 'price-desc', label: 'Price: high to low', bc: 'HIGHEST_PRICE' },
  { value: 'relevance', label: 'Relevance', bc: 'RELEVANCE' },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]['value'];

const SORT_VALUES = SORT_OPTIONS.map((option) => option.value);

/**
 * BigCommerce's sort enum → our URL-facing value.
 *
 * The two vocabularies differ (`LOWEST_PRICE` vs `price-asc`), and both a
 * category's `defaultProductSort` and the store's `defaultSearchProductSort`
 * arrive in BigCommerce's. Returns `undefined` for anything unrecognized so a new
 * enum member degrades to "no configured default" rather than producing a sort
 * value that canonicalization would treat as a real, cache-fragmenting filter.
 */
export function fromBcSort(bcSort: string | null | undefined): SortValue | undefined {
  return SORT_OPTIONS.find((option) => option.bc === bcSort)?.value;
}

export const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 48;

/** Above this many active facet groups, skip the cache. */
const MAX_CACHEABLE_FACETS = 4;

/** Raw `searchParams` shape as Next provides it. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/**
 * The canonical key. Every field is scalar or a sorted array, so Next can
 * serialize it into a stable cache key. Absent means "default".
 */
export interface ListingKey {
  categoryId?: number;
  brandId?: number;
  term?: string;
  sort?: SortValue;
  limit: number;
  after?: string;
  before?: string;
  categoryIn?: number[];
  brands?: number[];
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  inStock?: boolean;
  freeShipping?: boolean;
  isFeatured?: boolean;
  /** `[attributeKey, sortedValues]` pairs, sorted by key. */
  attributes?: Array<[string, string[]]>;
  /**
   * Display currency.
   *
   * Part of the key so listings in different currencies are different entries,
   * each shared by everyone using that currency.
   *
   * **Always populated, never inferred.** It used to be omitted whenever it
   * matched the "default", on the theory that the prerendered shell carried no
   * currency in its key. That was wrong in a way that only showed up once a
   * second locale existed: an omitted `currencyCode` does not mean "the default
   * we had in mind", it means BigCommerce answers with the *channel's* default.
   * The channel's default is USD, so `/es/garden/` rendered `89,00 US$` — Spanish
   * number formatting wrapped around the wrong currency — while the PDP, which
   * always passed a currency explicitly, correctly showed euros.
   */
  currency?: string;
}

const toArray = (value: string | string[] | undefined): string[] => {
  if (Array.isArray(value)) {
    return value;
  }

  return typeof value === 'string' && value !== '' ? [value] : [];
};

const toNumbers = (value: string | string[] | undefined): number[] =>
  toArray(value)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

const toNumber = (value: string | string[] | undefined): number | undefined => {
  const [first] = toArray(value);
  const parsed = Number(first);

  return Number.isFinite(parsed) ? parsed : undefined;
};

const toBool = (value: string | string[] | undefined): boolean | undefined => {
  const [first] = toArray(value);

  // Only an explicit truthy value counts. `?stock=` or `?stock=false` collapse to
  // absent so they share the unfiltered entry.
  return first === 'true' || first === '1' || first === 'in_stock' || first === 'free_shipping'
    ? true
    : undefined;
};

const ATTRIBUTE_KEY = /^attr_(.+)$/;

export interface CanonicalizeOptions {
  categoryId?: number;
  brandId?: number;
  /** Merchant-configured default sort for this category; omitted from the key. */
  defaultSort?: SortValue;
  /**
   * The shopper's display currency.
   *
   * No `defaultCurrency` companion any more: there is nothing to compare
   * against, because the currency now always reaches the key. Callers rendering
   * the cached shell pass the locale's default (readable from the locale root
   * param, so still cacheable); callers rendering a refined view pass the
   * shopper's selection.
   *
   * Per-locale keys were already distinct — locale is a root param — so making
   * the currency explicit adds no cache cardinality that the locale had not
   * already created.
   */
  currency?: string;
}

export function canonicalizeListingParams(
  raw: RawSearchParams,
  options: CanonicalizeOptions = {},
): ListingKey {
  const key: ListingKey = { limit: DEFAULT_LIMIT };

  if (options.currency) {
    key.currency = options.currency;
  }

  if (options.categoryId !== undefined) {
    key.categoryId = options.categoryId;
  }

  if (options.brandId !== undefined) {
    key.brandId = options.brandId;
  }

  const term = toArray(raw.term)[0]?.trim();

  if (term) {
    key.term = term;
  }

  // Rule 3: the default sort never appears in the key, so `?sort=featured` and no
  // sort param share one entry.
  const sort = toArray(raw.sort)[0];

  if (sort && SORT_VALUES.includes(sort as SortValue) && sort !== (options.defaultSort ?? 'featured')) {
    key.sort = sort as SortValue;
  }

  const limit = toNumber(raw.limit);

  if (limit !== undefined && limit !== DEFAULT_LIMIT) {
    key.limit = Math.min(Math.max(1, limit), MAX_LIMIT);
  }

  // Cursors are opaque; pass through but never both at once.
  const after = toArray(raw.after)[0];
  const before = toArray(raw.before)[0];

  if (after) {
    key.after = after;
  } else if (before) {
    key.before = before;
  }

  const categoryIn = toNumbers(raw.categoryIn);

  if (categoryIn.length > 0) {
    key.categoryIn = categoryIn;
  }

  const brands = toNumbers(raw.brand);

  if (brands.length > 0) {
    key.brands = brands;
  }

  const minPrice = toNumber(raw.minPrice);
  const maxPrice = toNumber(raw.maxPrice);

  if (minPrice !== undefined) {
    key.minPrice = minPrice;
  }

  if (maxPrice !== undefined) {
    key.maxPrice = maxPrice;
  }

  const minRating = toNumber(raw.minRating);

  if (minRating !== undefined) {
    key.minRating = minRating;
  }

  const inStock = toBool(raw.stock);

  if (inStock) {
    key.inStock = true;
  }

  const freeShipping = toBool(raw.shipping);

  if (freeShipping) {
    key.freeShipping = true;
  }

  const isFeatured = toBool(raw.isFeatured);

  if (isFeatured) {
    key.isFeatured = true;
  }

  // Rules 1 + 2: only `attr_*` keys survive, and both the pairs and each pair's
  // values are sorted.
  const attributes = Object.entries(raw)
    .flatMap(([rawKey, value]): Array<[string, string[]]> => {
      const match = ATTRIBUTE_KEY.exec(rawKey);
      const values = toArray(value).filter(Boolean).sort();

      return match?.[1] && values.length > 0 ? [[match[1], values]] : [];
    })
    .sort(([a], [b]) => a.localeCompare(b));

  if (attributes.length > 0) {
    key.attributes = attributes;
  }

  return key;
}

/** True when the shopper has narrowed beyond the default view. */
export function isFiltered(key: ListingKey): boolean {
  return (
    activeFacetCount(key) > 0 ||
    key.sort !== undefined ||
    key.after !== undefined ||
    key.before !== undefined
  );
}

export function activeFacetCount(key: ListingKey): number {
  return [
    key.categoryIn,
    key.brands,
    key.minPrice ?? key.maxPrice,
    key.minRating,
    key.inStock,
    key.freeShipping,
    key.isFeatured,
    ...(key.attributes ?? []).map(([, values]) => values),
  ].filter((value) => value !== undefined).length;
}

/**
 * Rule 5. Deep refinements are effectively unique per shopper, so caching them
 * costs a write and an eviction to serve exactly one request.
 */
export function shouldBypassCache(key: ListingKey): boolean {
  return activeFacetCount(key) > MAX_CACHEABLE_FACETS;
}

/**
 * The unfiltered view of the same listing — the entry most traffic shares.
 *
 * **Currency survives; filters do not.** That distinction is the whole point and
 * it was missing: currency is not a refinement of *which* products to show, it is
 * the unit the answer comes back in. Dropping it sent `currencyCode: null`, which
 * BigCommerce answers with the channel's default — so the prerendered shell for
 * `/es/garden/` was built in USD, rendered `89,00 US$`, and was then visibly
 * replaced by `86,50 €` when the refined grid streamed in.
 *
 * Keeping it costs nothing in cache cardinality: each locale prerenders its own
 * shell already, and a locale has exactly one default currency.
 */
export function defaultKey(key: ListingKey): ListingKey {
  return {
    limit: key.limit,
    ...(key.categoryId !== undefined && { categoryId: key.categoryId }),
    ...(key.brandId !== undefined && { brandId: key.brandId }),
    ...(key.term !== undefined && { term: key.term }),
    ...(key.currency !== undefined && { currency: key.currency }),
  };
}

