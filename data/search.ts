import type { ResultOf } from 'gql.tada';
import { cacheLife, cacheTag } from 'next/cache';
import { type Facet, type RawFacet, toFacets } from '~/domain/facets';
import {
  defaultKey,
  type ListingKey,
  shouldBypassCache,
  SORT_OPTIONS,
} from '~/domain/listing-params';
import { type ProductCard, toProductCard } from '~/domain/product-card';
import { query } from '~/lib/bigcommerce';
import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import { PaginationFragment } from '~/lib/bigcommerce/fragments/pagination';
import { ProductCardFragment } from '~/lib/bigcommerce/fragments/product-card';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';
import { getStoreSettings } from './settings';

/**
 * Faceted product search — the engine behind category, brand, and search pages.
 *
 * **One query serves four consumers.** Facets, result count, product grid, and
 * pagination all call `searchListing(key)` with the same canonical key, so they
 * resolve from a single cache entry and a single origin request. This is the
 * "one query per (cache key, cacheLife) tuple, not per component" rule — without
 * it, composing the page out of independent components would multiply requests.
 */

const SearchProductsQuery = graphql(
  `
    query SearchProducts(
      $first: Int
      $last: Int
      $after: String
      $before: String
      $filters: SearchProductsFiltersInput!
      $sort: SearchProductsSortInput
      $currencyCode: currencyCode
    ) {
      site {
        search {
          searchProducts(filters: $filters, sort: $sort) {
            products(first: $first, after: $after, last: $last, before: $before) {
              pageInfo {
                ...PaginationFragment
              }
              collectionInfo {
                totalItems
              }
              edges {
                node {
                  ...ProductCardFragment
                }
              }
            }
            filters {
              edges {
                node {
                  __typename
                  displayName
                  isCollapsedByDefault
                  ... on BrandSearchFilter {
                    displayProductCount
                    brands {
                      edges {
                        node {
                          entityId
                          name
                          isSelected
                          productCount
                        }
                      }
                    }
                  }
                  ... on CategorySearchFilter {
                    displayProductCount
                    categories {
                      edges {
                        node {
                          entityId
                          name
                          isSelected
                          productCount
                          subCategories {
                            edges {
                              node {
                                entityId
                                name
                                isSelected
                                productCount
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                  ... on ProductAttributeSearchFilter {
                    displayProductCount
                    filterKey
                    attributes {
                      edges {
                        node {
                          value
                          isSelected
                          productCount
                        }
                      }
                    }
                  }
                  ... on RatingSearchFilter {
                    ratings {
                      edges {
                        node {
                          value
                          isSelected
                          productCount
                        }
                      }
                    }
                  }
                  ... on PriceSearchFilter {
                    selected {
                      minPrice
                      maxPrice
                    }
                  }
                  ... on OtherSearchFilter {
                    displayProductCount
                    freeShipping {
                      isSelected
                      productCount
                    }
                    isFeatured {
                      isSelected
                      productCount
                    }
                    isInStock {
                      isSelected
                      productCount
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `,
  [PaginationFragment, ProductCardFragment],
);

export interface Pagination {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

export interface Listing {
  products: ProductCard[];
  totalItems: number;
  pagination: Pagination;
  /** Raw facet nodes; `toFacets` needs two of these to compute disabled states. */
  rawFacets: RawFacet[];
}

type SearchResult = ResultOf<typeof SearchProductsQuery>;

type FilterConnection = SearchResult['site']['search']['searchProducts']['filters'];

/**
 * Flattens BigCommerce's Relay connections inside each facet variant.
 *
 * The switch narrows on `__typename` before touching variant-specific fields, so
 * this stays type-safe without casts — the union member's own shape is what makes
 * `node.brands` legal in that branch and not in others.
 */

function flattenFacets(filters: FilterConnection): RawFacet[] {
  return removeEdgesAndNodes(filters).map((node): RawFacet => {
    switch (node.__typename) {
      case 'BrandSearchFilter':
        return { ...node, brands: removeEdgesAndNodes(node.brands) };
      case 'CategorySearchFilter':
        return {
          ...node,
          categories: removeEdgesAndNodes(node.categories).map((category) => ({
            ...category,
            subCategories: removeEdgesAndNodes(category.subCategories),
          })),
        };
      case 'ProductAttributeSearchFilter':
        return { ...node, attributes: removeEdgesAndNodes(node.attributes) };
      case 'RatingSearchFilter':
        return { ...node, ratings: removeEdgesAndNodes(node.ratings) };
      default:
        return node;
    }
  });
}

function toVariables(key: ListingKey) {
  const sort = SORT_OPTIONS.find((option) => option.value === key.sort)?.bc;
  // `before` means "walk backwards from this cursor", which in Relay terms is
  // last/before rather than first/after.
  const pagination = key.before
    ? { last: key.limit, before: key.before }
    : { first: key.limit, after: key.after ?? null };
  return {
    ...pagination,
    currencyCode: null,
    sort: sort ?? null,
    filters: {
      categoryEntityId: key.categoryId ?? null,
      categoryEntityIds: key.categoryIn ?? null,
      brandEntityIds: key.brands ?? (key.brandId !== undefined ? [key.brandId] : null),
      searchTerm: key.term ?? null,
      hideOutOfStock: key.inStock ?? null,
      isFreeShipping: key.freeShipping ?? null,
      isFeatured: key.isFeatured ?? null,
      price:
        key.minPrice !== undefined || key.maxPrice !== undefined
          ? { minPrice: key.minPrice ?? null, maxPrice: key.maxPrice ?? null }
          : null,
      rating: key.minRating !== undefined ? { minRating: key.minRating, maxRating: null } : null,
      productAttributes:
        key.attributes?.map(([attribute, values]) => ({ attribute, values })) ?? null,
    },
  };
}

async function fetchListing(key: ListingKey): Promise<Listing> {
  const [data, settings] = await Promise.all([
    query({ document: SearchProductsQuery, variables: toVariables(key) }),
    getStoreSettings(),
  ]);
  const results = data.site.search.searchProducts;
  return {
    products: removeEdgesAndNodes(results.products).map((product) =>
      toProductCard(product, {
        taxDisplay: settings.taxDisplay.plp,
        inventory: settings.inventory,
      }),
    ),
    totalItems: results.products.collectionInfo?.totalItems ?? 0,
    pagination: results.products.pageInfo,
    rawFacets: flattenFacets(results.filters),
  };
}

/**
 * Cache-miss instrumentation.
 *
 * `use cache` exposes no hit/miss signal, but the body of a cached function only
 * executes on a miss — so logging here counts misses exactly. Divide by request
 * count to get the hit rate the Phase 2 bar asks for (>90% on the default key).
 *
 * Logs the *key shape* rather than the key: which facets are engaged is what
 * predicts hit rate, and the concrete values would be unbounded.
 */

function logCacheMiss(key: ListingKey): void {
  if (process.env.CACHE_MISS_LOGGER !== 'true') {
    return;
  }
  const shape = [
    key.categoryId !== undefined && 'category',
    key.brandId !== undefined && 'brand',
    key.term !== undefined && 'term',
    key.sort !== undefined && 'sort',
    (key.after ?? key.before) !== undefined && 'page',
    key.categoryIn && 'categoryIn',
    key.brands && 'brandFilter',
    (key.minPrice ?? key.maxPrice) !== undefined && 'price',
    key.minRating !== undefined && 'rating',
    key.inStock && 'inStock',
    key.freeShipping && 'freeShipping',
    key.isFeatured && 'featured',
    key.attributes && `attr×${key.attributes.length}`,
  ].filter(Boolean);

  console.log(`[cache-miss] searchListing shape=${shape.join('+') || 'default'}`);
}

/** Cached path. Only reached for keys that survive the cardinality cap. */

async function cachedListing(key: ListingKey): Promise<Listing> {
  'use cache: remote';
  // Filtered views have high key cardinality and short-lived value, so they get
  // the shorter `search` profile. The unfiltered default gets `listing`, whose
  // stale >= 300 is what lets it land in the static shell.
  cacheLife(key.after || key.before || hasFilters(key) ? 'search' : 'listing');
  cacheTag(
    tags.products,
    ...(key.categoryId !== undefined ? [tags.categoryProducts(key.categoryId)] : []),
    ...(key.brandId !== undefined ? [tags.brandProducts(key.brandId)] : []),
  );
  // Reached only on a miss — see logCacheMiss.
  logCacheMiss(key);
  return fetchListing(key);
}

function hasFilters(key: ListingKey): boolean {
  return (
    key.categoryIn !== undefined ||
    key.brands !== undefined ||
    key.minPrice !== undefined ||
    key.maxPrice !== undefined ||
    key.minRating !== undefined ||
    key.inStock !== undefined ||
    key.freeShipping !== undefined ||
    key.isFeatured !== undefined ||
    key.attributes !== undefined ||
    key.sort !== undefined
  );
}

/**
 * Entry point. Deep refinements bypass the cache entirely rather than filling it
 * with entries that will be read exactly once.
 */

export async function searchListing(key: ListingKey): Promise<Listing> {
  return shouldBypassCache(key) ? fetchListing(key) : cachedListing(key);
}

/**
 * Facets for the current refinement, with unavailable options greyed out rather
 * than removed.
 *
 * Note the second read is `searchListing(defaultKey(key))` — the *unfiltered*
 * listing for this same category. That is the identical entry the default grid
 * and every unfiltered visitor already use, so on the common path it is a cache
 * hit and this costs nothing extra.
 */

export async function getFacets(key: ListingKey): Promise<Facet[]> {
  const [refined, all] = await Promise.all([searchListing(key), searchListing(defaultKey(key))]);
  return toFacets(all.rawFacets, refined.rawFacets, key);
}
