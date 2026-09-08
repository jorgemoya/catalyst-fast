'use server';

import { signOut } from '~/lib/auth';

/**
 * Sign out.
 *
 * The BigCommerce-side logout and the cart hand-back happen in the `signOut`
 * event in `lib/auth/index.ts`, not here — next-auth fires it with the token
 * still available, which is the only point where the access token needed to end
 * the remote session is still in hand.
 */
export async function logout(): Promise<void> {
  await signOut({ redirectTo: '/' });
}
