import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { bc } from './index';
import { BigCommerceAuthError } from './client';
import type { ClientRequest } from './client/types';

/**
 * Customer-scoped fetcher. Dynamic by definition — it reads the session.
 *
 * Legal in: server actions, route handlers, and `'use cache: private'` scopes
 * (which may read cookies, but are never persisted server-side).
 *
 * ILLEGAL in: anything under `data/` that isn't `data/customer/`. Threading a
 * customer token into shared queries is precisely the defect this rewrite
 * exists to remove — in Catalyst it appears at ~76 call sites and costs
 * logged-in users every byte of HTTP caching, including for data that is
 * byte-identical across all customers.
 *
 * Before reaching for this, check whether the query actually needs the token.
 * Most don't: `site.route`, `site.settings`, `site.categoryTree`, product
 * content, inventory, availability, search, and reviews are all store-level.
 * Only `customer{...}`, orders, wishlists, cart/checkout once customer-assigned,
 * customer-group catalog visibility, and customer-group price lists genuinely
 * require it.
 */
export async function customerQuery<TResult, TVariables extends Record<string, unknown>>(
  request: Omit<ClientRequest<TResult, TVariables>, 'fetchOptions'> & {
    variables: TVariables;
    customerAccessToken: string;
  },
): Promise<TResult>;
export async function customerQuery<TResult>(
  request: Omit<ClientRequest<TResult, Record<string, never>>, 'fetchOptions'> & {
    variables?: undefined;
    customerAccessToken: string;
  },
): Promise<TResult>;
export async function customerQuery<TResult, TVariables>(
  request: Omit<ClientRequest<TResult, TVariables>, 'fetchOptions'> & {
    customerAccessToken: string;
  },
): Promise<TResult> {
  // Forwarded so BigCommerce can do geolocation-dependent personalization at
  // origin. Only meaningful on uncached requests, which is all of these.
  const forwardedFor = (await headers()).get('x-forwarded-for');

  try {
    const { data } = await bc.request<TResult, TVariables>({
      ...request,
      headers: {
        ...request.headers,
        ...(forwardedFor && { 'X-Forwarded-For': forwardedFor, 'True-Client-IP': forwardedFor }),
      },
      fetchOptions: { cache: 'no-store' },
    });

    return data;
  } catch (error) {
    // The session died mid-render. Safe to redirect here because we are already
    // dynamic — upstream this lived in the client's `onError` hook, where it
    // could fire from inside a cached body.
    if (error instanceof BigCommerceAuthError) {
      redirect('/api/auth/signout');
    }

    throw error;
  }
}
