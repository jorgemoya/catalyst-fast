import { cacheLife, cacheTag } from 'next/cache';

import { query } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';
import { buildConfig } from '~/lib/config';

/**
 * `robots.txt`, sourced from the merchant's channel settings.
 *
 * Keeping it merchant-owned rather than checking a static file into the repo
 * means a merchant can adjust crawl rules from the control panel without a
 * deploy — which is the same reason the URL space itself is resolved through
 * `site.route` rather than expressed as file-system routes.
 *
 * The `Sitemap:` directive is appended here rather than left to the merchant,
 * because our sitemap lives at `/sitemap.xml` while theirs was historically at
 * `/xmlsitemap.php`, and a stale directive pointed at the old path is a silent
 * crawl failure.
 */

const RobotsTxtQuery = graphql(`
  query RobotsTxt {
    site {
      settings {
        robotsTxt
      }
    }
  }
`);

async function fetchRobotsTxt(): Promise<string> {
  'use cache';
  cacheLife('settings');
  cacheTag(tags.settings);

  const data = await query({ document: RobotsTxtQuery });

  return data.site.settings?.robotsTxt ?? '';
}

export async function GET(): Promise<Response> {
  const origin = new URL(buildConfig.get('urls').vanityUrl).origin;

  let merchantRules = '';

  try {
    merchantRules = await fetchRobotsTxt();
  } catch (error) {
    // Falling through to just the sitemap directive is the safe failure: an
    // empty robots.txt permits crawling, whereas a 500 can be read as
    // "disallow everything" by some crawlers.
    console.error('[robots]', error);
  }

  const body = `${merchantRules.trim()}\n\nSitemap: ${origin}/sitemap.xml\n`.trimStart();

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
