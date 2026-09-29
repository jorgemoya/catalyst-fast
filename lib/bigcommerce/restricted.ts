import 'server-only';

import { getSession } from '~/data/customer/session';
import { channelFor } from '~/lib/config/channels';
import { env } from '~/lib/env';

import { type PublicRequest, bc, query } from './index';
import { BigCommerceAuthError } from './client';

/**
 * Catalog reads *as the shopper*, for customer groups whose catalog visibility
 * differs from guests' (`RESTRICTED_CATALOG_GROUPS`).
 *
 * Same overloads as `query()`, so a data function can take either as its
 * fetcher. The difference is the token: BigCommerce decides visibility from the
 * caller, so a group that can see a restricted category only sees it when the
 * request carries that customer's token.
 *
 * **Only legal inside `'use cache: private'`.** It reads the session, and its
 * results are that shopper's — they must never land in a shared cache.
 * `scripts/cache-audit.ts` enforces that every call sits in a private scope.
 *
 * **Re-checks the group itself** rather than trusting that the proxy sent this
 * request down the `restricted` audience. A shopper who is not in a listed group
 * gets exactly what `query()` would return. Failing towards the guest catalog is
 * the safe direction: it can hide something a shopper may see, never reveal
 * something they may not.
 */
export async function restrictedQuery<TResult, TVariables extends Record<string, unknown>>(
  request: PublicRequest<TResult, TVariables> & { variables: TVariables },
): Promise<TResult>;
export async function restrictedQuery<TResult>(
  request: PublicRequest<TResult, Record<string, never>> & { variables?: undefined },
): Promise<TResult>;
export async function restrictedQuery<TResult, TVariables>(
  request: PublicRequest<TResult, TVariables>,
): Promise<TResult> {
  // `query`'s overloads cannot see through the generic implementation signature.
  const asGuest = () =>
    (query as (r: PublicRequest<TResult, TVariables>) => Promise<TResult>)(request);
  const session = await getSession();

  if (!session || !env.RESTRICTED_CATALOG_GROUPS.includes(session.customerGroupId)) {
    return asGuest();
  }

  try {
    const { data } = await bc.request<TResult, TVariables>({
      ...request,
      customerAccessToken: session.customerAccessToken,
      ...(request.locale && {
        headers: { ...request.headers, 'Accept-Language': request.locale },
        channelId: channelFor(request.locale).channelId,
      }),
      fetchOptions: { cache: 'no-store' },
    });

    return data;
  } catch (error) {
    /*
     * An expired token degrades to the guest catalog rather than redirecting.
     * This runs inside a render (a private cache scope), where a redirect would
     * take over the whole page for what is, to the shopper, a slightly smaller
     * catalog until the session is refreshed.
     */
    if (error instanceof BigCommerceAuthError) {
      return asGuest();
    }

    throw error;
  }
}

/** The fetcher shape both `query` and `restrictedQuery` satisfy. */
export type CatalogFetcher = typeof query;
