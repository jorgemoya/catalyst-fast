import { getT } from '~/lib/i18n/server';
import type { ReactNode } from 'react';
import { Suspense } from 'react';

import type { Breadcrumb } from '~/domain/breadcrumbs';
import { getFacets, searchListing } from '~/data/search';
import { getStoreSettings } from '~/data/settings';
import { getDefaultCurrency, getSelectedCurrency } from '~/lib/currency';
import {
  canonicalizeListingParams,
  type CanonicalizeOptions,
  defaultKey,
  isFiltered,
  type RawSearchParams,
} from '~/domain/listing-params';
import { Breadcrumbs } from '~/ui/patterns/breadcrumbs';
import { Facets, FacetsSkeleton } from '~/ui/patterns/facets';
import { Pagination } from '~/ui/patterns/pagination';
import { Prose } from '~/ui/patterns/prose';
import { ProductGrid, ProductGridSkeleton } from '~/ui/patterns/product-card';
import { SortSelect } from '~/ui/patterns/sort-select';
import { Skeleton } from '~/ui/primitives/skeleton';

/**
 * Listing page composition, shared by category, brand, and (Phase 5) search.
 *
 * **Slot-based rather than prop-based.** An earlier version took eight props
 * including empty-state copy, which is the beginning of exactly the
 * section-component shape this project exists to avoid — every new consumer adds
 * a prop, and the component grows toward Catalyst's 27-prop
 * `ProductsListSection`. Callers now compose: `<ListingLayout>` owns structure,
 * `<ListingLayout.Header>` and friends take children.
 *
 * Two properties make the caching work:
 *
 * **1. `searchParams` is never awaited above a Suspense boundary.** It arrives as
 * a promise and is passed down; each region awaits it at the leaf. Awaiting it
 * here would make the whole page dynamic for every visitor, including the ~95%
 * who arrive with no filters.
 *
 * **2. Each dynamic region's Suspense fallback is a cached component** rendering
 * the *unfiltered* view. So the prerendered shell holds real products, facets,
 * and counts rather than skeletons, and a filtered request streams the refined
 * version over the top. The inner boundary is required because a fallback must
 * not itself suspend — verified in Phase 0, spike 3.
 *
 * Every data-reading region calls `searchListing` with the same canonical key, so
 * they share one cache entry and one origin request.
 *
 * **The cost, measured, so it does not get relitigated.** Property 2 means the
 * grid is serialized twice on an unfiltered request: once as the cached fallback
 * and once as the streamed result. `/shop-all/` ships 24 `<article>` elements
 * for 12 products — every one exactly doubled. That sounds worse than it is,
 * because the two copies are near-identical and gzip eats the second one:
 *
 *   27.4 KB gzipped as shipped · 25.3 KB with the surplus copies stripped
 *   → 2.1 KB, about 8% of the payload
 *
 * 2.1 KB is a fair price for the unfiltered listing painting instantly from the
 * static shell, which is the majority of listing traffic. Leave it alone. If it
 * ever needs to shrink, the move is a *lighter* fallback card (image and title,
 * no price or rating) rather than giving up the cached fallback — that keeps the
 * instant paint and roughly halves the duplicate.
 */

interface LayoutProps {
  children: ReactNode;
}

export function ListingLayout({ children }: LayoutProps) {
  return <div className="page-container py-8">{children}</div>;
}

function Header({
  breadcrumbs,
  title,
  description,
}: {
  breadcrumbs?: Breadcrumb[];
  title: string;
  description?: string | null;
}) {
  return (
    <>
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} />}
      <header className="mt-4 mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {/* Sanitized in `data/catalog.ts`; see the contract on `Prose`. */}
        {description && <Prose className="mt-3 text-muted" html={description} />}
      </header>
    </>
  );
}

function Body({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-8 lg:flex-row">
      <aside className="w-full shrink-0 lg:w-64">{sidebar}</aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

ListingLayout.Header = Header;
ListingLayout.Body = Body;

/**
 * Subcategory navigation, rendered above the facets.
 *
 * Distinct from the Category *facet*: this is a link group built from the
 * category tree, so it navigates to a child category's own page rather than
 * refining the current result set. Catalyst renders both for the same reason —
 * "browse into Succulents" and "narrow these results to Succulents" are different
 * intents, and only the former produces a canonical, indexable URL.
 */
export async function SubcategoryLinks({ items }: { items: Breadcrumb[] }) {
  const t = await getT();

  if (items.length === 0) {
    return null;
  }

  return (
    <nav aria-label={t('Listing.subcategories')} className="mb-6 border-b border-border pb-4">
      <h2 className="mb-3 text-sm font-semibold">{t('Listing.browse')}</h2>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item.href}>
            <a className="text-sm text-muted hover:text-foreground" href={item.href}>
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

interface RegionProps {
  options: CanonicalizeOptions;
  pathname: string;
  searchParams: Promise<RawSearchParams>;
  /**
   * Whether the Suspense fallback renders the cached *unfiltered* listing.
   *
   * True for category and brand, where "unfiltered" is a real, useful view that
   * most traffic lands on — so prerendering it puts real products in the shell.
   *
   * **False for search**, where it would be actively wrong: a search key with no
   * term is the entire catalog, so the fallback would flash the whole store
   * before the actual results replaced it, and would spend a full
   * `SearchProducts` query to do it. A search page has no static shell to fill
   * anyway — it cannot render at all without reading `term`.
   */
  prerenderDefault?: boolean;
}

/** Facet panel: refined when filters are present, cached-default otherwise. */
export function FacetRegion({
  options,
  pathname,
  searchParams,
  prerenderDefault = true,
}: RegionProps) {
  return (
    <Suspense
      fallback={
        prerenderDefault ? (
          <Suspense fallback={<FacetsSkeleton />}>
            <DefaultFacets options={options} pathname={pathname} />
          </Suspense>
        ) : (
          <FacetsSkeleton />
        )
      }
    >
      <RefinedFacets options={options} pathname={pathname} searchParams={searchParams} />
    </Suspense>
  );
}

export function ToolbarRegion({
  options,
  searchParams,
  prerenderDefault = true,
}: {
  options: CanonicalizeOptions;
  searchParams: Promise<RawSearchParams>;
  prerenderDefault?: boolean;
}) {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <Suspense
        fallback={
          prerenderDefault ? (
            <Suspense fallback={<Skeleton className="h-5 w-24" />}>
              <DefaultResultCount options={options} />
            </Suspense>
          ) : (
            <Skeleton className="h-5 w-24" />
          )
        }
      >
        <RefinedResultCount options={options} searchParams={searchParams} />
      </Suspense>

      <SortSelect defaultSort={options.defaultSort} />
    </div>
  );
}

export function GridRegion({
  options,
  pathname,
  searchParams,
  emptyState,
  prerenderDefault = true,
}: RegionProps & { emptyState: ReactNode }) {
  return (
    <Suspense
      fallback={
        prerenderDefault ? (
          <Suspense fallback={<ProductGridSkeleton count={8} />}>
            <DefaultGrid emptyState={emptyState} options={options} />
          </Suspense>
        ) : (
          <ProductGridSkeleton count={8} />
        )
      }
    >
      <RefinedGrid
        emptyState={emptyState}
        options={options}
        pathname={pathname}
        searchParams={searchParams}
      />
    </Suspense>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="rounded-(--radius-card) border border-border py-16 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted">{subtitle}</p>
    </div>
  );
}

/**
 * Whether product cards show star ratings. Merchants can disable reviews or the
 * rating display independently, and Catalyst gates on both — showing stars on a
 * store with reviews turned off would be inventing UI the merchant switched off.
 */
async function shouldShowRating(): Promise<boolean> {
  const settings = await getStoreSettings();

  return settings.reviewsEnabled && settings.showProductRating;
}

/**
 * Both grid variants need this, and it comes from the same cached settings entry
 * every other region already reads — so it costs no additional origin request.
 */
async function compareEnabled(): Promise<boolean> {
  return (await getStoreSettings()).productComparisonsEnabled;
}

/* ── Prerendered variants: no `searchParams` access anywhere below here ────── */

async function DefaultGrid({
  options,
  emptyState,
}: {
  options: CanonicalizeOptions;
  emptyState: ReactNode;
}) {
  const key = defaultKey(
    canonicalizeListingParams({}, { ...options, currency: await getDefaultCurrency() }),
  );
  const [listing, showRating, compare] = await Promise.all([
    searchListing(key),
    shouldShowRating(),
    compareEnabled(),
  ]);

  if (listing.products.length === 0) {
    return emptyState;
  }

  return (
    <ProductGrid
      compareEnabled={compare}
      priority
      products={listing.products}
      showRating={showRating}
    />
  );
}

async function DefaultResultCount({ options }: { options: CanonicalizeOptions }) {
  const { totalItems } = await searchListing(
    defaultKey(canonicalizeListingParams({}, { ...options, currency: await getDefaultCurrency() })),
  );

  return <CountText total={totalItems} />;
}

/**
 * With no refinement applied, the "all facets" and "refined facets" reads in
 * `getFacets` resolve to the same cache entry, so nothing is disabled and this
 * costs one origin request — the same one `DefaultGrid` already used.
 */
async function DefaultFacets({
  options,
  pathname,
}: {
  options: CanonicalizeOptions;
  pathname: string;
}) {
  const facets = await getFacets(
    defaultKey(canonicalizeListingParams({}, { ...options, currency: await getDefaultCurrency() })),
  );

  return <Facets facets={facets} hasActiveFilters={false} pathname={pathname} searchParams={{}} />;
}

/* ── Request-time variants ────────────────────────────────────────────────── */

async function RefinedGrid({
  options,
  pathname,
  searchParams,
  emptyState,
}: RegionProps & { emptyState: ReactNode }) {
  const raw = await searchParams;
  /*
   * Currency joins the key here, in the *refined* grid, and nowhere else.
   *
   * This region already awaits `searchParams`, so it is a dynamic hole and a
   * cookie read adds no cacheability cost. `DefaultGrid` — the cached fallback
   * that lands in the shell — deliberately does not read it and renders the
   * channel default, which is what keeps the unfiltered listing static for the
   * overwhelming majority who never switch currency.
   *
   * The currency is always explicit now — see `CanonicalizeOptions`. A shopper on
   * the channel default computes the same key the shell was prerendered with,
   * because that path passes the same locale default rather than passing nothing
   * and hoping BigCommerce agrees about what "default" meant.
   */
  const key = canonicalizeListingParams(raw, {
    ...options,
    currency: await getSelectedCurrency(),
  });
  const [listing, showRating, compare] = await Promise.all([
    searchListing(key),
    shouldShowRating(),
    compareEnabled(),
  ]);

  if (listing.products.length === 0) {
    return emptyState;
  }

  return (
    <>
      <ProductGrid
        compareEnabled={compare}
        priority
        products={listing.products}
        showRating={showRating}
      />
      <Pagination pagination={listing.pagination} pathname={pathname} searchParams={raw} />
    </>
  );
}

async function RefinedResultCount({
  options,
  searchParams,
}: {
  options: CanonicalizeOptions;
  searchParams: Promise<RawSearchParams>;
}) {
  const key = canonicalizeListingParams(await searchParams, {
    ...options,
    currency: await getSelectedCurrency(),
  });
  const { totalItems } = await searchListing(key);

  return <CountText total={totalItems} />;
}

async function RefinedFacets({ options, pathname, searchParams }: RegionProps) {
  const raw = await searchParams;
  const key = canonicalizeListingParams(raw, {
    ...options,
    currency: await getSelectedCurrency(),
  });
  const facets = await getFacets(key);

  return (
    <Facets
      facets={facets}
      hasActiveFilters={isFiltered(key)}
      pathname={pathname}
      searchParams={raw}
    />
  );
}

async function CountText({ total }: { total: number }) {
  const t = await getT();

  return (
    // A PPR response contains both the cached fallback and the streamed result,
    // so a text-matching selector is ambiguous by construction. The testid gives
    // tests a stable hook; `.last()` picks the streamed value.
    <p className="text-sm text-muted" data-testid="result-count">
      {t('Listing.productCount', { count: total })}
    </p>
  );
}
