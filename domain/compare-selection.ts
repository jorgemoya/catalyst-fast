/**
 * The compare selection — which products the shopper has ticked.
 *
 * Pure so it can be unit-tested and shared between the client store and the
 * `/compare` page's param parsing. Both ends must agree exactly on the encoding,
 * or a shopper ticks three products and lands on a page showing two.
 */

/** Comparing more than a handful is unreadable; the data layer clamps too. */
export const MAX_COMPARE_SELECTION = 10;

/**
 * Parses `?ids=1,2,3`.
 *
 * Tolerant on purpose — this value is in a URL, so it arrives hand-edited,
 * truncated by a link shortener, and appended to by crawlers. Anything
 * unparseable is dropped rather than failing the page, because a comparison of
 * the ids that *are* valid is more useful than an error.
 *
 * `Number()` rather than `parseInt`: `parseInt('12abc')` is 12, which would
 * silently compare a product the shopper never chose.
 */
export function parseCompareIds(raw: string | string[] | undefined): number[] {
  if (!raw) {
    return [];
  }

  const joined = Array.isArray(raw) ? raw.join(',') : raw;

  const ids = joined
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);

  return [...new Set(ids)].slice(0, MAX_COMPARE_SELECTION);
}

export function serializeCompareIds(ids: readonly number[]): string {
  return [...new Set(ids)].slice(0, MAX_COMPARE_SELECTION).join(',');
}

export function compareHref(ids: readonly number[]): string {
  return `/compare/?ids=${serializeCompareIds(ids)}`;
}

/** Returns the new selection, or the original when it would exceed the cap. */
export function toggleCompare(selection: readonly number[], id: number): number[] {
  if (selection.includes(id)) {
    return selection.filter((existing) => existing !== id);
  }

  if (selection.length >= MAX_COMPARE_SELECTION) {
    return [...selection];
  }

  return [...selection, id];
}
