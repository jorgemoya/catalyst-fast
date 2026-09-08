'use server';

import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';
import { redirect } from 'next/navigation';

import { registerSchema } from '~/domain/registration';
import { isAuthConfigured, signIn } from '~/lib/auth';
import { mutate } from '~/lib/bigcommerce';
import { BigCommerceGQLError } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';
import { getCartId } from '~/lib/cart/session';
import { t } from '~/lib/i18n/messages';

/**
 * Create an account, then sign in.
 *
 * The sign-in is the important half. Registering without it leaves the shopper
 * authenticated nowhere — with an account they can't see and a guest cart that
 * was never merged. Signing in immediately routes them through the same
 * `guestCartEntityId` merge every other login uses.
 *
 * reCAPTCHA is deferred to Phase 7 with the rest of the spam-protection work.
 * `registerCustomer` takes an optional `reCaptchaV2`, so wiring it is additive —
 * but until then **this endpoint is unprotected**, which matters more here than
 * on the contact form: each submission creates a real customer record.
 */

const RegisterMutation = graphql(`
  mutation RegisterCustomer($input: RegisterCustomerInput!) {
    customer {
      registerCustomer(input: $input) {
        customer {
          entityId
        }
        errors {
          __typename
          ... on Error {
            message
          }
        }
      }
    }
  }
`);

const formError = (message: string): SubmissionResult => ({
  status: 'error',
  error: { '': [message] },
});

export async function register(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  if (!isAuthConfigured) {
    return formError(t('Auth.notConfigured'));
  }

  const submission = parseWithZod(formData, { schema: registerSchema });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  const { email, password, firstName, lastName, company, phone } = submission.value;

  try {
    const data = await mutate({
      document: RegisterMutation,
      variables: {
        input: {
          email,
          password,
          firstName,
          lastName,
          ...(company && { company }),
          ...(phone && { phone }),
        },
      },
    });

    const errors = data.customer.registerCustomer.errors;

    if (errors.length > 0) {
      // BigCommerce words these well — "email already in use", and the store's
      // own password-complexity rules, which we cannot know up front.
      return submission.reply({ formErrors: [errors[0]?.message || t('Auth.registerFailed')] });
    }
  } catch (error) {
    if (error instanceof BigCommerceGQLError) {
      return submission.reply({
        formErrors: [error.errors.find((gql) => gql.message)?.message || t('Auth.registerFailed')],
      });
    }

    throw error;
  }

  const cartId = await getCartId();

  await signIn('password', { email, password, cartId: cartId ?? '', redirect: false });

  redirect('/account/orders');
}
