import { composeProxies } from './proxies/compose';
import { withRoutes } from './proxies/with-routes';

/**
 * Only route resolution for now. Every additional proxy runs on every request,
 * ahead of Next's own routing — including prefetches and RSC navigations — so
 * each one is a tax on the whole storefront. Add sparingly:
 *
 *   Phase 4 — anonymous session (guest cart id)
 *   Phase 6 — auth + the /account protected-path redirect
 *   Phase 7 — analytics visit/visitor cookies
 *   Phase 8 — locale prefix + channel id
 */
export const proxy = composeProxies(withRoutes);

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
  ],
};
