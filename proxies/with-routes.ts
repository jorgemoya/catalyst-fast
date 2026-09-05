import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { query } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';
import { kv } from '~/lib/kv';
import { kvKey, STORE_STATUS_KEY } from '~/lib/kv/keys';

import type { ProxyFactory } from './compose';

/**
 * BigCommerce URL resolution.
 *
 * The storefront's URL space is entirely merchant-defined in the BigCommerce
 * control panel and can change without a redeploy, so it can't be expressed as
 * file-system routes or `generateStaticParams`. Every request resolves its path
 * through `site.route`, which returns either a 301, a node to render, or nothing.
 *
 * Ported from core/proxies/with-routes.ts with two deliberate changes:
 *
 *  1. **No authenticated bypass.** Upstream, any request carrying a customer
 *     token skipped the KV cache entirely and paid a synchronous GraphQL round
 *     trip before the route was even known — a hard perf cliff for logged-in and
 *     B2B traffic. The guest resolution is now cached and shared by everyone.
 *     The narrow case that motivated the bypass (customer-group catalog
 *     visibility, where a restricted product resolves to `null` for guests) is
 *     handled in Phase 6 by a negative-result fallback: only when the cached
 *     answer is "not found" AND a session cookie is present do we re-resolve
 *     with the customer's token. Authenticated results are never written back
 *     into the shared entry.
 *  2. **No locale or analytics concerns.** v1 is single-locale, and the
 *     product-viewed event moves to a client beacon rather than firing from a
 *     `waitUntil` on every non-prefetch product request.
 *
 * Kept exactly: the stale-while-revalidate shape (serve stale, refresh in
 * background; block only on a cold miss) and the trailing-slash normalization,
 * which is load-bearing against redirect loops.
 */

const trailingSlashDisabled = process.env.TRAILING_SLASH === 'false';

const GetRouteQuery = graphql(`
  query GetRouteQuery($path: String!) {
    site {
      route(path: $path, redirectBehavior: FOLLOW) {
        redirect {
          to {
            __typename
            ... on BlogPostRedirect {
              path
            }
            ... on BrandRedirect {
              path
            }
            ... on CategoryRedirect {
              path
            }
            ... on PageRedirect {
              path
            }
            ... on ProductRedirect {
              path
            }
            ... on ManualRedirect {
              url
            }
          }
          fromPath
          toUrl
        }
        node {
          __typename
          id
          ... on Product {
            entityId
          }
          ... on Category {
            entityId
          }
          ... on Brand {
            entityId
          }
          ... on BlogPost {
            entityId
          }
        }
      }
    }
  }
`);

const GetRawWebPageContentQuery = graphql(`
  query GetRawWebPageContent($id: ID!) {
    node(id: $id) {
      __typename
      ... on RawHtmlPage {
        htmlBody
      }
    }
  }
`);

const GetStoreStatusQuery = graphql(`
  query GetStoreStatus {
    site {
      settings {
        status
      }
    }
  }
`);

const getRoute = async (path: string, channelId?: string) => {
  const data = await query({ document: GetRouteQuery, variables: { path }, channelId });

  return data.site.route;
};

const getStoreStatus = async (channelId?: string) => {
  const data = await query({ document: GetStoreStatusQuery, channelId });

  return data.site.settings?.status;
};

const getRawWebPageContent = async (id: string) => {
  const data = await query({ document: GetRawWebPageContentQuery, variables: { id } });

  if (data.node?.__typename !== 'RawHtmlPage') {
    throw new Error('Failed to fetch raw web page content');
  }

  return data.node;
};

type Route = Awaited<ReturnType<typeof getRoute>>;
type StorefrontStatusType = ReturnType<typeof graphql.scalar<'StorefrontStatusType'>>;

interface RouteCache {
  route: Route;
  expiryTime: number;
}

interface StorefrontStatusCache {
  status: StorefrontStatusType;
  expiryTime: number;
}

// Cached values are validated on read, not trusted. A schema change across a
// deploy would otherwise surface as a runtime crash in the proxy — the worst
// place for one, since it takes down every route at once.
const StorefrontStatusCacheSchema = z.object({
  status: z.union([
    z.literal('HIBERNATION'),
    z.literal('LAUNCHED'),
    z.literal('MAINTENANCE'),
    z.literal('PRE_LAUNCH'),
  ]),
  expiryTime: z.number(),
});

const RedirectSchema = z.object({
  to: z.union([
    z.object({ __typename: z.literal('BlogPostRedirect'), path: z.string() }),
    z.object({ __typename: z.literal('BrandRedirect'), path: z.string() }),
    z.object({ __typename: z.literal('CategoryRedirect'), path: z.string() }),
    z.object({ __typename: z.literal('PageRedirect'), path: z.string() }),
    z.object({ __typename: z.literal('ProductRedirect'), path: z.string() }),
    z.object({ __typename: z.literal('ManualRedirect'), url: z.string() }),
  ]),
  fromPath: z.string(),
  toUrl: z.string(),
});

const NodeSchema = z.union([
  z.object({ __typename: z.literal('Product'), entityId: z.number() }),
  z.object({ __typename: z.literal('Category'), entityId: z.number() }),
  z.object({ __typename: z.literal('Brand'), entityId: z.number() }),
  z.object({ __typename: z.literal('ContactPage'), id: z.string() }),
  z.object({ __typename: z.literal('NormalPage'), id: z.string() }),
  z.object({ __typename: z.literal('RawHtmlPage'), id: z.string() }),
  z.object({ __typename: z.literal('Blog'), id: z.string() }),
  z.object({ __typename: z.literal('BlogPost'), entityId: z.number() }),
]);

const RouteCacheSchema = z.object({
  route: z.nullable(z.object({ redirect: z.nullable(RedirectSchema), node: z.nullable(NodeSchema) })),
  expiryTime: z.number(),
});

const ROUTE_TTL_MS = 1000 * 60 * 30; // 30 minutes
const STATUS_TTL_MS = 1000 * 60 * 5; // 5 minutes

const updateRouteCache = async (
  pathname: string,
  channelId: string,
  event: NextFetchEvent,
): Promise<RouteCache> => {
  const routeCache: RouteCache = {
    route: await getRoute(pathname, channelId),
    expiryTime: Date.now() + ROUTE_TTL_MS,
  };

  event.waitUntil(kv.set(kvKey(pathname, channelId), routeCache));

  return routeCache;
};

const updateStatusCache = async (
  channelId: string,
  event: NextFetchEvent,
): Promise<StorefrontStatusCache> => {
  const status = await getStoreStatus(channelId);

  if (status === undefined) {
    throw new Error('Failed to fetch storefront status');
  }

  const statusCache: StorefrontStatusCache = {
    status,
    expiryTime: Date.now() + STATUS_TTL_MS,
  };

  event.waitUntil(kv.set(kvKey(STORE_STATUS_KEY, channelId), statusCache));

  return statusCache;
};

/**
 * Normalizes a URL for loop detection. BigCommerce emits trailing slashes by
 * default; if this disagrees with `trailingSlash` in next.config.ts, a redirect
 * whose target differs from its source only by that slash will bounce forever.
 */
function normalizeForCompare(url: URL): string {
  if (trailingSlashDisabled && url.pathname !== '/' && url.pathname.endsWith('/')) {
    return `${url.pathname.replace(/\/+$/, '')}${url.search}`;
  }

  if (!trailingSlashDisabled && !url.pathname.endsWith('/')) {
    return `${url.pathname}/${url.search}`;
  }

  return `${url.pathname}${url.search}`;
}

const sameInternalUrl = (a: URL, b: URL): boolean =>
  a.origin === b.origin && normalizeForCompare(a) === normalizeForCompare(b);

const getRouteInfo = async (request: NextRequest, event: NextFetchEvent) => {
  const channelId = process.env.BIGCOMMERCE_CHANNEL_ID ?? '1';

  try {
    // Query params are part of the key: BigCommerce 301 rules can match on them,
    // so `/x` and `/x?a=1` are genuinely different resolutions.
    const pathname = request.nextUrl.pathname + request.nextUrl.search;

    // One round trip for both values.
    let [routeCache, statusCache] = await kv.mget<RouteCache | StorefrontStatusCache>(
      kvKey(pathname, channelId),
      kvKey(STORE_STATUS_KEY, channelId),
    );

    // Stale: serve what we have and refresh behind the response.
    // Missing: block once, then write through in the background.
    if (statusCache && statusCache.expiryTime < Date.now()) {
      event.waitUntil(updateStatusCache(channelId, event));
    } else if (!statusCache) {
      statusCache = await updateStatusCache(channelId, event);
    }

    if (routeCache && routeCache.expiryTime < Date.now()) {
      event.waitUntil(updateRouteCache(pathname, channelId, event));
    } else if (!routeCache) {
      routeCache = await updateRouteCache(pathname, channelId, event);
    }

    const parsedStatus = StorefrontStatusCacheSchema.safeParse(statusCache);
    const parsedRoute = RouteCacheSchema.safeParse(routeCache);

    return {
      route: parsedRoute.success ? parsedRoute.data.route : undefined,
      status: parsedStatus.success ? parsedStatus.data.status : undefined,
    };
  } catch (error) {
    // A KV or BigCommerce outage must not take down every route. Fall through to
    // normal file-system routing, which will 404 rather than 500.
     
    console.error('[with-routes]', error);

    return { route: undefined, status: undefined };
  }
};

/**
 * Routes that exist only as rewrite targets. A shopper reaches a listing at the
 * merchant's vanity URL (`/plants/`); `/category/98` is the internal path this
 * proxy rewrites *to*.
 *
 * Blocking direct access matters because `notFound()` cannot set a status once a
 * PPR shell has flushed: `/category/999999` would otherwise return **200** with a
 * not-found body, which a crawler indexes as a real page. Bogus *vanity* URLs
 * already 404 correctly (BigCommerce resolves no node, nothing is rewritten, and
 * file-system routing 404s), so this closes the remaining hole.
 *
 * **Only applied to document navigations.** Next's prefetch and RSC machinery
 * resolves the *rewritten* path internally, so a blanket guard 404s every
 * prefetch of a listing page — measured: `/plants/` returned 200 as a document
 * and 404 with `RSC: 1` + `Next-Router-Prefetch: 1`, which would silently
 * disable prefetching across the whole storefront. Those requests are exempt;
 * they can only originate from a page the router already resolved legitimately.
 */
const INTERNAL_ROUTE_ONLY = /^\/(?:category|brand|product)\/\d+\/?$/;

const isRscRequest = (request: NextRequest): boolean =>
  request.headers.get('RSC') === '1' || request.headers.get('Next-Router-Prefetch') === '1';

export const withRoutes: ProxyFactory = () => async (request, event) => {
  if (INTERNAL_ROUTE_ONLY.test(request.nextUrl.pathname) && !isRscRequest(request)) {
    return new NextResponse(null, { status: 404 });
  }

  const { route, status } = await getRouteInfo(request, event);

  if (status === 'MAINTENANCE') {
    // The 503 does not currently stick on a rewrite — https://github.com/vercel/next.js/issues/50155
    return NextResponse.rewrite(new URL('/maintenance', request.url), { status: 503 });
  }

  const redirectConfig = {
    // 301 rather than 308: more universally honored by crawlers.
    status: 301,
    nextConfig: { trailingSlash: !trailingSlashDisabled },
  };

  if (route?.redirect) {
    // Only carry query params forward when the rule didn't match on them —
    // BigCommerce supports matching a redirect by specific query params, and
    // re-appending them would defeat that.
    const fromPathSearchParams = new URL(route.redirect.fromPath, request.url).search;
    const searchParams = fromPathSearchParams.length > 0 ? '' : request.nextUrl.search;

    switch (route.redirect.to.__typename) {
      case 'BlogPostRedirect':
      case 'BrandRedirect':
      case 'CategoryRedirect':
      case 'PageRedirect':
      case 'ProductRedirect': {
        const redirectUrl = new URL(route.redirect.to.path + searchParams, request.url);

        if (!sameInternalUrl(request.nextUrl, redirectUrl)) {
          return NextResponse.redirect(redirectUrl, redirectConfig);
        }

        break;
      }

      case 'ManualRedirect': {
        // Relative for internal targets, absolute for external. URL handles both.
        const redirectUrl = new URL(route.redirect.to.url, request.url);

        if (redirectUrl.origin === request.nextUrl.origin) {
          redirectUrl.search = searchParams;

          if (sameInternalUrl(request.nextUrl, redirectUrl)) {
            break;
          }
        }

        return NextResponse.redirect(redirectUrl, redirectConfig);
      }

      default:
        return NextResponse.redirect(route.redirect.toUrl, redirectConfig);
    }
  }

  const node = route?.node;
  let url: string;

  switch (node?.__typename) {
    case 'Brand':
      url = `/brand/${node.entityId}`;
      break;

    case 'Category':
      url = `/category/${node.entityId}`;
      break;

    case 'Product':
      url = `/product/${node.entityId}`;
      break;

    case 'NormalPage':
      url = `/webpages/${node.id}/normal/`;
      break;

    case 'ContactPage':
      url = `/webpages/${node.id}/contact/`;
      break;

    case 'RawHtmlPage': {
      // Merchant-authored HTML with no Next route behind it, so there is no shell
      // to prerender — KV is the only cache this path ever gets.
      const { htmlBody } = await getRawWebPageContent(node.id);

      return new NextResponse(htmlBody, { headers: { 'content-type': 'text/html' } });
    }

    case 'Blog':
      url = '/blog';
      break;

    case 'BlogPost':
      url = `/blog/${node.entityId}`;
      break;

    default:
      // Unresolved: hand back to file-system routing, which 404s.
      url = new URL(request.url).pathname;
  }

  const rewriteUrl = new URL(url, request.url);

  rewriteUrl.search = request.nextUrl.search;

  return NextResponse.rewrite(rewriteUrl);
};
