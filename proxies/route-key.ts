/**
 * Pure URL logic for route resolution.
 *
 * Split out of `with-routes.ts` for the same reason `domain/` exists: these two
 * functions decide the storefront's route-cache hit rate and its redirect-loop
 * safety, and neither needs a request, a store, or a server runtime to test.
 * `with-routes.ts` itself transitively imports `server-only`, so anything left in
 * there is unreachable from a unit test.
 */

const trailingSlashDisabled = (): boolean => process.env.TRAILING_SLASH === 'false';

/**
 * Marketing parameters, which are never part of a merchant's redirect rule.
 *
 * `fbclid` and `gclid` are **unique per click**, so without stripping them every
 * visitor arriving from an ad is a guaranteed route-cache miss and pays a
 * blocking `site.route` round trip before Next can even route the request — on
 * every page they visit. Measured: five `?fbclid=…` values against one path
 * produced five `GetRouteQuery` calls; the same value repeated produced one.
 *
 * That is origin QPS scaling with *traffic*, which is precisely the failure this
 * rewrite exists to remove — and it was hiding in the proxy, below the layer
 * where `domain/listing-params.ts` already canonicalizes for the data cache.
 */
const TRACKING_PARAM =
  /^(?:utm_|_gl$|_ga$|mc_(?:cid|eid)$|fbclid$|gclid$|dclid$|gbraid$|wbraid$|msclkid$|ttclid$|twclid$|igshid$|yclid$|ref$|mkt_tok$)/i;

/**
 * The path used for both the KV key and the `site.route` lookup.
 *
 * These must be derived from the *same* string. Keying on a canonicalized path
 * while resolving the raw one would let two genuinely different URLs share an
 * entry, and a redirect meant for one would fire on the other.
 *
 * Remaining params are sorted, so `?a=1&b=2` and `?b=2&a=1` share a lookup.
 *
 * **Trade-off, deliberately taken:** BigCommerce lets a merchant match a 301 on
 * specific query params, so stripping `utm_*` means a redirect rule keyed on one
 * would no longer fire. That is a rare rule against a cost paid by every ad click
 * on every page.
 */
export function toRouteKeyPath(url: URL): string {
  const params = new URLSearchParams(url.search);

  for (const key of [...params.keys()]) {
    if (TRACKING_PARAM.test(key)) {
      params.delete(key);
    }
  }

  params.sort();

  const search = params.toString();

  return search ? `${url.pathname}?${search}` : url.pathname;
}

/**
 * Normalizes a URL for loop detection. BigCommerce emits trailing slashes by
 * default; if this disagrees with `trailingSlash` in next.config.ts, a redirect
 * whose target differs from its source only by that slash will bounce forever.
 */
export function normalizeForCompare(url: URL): string {
  if (trailingSlashDisabled() && url.pathname !== '/' && url.pathname.endsWith('/')) {
    return `${url.pathname.replace(/\/+$/, '')}${url.search}`;
  }

  if (!trailingSlashDisabled() && !url.pathname.endsWith('/')) {
    return `${url.pathname}/${url.search}`;
  }

  return `${url.pathname}${url.search}`;
}

export const sameInternalUrl = (a: URL, b: URL): boolean =>
  a.origin === b.origin && normalizeForCompare(a) === normalizeForCompare(b);
