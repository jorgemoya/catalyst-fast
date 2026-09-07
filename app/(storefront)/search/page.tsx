import type { Metadata } from 'next';
import { Suspense } from 'react';

import { getStoreSettings } from '~/data/settings';
import type { RawSearchParams } from '~/domain/listing-params';
import { t } from '~/lib/i18n/messages';
import {
  EmptyState,
  FacetRegion,
  GridRegion,
  ListingLayout,
  ToolbarRegion,
} from '~/ui/layout/listing';
import { SearchField } from '~/ui/patterns/search-field';
import { Skeleton } from '~/ui/primitives/skeleton';

/**
 * Search results.
 *
 * Reuses the whole listing stack — facets, sort, cursor pagination — because a
 * search *is* a faceted listing whose key happens to carry a `term` instead of a
 * `categoryId`. That reuse is the point of keying `searchListing` on a canonical
 * `ListingKey` rather than per-page query functions.
 *
 * Two things differ from category and brand, and both follow from the same fact —
 * a search cannot render without reading `term`:
 *
 *  - **`prerenderDefault={false}`.** There is no useful unfiltered default here.
 *    A search key with no term is the entire catalog, so the cached fallback the
 *    other listings use would flash the whole store and spend a query doing it.
 *  - **`noindex`.** Search result pages are the classic crawl-budget sink:
 *    unbounded URL space, thin duplicated content, and no canonical of their own.
 *    Category pages are the indexable surface.
 */

interface Props {
  searchParams: Promise<RawSearchParams>;
}

/**
 * The *document* title carries the term; the `<h1>` deliberately does not.
 *
 * The heading sits in the static shell, so making it term-dependent would pull it
 * — and the search field above it — out of the prerender for a value the browser
 * already has in its URL. Metadata is resolved separately, so the tab and history
 * entry can be specific without costing the shell.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const raw = await searchParams;
  const term = typeof raw.term === 'string' ? raw.term.trim() : '';

  return {
    title: term ? t('Search.titleWithTerm', { term }) : t('Search.title'),
    robots: { index: false, follow: true },
  };
}

export default function SearchPage({ searchParams }: Props) {
  return (
    <ListingLayout>
      <div className="mt-4 mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">{t('Search.title')}</h1>
        <div className="mt-4 max-w-lg">
          {/*
            `SearchField` reads the current term with `useSearchParams`, which
            suspends during prerender — without this boundary it would opt the
            whole route out of the static shell, including the heading above it.
          */}
          <Suspense fallback={<Skeleton className="h-11 w-full" />}>
            <SearchField />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={<SearchSkeleton />}>
        <SearchResults searchParams={searchParams} />
      </Suspense>
    </ListingLayout>
  );
}

async function SearchResults({ searchParams }: Props) {
  const [raw, settings] = await Promise.all([searchParams, getStoreSettings()]);
  const term = typeof raw.term === 'string' ? raw.term.trim() : '';

  // Short-circuit before touching BigCommerce. An empty search is not a search
  // with zero results — issuing an unfiltered `SearchProducts` here would return
  // the whole catalog and read as "here is everything" rather than "type
  // something".
  if (!term) {
    return <EmptyState subtitle={t('Search.promptSubtitle')} title={t('Search.promptTitle')} />;
  }

  /*
   * The merchant's configured search default, which is a *different* setting from
   * a category's `defaultProductSort` — BigCommerce defaults it to relevance for
   * textual search.
   *
   * It feeds canonicalization, so it is load-bearing for the cache and not just
   * for the dropdown: without it, a shopper who picks the option that is already
   * the default creates a second entry identical to the unsorted one.
   */
  const options = { defaultSort: settings.defaultSearchSort };
  const pathname = '/search';

  return (
    <ListingLayout.Body
      sidebar={
        <FacetRegion
          options={options}
          pathname={pathname}
          prerenderDefault={false}
          searchParams={searchParams}
        />
      }
    >
      <ToolbarRegion options={options} prerenderDefault={false} searchParams={searchParams} />
      <GridRegion
        emptyState={
          <EmptyState subtitle={t('Search.emptySubtitle', { term })} title={t('Search.emptyTitle')} />
        }
        options={options}
        pathname={pathname}
        prerenderDefault={false}
        searchParams={searchParams}
      />
    </ListingLayout.Body>
  );
}

function SearchSkeleton() {
  return (
    <div className="flex flex-col gap-8 lg:flex-row">
      <Skeleton className="h-96 w-full shrink-0 lg:w-64" />
      <Skeleton className="h-96 flex-1" />
    </div>
  );
}
