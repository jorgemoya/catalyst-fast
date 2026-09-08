import { tags } from '~/lib/cache/tags';

/**
 * BigCommerce webhook scope → cache tags.
 *
 * This is the piece that changes the economics of the whole storefront. Without
 * it, freshness has to come from short `revalidate` windows, so origin load
 * scales with **traffic**: every entry re-fetches on a timer whether or not
 * anything changed. With it, a cached entry can live a long time and be dropped
 * the moment BigCommerce says it is stale, so origin load scales with the
 * **catalog change rate** instead. That is the difference between a store that
 * gets more expensive as it gets popular and one that does not.
 *
 * Pure and separately tested because the failure modes are quiet in both
 * directions: tag too little and the storefront serves stale prices; tag too
 * much and every product edit stampedes the entire catalog.
 */

/** The shape BigCommerce POSTs. Only the fields that are actually used. */
export interface WebhookPayload {
  scope: string;
  /** `store_id` and `producer` also arrive; `data.id` is the entity. */
  data?: { id?: number; type?: string };
}

/**
 * A product edit can change price, so `productPrice` goes too — BigCommerce has
 * no separate "price updated" scope, and a stale price is the most visible
 * possible defect.
 *
 * `products` (the collection) is included because listing and search entries are
 * tagged with it: a product's name or price changing alters how it renders in
 * every grid it appears in, and there is no way to know which grids those are
 * without asking BigCommerce.
 */
function productTags(id: number): string[] {
  return [tags.product(id), tags.productPrice(id), tags.products];
}

/**
 * Maps a scope to the tags it should invalidate. Returns `[]` for scopes we
 * don't model, which the receiver treats as "acknowledge and ignore" rather than
 * an error — BigCommerce retries non-2xx responses, so rejecting an unmodelled
 * scope would produce a retry loop over something we deliberately don't care
 * about.
 */
export function tagsForScope(payload: WebhookPayload): string[] {
  const { scope } = payload;
  const id = payload.data?.id;

  // Inventory is checked before the general product prefix: the scope
  // `store/product/inventory/updated` also starts with `store/product/`, and
  // matching it as a plain product edit would invalidate price entries on every
  // stock movement — which on a busy store is constant.
  if (scope.startsWith('store/product/inventory')) {
    return id ? [tags.productInventory(id), tags.inventory] : [tags.inventory];
  }

  if (scope.startsWith('store/product')) {
    return id ? productTags(id) : [tags.products];
  }

  if (scope.startsWith('store/category')) {
    // Categories are navigation: the header tree and breadcrumbs both change.
    return [
      ...(id ? [tags.category(id), tags.categoryProducts(id)] : []),
      tags.categories,
      tags.navigation,
    ];
  }

  if (scope.startsWith('store/brand')) {
    return [...(id ? [tags.brand(id), tags.brandProducts(id)] : []), tags.brands];
  }

  // Store settings feed the header, footer, currency display and tax display, so
  // they reach almost every page — but they change rarely, which is what makes a
  // blunt collection-wide invalidation acceptable here.
  if (scope.startsWith('store/settings') || scope.startsWith('store/store')) {
    return [tags.settings, tags.navigation];
  }

  return [];
}

/**
 * Bulk-import storm protection.
 *
 * A catalog import or a price-list republish emits one webhook per product —
 * thousands within a minute. Honouring each individually would issue thousands
 * of tag writes and then stampede the origin as every entry revalidates
 * independently. Past the threshold it is both cheaper and *more correct* to
 * admit the whole catalog is suspect and invalidate the collection once.
 *
 * Deliberately a plain counter rather than anything durable. It is per-instance,
 * so with N instances the effective threshold is N × `limit` — which is fine,
 * because this is a cost guard and not a correctness mechanism: the individual
 * invalidations it replaces would have been correct too, just far more
 * expensive.
 */
export class EventWindow {
  private hits: number[] = [];

  constructor(
    private readonly limit = 200,
    private readonly windowMs = 60_000,
  ) {}

  /** Records an event and reports whether the window is now saturated. */
  record(now: number = Date.now()): boolean {
    this.hits.push(now);

    const cutoff = now - this.windowMs;

    // Cheap because the array is bounded by the arrival rate within one window.
    this.hits = this.hits.filter((at) => at > cutoff);

    return this.hits.length > this.limit;
  }

  get size(): number {
    return this.hits.length;
  }
}
