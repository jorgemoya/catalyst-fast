import { isSinglePage, type Pagination as PaginationModel } from '~/domain/pagination';
import type { RawSearchParams } from '~/domain/listing-params';
import { cursorHref } from '~/domain/listing-url';
import { Link } from '~/ui/primitives/link';
import { t } from '~/lib/i18n/messages';

/**
 * Cursor pagination, server-rendered as links.
 *
 * BigCommerce's product connections are Relay-style, so there are no page
 * numbers to link to — only "the page after this cursor". That is a real
 * constraint, not a simplification: an offset-style `?page=7` would require
 * walking every prior page to find the cursor.
 *
 * Rendering as `<a>` keeps pagination crawlable and prefetchable, and `rel`
 * prev/next tells crawlers these are a sequence rather than duplicate content.
 */
export function Pagination({
  pagination,
  pathname,
  searchParams,
}: {
  pagination: PaginationModel;
  pathname: string;
  searchParams: RawSearchParams;
}) {
  const { hasNextPage, hasPreviousPage, startCursor, endCursor } = pagination;

  if (isSinglePage(pagination)) {
    return null;
  }

  return (
    <nav aria-label={t('Listing.pagination')} className="mt-12 flex items-center justify-center gap-2">
      {hasPreviousPage && startCursor ? (
        <Link
          className="inline-flex h-10 items-center rounded-(--radius-control) border border-border px-4 text-sm font-medium hover:bg-accent"
          href={cursorHref(pathname, searchParams, 'before', startCursor)}
          rel="prev"
        >
          {t('Listing.previous')}
        </Link>
      ) : (
        <span className="inline-flex h-10 items-center rounded-(--radius-control) border border-border px-4 text-sm text-subtle">
          {t('Listing.previous')}
        </span>
      )}

      {hasNextPage && endCursor ? (
        <Link
          className="inline-flex h-10 items-center rounded-(--radius-control) border border-border px-4 text-sm font-medium hover:bg-accent"
          href={cursorHref(pathname, searchParams, 'after', endCursor)}
          rel="next"
        >
          {t('Listing.next')}
        </Link>
      ) : (
        <span className="inline-flex h-10 items-center rounded-(--radius-control) border border-border px-4 text-sm text-subtle">
          {t('Listing.next')}
        </span>
      )}
    </nav>
  );
}
