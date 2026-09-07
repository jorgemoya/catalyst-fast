/**
 * BigCommerce GraphQL node ids in URL paths.
 *
 * Web pages have no numeric storefront id, so the proxy rewrites to
 * `/webpages/{nodeId}/normal/` using the opaque global id. Those ids are base64
 * of `Type:entityId` — and base64 emits `=` padding whenever the input length is
 * not a multiple of three:
 *
 *   NormalPage:1   → Tm9ybWFsUGFnZTox      (no padding)
 *   ContactPage:4  → Q29udGFjdFBhZ2U6NA==  (padded)
 *
 * `=` is not path-safe, so building the rewrite URL percent-encodes it and the
 * param arrives as `Q29udGFjdFBhZ2U6NA%3D%3D`. Handed to BigCommerce that way it
 * fails with `Invalid Global ID`.
 *
 * The failure is length-dependent, which is what makes it nasty: a store whose
 * page ids happen to land on a multiple of three works perfectly, and the bug
 * appears only when a merchant adds the page that doesn't. Ours passed on
 * `/shipping-returns/` and failed on `/contact-us/` for exactly that reason.
 *
 * Decoding must happen **before** the cached read, not inside it, or the encoded
 * and decoded spellings become two cache keys for one page.
 */

/**
 * Percent-decodes a node id, idempotently.
 *
 * Safe to apply to an already-decoded id: base64 never contains `%`, so there is
 * nothing for `decodeURIComponent` to act on. A malformed value is returned
 * unchanged rather than throwing — a bad id should 404 at BigCommerce, not crash
 * the render.
 */
export function decodeNodeId(id: string): string {
  if (!id.includes('%')) {
    return id;
  }

  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}
