export interface Breadcrumb {
  label: string;
  href: string;
}

/**
 * BigCommerce returns the full ancestor chain. Deep category trees produce
 * breadcrumb trails that wrap across several lines and push the page heading
 * below the fold, so long trails are elided in the middle — the first crumb
 * (context) and the last few (immediate ancestry) are what shoppers actually use.
 */
const MAX_VISIBLE = 5;
export const ELLIPSIS = '…';

export function truncateBreadcrumbs(
  crumbs: Breadcrumb[],
  maxVisible = MAX_VISIBLE,
): Array<Breadcrumb | typeof ELLIPSIS> {
  if (crumbs.length <= maxVisible) {
    return crumbs;
  }

  // Keep the first, then the final `maxVisible - 1` — dropping the middle rather
  // than the tail, since the nearest ancestors carry the most meaning.
  return [crumbs[0] as Breadcrumb, ELLIPSIS, ...crumbs.slice(-(maxVisible - 1))];
}
