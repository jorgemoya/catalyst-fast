import { cacheLife, cacheTag } from 'next/cache';

import { bc } from '~/lib/bigcommerce';
import { tags } from '~/lib/cache/tags';

/**
 * Proxies BigCommerce's own sitemap index.
 *
 * Deliberately not a generated `sitemap.ts`. BigCommerce already produces a
 * complete, correct index covering every product, category, brand, page, and post
 * — including entities this storefront doesn't render — and it updates as the
 * catalog changes without a redeploy. Regenerating it here would mean paginating
 * the whole catalog at build time (see `docs/scaling.md` on why that is a trap)
 * to produce a worse copy that goes stale.
 *
 * Cached under `content` rather than fetched per request: crawlers hit this
 * repeatedly, and the upstream document changes on the order of hours.
 *
 * Note this route is excluded from the proxy matcher, so it never pays a
 * `site.route` lookup.
 */

async function fetchSitemap(): Promise<string> {
  'use cache';
  cacheLife('content');
  cacheTag(tags.content);

  return bc.fetchSitemapIndex();
}

export async function GET(): Promise<Response> {
  try {
    return new Response(await fetchSitemap(), {
      headers: { 'Content-Type': 'application/xml' },
    });
  } catch (error) {
    console.error('[sitemap]', error);

    // An empty but well-formed index beats a 500: a crawler retries a 5xx and may
    // treat repeated failures as a site-health signal.
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></sitemapindex>',
      { status: 200, headers: { 'Content-Type': 'application/xml' } },
    );
  }
}
