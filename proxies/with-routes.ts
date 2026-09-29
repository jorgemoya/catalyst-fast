import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { bc, query } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';
import { kv } from '~/lib/kv';
import { channelFor } from '~/lib/config/channels';

import {
  LOCALE_EXEMPT_PATH,
  LOCALE_HEADER,
  detectLocale,
  shouldStripPrefix,
  withLocalePrefix,
} from './locale';
import { kvKey, STORE_STATUS_KEY } from '~/lib/kv/keys';

import { AUDIENCE_HEADER, type Audience, resolveAudience } from './audience';
import type { ProxyFactory } from './compose';
import { createCustomerRouteMemo } from './customer-route-memo';
import { sameInternalUrl, toRouteKeyPath } from './route-key';

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
 *
 *     The narrow case that motivated the bypass is customer-group **catalog
 *     visibility**, where a group-restricted product resolves to `null` for
 *     guests. That is now opt-in and scoped: only shoppers in a group listed in
 *     `RESTRICTED_CATALOG_GROUPS` resolve as themselves, uncached, and are
 *     rewritten to the `restricted` audience. Everyone else shares the cache.
 *     See `proxies/audience.ts` and `lib/audience.ts`.
 *  2. **No analytics concerns.** The product-viewed event moves to a client
 *     beacon rather than firing from a `waitUntil` on every non-prefetch
 *     product request.
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

/*
 * The same lookup made *as a customer* — for the restricted audience only.
 * `query()` is token-free by construction, so this goes through the client
 * directly; it is uncached and its result is never written to KV.
 */
const customerRouteMemo = createCustomerRouteMemo<RouteResult>();

type RouteResult = Awaited<ReturnType<typeof fetchRouteAsCustomer>>;

// Memoised per shopper for seconds — see `proxies/customer-route-memo.ts`.
const getRouteAsCustomer = (path: string, channelId: string, customerAccessToken: string) =>
  customerRouteMemo(customerAccessToken, `${channelId}:${path}`, () =>
    fetchRouteAsCustomer(path, channelId, customerAccessToken),
  );

const fetchRouteAsCustomer = async (path: string, channelId: string, customerAccessToken: string) => {
  const { data } = await bc.request({
    document: GetRouteQuery,
    variables: { path },
    channelId,
    customerAccessToken,
    fetchOptions: { cache: 'no-store' },
  });

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

const getRouteInfo = async (
  request: NextRequest,
  event: NextFetchEvent,
  /**
   * The locale's channel, and the path **without** its locale prefix.
   *
   * Both are passed in rather than derived here. BigCommerce resolves a route
   * per channel and knows nothing about our URL prefixes: on a French channel
   * the page is `/garden/`, not `/fr/garden/`. Looking up the prefixed path
   * would resolve to nothing and 404 every non-default locale.
   */
  locale: { channelId: string; pathname: string; customerAccessToken?: string },
) => {
  const channelId = locale.channelId;

  try {
    // Query params stay part of the key — BigCommerce 301 rules can match on
    // them, so `/x` and `/x?a=1` are genuinely different resolutions — but
    // tracking noise is stripped first. See `toRouteKeyPath`.
    const pathname = toRouteKeyPath(request.nextUrl, locale.pathname);

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

    const guestRoute = RouteCacheSchema.safeParse(routeCache);
    const guestFound = guestRoute.success && Boolean(guestRoute.data.route?.node ?? guestRoute.data.route?.redirect);

    if (locale.customerAccessToken && !guestFound) {
      /*
       * **Restricted audience: re-resolve as the shopper, only on a guest miss.**
       *
       * BigCommerce resolves a route against the caller's catalog visibility, so
       * the shared guest entry answers "not found" for a product only this
       * shopper's group can see. Their answer is theirs — writing it to the
       * shared KV entry would publish a restricted route to every guest — so it
       * is fetched fresh, and never stored.
       *
       * Only on a miss. This used to run for *every* restricted request, and
       * the proxy sees every prefetch: measured, 22–36 BigCommerce calls per
       * page view, two thirds of them route lookups for links the shopper never
       * clicked. A path guests can resolve is the same page for the shopper; if
       * their group sees *less* than guests, the page's own restricted catalog
       * read is authoritative and 404s it.
       */
      routeCache = {
        route: await getRouteAsCustomer(pathname, channelId, locale.customerAccessToken),
        expiryTime: Date.now(),
      };
    }

    const parsedStatus = StorefrontStatusCacheSchema.safeParse(statusCache);
    const parsedRoute = RouteCacheSchema.safeParse(routeCache);
    const route = parsedRoute.success ? parsedRoute.data.route : undefined;

    /*
     * No negative-result fallback for everyone else. There used to be one (plan
     * §6.3): a "not found" plus any session cookie re-resolved the route. It
     * fetched through `query()`, which carries no customer credential, so it
     * re-ran the identical guest query and got the identical `null` — one
     * uncached BigCommerce call per miss, on exactly the paths crawlers and
     * scanners hammer, for nothing. The restricted branch above is the working
     * version of the same idea, gated on a group that can actually differ.
     */

    return {
      route,
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
 *
 * Extended in Phase 5 to blog posts and web pages, which are rewrite targets for
 * exactly the same reason and were reachable directly — serving the same content
 * at a second, non-canonical URL for a crawler to index.
 */
const INTERNAL_ROUTE_ONLY =
  /^\/(?:(?:category|brand|product|blog)\/\d+|webpages\/[^/]+\/(?:normal|contact))\/?$/;

/**
 * Paths this application owns outright, which must never be resolved against
 * BigCommerce.
 *
 * This is a correctness guard, not an optimization. `site.route` resolves the
 * merchant's URL space, and nothing stops a merchant creating a web page at
 * `/cart/`. If they have, resolution would rewrite to `/webpages/…` and our cart
 * would become unreachable — a failure that only appears on *some* stores, which
 * is the worst kind. Short-circuiting also saves a KV read and a negative-result
 * lookup on two paths that get real traffic.
 */
const APP_OWNED_PATH = /^\/(?:cart|checkout|search|login|register|logout|forgot-password|reset-password)\/?$|^\/(?:account|login\/token)\//;

/**
 * App-owned paths that are **route handlers**, and therefore live outside the
 * `[locale]` tree.
 *
 * `next/root-params` is unavailable in Route Handlers, so they were left at the
 * top level rather than moved under `app/[locale]/`. That means they must not be
 * locale-prefixed: rewriting `/checkout` to `/en/checkout` points at a route
 * that does not exist, and the handoff 404s. Caught by the checkout e2e tests
 * the first time this shipped.
 *
 * These still get the locale *header* (see `localeHeaders`), which is how they
 * know which channel and currency to use.
 */
/**
 * Adds the resolved locale to the *request* headers the app will see.
 *
 * `NextResponse.rewrite` takes `request.headers` for exactly this: it mutates
 * what the downstream handler receives, not what the browser gets back.
 */
const localeHeaders = (request: NextRequest, locale: string, audience: Audience) => {
  const headers = new Headers(request.headers);

  headers.set(LOCALE_HEADER, locale);
  // Server Actions and Route Handlers cannot read the `[audience]` root param,
  // so it travels as a header too — see `lib/audience.ts`.
  headers.set(AUDIENCE_HEADER, audience);

  return { request: { headers } };
};

const isRscRequest = (request: NextRequest): boolean =>
  request.headers.get('RSC') === '1' || request.headers.get('Next-Router-Prefetch') === '1';

export const withRoutes: ProxyFactory = () => async (request, event) => {
  /*
   * Locale first, because everything below works on the *unprefixed* path.
   *
   * `with-routes` resolves vanity URLs against BigCommerce and caches the answer
   * in KV; that cache is already keyed by channel id, and a locale is a channel,
   * so the two stay consistent as long as this strips the prefix before any
   * lookup happens. See `proxies/locale.ts`.
   */
  const detected = detectLocale(request);
  const { locale } = detected;
  const pathname = detected.pathname;

  /*
   * `/en/garden/` and `/garden/` must not both serve the page: that is duplicate
   * content for crawlers and two KV entries for one URL. The default locale's
   * canonical form is the prefix-free one, so redirect to it.
   */
  if (shouldStripPrefix(detected)) {
    const canonical = new URL(pathname, request.url);

    canonical.search = request.nextUrl.search;

    return NextResponse.redirect(canonical, { status: 301 });
  }

  /*
   * Which catalog to render. \`restricted\` only for a signed-in shopper in one of
   * \`RESTRICTED_CATALOG_GROUPS\`; the guest path returns before touching the
   * session. See \`proxies/audience.ts\`.
   */
  const { audience, customerAccessToken } = await resolveAudience(request);

  const localized = (target: string): string => withLocalePrefix(target, locale, audience);

  if (APP_OWNED_PATH.test(pathname)) {
    // Route handlers stay at the top level and must keep their unprefixed path;
    // everything else now lives under the locale segment, so passing through
    // unprefixed would land on nothing and 404.
    const target = LOCALE_EXEMPT_PATH.test(pathname) ? pathname : localized(pathname);
    const appUrl = new URL(target, request.url);

    appUrl.search = request.nextUrl.search;

    return NextResponse.rewrite(appUrl, localeHeaders(request, locale, audience));
  }

  if (INTERNAL_ROUTE_ONLY.test(pathname) && !isRscRequest(request)) {
    return new NextResponse(null, { status: 404 });
  }

  const { route, status } = await getRouteInfo(request, event, {
    channelId: channelFor(locale).channelId,
    pathname,
    customerAccessToken,
  });

  if (status === 'MAINTENANCE') {
    // The 503 does not currently stick on a rewrite — https://github.com/vercel/next.js/issues/50155
    return NextResponse.rewrite(new URL(localized('/maintenance'), request.url), { status: 503 });
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
      url = pathname;
  }

  const rewriteUrl = new URL(localized(url), request.url);

  rewriteUrl.search = request.nextUrl.search;

  return NextResponse.rewrite(rewriteUrl, localeHeaders(request, locale, audience));
};
