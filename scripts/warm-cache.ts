/**
 * Post-deploy cache warmer.
 *
 * Solves the sharpest non-obvious risk in the design (plan §7.4): a remote cache
 * key includes the build id, so **every deploy starts fully cold** no matter how
 * healthy the shared KV store is. That was verified alongside the cross-instance
 * proof — sharing works, but only between instances running the same build. So
 * the first traffic wave after a deploy hits BigCommerce at full force, which on
 * a busy store is precisely when you can least afford it.
 *
 *   pnpm warm-cache                       # warm against WEBHOOK_DESTINATION_ORIGIN
 *   pnpm warm-cache --origin https://…    # or an explicit target
 *   pnpm warm-cache --limit 50 --concurrency 2
 *   pnpm warm-cache --dry-run             # list what would be requested
 *
 * Run it *after* the deployment is live and serving. Warming the previous build
 * accomplishes nothing, since the new one will not share its entries.
 *
 * URLs come from BigCommerce's own sitemap index, which is authoritative about
 * what exists and needs no catalog pagination. It is not ordered by traffic —
 * "top-N" here means "first N", which is a reasonable proxy and much cheaper
 * than wiring up analytics. If you have real traffic data, feed it in instead;
 * the shape of this script does not change.
 */
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', quiet: true });

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? undefined : process.argv[index + 1];
};

const origin = (arg('origin') ?? process.env.WEBHOOK_DESTINATION_ORIGIN ?? '').replace(/\/$/, '');
const limit = Number(arg('limit') ?? 100);
const concurrency = Number(arg('concurrency') ?? 3);
const dryRun = process.argv.includes('--dry-run');

const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
const channelId = process.env.BIGCOMMERCE_CHANNEL_ID ?? '1';
const apiDomain = process.env.BIGCOMMERCE_GRAPHQL_API_DOMAIN ?? 'mybigcommerce.com';
const storefrontToken = process.env.BIGCOMMERCE_STOREFRONT_TOKEN;

/*
 * XML escapes ampersands, so a child sitemap URL arrives as
 * `…xmlsitemap.php?type=products&amp;page=1`. Requesting that literally 404s —
 * the query string is one parameter named `type` with a value containing
 * "&amp;page=1". Decoding is not optional cleanup; without it the warmer walks
 * the index, fails every child, and cheerfully reports warming one path.
 */
const decodeEntities = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

/** Pulls `<loc>` values out of a sitemap or sitemap index. */
const locations = (xml: string): string[] =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1]?.trim())
    .filter((loc): loc is string => Boolean(loc))
    .map(decodeEntities);

async function fetchText(url: string, headers?: Record<string, string>): Promise<string> {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`GET ${url} → ${response.status}`);
  }

  return response.text();
}

/**
 * Walks the sitemap index into a flat list of storefront paths.
 *
 * BigCommerce's index points at per-type child sitemaps, so this is two levels.
 * Only as many children as `limit` requires are fetched — a large catalog can
 * have many, and warming does not need all of them.
 */
async function collectPaths(): Promise<string[]> {
  const base = `https://store-${storeHash}-${channelId}.${apiDomain}`;
  const index = await fetchText(`${base}/xmlsitemap.php`, {
    Authorization: `Bearer ${storefrontToken}`,
  });

  /*
   * Order the child sitemaps by how much warming them is worth, rather than
   * taking BigCommerce's order.
   *
   * Its index happens to list `pages` first, and on a B2B-enabled store that
   * sitemap is mostly account routes — `/address-book/`, `/quote/`,
   * `/buy-again/`. Those are auth-gated, uncacheable, and warming them achieves
   * nothing except spending the budget that products and categories needed.
   * Products first, then categories and brands, then everything else.
   */
  const priority = ['products', 'categories', 'brands'];
  const rank = (url: string): number => {
    const type = new URL(url).searchParams.get('type') ?? '';
    const index = priority.indexOf(type);

    return index === -1 ? priority.length : index;
  };

  const children = locations(index).sort((a, b) => rank(a) - rank(b));
  const paths: string[] = [];

  // Always warm the homepage: it is the most requested URL and never appears in
  // a product sitemap.
  paths.push('/');

  for (const child of children) {
    if (paths.length >= limit) {
      break;
    }

    try {
      const xml = await fetchText(child, { Authorization: `Bearer ${storefrontToken}` });

      for (const loc of locations(xml)) {
        if (paths.length >= limit) {
          break;
        }

        // The sitemap lists canonical store URLs; only the path is wanted, since
        // we warm whatever origin is being deployed.
        paths.push(new URL(loc).pathname);
      }
    } catch (error) {
      // One unreadable child sitemap should not abort the warm.
      console.warn(`  ! skipped ${child}: ${error instanceof Error ? error.message : error}`);
    }
  }

  return [...new Set(paths)];
}

/**
 * Requests paths with bounded concurrency.
 *
 * Deliberately gentle. The point is to move load off the first real visitors,
 * not to recreate the same stampede from a script — and `BC_MAX_CONCURRENCY`
 * plus BigCommerce's rate limits apply to the warm exactly as they do to
 * traffic. Slower than necessary is the correct failure mode here.
 */
async function warm(paths: string[]): Promise<void> {
  let index = 0;
  let ok = 0;
  let failed = 0;
  const started = Date.now();

  const worker = async (): Promise<void> => {
    for (;;) {
      const current = index++;

      if (current >= paths.length) {
        return;
      }

      const path = paths[current];

      try {
        const response = await fetch(`${origin}${path}`, {
          headers: { 'User-Agent': 'catalyst-fast-cache-warmer' },
        });

        if (response.ok) {
          ok++;
        } else {
          failed++;
          console.warn(`  ! ${response.status} ${path}`);
        }

        // Drain the body: an unread response can keep the connection open and
        // stall the pool.
        await response.arrayBuffer();
      } catch (error) {
        failed++;
        console.warn(`  ! ${path}: ${error instanceof Error ? error.message : error}`);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\nwarmed ${ok}/${paths.length} in ${elapsed}s (${failed} failed)`);
}

async function main(): Promise<void> {
  if (!storeHash || !storefrontToken) {
    console.error('Missing BIGCOMMERCE_STORE_HASH or BIGCOMMERCE_STOREFRONT_TOKEN');
    process.exit(1);
  }

  // Only needed when actually requesting something — a dry run just lists paths,
  // which is the useful way to sanity-check the sitemap walk before a deploy.
  if (!origin && !dryRun) {
    console.error(
      'No target origin. Pass --origin https://your-store.example or set ' +
        'WEBHOOK_DESTINATION_ORIGIN.',
    );
    process.exit(1);
  }

  console.log(`collecting up to ${limit} paths from the BigCommerce sitemap…`);

  const paths = await collectPaths();

  if (dryRun) {
    paths.forEach((path) => console.log(`  ${path}`));
    console.log(`\n${paths.length} path(s); dry run, nothing requested`);

    return;
  }

  console.log(`warming ${paths.length} path(s) against ${origin} (concurrency ${concurrency})…`);

  await warm(paths);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
