import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { createClient, type DocumentDecoration } from '../lib/bigcommerce/client';
import { buildConfigSchema } from '../lib/config/schema';

/**
 * Writes the build-time settings snapshot consumed by `lib/config/index.ts`.
 *
 * Runs as `prebuild`/`predev` rather than from inside `next.config.ts`.
 * Catalyst fetched these settings from `next.config.ts` directly, which meant
 * the GraphQL client was imported during config resolution — and that pulled
 * `next/headers` and `next-intl/server` into the module graph early enough to
 * poison AsyncLocalStorage (pnpm symlinks produce two singleton instances), so
 * upstream needed dynamic `import()` gymnastics throughout the client to work
 * around it. Doing the fetch in a plain script removes the whole class of problem:
 * `next.config.ts` only ever reads a validated JSON file.
 */

/**
 * Written as a raw string and validated with zod below, rather than as a
 * `graphql()` document. This is the one script that must work BEFORE
 * `pnpm generate` has ever run — using gql.tada here would make a fresh clone's
 * `pnpm build` fail on missing introspection types instead of on missing
 * credentials, which is a much more confusing first error.
 *
 * `normalizeQuery` in the client takes the string branch; the cast only satisfies
 * the typed-document signature.
 */
const SettingsQuery = `
  query BuildConfigSettings {
    site {
      settings {
        url {
          vanityUrl
          cdnUrl
          checkoutUrl
        }
      }
    }
  }
` as unknown as DocumentDecoration<unknown, Record<string, never>>;

const ResponseSchema = z.object({
  site: z.object({
    settings: z
      .object({
        url: z.object({
          vanityUrl: z.string(),
          cdnUrl: z.string().nullable(),
          checkoutUrl: z.string(),
        }),
      })
      .nullable(),
  }),
});

const CONFIG_FILE = join(dirname(fileURLToPath(import.meta.url)), '../lib/config/build-config.json');

async function main(): Promise<void> {
  const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
  const storefrontToken = process.env.BIGCOMMERCE_STOREFRONT_TOKEN;

  if (!storeHash || !storefrontToken) {
    console.warn(
      '[build-config] BIGCOMMERCE_STORE_HASH / BIGCOMMERCE_STOREFRONT_TOKEN not set — keeping the existing build-config.json.',
    );

    return;
  }

  const client = createClient({
    storeHash,
    storefrontToken,
    channelId: process.env.BIGCOMMERCE_CHANNEL_ID ?? '1',
    graphqlApiDomain: process.env.BIGCOMMERCE_GRAPHQL_API_DOMAIN,
    trustedProxySecret: process.env.BIGCOMMERCE_TRUSTED_PROXY_SECRET,
  });

  const { data } = await client.request({ document: SettingsQuery });
  const settings = ResponseSchema.parse(data).site.settings;

  if (!settings) {
    throw new Error('[build-config] BigCommerce returned no site settings.');
  }

  // Multiple CDN hostnames can be supplied via env for stores fronted by their
  // own CDN; otherwise fall back to whatever BigCommerce reports.
  const envHostnames = process.env.NEXT_PUBLIC_BIGCOMMERCE_CDN_HOSTNAME;
  const cdnUrls = (
    envHostnames ? envHostnames.split(',').map((s) => s.trim()) : [settings.url.cdnUrl]
  ).filter((url): url is string => Boolean(url));

  if (cdnUrls.length === 0) {
    throw new Error(
      '[build-config] No CDN hostname resolved. Set NEXT_PUBLIC_BIGCOMMERCE_CDN_HOSTNAME.',
    );
  }

  const config = buildConfigSchema.parse({
    urls: {
      vanityUrl: settings.url.vanityUrl,
      checkoutUrl: settings.url.checkoutUrl,
      cdnUrls,
    },
  });

  await writeFile(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`[build-config] wrote ${CONFIG_FILE}`);
}

main().catch((error: unknown) => {
  console.error('[build-config] failed:', error);
  process.exit(1);
});
