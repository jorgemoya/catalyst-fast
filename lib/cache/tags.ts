/**
 * Cache tag taxonomy.
 *
 * Catalyst had three tags total (`cart`, `checkout`, `customer`), so any one
 * customer mutation invalidated every customer read. Here each cached function
 * tags itself with **its entity tag plus every collection tag it belongs to**,
 * so a single product edit, a price-list republish, and a catalog-wide panic
 * purge are each one call.
 *
 * Two hard rules, because Next stores cache keys and tag values in PLAIN TEXT:
 *
 *   1. Never put a customer access token in a tag or a cache key.
 *   2. Session-scoped tags use opaque ids only (cart id, customer id). Cart ids
 *      are already exposed in checkout URLs so this is acceptable — but do not
 *      log tag values.
 *
 * Which API to invalidate with:
 *
 *   updateTag(tag)               — Server Actions only. Expires immediately; the
 *                                  next read blocks for fresh data. Use when the
 *                                  current user must see their own write.
 *   refresh()                    — pair with updateTag whenever a
 *                                  `'use cache: private'` scope or a dynamic hole
 *                                  is involved (the cart badge). updateTag alone
 *                                  will NOT update a private scope, because that
 *                                  scope lives in the browser.
 *   revalidateTag(tag, 'max')    — webhooks / route handlers. Serves stale while
 *                                  revalidating in the background.
 *   revalidateTag(tag, {expire:0}) — hard purge.
 */

export const tags = {
  // ── Collections: bulk invalidation and panic buttons ──────────────────────
  products: 'products',
  categories: 'categories',
  brands: 'brands',
  prices: 'prices',
  inventory: 'inventory',
  content: 'content',
  settings: 'settings',
  navigation: 'navigation',

  // ── Per-entity ────────────────────────────────────────────────────────────
  product: (id: number) => `product:${id}`,
  productPrice: (id: number) => `product:${id}:price`,
  productInventory: (id: number) => `product:${id}:inventory`,
  productReviews: (id: number) => `product:${id}:reviews`,
  category: (id: number) => `category:${id}`,
  categoryProducts: (id: number) => `category:${id}:products`,
  brand: (id: number) => `brand:${id}`,
  brandProducts: (id: number) => `brand:${id}:products`,
  webpage: (id: string) => `webpage:${id}`,
  blogPost: (id: number) => `blog:post:${id}`,
  route: (path: string) => `route:${path}`,

  // ── Session-scoped: opaque ids only, never a token ────────────────────────
  cart: (cartId: string) => `cart:${cartId}`,
  customer: (customerId: number) => `customer:${customerId}`,
  wishlists: (customerId: number) => `customer:${customerId}:wishlists`,
  orders: (customerId: number) => `customer:${customerId}:orders`,
} as const;
