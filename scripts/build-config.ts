import { readFile, readdir, writeFile } from 'node:fs/promises';
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
        locales {
          code
          path
          isDefault
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
        locales: z
          .array(z.object({ code: z.string(), path: z.string().nullish(), isDefault: z.boolean() }))
          .nullish(),
      })
      .nullable(),
  }),
});

const CONFIG_FILE = join(dirname(fileURLToPath(import.meta.url)), '../lib/config/build-config.json');

const MESSAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../messages');
const CHANNELS_FILE = 'lib/config/channels.ts';

/**
 * Reports locales the store offers that this repo cannot serve, and vice versa.
 *
 * The locale list is read from BigCommerce at runtime (`data/locales.ts`), but two
 * things about it are settled at build time: whether `messages/<code>.json`
 * exists, and whether `CHANNELS` in `lib/config/channels.ts` knows the code — the
 * proxy's routing guard reads the latter statically, deliberately, so it does not
 * put a network call in front of every request.
 *
 * That leaves exactly one way for the two to drift: a merchant enables a language
 * in the control panel and nobody adds the catalogue. The symptom would be silence
 * — the locale simply never appears in the switcher, with nothing to explain why.
 * So say it here, at the one moment someone is watching the output.
 *
 * A **warning, not an error**. A merchant experimenting with a language in the
 * control panel should not be able to break a deploy of an unrelated change, and
 * the runtime behaviour is already safe: an untranslated locale is filtered out
 * rather than served half-English.
 */
async function reportLocaleDrift(
  locales: Array<{ code: string; path?: string | null; isDefault: boolean }>,
): Promise<void> {
  const storeLocales = locales.map((locale) => locale.code);

  const routableDefault = (await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', CHANNELS_FILE), 'utf8')).match(
    /^export const DEFAULT_LOCALE = '([^']+)';$/mu,
  )?.[1];
  const storeDefault = locales.find((locale) => locale.isDefault)?.code;

  /*
   * These answer different questions — BigCommerce's is "what language is the
   * catalog in", ours is "whose URL prefix do we hide" — but a storefront where
   * they disagree is almost always a mistake, and the symptom is obscure: the
   * language switcher emits URLs the proxy does not serve.
   */
  if (storeDefault && routableDefault && storeDefault !== routableDefault) {
    console.warn(
      `[build-config] BigCommerce's default locale is "${storeDefault}" but DEFAULT_LOCALE in ${CHANNELS_FILE} is "${routableDefault}" — "${routableDefault}" is the one served on prefix-free URLs. Change one if that is not intended.`,
    );
  }

  for (const { code, path } of locales) {
    if (path) {
      console.warn(
        `[build-config] BigCommerce sets a URL subfolder ("${path}") for the "${code}" locale, but routing uses /${code}/ — the proxy resolves locales from a static list. See proxies/locale.ts.`,
      );
    }
  }

  if (storeLocales.length === 0) {
    return;
  }

  const translated = (await readdir(MESSAGES_DIR))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/\.json$/, ''));

  const routable = (await readFile(join(dirname(fileURLToPath(import.meta.url)), '..', CHANNELS_FILE), 'utf8'))
    .match(/^\s{2}([a-z]{2}(?:-[A-Za-z0-9]+)?):\s*\{$/gmu)
    ?.map((line) => line.trim().replace(/:\s*\{$/u, '')) ?? [];

  for (const code of storeLocales) {
    if (!translated.includes(code)) {
      console.warn(
        `[build-config] BigCommerce offers the "${code}" locale but messages/${code}.json is missing — it will not be served. Add the catalogue to enable it.`,
      );
    } else if (!routable.includes(code)) {
      console.warn(
        `[build-config] BigCommerce offers the "${code}" locale and messages/${code}.json exists, but ${CHANNELS_FILE} has no entry — the proxy will not route /${code}/. Add one.`,
      );
    }
  }

  for (const code of translated) {
    if (!storeLocales.includes(code)) {
      console.warn(
        `[build-config] messages/${code}.json exists but BigCommerce does not offer the "${code}" locale — it will not be served. Enable it in the control panel.`,
      );
    }
  }
}

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

  await reportLocaleDrift(settings.locales ?? []);
}

main().catch((error: unknown) => {
  console.error('[build-config] failed:', error);
  process.exit(1);
});
