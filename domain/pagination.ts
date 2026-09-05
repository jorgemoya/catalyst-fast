/**
 * Cursor pagination model.
 *
 * BigCommerce product connections are Relay-style, so there are no page numbers —
 * only "the page after this cursor". That is a genuine constraint rather than a
 * simplification: an offset-style `?page=7` would require walking every prior
 * page to discover the cursor.
 */
export interface Pagination {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

export const EMPTY_PAGINATION: Pagination = {
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
};

/** True when there is nothing to render — both directions are dead ends. */
export const isSinglePage = (pagination: Pagination): boolean =>
  !pagination.hasNextPage && !pagination.hasPreviousPage;
