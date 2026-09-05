import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { getBrand, getBrandIds } from '~/data/catalog';
import type { RawSearchParams } from '~/domain/listing-params';
import {
  EmptyState,
  FacetRegion,
  GridRegion,
  ListingLayout,
  ToolbarRegion,
} from '~/ui/layout/listing';
import { Skeleton } from '~/ui/primitives/skeleton';

/**
 * Brand listing. Same composition as category — the only difference is which
 * filter seeds the search, and that brands have no subcategory tree — so both
 * compose `ListingLayout` rather than duplicating facet/sort/pagination wiring.
 */

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}

/** Same reasoning as the category route — see its `generateStaticParams`. */
export async function generateStaticParams() {
  const ids = await getBrandIds();

  return ids.map((id) => ({ id: String(id) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const brand = await getBrand(Number((await params).id));

  if (!brand) {
    return {};
  }

  return {
    title: brand.seo.pageTitle || brand.name,
    description: brand.seo.metaDescription || undefined,
    keywords: brand.seo.metaKeywords || undefined,
    alternates: { canonical: brand.path },
  };
}

export default function BrandPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<ListingSkeleton />}>
      <BrandListing params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function BrandListing({ params, searchParams }: Props) {
  const id = Number((await params).id);
  const brand = await getBrand(id);

  if (!brand) {
    notFound();
  }

  // The merchant's vanity URL — see the equivalent note in the category route.
  const pathname = brand.path;
  const options = { brandId: id };
  const emptyState = (
    <EmptyState
      subtitle="Try removing some filters, or browse another brand."
      title="No products found"
    />
  );

  return (
    <ListingLayout>
      {/* BigCommerce models no ancestry for brands, so a single crumb back to the
          brand itself would be noise. Catalyst omits them here too. */}
      <ListingLayout.Header title={brand.name} />

      <ListingLayout.Body
        sidebar={<FacetRegion options={options} pathname={pathname} searchParams={searchParams} />}
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
      <Skeleton className="h-9 w-64" />
      <div className="mt-8 flex flex-col gap-8 lg:flex-row">
        <Skeleton className="h-96 w-full shrink-0 lg:w-64" />
        <Skeleton className="h-96 flex-1" />
      </div>
    </div>
  );
}
