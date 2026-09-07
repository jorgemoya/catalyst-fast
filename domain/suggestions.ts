/**
 * Quick-search suggestion shape.
 *
 * Separate from the Server Function that produces it because a `'use server'`
 * module may export **only async functions** — a constant or a type exported
 * alongside them makes the whole module compile to no exports at all, and the
 * failure surfaces as "export not found" at the *import* site rather than here.
 * (The same rule bit `_actions/discounts.ts`, where arrow constants returning a
 * promise didn't qualify either.)
 */

/**
 * Minimum characters before suggestions are fetched.
 *
 * Below three, results are too broad to be useful and every keystroke is a cache
 * miss on a key nobody else will ever request — the opposite of what makes the
 * shared suggestion cache worthwhile.
 */
export const MIN_QUERY_LENGTH = 3;

export interface Suggestion {
  id: string;
  title: string;
  href: string;
  image: { src: string; alt: string } | null;
}
