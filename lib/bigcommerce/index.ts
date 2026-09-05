import 'server-only';

import { env } from '~/lib/env';

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
>;

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
    fetchOptions: { cache: 'no-store' },
  });

  return data;
}
