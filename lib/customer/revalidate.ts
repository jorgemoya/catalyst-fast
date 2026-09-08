import 'server-only';

import { refresh, updateTag } from 'next/cache';

/**
 * Invalidation for a customer-scoped write.
 *
 * The same two-call contract as `lib/cart/revalidate.ts`, and it is required for
 * the same reason: `updateTag` expires the *server* entries, but these reads are
 * `'use cache: private'` and live in the **browser's** memory, where `updateTag`
 * has no reach. `refresh()` is what re-renders them.
 *
 * Omitting it looks fine in code review and fails in exactly one visible way —
 * the list still shows a wishlist that was just deleted, because the private
 * scope was never told anything happened.
 */
export function revalidateCustomer(tag: string): void {
  updateTag(tag);
  refresh();
}
