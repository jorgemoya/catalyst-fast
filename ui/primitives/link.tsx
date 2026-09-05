import NextLink from 'next/link';
import type { ComponentPropsWithRef } from 'react';

/**
 * Plain re-export of `next/link`, deliberately.
 *
 * Catalyst wrapped Link in a client component that hand-rolled hover- and
 * viewport-triggered `router.prefetch` calls. That made sense before Next 16,
 * but with `cacheComponents` + `partialPrefetching` the router already prefetches
 * the static shell of a route at segment granularity and knows, from each
 * scope's `cacheLife.stale`, what is safe to reuse. Hand-rolled prefetching now
 * competes with that rather than helping it.
 *
 * This stays a named wrapper rather than importing `next/link` directly at call
 * sites so there is one seam to change if that assessment turns out wrong, or
 * when locale-prefixed hrefs return in Phase 8.
 */
export type LinkProps = ComponentPropsWithRef<typeof NextLink>;

export function Link(props: LinkProps) {
  return <NextLink {...props} />;
}
