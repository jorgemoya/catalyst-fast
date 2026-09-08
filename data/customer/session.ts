import 'server-only';

import { auth, isAuthConfigured } from '~/lib/auth';

/**
 * The one place the rest of the app asks "who is this shopper?".
 *
 * Dynamic by definition — it reads the session cookie — so it is legal in server
 * actions, route handlers, and `'use cache: private'` scopes, and nowhere else.
 * `scripts/cache-audit.ts` enforces that nothing under `data/` outside this
 * folder can reach it.
 */

export interface CustomerSession {
  customerId: number;
  /**
   * Which price list applies. `DEFAULT_CUSTOMER_GROUP_ID` means catalog pricing,
   * which is the case for the overwhelming majority of signed-in shoppers and is
   * what lets the personalized-price overlay skip a fetch entirely.
   */
  customerGroupId: number;
  customerAccessToken: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Set when a B2B agent is acting on this customer's behalf. */
  impersonatorId: string | null;
}

/**
 * BigCommerce uses group 0 for "no group", which is also what a store with no
 * price lists reports for everyone.
 */
export const DEFAULT_CUSTOMER_GROUP_ID = 0;

export async function getSession(): Promise<CustomerSession | null> {
  // Short-circuits before touching next-auth so a store without accounts
  // configured never pays for, or fails on, session decoding.
  if (!isAuthConfigured) {
    return null;
  }

  const session = await auth();
  const user = session?.user;

  if (!user?.customerAccessToken) {
    return null;
  }

  return {
    customerId: user.customerId,
    customerGroupId: user.customerGroupId,
    customerAccessToken: user.customerAccessToken,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email ?? '',
    impersonatorId: user.impersonatorId,
  };
}
