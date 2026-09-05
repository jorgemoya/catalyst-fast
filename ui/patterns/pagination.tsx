import type { Pagination as PaginationModel } from '~/data/search';
import type { RawSearchParams } from '~/domain/listing-params';
import { cursorHref } from '~/domain/listing-url';
import { Link } from '~/ui/primitives/link';

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

  if (!hasNextPage && !hasPreviousPage) {
    return null;
  }

  return (
    <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-2">
      {hasPreviousPage && startCursor ? (
        <Link
          className="inline-flex h-10 items-center rounded-(--radius-control) border border-border px-4 text-sm font-medium hover:bg-accent"
          href={cursorHref(pathname, searchParams, 'before', startCursor)}
          rel="prev"
        >
          Previous
        </Link>
      ) : (
        <span className="inline-flex h-10 items-center rounded-(--radius-control) border border-border px-4 text-sm text-subtle">
          Previous
        </span>
      )}

      {hasNextPage && endCursor ? (
        <Link
          className="inline-flex h-10 items-center rounded-(--radius-control) border border-border px-4 text-sm font-medium hover:bg-accent"
          href={cursorHref(pathname, searchParams, 'after', endCursor)}
          rel="next"
        >
          Next
        </Link>
      ) : (
        <span className="inline-flex h-10 items-center rounded-(--radius-control) border border-border px-4 text-sm text-subtle">
          Next
        </span>
      )}
    </nav>
  );
}
