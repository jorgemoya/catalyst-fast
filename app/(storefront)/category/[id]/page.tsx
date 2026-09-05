import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { getCategory, getCategoryIds } from '~/data/catalog';
import { getCategoryBranch } from '~/data/navigation';
import type { RawSearchParams } from '~/domain/listing-params';
import {
  EmptyState,
  FacetRegion,
  GridRegion,
  ListingLayout,
  SubcategoryLinks,
  ToolbarRegion,
} from '~/ui/layout/listing';
import { Skeleton } from '~/ui/primitives/skeleton';
import { t } from '~/lib/i18n/messages';

/**
 * Category listing. Reached via a proxy rewrite from the merchant's vanity URL
 * (`/plants/` → `/category/98`), so `[id]` is the BigCommerce entityId.
 *
 * The page component is **not** async and awaits nothing — `params` and
 * `searchParams` are handed down as promises and resolved at the leaves.
 * Awaiting either here would make the route unprerenderable (Phase 0, spike 4).
 */

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}

/**
 * Seeds categories so `params` is build-time known and the unfiltered grid lands
 * in the static shell — without it, `await params` pushes everything below it out
 * of the shell and only chrome prerenders.
 *
 * Bounded by `STATIC_PARAMS_LIMIT`; `dynamicParams` stays on so anything unseeded
 * still renders correctly. See `docs/scaling.md`.
 */
export async function generateStaticParams() {
  const ids = await getCategoryIds();

  return ids.map((id) => ({ id: String(id) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const category = await getCategory(Number((await params).id));

  if (!category) {
    return {};
  }

  return {
    title: category.seo.pageTitle || category.name,
    description: category.seo.metaDescription || undefined,
    keywords: category.seo.metaKeywords || undefined,
    alternates: { canonical: category.path },
  };
}

export default function CategoryPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<ListingSkeleton />}>
      <CategoryListing params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function CategoryListing({ params, searchParams }: Props) {
  const id = Number((await params).id);
  const [category, subcategories] = await Promise.all([getCategory(id), getCategoryBranch(id)]);

  if (!category) {
    notFound();
  }

  // The merchant's vanity URL, not `/category/${id}`. This route is only ever a
  // proxy rewrite target; building refinement links from the internal path would
  // bounce shoppers off the vanity URL on their first filter click and leak
  // internal paths into the HTML for crawlers to follow.
  const pathname = category.path;
  const options = { categoryId: id, defaultSort: category.defaultSort };
  const emptyState = (
    <EmptyState
      subtitle={t('Listing.emptyCategory')}
      title={t('Listing.emptyTitle')}
    />
  );

  return (
    <ListingLayout>
      <ListingLayout.Header
        breadcrumbs={category.breadcrumbs}
        description={category.description}
        title={category.name}
      />

      <ListingLayout.Body
        sidebar={
          <>
            <SubcategoryLinks
              items={subcategories.map((child) => ({ label: child.label, href: child.href }))}
            />
            <FacetRegion options={options} pathname={pathname} searchParams={searchParams} />
          </>
        }
      >
        <ToolbarRegion options={options} searchParams={searchParams} />
        <GridRegion
          emptyState={emptyState}
          options={options}
          pathname={pathname}
          searchParams={searchParams}
        />
      </ListingLayout.Body>
    </ListingLayout>
  );
}

function ListingSkeleton() {
  return (
    <div className="page-container py-8">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-4 h-9 w-64" />
      <div className="mt-8 flex flex-col gap-8 lg:flex-row">
        <Skeleton className="h-96 w-full shrink-0 lg:w-64" />
        <Skeleton className="h-96 flex-1" />
      </div>
    </div>
  );
}
