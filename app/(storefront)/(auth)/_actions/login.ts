'use server';

import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { safeRedirectPath } from '~/domain/redirect';

import { AuthError } from 'next-auth';

import { isAuthConfigured, signIn } from '~/lib/auth';
import { getCartId } from '~/lib/cart/session';
import { t } from '~/lib/i18n/messages';

/**
 * Sign in.
 *
 * The guest cart id is read here and handed to BigCommerce, which merges it into
 * the customer's cart and returns the result — see `lib/auth/mutations.ts`.
 */

const loginSchema = z.object({
  email: z.string().trim().min(1, t('Auth.required')).email(t('Auth.invalidEmail')),
  password: z.string().min(1, t('Auth.required')),
  redirectTo: z.string().optional(),
});

const formError = (message: string): SubmissionResult => ({
  status: 'error',
  error: { '': [message] },
});

export async function login(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  if (!isAuthConfigured) {
    return formError(t('Auth.notConfigured'));
  }

  const submission = parseWithZod(formData, { schema: loginSchema });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  const { email, password, redirectTo } = submission.value;
  const cartId = await getCartId();

  try {
    await signIn('password', { email, password, cartId: cartId ?? '', redirect: false });
  } catch (error) {
    /*
     * next-auth v5 **throws** on a failed credentials sign-in rather than
     * returning an error shape — an earlier version of this checked the return
     * value and so never showed anything at all. The failure was invisible until
     * `AUTH_TRUST_HOST` was set, because before that the request never got far
     * enough to fail this way.
     *
     * The message is deliberately the same for an unknown email and a wrong
     * password: distinguishing them tells an attacker which addresses are
     * registered.
     */
    if (error instanceof AuthError) {
      return submission.reply({ formErrors: [t('Auth.invalidCredentials')] });
    }

    // Anything else — including the `NEXT_REDIRECT` next-auth may throw — has to
    // propagate untouched.
    throw error;
  }

  redirect(safeRedirectPath(redirectTo, '/account/orders'));
}
