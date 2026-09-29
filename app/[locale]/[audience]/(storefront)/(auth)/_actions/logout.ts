'use server';

import { signOut } from '~/lib/auth';
import type { DocumentNavigationResult } from '~/lib/navigation/document-navigation';

/**
 * Sign out.
 *
 * The BigCommerce-side logout and the cart hand-back happen in the `signOut`
 * event in `lib/auth/index.ts`, not here — next-auth fires it with the token
 * still available, which is the only point where the access token needed to end
 * the remote session is still in hand.
 *
 * Returns a target rather than letting next-auth redirect: a restricted shopper
 * moves back to the `public` catalog audience, a root-param change that must be
 * a document load — which also discards every page the router cached for their
 * group. See `lib/navigation/document-navigation.ts`.
 */
export async function logout(): Promise<DocumentNavigationResult> {
  await signOut({ redirect: false });

  return { navigateTo: '/' };
}
