/**
 * A short, per-instance memo for route lookups made **as a customer**.
 *
 * With partial prefetching, one visible link becomes several segment requests,
 * each passing through the proxy. For a restricted shopper, a link to something
 * only their group can see misses the shared guest route cache and is resolved
 * with their token — measured, up to 7 identical lookups on one page view.
 *
 * Why this is safe where the shared KV cache is not:
 *
 *  - **Keyed by a hash of the shopper's token**, so an entry is only ever read
 *    back for the session that produced it. The raw token is never a key.
 *  - **In process memory only**, never KV: nothing leaves the instance, and it
 *    is gone on restart.
 *  - **Seconds, not minutes.** Long enough to absorb one page's prefetch fan-out
 *    and a quick back-and-forth, short enough that a merchant's visibility change
 *    shows up almost at once.
 *
 * The promise is stored, not the value, so concurrent segment requests for the
 * same path share one BigCommerce call instead of racing. A rejected lookup is
 * evicted so an outage is not remembered.
 */
export function createCustomerRouteMemo<T>({
  ttlMs = 30_000,
  maxEntries = 1000,
  now = Date.now,
}: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}) {
  const entries = new Map<string, { value: Promise<T>; expires: number }>();

  return async function memo(
    token: string,
    key: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const id = `${await hash(token)}:${key}`;
    const hit = entries.get(id);

    if (hit && hit.expires > now()) {
      return hit.value;
    }

    // Map iteration order is insertion order, so the first key is the oldest.
    if (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;

      if (oldest !== undefined) {
        entries.delete(oldest);
      }
    }

    const value = load();

    entries.delete(id);
    entries.set(id, { value, expires: now() + ttlMs });
    value.catch(() => {
      if (entries.get(id)?.value === value) {
        entries.delete(id);
      }
    });

    return value;
  };
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
