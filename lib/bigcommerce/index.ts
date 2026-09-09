import 'server-only';

import { env } from '~/lib/env';

import { channelFor } from '~/lib/config/channels';

import { createClient } from './client';
import type { ClientRequest } from './client/types';

const commitSha = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

export const bc = createClient({
  storeHash: env.BIGCOMMERCE_STORE_HASH,
  storefrontToken: env.BIGCOMMERCE_STOREFRONT_TOKEN,
  channelId: env.BIGCOMMERCE_CHANNEL_ID,
  graphqlApiDomain: env.BIGCOMMERCE_GRAPHQL_API_DOMAIN,
  trustedProxySecret: env.BIGCOMMERCE_TRUSTED_PROXY_SECRET,
  userAgentExtensions: `catalyst-fast/0.0.0${commitSha ? ` (${commitSha})` : ''}`,
  maxConcurrency: env.BC_MAX_CONCURRENCY,
  logger:
    (env.NODE_ENV !== 'production' && env.CLIENT_LOGGER !== 'false') || env.CLIENT_LOGGER === 'true',
});

/** A public request carries no customer credential, by construction. */
type PublicRequest<TResult, TVariables> = Omit<
  ClientRequest<TResult, TVariables>,
  'customerAccessToken' | 'fetchOptions'
> & {
  /**
   * Sent as `Accept-Language`. Pass it from any cached read whose result can
   * differ by locale — and make sure that read takes locale as an argument, so
   * the entry is keyed by it.
   */
  locale?: string;
};

/**
 * The ONLY fetcher legal inside a `'use cache'` / `'use cache: remote'` body.
 *
 * Reads no request state and sends no customer credential, so it is safe to call
 * from a cached function whose key is made of scalar arguments only.
 *
 * `cache: 'no-store'` is deliberate and is not a mistake: `use cache` owns
 * caching now. Letting the fetch layer cache as well would give us two caches
 * with different keys, different lifetimes, and no shared invalidation — which
 * is roughly the situation in Catalyst today.
 *
 * Enforced by `scripts/cache-audit.ts` and the ESLint boundary on `data/`:
 * `data/*.ts` may import this, but never `next/headers` or `customerQuery`.
 */
export async function query<TResult, TVariables extends Record<string, unknown>>(
  request: PublicRequest<TResult, TVariables> & { variables: TVariables },
): Promise<TResult>;
export async function query<TResult>(
  request: PublicRequest<TResult, Record<string, never>> & { variables?: undefined },
): Promise<TResult>;
export async function query<TResult, TVariables>(
  request: PublicRequest<TResult, TVariables>,
): Promise<TResult> {
  const { data } = await bc.request<TResult, TVariables>({
    ...request,
    /*
     * `Accept-Language` tells BigCommerce which translations to return for
     * catalog content — product names, descriptions, category names. Catalyst
     * sends it from `beforeRequest`; without it a Spanish storefront gets the
     * channel's default language whatever the shopper picked.
     *
     * **The locale is an explicit argument, never read here.** Two reasons, and
     * the second is the important one:
     *
     *  1. `next/root-params` is unusable in this module. It is reachable from
     *     `proxy.ts` and from route handlers, and Turbopack rejects the import
     *     outright: "'next/root-params' can only be used inside the App
     *     Directory."
     *  2. The header must agree with the **cache key**. A caller that passes
     *     `locale` has it in its own signature, so its entry is keyed by it.
     *     Reading the locale implicitly here would send a per-locale header from
     *     a locale-blind cache entry — measured before this existed,
     *     `/es/garden/` reused 14 of 15 entries warmed by `/en/garden/`, which
     *     with this header would mean Spanish shoppers served English content.
     */
    ...(request.locale && {
      headers: { ...request.headers, 'Accept-Language': request.locale },
      /*
       * **The channel comes from the same locale as the header**, so a store that
       * gives a locale its own BigCommerce channel gets it honoured. Previously
       * `channelFor().channelId` was defined and never used — `channels.ts`
       * claimed changing it was all that was needed, and that claim was false.
       *
       * Safe for caching for exactly the reason `Accept-Language` is: the locale
       * is an explicit argument, so the caller's cache entry is already keyed by
       * it. Deriving the channel from ambient state instead would let one entry
       * serve two channels.
       */
      channelId: channelFor(request.locale).channelId,
    }),
    fetchOptions: { cache: 'no-store' },
  });

  return data;
}

/**
 * Writes. Mechanically identical to `query`, deliberately named apart from it.
 *
 * The distinction is not stylistic: `query` is safe inside a cached body and a
 * mutation never is — running one there would re-execute a write on every cache
 * miss and, worse, would appear to work. Sharing one name would make that
 * mistake invisible at the call site, so `mutate` is banned in `data/` by
 * `scripts/cache-audit.ts` the same way `customerQuery` is.
 *
 * A customer credential may be passed **explicitly**, and only explicitly. That
 * is the difference from `customerQuery`, which reads the session itself: a
 * mutation like logout has to act on a specific token the caller is holding, and
 * during sign-out there is no session left to read. Making it an argument keeps
 * the "no ambient credentials" rule intact — nothing here reaches for request
 * state on its own.
 */
export async function mutate<TResult, TVariables extends Record<string, unknown>>(
  request: PublicRequest<TResult, TVariables> & {
    variables: TVariables;
    customerAccessToken?: string;
  },
): Promise<TResult> {
  const { data } = await bc.request<TResult, TVariables>({
    ...request,
    /*
     * A write must land on the same channel the shopper is reading from —
     * otherwise, on a store where locales have separate channels, a cart is built
     * against one catalog and priced against another.
     *
     * Optional, and omitting it keeps the client's configured default, which is
     * today's behaviour on a single-channel store. Callers in a locale-aware path
     * should pass it; `getTForAction`-style call sites already have the locale to
     * hand via `activeLocale()`.
     */
    ...(request.locale && { channelId: channelFor(request.locale).channelId }),
    fetchOptions: { cache: 'no-store' },
  });

  return data;
}
