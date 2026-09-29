import { composeProxies } from './proxies/compose';
import { withRoutes } from './proxies/with-routes';
import { withUcpProxy } from './proxies/with-ucp-proxy';

/**
 * Every proxy runs on every request, ahead of Next's own routing — including
 * prefetches and RSC navigations — so each one is a tax on the whole
 * storefront. Add sparingly.
 *
 * `withRoutes` does the real work: locale prefix, catalog audience
 * (`public`, or `restricted` for groups in `RESTRICTED_CATALOG_GROUPS`),
 * maintenance, redirects, and the rewrite to `app/[locale]/[audience]/…`.
 */
// `withUcpProxy` first: UCP paths must bypass locale prefixing and route
// resolution entirely. See proxies/with-ucp-proxy.ts.
export const proxy = composeProxies(withUcpProxy, withRoutes);

export const config = {
  matcher: [
    /*
     * Everything except:
     * - api (route handlers resolve themselves)
     * - _next/static, _next/image, _vercel (framework internals)
     * - favicon.ico, sitemap.xml, xmlsitemap.php, robots.txt (fixed routes)
     *
     * Note _next/static and _next/image are excluded but the RSC payload
     * requests for a navigation are NOT — they must pass through so a
     * client-side navigation resolves the same vanity URL the server did.
     */
    '/((?!api|_next/static|_next/image|_vercel|favicon.ico|xmlsitemap.php|sitemap.xml|robots.txt).*)',
    /*
     * UCP endpoints, proxied to BigCommerce by `withUcpProxy`. Listed separately
     * so the `api` exclusion above keeps applying to every other API route.
     */
    '/api/ucp/:path*',
  ],
};
