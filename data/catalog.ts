import type { ResultOf } from 'gql.tada';
import { cacheLife, cacheTag } from 'next/cache';

import type { Breadcrumb } from '~/domain/breadcrumbs';
import type { SortValue } from '~/domain/listing-params';
import { query } from '~/lib/bigcommerce';
import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

export type { Breadcrumb };

/**
 * Category and brand entity data — everything the listing page needs *except*
 * products. Kept separate from `data/search.ts` because it has a different cache
 * key (entity id only, no facets) and a different lifetime: a category's name and
 * description change far less often than its product set.
 */

export interface CategoryPage {
  id: number;
  name: string;
  description: string | null;
  /**
   * The merchant's vanity URL (e.g. `/plants/`), NOT the internal `/category/98`
   * rewrite target. Every refinement link on the listing page is built from this
   * — see the note in the category route.
   */
  path: string;
  breadcrumbs: Breadcrumb[];
  /** Merchant-configured default sort, folded into the cache key canonicalization. */
  defaultSort?: SortValue;
  seo: { pageTitle: string; metaDescription: string; metaKeywords: string };
}

export interface BrandPage {
  id: number;
  name: string;
  path: string;
  seo: { pageTitle: string; metaDescription: string; metaKeywords: string };
}

const CategoryIdsQuery = graphql(`
  query CategoryIds {
    site {
      categoryTree {
        entityId
        children {
          entityId
          children {
            entityId
          }
        }
      }
    }
  }
`);

const BrandIdsQuery = graphql(`
  query BrandIds($first: Int!, $after: String) {
    site {
      brands(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            entityId
          }
        }
      }
    }
  }
`);

/** BigCommerce rejects `first` above this: "Argument 'first' cannot exceed 50". */
const BRANDS_MAX_PAGE_SIZE = 50;

const CategoryQuery = graphql(`
  query CategoryPage($entityId: Int!) {
    site {
      category(entityId: $entityId) {
        entityId
        name
        description
        defaultProductSort
        path
        breadcrumbs(depth: 5) {
          edges {
            node {
              name
              path
            }
          }
        }
        seo {
          pageTitle
          metaDescription
          metaKeywords
        }
      }
    }
  }
`);

const BrandQuery = graphql(`
  query BrandPage($entityId: Int!) {
    site {
      brand(entityId: $entityId) {
        entityId
        name
        path
        seo {
          pageTitle
          metaDescription
          metaKeywords
        }
      }
    }
  }
`);

/**
 * BigCommerce's `defaultProductSort` enum uses different spellings from the
 * public URL values, so it is mapped rather than passed through — and it feeds
 * canonicalization, so a category whose default is "newest" collapses
 * `?sort=newest` to the shared unfiltered key.
 */
const DEFAULT_SORT_MAP: Record<string, SortValue> = {
  FEATURED: 'featured',
  NEWEST: 'newest',
  BEST_SELLING: 'best-selling',
  ALPHABETICAL_ASC: 'a-to-z',
  ALPHABETICAL_DESC: 'z-to-a',
  HIGHEST_PRICE: 'price-desc',
  LOWEST_PRICE: 'price-asc',
  BEST_REVIEWED: 'best-reviewed',
  RELEVANCE: 'relevance',
};

const EMPTY_SEO = { pageTitle: '', metaDescription: '', metaKeywords: '' };

export async function getCategory(entityId: number): Promise<CategoryPage | null> {
  'use cache';
  cacheLife('product');
  cacheTag(tags.category(entityId), tags.categories);

  const data = await query({ document: CategoryQuery, variables: { entityId } });
  const category = data.site.category;

  if (!category) {
    return null;
  }

  const crumbs = category.breadcrumbs.edges ?? [];

  return {
    id: category.entityId,
    name: category.name,
    description: category.description || null,
    path: category.path,
    breadcrumbs: crumbs
      .filter((edge) => edge !== null)
      .map((edge) => ({ label: edge.node.name, href: edge.node.path ?? '#' })),
    defaultSort: category.defaultProductSort
      ? DEFAULT_SORT_MAP[category.defaultProductSort]
      : undefined,
    seo: category.seo ?? EMPTY_SEO,
  };
}

export async function getBrand(entityId: number): Promise<BrandPage | null> {
  'use cache';
  cacheLife('product');
  cacheTag(tags.brand(entityId), tags.brands);

  const data = await query({ document: BrandQuery, variables: { entityId } });
  const brand = data.site.brand;

  if (!brand) {
    return null;
  }

  return {
    id: brand.entityId,
    name: brand.name,
    path: brand.path,
    seo: brand.seo ?? EMPTY_SEO,
  };
}

/**
 * Ids for `generateStaticParams`.
 *
 * Seeding matters more than it first appears. Without static params, `params` is
 * runtime data, so everything below `await params` — including the unfiltered
 * product grid — falls out of the static shell and the listing route prerenders
 * only the surrounding chrome. Seeding is what makes "unfiltered page 1 is in the
 * shell" actually true.
 *
 * **Bounded, not exhaustive.** Each seeded route costs 2 BigCommerce calls at
 * build time (`CategoryPage` + `SearchProducts`), so a store with 1000 categories
 * and 1000 brands would issue ~4000 build-time requests — minutes of network,
 * against a rate- and complexity-limited API. Seeding is a *performance* choice,
 * not a correctness one: `dynamicParams` stays on, so anything unseeded still
 * renders correctly, just with a chrome-only shell until its first request warms
 * the cache.
 *
 * Tune with `STATIC_PARAMS_LIMIT`. Set it to `0` to disable prerendering entirely
 * (fastest builds, no shells) — worth doing on very large catalogs where a
 * post-deploy cache-warm job over the top URLs is the better lever.
 */
const STATIC_PARAMS_LIMIT = Number(process.env.STATIC_PARAMS_LIMIT ?? 100);

export async function getCategoryIds(limit = STATIC_PARAMS_LIMIT): Promise<number[]> {
  'use cache';
  cacheLife('navigation');
  cacheTag(tags.categories);

  if (limit <= 0) {
    return [];
  }

  const data = await query({ document: CategoryIdsQuery });

  // Breadth-first: top-level categories carry the most traffic, so they are the
  // ones worth prerendering when the limit bites.
  const byDepth = [
    data.site.categoryTree.map((top) => top.entityId),
    data.site.categoryTree.flatMap((top) => top.children.map((child) => child.entityId)),
    data.site.categoryTree.flatMap((top) =>
      top.children.flatMap((child) => child.children.map((grandchild) => grandchild.entityId)),
    ),
  ];

  return [...new Set(byDepth.flat())].slice(0, limit);
}

export async function getBrandIds(limit = STATIC_PARAMS_LIMIT): Promise<number[]> {
  'use cache';
  cacheLife('navigation');
  cacheTag(tags.brands);

  if (limit <= 0) {
    return [];
  }

  // Paginated so the ceiling is ours (`STATIC_PARAMS_LIMIT`) rather than
  // BigCommerce's 50-per-page cap. Sequential by necessity — each request needs
  // the previous cursor — but it runs once per build, behind a cached read.
  const ids: number[] = [];
  let after: string | null = null;

  while (ids.length < limit) {
    // Annotated explicitly: without it TS sees a cycle, since `after` is assigned
    // from `endCursor`, which is inferred from `data`, which depends on `after`.
    const data: ResultOf<typeof BrandIdsQuery> = await query({
      document: BrandIdsQuery,
      variables: { first: Math.min(BRANDS_MAX_PAGE_SIZE, limit - ids.length), after },
    });

    ids.push(...removeEdgesAndNodes(data.site.brands).map((brand) => brand.entityId));

    const { hasNextPage, endCursor } = data.site.brands.pageInfo;

    if (!hasNextPage || !endCursor) {
      break;
    }

    after = endCursor;
  }

  return ids.slice(0, limit);
}
