import type { ResultOf } from 'gql.tada';
import { cacheLife, cacheTag } from 'next/cache';

import { toSafeHtml } from '~/domain/html';
import { type ProductOptionField, toProductOptions } from '~/domain/product-options';
import { query } from '~/lib/bigcommerce';
import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import { ProductOptionsFragment } from '~/lib/bigcommerce/fragments/product-options';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';
import { buildConfig } from '~/lib/config';
import { env } from '~/lib/env';

/**
 * Product content: everything that does **not** vary with the shopper or with
 * their variant selection.
 *
 * This is the PDP's static shell. Catalyst split the equivalent across seven
 * queries wired together by seventeen `Streamable` closures; here it is one
 * cached read that several independent components consume, following the "one
 * query per (cache key, cacheLife) tuple, not per component" rule.
 *
 * Price and inventory live in `data/pricing.ts` / `data/inventory.ts` because
 * they key on the variant selection and churn far faster.
 */

const ProductQuery = graphql(
  `
    query ProductPage($entityId: Int!) {
      site {
        product(entityId: $entityId) {
          entityId
          name
          path
          sku
          description
          plainTextDescription(characterLimit: 200)
          warranty
          condition
          weight {
            value
            unit
          }
          brand {
            name
            path
          }
          defaultImage {
            url: urlTemplate(lossy: true)
            altText
          }
          images(first: 12) {
            edges {
              node {
                url: urlTemplate(lossy: true)
                altText
                isDefault
              }
            }
          }
          videos(first: 25) {
            edges {
              node {
                title
                url
              }
            }
          }
          customFields(first: 30) {
            edges {
              node {
                entityId
                name
                value
              }
            }
          }
          reviewSummary {
            averageRating
            numberOfReviews
          }
          minPurchaseQuantity
          maxPurchaseQuantity
          seo {
            pageTitle
            metaDescription
            metaKeywords
          }
          categories(first: 1) {
            edges {
              node {
                name
                path
                breadcrumbs(depth: 5) {
                  edges {
                    node {
                      name
                      path
                    }
                  }
                }
              }
            }
          }
          ...ProductOptionsFragment
        }
      }
    }
  `,
  [ProductOptionsFragment],
);

export interface ProductImage {
  src: string;
  alt: string;
  isDefault: boolean;
}

export interface Product {
  id: number;
  name: string;
  path: string;
  sku: string | null;
  /** Merchant-authored WYSIWYG HTML. */
  description: string | null;
  plainTextDescription: string;
  warranty: string | null;
  condition: string | null;
  weight: { value: number; unit: string } | null;
  brand: { name: string; path: string } | null;
  images: ProductImage[];
  videos: Array<{ title: string; url: string }>;
  customFields: Array<{ id: number; name: string; value: string }>;
  rating: number;
  numberOfReviews: number;
  minPurchaseQuantity: number;
  maxPurchaseQuantity: number | null;
  options: ProductOptionField[];
  breadcrumbs: Array<{ label: string; href: string }>;
  seo: { pageTitle: string; metaDescription: string; metaKeywords: string };
}

export async function getProduct(entityId: number): Promise<Product | null> {
  'use cache';
  cacheLife('product');
  cacheTag(tags.product(entityId), tags.products);

  const data = await query({ document: ProductQuery, variables: { entityId } });
  const product = data.site.product;

  if (!product) {
    return null;
  }

  const cdnHost = buildConfig.get('urls').cdnUrls[0] ?? '';

  const images = removeEdgesAndNodes(product.images).map((image) => ({
    src: image.url,
    alt: image.altText,
    isDefault: image.isDefault,
  }));

  // The default image anchors the gallery and is the LCP candidate, so it is
  // pinned first regardless of the order BigCommerce returns.
  images.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

  // BigCommerce has no product-level breadcrumb; the trail comes from the
  // product's primary category.
  const primaryCategory = removeEdgesAndNodes(product.categories).at(0);
  const breadcrumbs = primaryCategory
    ? removeEdgesAndNodes(primaryCategory.breadcrumbs).map((crumb) => ({
        label: crumb.name,
        href: crumb.path ?? '#',
      }))
    : [];

  return {
    id: product.entityId,
    name: product.name,
    path: product.path,
    sku: product.sku || null,
    // Sanitized and URL-rewritten here so the *safe* HTML is what gets cached.
    description: toSafeHtml(product.description, cdnHost, env.BIGCOMMERCE_STORE_HASH),
    plainTextDescription: product.plainTextDescription,
    warranty: toSafeHtml(product.warranty, cdnHost, env.BIGCOMMERCE_STORE_HASH),
    condition: product.condition ?? null,
    weight: product.weight ?? null,
    brand: product.brand ?? null,
    images,
    videos: removeEdgesAndNodes(product.videos),
    customFields: removeEdgesAndNodes(product.customFields).map((field) => ({
      id: field.entityId,
      name: field.name,
      value: field.value,
    })),
    rating: product.reviewSummary.averageRating,
    numberOfReviews: product.reviewSummary.numberOfReviews,
    minPurchaseQuantity: product.minPurchaseQuantity ?? 1,
    maxPurchaseQuantity: product.maxPurchaseQuantity ?? null,
    options: toProductOptions(product.productOptions),
    breadcrumbs: [...breadcrumbs, { label: product.name, href: product.path }],
    seo: product.seo ?? { pageTitle: '', metaDescription: '', metaKeywords: '' },
  };
}

/* ── Related products ─────────────────────────────────────────────────────── */

const RelatedProductsQuery = graphql(`
  query RelatedProducts($entityId: Int!, $currencyCode: currencyCode) {
    site {
      product(entityId: $entityId) {
        relatedProducts(first: 8) {
          edges {
            node {
              entityId
              name
              path
              defaultImage {
                url: urlTemplate(lossy: true)
                altText
              }
              brand {
                name
              }
              reviewSummary {
                averageRating
                numberOfReviews
              }
              prices(currencyCode: $currencyCode) {
                price {
                  value
                  currencyCode
                }
                basePrice {
                  value
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`);

export interface RelatedProduct {
  id: string;
  title: string;
  href: string;
  image?: { src: string; alt: string };
  brand?: string;
  price: number | null;
  currencyCode: string;
  rating: number;
  numberOfReviews: number;
}

export async function getRelatedProducts(entityId: number): Promise<RelatedProduct[]> {
  'use cache';
  cacheLife('product');
  cacheTag(tags.product(entityId), tags.products);

  const data = await query({
    document: RelatedProductsQuery,
    variables: { entityId, currencyCode: null },
  });

  return removeEdgesAndNodes(data.site.product?.relatedProducts ?? { edges: [] }).map((related) => ({
    id: String(related.entityId),
    title: related.name,
    href: related.path,
    image: related.defaultImage
      ? { src: related.defaultImage.url, alt: related.defaultImage.altText }
      : undefined,
    brand: related.brand?.name ?? undefined,
    price: related.prices?.price.value ?? null,
    currencyCode: related.prices?.price.currencyCode ?? 'USD',
    rating: related.reviewSummary.averageRating,
    numberOfReviews: related.reviewSummary.numberOfReviews,
  }));
}

/* ── Reviews (read path) ──────────────────────────────────────────────────── */

const ReviewsQuery = graphql(`
  query ProductReviews($entityId: Int!, $first: Int!, $after: String) {
    site {
      product(entityId: $entityId) {
        reviews(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              entityId
              author {
                name
              }
              title
              text
              rating
              createdAt {
                utc
              }
            }
          }
        }
      }
    }
  }
`);

export interface Review {
  id: number;
  author: string;
  title: string;
  text: string;
  rating: number;
  createdAt: string;
}

export async function getProductReviews(
  entityId: number,
  first = 5,
  after: string | null = null,
): Promise<{ reviews: Review[]; hasNextPage: boolean; endCursor: string | null }> {
  'use cache';
  cacheLife('reviews');
  cacheTag(tags.productReviews(entityId), tags.product(entityId));

  const data = await query({ document: ReviewsQuery, variables: { entityId, first, after } });
  const connection = data.site.product?.reviews;

  if (!connection) {
    return { reviews: [], hasNextPage: false, endCursor: null };
  }

  return {
    reviews: removeEdgesAndNodes(connection).map((review) => ({
      id: review.entityId,
      author: review.author.name,
      title: review.title,
      text: review.text,
      rating: review.rating,
      createdAt: review.createdAt.utc,
    })),
    hasNextPage: connection.pageInfo.hasNextPage,
    endCursor: connection.pageInfo.endCursor,
  };
}

/* ── Static params ────────────────────────────────────────────────────────── */

const ProductIdsQuery = graphql(`
  query ProductIds($first: Int!, $after: String) {
    site {
      products(first: $first, after: $after) {
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

/** BigCommerce rejects `first` above this on product connections. */
const PRODUCTS_MAX_PAGE_SIZE = 50;

/**
 * Products are the one unbounded set on a storefront — tens of thousands is
 * ordinary — so unlike categories and brands this seeds a **top-N slice**, never
 * the whole catalog. Each seeded route costs a build-time BigCommerce call, and
 * `dynamicParams` covers everything else correctly.
 *
 * Kept deliberately small by default. On a real catalog a post-deploy cache-warm
 * over actual top URLs beats guessing at build time — remote cache entries are
 * keyed by `buildId`, so every deploy starts cold regardless of seeding.
 *
 * **Cannot be zero.** Cache Components requires `generateStaticParams` to return
 * at least one result: *"all `generateStaticParams` functions must return at
 * least one result … to ensure that we can perform build-time validation that
 * there is no other dynamic accesses that would cause a runtime error."* So the
 * limit clamps to a minimum of 1 rather than disabling prerendering.
 */
const PRODUCT_STATIC_PARAMS_LIMIT = Math.max(
  1,
  Number(process.env.PRODUCT_STATIC_PARAMS_LIMIT ?? 10),
);

export async function getProductIds(limit = PRODUCT_STATIC_PARAMS_LIMIT): Promise<number[]> {
  'use cache';
  cacheLife('navigation');
  cacheTag(tags.products);

  // Paginated, so the ceiling is `limit` rather than BigCommerce's 50-per-page
  // cap. Without this, asking for 200 silently returned 50 — the limit claimed
  // one thing and did another, which is worse than either bound on its own.
  const ids: number[] = [];
  let after: string | null = null;

  while (ids.length < limit) {
    const data: ResultOf<typeof ProductIdsQuery> = await query({
      document: ProductIdsQuery,
      variables: { first: Math.min(PRODUCTS_MAX_PAGE_SIZE, limit - ids.length), after },
    });

    ids.push(...removeEdgesAndNodes(data.site.products).map((product) => product.entityId));

    const { hasNextPage, endCursor } = data.site.products.pageInfo;

    if (!hasNextPage || !endCursor) {
      break;
    }

    after = endCursor;
  }

  return ids.slice(0, limit);
}
